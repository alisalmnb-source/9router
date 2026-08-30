// FORK(locks): settings-driven lock durations.
//
// open-sse computes cooldowns from static constants in config/errorConfig.js, in a
// pure synchronous function that cannot read the database. This module remaps that
// computed duration onto a configured one inside markAccountUnavailable
// (src/sse/services/auth.js), which every modality handler routes its failures through,
// so nothing under open-sse/ has to change.
//
// One path escapes it, as of v0.5.59: an antigravity quota block. src/sse/handlers/chat.js
// hard-codes shouldFallback and skips markAccountUnavailable entirely when
// handleAntigravityQuotaError comes back with a resetAt, so no configured duration is
// consulted and no modelLock_* is written. See the locks known limitations in
// FORK-CHANGES.md.
//
// Two properties are load-bearing:
//
//   1. The remapping keys are the *imported* upstream constants, never literals. If
//      upstream retunes a value, the mapping follows it instead of silently pointing
//      at a number that no longer exists in the rules table.
//   2. Anything unrecognised passes through unchanged. A new upstream rule with a
//      duration this module does not know keeps upstream's behaviour rather than
//      picking up an unrelated configured value.
//
// A setting left unset (null, "", absent, zero, negative, non-numeric) resolves to
// the upstream constant, so an install that never opens the Settings card behaves
// exactly like upstream. That is also why no numeric default is copied into
// DEFAULT_SETTINGS — see "Rules that outlive a feature" in FORK-CHANGES.md.
//
// Pure and dependency-free on purpose: imported by the server (auth.js) and by the
// client (LockDurationsCard.js). errorConfig.js has no imports of its own.

import {
  BACKOFF_CONFIG,
  COOLDOWN_MS,
  MAX_RATE_LIMIT_COOLDOWN_MS,
  TRANSIENT_COOLDOWN_MS,
} from "open-sse/config/errorConfig.js";

/**
 * The settings keys this feature adds, their upstream counterparts, and their UI copy.
 *
 * Single source for the resolver and the Settings card. `upstreamMs` is read from the
 * imported constant rather than written out, so the card's placeholder and the
 * resolver's fallback can never disagree with each other or with upstream.
 *
 * BACKOFF_CONFIG.maxLevel is deliberately absent. It caps the stored counter, not the
 * duration, and `lockBackoffMaxMs` already caps the duration — so it only becomes the
 * effective ceiling when lockBackoffMaxMs > lockBackoffBaseMs * 2^(maxLevel - 1).
 * Exposing it would be a control that does nothing in every other configuration.
 */
export const LOCK_SETTING_KEYS = [
  {
    key: "lockBackoffBaseMs",
    upstreamMs: BACKOFF_CONFIG.base,
    label: "Rate limit — first step",
    hint: "First cooldown after a rate limit. Each further failure doubles it.",
  },
  {
    key: "lockBackoffMaxMs",
    upstreamMs: BACKOFF_CONFIG.max,
    label: "Rate limit — ceiling",
    hint: "The doubling stops here. Raised to the first step if set below it.",
  },
  {
    key: "lockAuthCooldownMs",
    upstreamMs: COOLDOWN_MS.unauthorized,
    label: "Auth and access errors",
    hint: "401, 402, 403, 404, and the \"no credentials\" / \"improperly formed request\" messages.",
  },
  {
    key: "lockShortCooldownMs",
    upstreamMs: COOLDOWN_MS.requestNotAllowed,
    label: "Request not allowed",
    hint: "The one rule upstream treats as near-instantly retryable.",
  },
  {
    key: "lockTransientCooldownMs",
    upstreamMs: TRANSIENT_COOLDOWN_MS,
    label: "Transient and unknown errors",
    hint: "Everything the rules table does not match: 500, 502, 503, 504, network failures. Fires most often.",
  },
  {
    key: "lockProviderResetCapMs",
    upstreamMs: MAX_RATE_LIMIT_COOLDOWN_MS,
    label: "Provider-reported reset cap",
    hint: "Ceiling on a reset time the provider sends itself. Not a duration — lowering it shortens those locks, raising it only stops the clamping.",
  },
];

const UPSTREAM_DEFAULTS = new Map(
  LOCK_SETTING_KEYS.map(({ key, upstreamMs }) => [key, upstreamMs])
);

/**
 * A configured duration, or null when unset.
 *
 * Zero and negatives are rejected rather than honoured: a zero cooldown would write a
 * lock that has already expired, which reads as "no lock at all" and would quietly
 * turn off the backoff the rest of this feature exists to lengthen.
 *
 * The type is screened before Number() rather than after, and that ordering is the
 * guard rather than tidiness. Number() maps several non-numbers onto plausible small
 * positives — Number(true) is 1 and Number([5]) is 5 — so a value-only check would
 * honour either as a millisecond cooldown and land in exactly the case above. The
 * Settings card cannot produce one, since its input is type="number" and hands over a
 * string, but PATCH /api/settings deletes PROTECTED_SETTING_KEYS and forwards
 * everything else, so whatever a caller sends reaches the blob unexamined.
 *
 * Numeric strings stay accepted: "120" is what the card itself writes.
 */
function readConfiguredMs(settings, key) {
  const raw = settings?.[key];
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Configured value for `key`, falling back to the upstream constant. */
function effectiveMs(settings, key) {
  const configured = readConfiguredMs(settings, key);
  return configured === null ? UPSTREAM_DEFAULTS.get(key) : configured;
}

/**
 * Upstream fixed duration → configured duration.
 *
 * Values that collide are dropped rather than mapped. Today the three constants hold
 * three different numbers, but if upstream ever makes two of them equal, one category
 * would otherwise silently take the other's configured value. Dropping the ambiguous
 * entry means both fall through to upstream's own duration instead — wrong in a way
 * that matches upstream rather than wrong in a way nobody asked for. Checklist item
 * 11 in FORK-CHANGES.md is what notices the collision.
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
 * Configured exponential backoff duration for a level.
 *
 * Mirrors getQuotaCooldown in open-sse/services/accountFallback.js, including its
 * `level - 1` offset — upstream stores the level, so the two formulas have to agree on
 * what a stored level means. Checklist item 13 pins that.
 *
 * The ceiling is raised to the first step when it is set below it: a first step larger
 * than the ceiling is incoherent, and silently clipping it would make a large base
 * value look like it had no effect.
 *
 * @param {number} backoffLevel - The level upstream just computed (always >= 1).
 * @param {object} settings
 * @returns {number} Cooldown in milliseconds.
 */
export function resolveBackoffCooldownMs(backoffLevel, settings) {
  const base = effectiveMs(settings, "lockBackoffBaseMs");
  const ceiling = Math.max(effectiveMs(settings, "lockBackoffMaxMs"), base);
  const step = Math.max(0, Number(backoffLevel) - 1);
  return Math.min(base * Math.pow(2, step), ceiling);
}

/**
 * Ceiling for a reset time the provider reported itself.
 *
 * Replaces MAX_RATE_LIMIT_COOLDOWN_MS at its only call site. In practice only
 * executors/codex.js feeds that path.
 */
export function resolveProviderResetCapMs(settings) {
  return effectiveMs(settings, "lockProviderResetCapMs");
}

/**
 * Remap a duration that checkFallbackError just computed onto the configured one.
 *
 * Only ever call this with checkFallbackError's return value. The `newBackoffLevel`
 * field is how a ladder duration is told apart from a fixed one, and upstream sets it
 * exclusively on backoff rules — the other two branches in markAccountUnavailable
 * also assign that name, which is why they are resolved separately and never routed
 * through here.
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
