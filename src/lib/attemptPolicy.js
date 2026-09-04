// FORK(attempts): the two ceilings on one client request's account walk. Upstream had none —
// the attempt count was simply the number of accounts, so a provider with hundreds of
// connections turned one client request into hundreds of upstream ones.
//
// Pure and dependency-free, like lockPolicy.js: the server loop, settingsRepo and the Settings
// card all read from here.

/** Accounts tried in a row before the walk stops. */
export const DEFAULT_MAX_ACCOUNT_ATTEMPTS = 30;

/**
 * Milliseconds the walk may take, measured from the END of the first attempt.
 *
 * The first attempt is deliberately unbounded — a first token arriving twenty seconds in is
 * normal on coding requests, and starting the clock with the request would cut off slow but
 * working answers.
 */
export const DEFAULT_ACCOUNT_ATTEMPT_WINDOW_MS = 60 * 1000;

/**
 * Keys, defaults and UI copy. One source for the resolver, DEFAULT_SETTINGS and the card, so a
 * field's placeholder cannot disagree with the value the loop uses.
 *
 * Value fields only — none of the attempt-loop stops gets a switch, because the "off" behaviour
 * is the broken one.
 */
export const ATTEMPT_SETTING_KEYS = [
  {
    key: "maxAccountAttempts",
    defaultValue: DEFAULT_MAX_ACCOUNT_ATTEMPTS,
    unit: "attempts",
    label: "Maximum accounts per request",
    hint: "High enough for a large pool, low enough that one client request cannot become hundreds of upstream ones.",
  },
  {
    key: "accountAttemptWindowMs",
    defaultValue: DEFAULT_ACCOUNT_ATTEMPT_WINDOW_MS,
    unit: "seconds",
    label: "Time budget after the first attempt",
    hint: "The first attempt is never cut short. This bounds everything after it.",
  },
];

/**
 * A configured positive number, or null when unset.
 *
 * The type is tested rather than left to Number(), same as lockPolicy.js: Number() turns
 * non-numbers into plausible small positives (Number(true) is 1) and PATCH /api/settings
 * forwards whatever a caller sends. A resolved 1 here means "never try a second account" —
 * the mechanism switching itself off silently.
 */
function readConfigured(settings, key) {
  const raw = settings?.[key];
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : null;
}

/**
 * Both ceilings for one walk. Read once per client request and passed down — re-reading per
 * attempt would make the loop's behaviour unreproducible mid-walk.
 *
 * @param {object} settings
 * @returns {{ maxAttempts: number, windowMs: number }}
 */
export function resolveAttemptLimits(settings) {
  return {
    maxAttempts: readConfigured(settings, "maxAccountAttempts") ?? DEFAULT_MAX_ACCOUNT_ATTEMPTS,
    windowMs: readConfigured(settings, "accountAttemptWindowMs") ?? DEFAULT_ACCOUNT_ATTEMPT_WINDOW_MS,
  };
}
