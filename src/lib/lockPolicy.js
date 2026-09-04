// FORK(locks): settings-driven lock durations.
//
// open-sse computes cooldowns from static constants in a pure function that cannot read the
// database. This module remaps that computed duration onto a configured one inside
// markAccountUnavailable (src/sse/services/auth.js), which every modality routes failures
// through — so nothing under open-sse/ changes.
//
// Two load-bearing properties:
//   1. The remapping keys are the IMPORTED upstream constants, never literals. Upstream
//      retuning a value is then followed automatically.
//   2. Anything unrecognised passes through unchanged, so a new upstream rule keeps upstream's
//      duration rather than picking up an unrelated configured one.
//
// Accepted cost: an install that never opens the Settings card no longer behaves like upstream.
// It locks accounts considerably longer. That is the point of the values, not a side effect.
//
// One path escapes this module entirely: an antigravity quota block in src/sse/handlers/chat.js
// skips markAccountUnavailable, so no configured duration is read and no lock is written.
//
// Pure and dependency-free, because both auth.js and LockDurationsCard.js import it.

import {
  BACKOFF_CONFIG,
  COOLDOWN_MS,
  MAX_RATE_LIMIT_COOLDOWN_MS,
  TRANSIENT_COOLDOWN_MS,
} from "open-sse/config/errorConfig.js";

/**
 * Keys, their upstream counterparts, the fork's default where it has one, and UI copy.
 *
 * `upstreamMs` is read from the imported constant, never written out, so the reference can
 * never disagree with upstream. `forkDefaultMs` is the fork's own number and is stored nowhere —
 * an install with an empty card writes no settings at all.
 *
 * BACKOFF_CONFIG.maxLevel is deliberately absent: it caps the stored counter, not the duration,
 * and with these defaults it would only become the effective ceiling after about 17 days.
 */
export const LOCK_SETTING_KEYS = [
  {
    key: "lockBackoffBaseMs",
    upstreamMs: BACKOFF_CONFIG.base,
    forkDefaultMs: 90 * 1000,
    label: "Rate limit — first step",
    hint: "First cooldown after a rate limit. Each further failure doubles it.",
  },
  {
    key: "lockBackoffMaxMs",
    upstreamMs: BACKOFF_CONFIG.max,
    forkDefaultMs: 90 * 60 * 1000,
    label: "Rate limit — ceiling",
    hint: "The doubling stops here. Raised to the first step if set below it.",
  },
  {
    key: "lockAuthCooldownMs",
    upstreamMs: COOLDOWN_MS.unauthorized,
    // 5m against upstream's 2m. Costs one upstream test, which pins a 402 lock at exactly +2
    // minutes by reading upstream's constant through this fallback. Expected to fail.
    forkDefaultMs: 5 * 60 * 1000,
    label: "Auth and access errors",
    hint: "401, 402, 403, 404, and the \"no credentials\" / \"improperly formed request\" messages.",
  },
  {
    key: "lockShortCooldownMs",
    upstreamMs: COOLDOWN_MS.requestNotAllowed,
    forkDefaultMs: 30 * 1000,
    label: "Request not allowed",
    hint: "The one rule upstream treats as near-instantly retryable. Levelled with transient errors here.",
  },
  {
    key: "lockTransientCooldownMs",
    // No forkDefaultMs on purpose: the wanted value is 30s, which is already upstream's, so
    // writing it here would duplicate an upstream constant and stop following a retune.
    upstreamMs: TRANSIENT_COOLDOWN_MS,
    label: "Transient and unknown errors",
    hint: "Everything the rules table does not match: 500, 502, 503, 504, network failures. Fires most often.",
  },
  {
    key: "lockProviderResetCapMs",
    upstreamMs: MAX_RATE_LIMIT_COOLDOWN_MS,
    forkDefaultMs: 90 * 60 * 1000,
    label: "Provider-reported reset cap",
    hint: "Ceiling on a reset time the provider sends itself. Not a duration — lowering it shortens those locks, raising it only stops the clamping.",
  },
];

/**
 * What an unset field resolves to. Derived rather than written twice, so the card's placeholder
 * cannot disagree with the resolver's fallback.
 */
export function defaultLockMs({ forkDefaultMs, upstreamMs }) {
  return Number.isFinite(forkDefaultMs) ? forkDefaultMs : upstreamMs;
}

const EFFECTIVE_DEFAULTS = new Map(
  LOCK_SETTING_KEYS.map((entry) => [entry.key, defaultLockMs(entry)])
);

/**
 * A configured duration, or null when unset.
 *
 * The type is tested rather than left to Number() to reject: Number() maps non-numbers onto
 * plausible small positives (Number(true) is 1) and PATCH /api/settings forwards whatever a
 * caller sends. A 1 ms cooldown writes a lock that has already expired, which reads as no lock
 * at all — the backoff this feature exists to lengthen, switched off silently.
 */
function readConfiguredMs(settings, key) {
  const raw = settings?.[key];
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : null;
}

/** Configured value for `key`, falling back to that key's default. */
function effectiveMs(settings, key) {
  const configured = readConfiguredMs(settings, key);
  return configured === null ? EFFECTIVE_DEFAULTS.get(key) : configured;
}

/**
 * Upstream fixed duration → configured duration.
 *
 * Colliding keys are dropped rather than mapped: if upstream ever makes two of these constants
 * equal, one category would otherwise silently take the other's configured value. Dropping the
 * entry sends both to upstream's own duration instead.
 *
 * The collision test is on the KEYS, which are upstream's durations. Two *resolved* values being
 * equal is fine and is the shipped state — lockShortCooldownMs and lockTransientCooldownMs both
 * default to 30s while their upstream keys are 5s and 30s.
 */
function buildFixedCooldownMap(settings) {
  const pairs = [
    [COOLDOWN_MS.unauthorized, effectiveMs(settings, "lockAuthCooldownMs")],
    [COOLDOWN_MS.requestNotAllowed, effectiveMs(settings, "lockShortCooldownMs")],
    [TRANSIENT_COOLDOWN_MS, effectiveMs(settings, "lockTransientCooldownMs")],
  ];

  const map = new Map();
  const ambiguous = new Set();
  for (const [upstreamMs, configuredMs] of pairs) {
    if (!Number.isFinite(upstreamMs)) continue;
    if (map.has(upstreamMs)) {
      ambiguous.add(upstreamMs);
      continue;
    }
    map.set(upstreamMs, configuredMs);
  }
  for (const value of ambiguous) map.delete(value);
  return map;
}

/**
 * Configured exponential backoff for a level.
 *
 * Mirrors getQuotaCooldown in open-sse/services/accountFallback.js including its `level - 1`
 * offset — upstream stores the level, so both formulas must agree on what a stored level means.
 *
 * @param {number} backoffLevel - The level upstream just computed (always >= 1).
 * @param {object} settings
 * @returns {number} Cooldown in milliseconds.
 */
function resolveBackoffCooldownMs(backoffLevel, settings) {
  const base = effectiveMs(settings, "lockBackoffBaseMs");
  const ceiling = Math.max(effectiveMs(settings, "lockBackoffMaxMs"), base);
  const step = Math.max(0, Number(backoffLevel) - 1);
  return Math.min(base * Math.pow(2, step), ceiling);
}

/** Ceiling for a provider-reported reset. Replaces MAX_RATE_LIMIT_COOLDOWN_MS at its one call site. */
export function resolveProviderResetCapMs(settings) {
  return effectiveMs(settings, "lockProviderResetCapMs");
}

/**
 * Remap a duration checkFallbackError just computed onto the configured one.
 *
 * Only ever call this with checkFallbackError's return value. `newBackoffLevel` is how a ladder
 * duration is told apart from a fixed one, and upstream sets it exclusively on backoff rules —
 * the other two branches in markAccountUnavailable assign that same field name, which is why
 * they are resolved separately and never routed through here.
 *
 * @param {{ cooldownMs: number, newBackoffLevel?: number }} classified
 * @param {object} settings
 * @returns {number} Cooldown in milliseconds.
 */
export function resolveLockCooldownMs(classified, settings) {
  const upstreamMs = Number(classified?.cooldownMs);
  if (!Number.isFinite(upstreamMs) || upstreamMs <= 0) return classified?.cooldownMs;

  const level = Number(classified?.newBackoffLevel);
  if (Number.isFinite(level) && level >= 1) {
    return resolveBackoffCooldownMs(level, settings);
  }

  const override = buildFixedCooldownMap(settings).get(upstreamMs);
  return Number.isFinite(override) ? override : upstreamMs;
}

/** Shared with the Settings card so the unit conversion has one home. */
export function msToSeconds(ms) {
  const value = Number(ms);
  return Number.isFinite(value) && value > 0 ? Math.round(value / 1000) : null;
}

/** Inverse of msToSeconds. Returns null for anything that is not a positive number. */
export function secondsToMs(seconds) {
  if (seconds === null || seconds === undefined || seconds === "") return null;
  const value = Number(seconds);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 1000) : null;
}
