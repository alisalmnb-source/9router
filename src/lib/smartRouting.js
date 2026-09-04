// FORK(smartrouting): the ordering and error counter behind the Smart Routing strategy.
//
// This is a guess ordering, not a health report — whether an account still has quota is not
// knowable before the provider says so. The design measure: picking wrong must be cheap and
// self-correcting. That is why classification leans light when unsure, and why nothing here
// blocks an account.
//
// Blocking is upstream's model lock, untouched, and the two layers are not each other's backup:
// the lock removes an account from the pool short-term; this forms a judgement long-term and
// removes nothing. The counter accumulates ACROSS lock cycles, which is why a lock alone cannot
// do this job — and which makes this module depend on lock durations staying meaningful. Tune
// them down to seconds and the counter stops measuring "still broken after a recovery period".
//
// State lives on the connection record as flat per-model fields, beside upstream's
// modelLock_<model> and backoffLevel. Persisted rather than in RAM because the counter must
// survive the hours-long lock cycles it accumulates across. Both fields therefore ride the
// connection's JSON blob and are published by GET /api/providers — accepted: one small integer
// and one timestamp per model, nothing derived from credentials.
//
// Scope is the account-and-model pair, matching the model lock. Per account would demote an
// account for every model because one model ran out.
//
// No database import — auth.js owns the writes.

import { ERROR_WEIGHT } from "./errorPolicy.js";

/**
 * The counter's budget and what each failure spends.
 *
 * Deliberately not configurable: none of the three numbers means anything alone, only relative
 * to the others. A configurable threshold of 3 would make one heavy error demote instantly,
 * switching the mechanism off without saying so.
 */
export const DEMOTE_THRESHOLD = 10;

export const ERROR_WEIGHT_POINTS = {
  [ERROR_WEIGHT.HEAVY]: 4, // quota exhaustion, credit depletion → 3 repeats to demote
  [ERROR_WEIGHT.LIGHT]: 2, // rate limits, transient failures    → 5 repeats to demote
};

// Chosen to sit alongside upstream's modelLock_ and to be greppable as a group. The model
// segment is the raw model string, so all three fields for one model line up by eye.
const ERROR_SCORE_PREFIX = "smartErrorScore_";
const DEMOTED_AT_PREFIX = "smartDemotedAt_";

/** Stand-in for "no model known", mirroring upstream's modelLock___all. */
const ALL_MODELS = "__all";

function modelSegment(model) {
  return model || ALL_MODELS;
}

/** Field holding accumulated points for one account-and-model pair. */
export function errorScoreKey(model) {
  return `${ERROR_SCORE_PREFIX}${modelSegment(model)}`;
}

/** Field holding when that pair was last sent to the bottom. */
export function demotedAtKey(model) {
  return `${DEMOTED_AT_PREFIX}${modelSegment(model)}`;
}

/**
 * FORK(smartlogs): reverse of the key builders — which model a stored field is about.
 *
 * The detail screen walks a connection's own fields to find models the registry no longer lists,
 * the one direction the builders cannot serve. Lives here so the two prefixes keep a single
 * home: a route that re-spelled them would work today and silently find nothing the day either
 * string changed.
 *
 * @param {string} key A field name from a connection record.
 * @returns {{model: string|null}|null} `__all` comes back as null; null if not one of ours.
 */
export function smartFieldModel(key) {
  if (typeof key !== "string") return null;

  const prefix = [ERROR_SCORE_PREFIX, DEMOTED_AT_PREFIX].find((p) => key.startsWith(p));
  if (!prefix) return null;

  const segment = key.slice(prefix.length);
  return { model: segment === ALL_MODELS ? null : segment };
}

/**
 * The record update for one failure. Returns fields only, so the caller folds it into the single
 * write it already performs.
 *
 * On crossing the threshold the counter resets and the timestamp is written. **The reset is what
 * makes "three repeats" a repeating unit** — without it every subsequent failure would re-stamp
 * the date and the counter would stop carrying information.
 *
 * Demotion is one move to the very bottom, not a few places down: the point is to get a troubled
 * account out of the way, not to promote healthy ones.
 *
 * @param {object} connection Current connection record.
 * @param {string|null} model Model the failure happened on.
 * @param {"heavy"|"light"} weight From classifyErrorWeight.
 * @returns {object} Fields to merge into the connection record.
 */
export function buildErrorScoreUpdate(connection, model, weight) {
  const points = ERROR_WEIGHT_POINTS[weight];
  if (!points) return {};

  const key = errorScoreKey(model);
  const current = Number(connection?.[key]) || 0;
  const next = current + points;

  if (next < DEMOTE_THRESHOLD) return { [key]: next };

  return {
    [key]: 0,
    [demotedAtKey(model)]: new Date().toISOString(),
  };
}

/**
 * The record update for a success. **Only the counter is cleared.**
 *
 * The demotion timestamp is left alone on purpose: it is a relative position that fades as other
 * accounts fail, not a state to be exited. Clearing it on the first success would let one lucky
 * request undo an accumulated judgement — and that change produces no error.
 *
 * Returns {} when there is nothing to clear, so callers can skip a write.
 */
export function buildErrorScoreClearUpdate(connection, model) {
  const key = errorScoreKey(model);
  if (!connection || !Number(connection[key])) return {};
  return { [key]: null };
}

/**
 * Order accounts by likelihood of working, most likely first. Criteria, in order:
 *
 *   1. conversations carried            (ascending)
 *   2. when last sent to the bottom     (never first, then oldest first)
 *   3. the operator's static priority   (ascending, upstream's, unchanged)
 *
 * Conversations rather than requests, because how much quota a new conversation will consume is
 * unknowable; with no information, spreading evenly is the defensible assumption. The count is
 * derived from the session bindings at read time, never kept as its own counter — a second
 * counter that missed one decrement would leave an account unfairly behind forever.
 *
 * Criterion 2 is a date, not a flag: a flag snaps an account from last to first the moment it
 * clears, regardless of whether it recovered. A date lets it climb gradually and relative to the
 * others, which also removes the need for any recovery policy.
 *
 * Two behaviours fall out with no extra rules — a new account has zero conversations and no
 * timestamp, so it lands in the top group by itself; and a demoted account whose conversations
 * drain away can climb back, which is accepted because the lock does the excluding.
 *
 * Pure: returns a new array and mutates nothing. **Call this directly from any surface that
 * displays the order** — a second comparator would eventually disagree with the real one.
 *
 * @param {Array<object>} connections Already filtered to the selectable pool.
 * @param {object} opts
 * @param {string|null} opts.model
 * @param {Map<string, number>} opts.sessionCounts connectionId → conversations carried.
 * @returns {Array<object>} New array, best first.
 */
export function sortBySmartRouting(connections, { model, sessionCounts } = {}) {
  const demoteKey = demotedAtKey(model);
  const counts = sessionCounts || new Map();

  return [...connections].sort((a, b) => {
    const loadDiff = (counts.get(a.id) || 0) - (counts.get(b.id) || 0);
    if (loadDiff !== 0) return loadDiff;

    const demoteDiff = compareDemotedAt(a[demoteKey], b[demoteKey]);
    if (demoteDiff !== 0) return demoteDiff;

    return (a.priority || 999) - (b.priority || 999);
  });
}

/**
 * Never-demoted sorts ahead of demoted; among demoted, longest-ago first.
 *
 * An unparseable value is read as never demoted, not as ancient: the field is only ever written
 * by buildErrorScoreUpdate, so an unparseable one is a corrupted record and reading it as
 * "demoted infinitely long ago" would put a possibly broken account at the front.
 */
function compareDemotedAt(left, right) {
  const a = toTimestamp(left);
  const b = toTimestamp(right);
  if (a === null && b === null) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a - b;
}

function toTimestamp(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}
