/**
 * FORK(tokenstat): the whole policy behind "what is this connection's token doing?".
 *
 * Both halves live here so they cannot drift: the WRITE shape (`buildRefreshAttempt`) and the
 * READ resolution (`resolveTokenRefreshStatus`).
 *
 * Under `src/sse/services/` rather than beside `lockPolicy.js` because it cannot be pure — it
 * needs `getRefreshLeadMs`, whose table drags in the provider registry, and
 * `BACKGROUND_REFRESH_LEAD_MS` from the scheduler next door, and `src/lib` importing `src/sse`
 * appears nowhere in this codebase. So the computation stays server-side and the UI renders what
 * the route hands it.
 *
 * **No database import, by design** — the one write for this feature lives in `tokenRefresh.js`,
 * which already imports it. A writer here would give the feature two write paths.
 *
 * **Nothing here branches on a provider id, and that is the constraint to preserve.** Eligibility,
 * schedule and failure reason all come from upstream's own tables. A provider branch would mean
 * the fork starts maintaining a copy of something upstream owns.
 */

import { getRefreshLeadMs, isUnrecoverableRefreshError } from "open-sse/services/tokenRefresh.js";
import { getCredentialExpiryMs, getCredentialLastRefreshMs } from "open-sse/services/oauthCredentialManager.js";
import { BACKGROUND_REFRESH_LEAD_MS } from "./backgroundTokenRefresh.js";

/** The record field this feature owns. Referenced through the constant so the string exists once. */
export const REFRESH_ATTEMPT_FIELD = "tokenRefreshAttempt";

/**
 * Upper bound on the stored provider error detail. **Load-bearing, not cosmetic:**
 * `GET /api/providers` spreads the whole connection record, blanks only the secret fields, and is
 * not loopback-only — so anything written here is served to whoever can reach the dashboard.
 * Upstream returns a short code today, so the cap only fires if it starts handing back prose,
 * which is exactly the case where an unbounded copy could carry a URL or token fragment.
 */
const REFRESH_ERROR_DETAIL_MAX = 200;

/**
 * Trim and bound a provider-supplied string. Never returns "", so callers can treat null as
 * "upstream gave no reason" without a second emptiness test.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
function reduceDetail(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > REFRESH_ERROR_DETAIL_MAX
    ? trimmed.slice(0, REFRESH_ERROR_DETAIL_MAX)
    : trimmed;
}

/**
 * Shape one refresh outcome into the stored record field.
 *
 * **`ok` is passed in, never derived.** The caller has already tested whether to persist the
 * credentials, and that test is upstream's; recomputing it here could disagree, and the visible
 * failure would be a row reporting a failed refresh while new credentials sat on it.
 *
 * **The two stored names cross upstream's on purpose.** Upstream puts its own classification in
 * `error` and the provider's raw code in `code`, so reusing those names would give this record a
 * `code` meaning something different from upstream's. Both go through `reduceDetail` because
 * `GET /api/providers` publishes them.
 *
 * @param {boolean} ok
 * @param {object|null} refreshResult  what `refreshProviderCredentials` returned
 * @param {number} [nowMs]
 * @returns {{ at: string, ok: boolean, classification: string|null, providerCode: string|null }}
 */
export function buildRefreshAttempt(ok, refreshResult, nowMs = Date.now()) {
  const classification = refreshResult?.error;
  const providerCode = refreshResult?.code;
  return {
    at: new Date(nowMs).toISOString(),
    ok: !!ok,
    classification: ok ? null : reduceDetail(classification),
    providerCode: ok ? null : reduceDetail(providerCode),
  };
}

/**
 * Will anything refresh this connection?
 *
 * All three conditions are upstream's, **but they come from two different levels.**
 * `selectConnectionsNeedingRefresh` supplies the authType and refreshToken tests; the isActive
 * test is not in that function at all — it is the filter on the list handed to it, one level up
 * in `loadActiveConnections`. Reading only the selector misses it, and the resulting row promises
 * a refresh that cannot happen.
 *
 * isActive is doubly load-bearing because the request path applies the same filter, so a disabled
 * connection is refreshed by neither the sweep nor a request. That is why it is excluded outright
 * rather than reported as unscheduled — "refreshes on demand" would be just as untrue.
 *
 * Reads `refreshToken` off the raw record, which is why the route behind this goes to the
 * repository rather than `GET /api/providers`, which blanks the field.
 *
 * @param {object} connection
 * @returns {boolean}
 */
function isRefreshEligible(connection) {
  if (!connection) return false;
  // `=== false` rather than truthiness: a record reaching here with the field absent should read
  // as active, the same default ConnectionRow's Toggle applies.
  if (connection.isActive === false) return false;
  const authType = String(connection.authType || "").toLowerCase().replace(/_/g, "");
  if (authType !== "oauth") return false;
  return !!connection.refreshToken;
}

/**
 * Effective lead time for one provider. Mirrors the scheduler's `Math.max`, and **both operands
 * are imported rather than written down**, so an upstream retune is followed automatically.
 *
 * @param {string} provider
 * @returns {number} milliseconds
 */
function resolveRefreshLeadMs(provider) {
  const providerLead = getRefreshLeadMs(provider);
  return Math.max(
    Number.isFinite(providerLead) ? providerLead : 0,
    BACKGROUND_REFRESH_LEAD_MS
  );
}

/**
 * When this connection becomes due for a proactive refresh.
 *
 * A **due** time, not a scheduled one: the sweep runs on its own interval, so the refresh happens
 * on the first tick after this moment and a past value means "already due", not "missed".
 *
 * Null when the record carries no expiry — such a connection is skipped by the selector outright
 * and only ever refreshes reactively, so there is no next time to name and the UI must not invent
 * one.
 *
 * @param {object} connection
 * @returns {string|null} ISO timestamp
 */
function resolveNextRefreshDueAt(connection) {
  const expiresAtMs = getCredentialExpiryMs(connection);
  if (expiresAtMs === null) return null;
  return new Date(expiresAtMs - resolveRefreshLeadMs(connection?.provider)).toISOString();
}

/**
 * Read the stored attempt back.
 *
 * Deliberately not a validator for the whole shape — `buildRefreshAttempt` is the only writer and
 * emits all four keys. The two checks that stay are about what a bad value does downstream: the
 * object test, because the field lands in a free-form blob; and `at` being parseable, because
 * `TokenStatus` hands it to upstream's `getRelativeTime`, which has no NaN guard and would render
 * "refreshed NaNd ago".
 *
 * @param {object} connection
 * @returns {{ at: string, ok: boolean, classification: string|null, providerCode: string|null }|null}
 */
function readRefreshAttempt(connection) {
  const stored = connection?.[REFRESH_ATTEMPT_FIELD];
  if (!stored || typeof stored !== "object") return null;
  if (typeof stored.at !== "string" || Number.isNaN(new Date(stored.at).getTime())) return null;
  return {
    at: stored.at,
    ok: !!stored.ok,
    classification: reduceDetail(stored.classification),
    providerCode: reduceDetail(stored.providerCode),
  };
}

/**
 * Has something refreshed this credential since the stored attempt was recorded?
 *
 * Needed because only two of four refresh paths record an attempt, while every path stamps
 * upstream's `lastRefreshAt`. Without this check a *failed* attempt outlives its cause: press
 * Test, watch it succeed, and the line under the now-green badge still asks for
 * re-authentication — and re-authenticating does not clear it either.
 *
 * **The comparison is strict (`>`), and its direction is the whole guard — never relax it to
 * equality.** On the covered path both stamps describe the same event from two separate clock
 * reads, with the attempt taking the later one, so it correctly keeps precedence. An equality
 * test would let the fork's own record discard itself and the row would look never-updated.
 *
 * Applied to successful attempts too, so the rule stays one sentence: the newer stamp wins.
 *
 * @param {{at: string}|null} attempt - as returned by readRefreshAttempt, so `at` parses
 * @param {number|null} lastRefreshMs
 * @returns {boolean}
 */
function isSupersededByLastRefresh(attempt, lastRefreshMs) {
  if (!attempt || lastRefreshMs === null) return false;
  return lastRefreshMs > new Date(attempt.at).getTime();
}

/**
 * Everything the UI needs about one connection's token.
 *
 * **`permanent` is resolved here, never stored.** A stored flag goes stale the moment upstream
 * retunes which codes count as permanent, and it goes stale *plausibly* — still a boolean, still
 * looking right. Resolving at read time cannot drift.
 *
 * Both `attempt` and `lastRefreshAt` are always emitted and `attempt` wins, because the stale
 * record is already dropped above. Do not reduce this to one field on the way out: `lastRefreshAt`
 * is success-only, so suppressing it whenever an attempt survives throws away the last known
 * *success* time — the one thing nothing else on the record carries.
 *
 * @param {object} connection
 * @returns {object} `{ eligible: false }` and nothing else when there is no refresh to report on.
 */
export function resolveTokenRefreshStatus(connection) {
  if (!isRefreshEligible(connection)) return { eligible: false };

  const nextRefreshDueAt = resolveNextRefreshDueAt(connection);
  const lastRefreshMs = getCredentialLastRefreshMs(connection);
  const stored = readRefreshAttempt(connection);
  const attempt = isSupersededByLastRefresh(stored, lastRefreshMs) ? null : stored;

  return {
    eligible: true,
    // False means the record has no expiry, so nothing is scheduled and the token is refreshed
    // only when a request fails against it.
    scheduled: nextRefreshDueAt !== null,
    nextRefreshDueAt,
    attempt: attempt
      ? { ...attempt, permanent: isUnrecoverableRefreshError({ error: attempt.classification }) }
      : null,
    lastRefreshAt: lastRefreshMs === null ? null : new Date(lastRefreshMs).toISOString(),
  };
}
