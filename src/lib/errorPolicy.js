// FORK(smartrouting): the fork's own error classification.
//
// Nothing upstream to reuse: checkFallbackError returns a cooldown duration and sometimes an
// escalation level, never an error *type*. The table SHAPE is upstream's though — ordered rules,
// top to bottom, first match wins — so either table reads like the other.
//
// **This module is the only place a matched phrase lives.** A growing list written down twice
// drifts. Two entry points over one table: classifyErrorWeight (how heavily does this count
// against the account) and isBadRequest (is the request itself at fault).
//
// Pure and dependency-free, like lockPolicy.js.
//
// ── Reliability order, implemented as the step sequence in classifyErrorWeight ───────────
//   structured error fields > response headers > status code > free-form message
// Free text is written for humans and changes without notice; a field or header is a contract.
// **Reordering the steps inverts that, and produces no error.**

/** The two weight groups. Points per group live in src/lib/smartRouting.js. */
export const ERROR_WEIGHT = {
  HEAVY: "heavy",
  LIGHT: "light",
};

/**
 * The single threshold that turns a provider-reported wait into a weight. One threshold rather
 * than a curve: the question is only "minutes-scale or hours-scale".
 */
const HEAVY_WAIT_MS = 60 * 60 * 1000;

// ── Phrase table ─────────────────────────────────────────────────────────────
// Lower-cased substrings, matched against the lower-cased message. **Narrow phrases must precede
// broader ones that would shadow them; a shadowed rule never runs and never errors.**

/**
 * Permanent credit or billing exhaustion. Heavy, and checked before any reported wait, because
 * credit does not come back with time — a short retry-after paired with one of these is a wait
 * that will change nothing.
 */
const CREDIT_PHRASES = [
  "insufficient_quota",
  "insufficient credit",
  "insufficient credits",
  "insufficient funds",
  "insufficient balance",
  "credit balance is too low",
  "out of credit",
  "no credit remaining",
  "not enough credit",
  "add credits",
  "purchase more credits",
  "buy more credits",
  "billing_not_active",
  "billing hard limit",
  "billing details",
  "payment required",
  "payment method",
  "subscription has expired",
  "subscription expired",
  "plan has expired",
  "spending limit",
  "budget has been exceeded",
  "account balance",
  "top up",
];

/**
 * Quota exhaustion for the current period. Heavy, but checked *after* a reported wait, because
 * several providers phrase a per-minute rate limit in exactly this language while reporting a
 * wait measured in seconds.
 */
const QUOTA_PHRASES = [
  "quota exceeded",
  "quota exhausted",
  "exceeded your current quota",
  "resource_exhausted",
  "resource has been exhausted",
  "usage_limit_reached",
  "usage limit",
  "monthly limit",
  "daily limit",
  "weekly limit",
  "limit reached for",
  "you've reached your limit",
  "you have reached your limit",
  "reached the limit",
  "out of tokens",
  "token limit for your",
  "free tier",
  "trial has ended",
  "trial expired",
];

/**
 * Rate limiting and slow-down language. Never decides a weight on its own — light is
 * already the default. Its job is the isBadRequest exception: a provider that reports
 * a rate limit with status 400 must not have that read as a broken request.
 */
const RATE_LIMIT_PHRASES = [
  "rate limit",
  "rate_limit",
  "ratelimit",
  "too many requests",
  "too many concurrent",
  "slow down",
  "requests per",
  "tokens per minute",
  "concurrency limit",
  "overloaded",
  "at capacity",
  "capacity constraints",
  "try again later",
  "please retry",
  "temporarily unavailable",
];

/**
 * Credential and key problems. Heavy, and **the suppressor**: some providers report a bad key in
 * a sentence that names a model ("invalid api key for model x"), so a model-shaped rule matches,
 * the real cause is hidden, and the request walks every account failing identically. Matching
 * these before the status map is what prevents it.
 *
 * Structured fields are checked earlier and are deliberately unaffected — a provider that states
 * the cause in a field has already been believed.
 */
const AUTH_PHRASES = [
  "invalid api key",
  "invalid_api_key",
  "incorrect api key",
  "api key not valid",
  "api key expired",
  "no api key",
  "missing api key",
  "invalid authentication",
  "invalid access token",
  "invalid_grant",
  "invalid credentials",
  "token has expired",
  "token is expired",
  "expired access token",
  "unauthorized",
  "authentication failed",
  "authentication_error",
  "permission_denied for api key",
  "revoked",
  "account has been suspended",
  "account suspended",
  "account is disabled",
  "account deactivated",
  "banned",
];

// ── Phrase groups: the request itself is at fault ────────────────────────────
// Positive detection only. A 400 that matches nothing here keeps today's behaviour and
// carries on to the next account — the cheap direction to be wrong in.

/** Malformed conversation: message ordering, empty content, invalid tool definitions. */
const MALFORMED_MESSAGE_PHRASES = [
  "messages: at least one message is required",
  "messages must not be empty",
  "at least one message",
  "final assistant content cannot end with trailing whitespace",
  "must alternate",
  "must be followed by",
  "first message must use",
  "unexpected role",
  "invalid role",
  "text content blocks must be non-empty",
  "content field is required",
  "content must not be empty",
  "empty message",
  "empty content",
  "invalid_message",
  "invalid message",
  "tool_use_id",
  "tool_call_id",
  "tool_use ids were found without",
  "did not have response messages",
  "invalid schema for function",
  "invalid tool",
  "tools: ",
  "function name",
  "unexpected tool",
  "no tool output found",
  "invalid json schema",
  "invalid image",
  "unsupported image",
  "could not process image",
];

/** The request is longer than the model can accept. Fails identically on every account. */
const CONTEXT_LENGTH_PHRASES = [
  "context length",
  "context_length_exceeded",
  "maximum context",
  "context window",
  "too many tokens",
  "prompt is too long",
  "input is too long",
  "request too large",
  "reduce the length",
  "string too long",
  "exceeds the maximum",
  "input length and `max_tokens` exceed",
];

/**
 * A parameter outside its permitted range or of the wrong type.
 *
 * **Test for a new entry: could this text appear on a 400 that a DIFFERENT account would have
 * served? If yes it does not belong here.** Two classes fail that test and have already been
 * removed once:
 *
 *   - a provider's generic error TYPE (`invalid_request_error` is OpenAI's blanket type for all
 *     client errors, so it matched "you do not have access to this model" — an account problem);
 *   - a phrase that is a prefix of an unrelated sentence (`must be a` matches "the request must
 *     be authenticated"), which is why the type words are spelled out individually below.
 */
const INVALID_PARAMETER_PHRASES = [
  "invalid value",
  "invalid parameter",
  "invalid_parameter",
  "unsupported parameter",
  "unsupported value",
  "unrecognized request argument",
  "unknown parameter",
  "extra inputs are not permitted",
  "must be greater than",
  "must be less than",
  "must be one of",
  "must be a number",
  "must be a string",
  "must be a boolean",
  "must be an array",
  "must be an object",
  "must be an integer",
  "is not of type",
  "decimal below minimum",
  "above maximum",
  "out of range",
  "expected a string",
  "missing required parameter",
  "required property",
  "temperature",
  "top_p",
  "max_tokens must",
  "thinking.budget_tokens",
];

// ── Structured field rules (highest reliability) ─────────────────────────────
// Matched against a provider-declared error code or type, exactly — these are machine
// values, so substring matching would be sloppy where it is least needed.

const STRUCTURED_HEAVY = new Set([
  "insufficient_quota",
  "billing_not_active",
  "quota_exceeded",
  "resource_exhausted",
  "usage_limit_reached",
  "credit_limit_reached",
  "account_deactivated",
  "invalid_api_key",
  "authentication_error",
  "permission_error",
  "invalid_grant",
  "unauthenticated",
]);

const STRUCTURED_LIGHT = new Set([
  "rate_limit_error",
  "rate_limit_exceeded",
  "overloaded_error",
  "api_error",
  "server_error",
  "internal_server_error",
  "service_unavailable",
  "unavailable",
  "timeout",
  "deadline_exceeded",
  "aborted",
]);

/**
 * Coarse status mapping — the starting point only, overridden by every step above it.
 *
 * 401 and 402 are heavy: both are about the account, and a 401 reaching here already survived the
 * token-refresh path. 403 and 404 are light because both are ambiguous and another account may
 * well succeed. Staying light when unsure costs a few requests; going heavy when unsure sends a
 * healthy account to the bottom and keeps it there.
 */
const STATUS_WEIGHT = new Map([
  [401, ERROR_WEIGHT.HEAVY],
  [402, ERROR_WEIGHT.HEAVY],
  [403, ERROR_WEIGHT.LIGHT],
  [404, ERROR_WEIGHT.LIGHT],
  [408, ERROR_WEIGHT.LIGHT],
  [500, ERROR_WEIGHT.LIGHT],
  [502, ERROR_WEIGHT.LIGHT],
  [503, ERROR_WEIGHT.LIGHT],
  [504, ERROR_WEIGHT.LIGHT],
]);

/**
 * Provider-specific rules, checked before everything else.
 *
 * Kept deliberately small — the general table is still the main road. A rule earns a
 * place here only when a provider reports something in a way the general table would
 * read backwards.
 *
 * Each entry is `(context) => weight | null`; null means "no opinion, carry on".
 * `context` is the normalised bag built by classifyErrorWeight.
 */
const PROVIDER_RULES = {
  // Codex reports its five-hour and weekly windows as usage_limit_reached with an exact
  // resets_at. The general table would see "limit" and call it heavy even when the reset
  // is minutes away, so defer to the reported wait whenever there is one.
  codex: ({ waitMs }) =>
    waitMs === null ? null : (waitMs >= HEAVY_WAIT_MS ? ERROR_WEIGHT.HEAVY : ERROR_WEIGHT.LIGHT),

  // GitHub Copilot's monthly premium-request exhaustion arrives as a 402 whose text is
  // about usage rather than billing. It is genuinely exhausted for the rest of the
  // month, and auth.js already writes an absolute month-boundary lock for it.
  github: ({ status, text }) =>
    Number(status) === 402 && text.includes("usage limit") ? ERROR_WEIGHT.HEAVY : null,

  // Antigravity's quota block is delivered as 409/429 with an exact per-model resetAt
  // that chat.js fetches from the quota API. Trust that number over the wording.
  antigravity: ({ waitMs }) =>
    waitMs === null ? null : (waitMs >= HEAVY_WAIT_MS ? ERROR_WEIGHT.HEAVY : ERROR_WEIGHT.LIGHT),
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Lower-cased string for matching. Objects are stringified rather than dropped. */
function toText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.toLowerCase();
  try {
    return JSON.stringify(value).toLowerCase();
  } catch {
    return "";
  }
}

function matchesAny(text, phrases) {
  if (!text) return false;
  return phrases.some((phrase) => text.includes(phrase));
}

/**
 * Lower-cased header bag. Accepts a Headers instance, a plain object, or nothing —
 * callers reach this module from several layers and not all of them hold the same shape.
 */
function normalizeHeaders(headers) {
  const out = {};
  if (!headers) return out;
  if (typeof headers.forEach === "function" && typeof headers.get === "function") {
    headers.forEach((value, key) => { out[String(key).toLowerCase()] = String(value); });
    return out;
  }
  if (typeof headers === "object") {
    for (const [key, value] of Object.entries(headers)) {
      if (value === null || value === undefined) continue;
      out[String(key).toLowerCase()] = String(value);
    }
  }
  return out;
}

/**
 * Parse a wait into milliseconds from now, or null when the value carries no signal.
 *
 * Accepts every shape providers actually use — seconds, unit-suffixed, compound ("1h30m"), epoch
 * seconds, epoch milliseconds, ISO-8601, HTTP dates — because a signal that exists but cannot be
 * read is worse than one never sent: nobody notices.
 *
 * **Zero and past values return null on purpose.** "Retry now" carries no minutes-vs-hours
 * information, and treating it as a signal would land under the threshold and manufacture a light
 * verdict instead of falling through to the next step.
 */
function parseWaitMs(value, now = Date.now()) {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number" && Number.isFinite(value)) {
    return fromNumber(value, now);
  }

  const raw = String(value).trim();
  if (!raw) return null;

  // Pure number: unit is ambiguous, so scale by magnitude.
  if (/^-?\d+(\.\d+)?$/.test(raw)) return fromNumber(Number(raw), now);

  // Unit-suffixed, possibly compound: "1500ms", "30s", "6m0s", "1h30m10s".
  //
  // **The unit is terminated by `(?![a-z])`, not `\b`, and that is required.** In "6m0s" the
  // character after `m` is a digit, so `\b` finds no boundary and `6m` never matches — the value
  // collapses to the trailing `0s`, reads as zero, and the wait is silently lost. The lookahead
  // accepts a following digit while still rejecting a longer word.
  const unitMatches = [...raw.matchAll(/(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?)(?![a-z])/g)];
  if (unitMatches.length > 0) {
    let total = 0;
    for (const [, amount, unit] of unitMatches) {
      total += Number(amount) * unitToMs(unit);
    }
    return total > 0 ? total : null;
  }

  // Absolute timestamp: ISO-8601 or an HTTP date.
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) {
    const delta = parsed - now;
    return delta > 0 ? delta : null;
  }

  return null;
}

function unitToMs(unit) {
  if (unit.startsWith("ms") || unit.startsWith("milli")) return 1;
  if (unit === "s" || unit.startsWith("sec")) return 1000;
  if (unit === "m" || unit.startsWith("min")) return 60 * 1000;
  if (unit === "h" || unit.startsWith("hr") || unit.startsWith("hour")) return 60 * 60 * 1000;
  if (unit === "d" || unit.startsWith("day")) return 24 * 60 * 60 * 1000;
  return 1000;
}

/**
 * A bare number is either a duration or an absolute instant. Split by magnitude:
 * anything at or beyond 1e12 is epoch milliseconds, beyond 1e10 is epoch seconds, and
 * everything smaller is a duration in seconds. The gap between "a plausible number of
 * seconds to wait" and "an epoch value" is several orders of magnitude wide, so this
 * cannot be tripped by a real wait.
 */
function fromNumber(value, now) {
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value >= 1e12) {
    const delta = value - now;
    return delta > 0 ? delta : null;
  }
  if (value >= 1e10) {
    const delta = value * 1000 - now;
    return delta > 0 ? delta : null;
  }
  return value * 1000;
}

/** Header names that carry a wait, in descending order of how specific they are. */
const WAIT_HEADER_KEYS = [
  "retry-after-ms",
  "retry-after",
  "x-ratelimit-reset-after",
  "x-ratelimit-reset-requests",
  "x-ratelimit-reset-tokens",
  "x-ratelimit-reset",
  "ratelimit-reset",
  "x-rate-limit-reset",
];

/** Body fields that carry a wait, same ordering rationale. */
const WAIT_BODY_KEYS = [
  "retry_after_ms",
  "retryafterms",
  "retry_after_seconds",
  "resets_in_seconds",
  "retry_after",
  "retryafter",
  "retry_delay",
  "retrydelay",
  "resets_at",
  "resetsat",
  "reset_at",
  "resetat",
  "reset_time",
  "available_at",
];

/**
 * Best available wait, in ms from now, or null.
 *
 * `resetsAtMs` is preferred when present because it is not a guess: an executor already
 * parsed the provider's own reset field to produce it.
 */
function resolveWaitMs({ resetsAtMs, headers, body, text }, now) {
  if (Number.isFinite(resetsAtMs)) {
    const delta = Number(resetsAtMs) - now;
    if (delta > 0) return delta;
  }

  for (const key of WAIT_HEADER_KEYS) {
    if (!(key in headers)) continue;
    const ms = parseWaitMs(headers[key], now);
    // retry-after-ms is the one header whose unit is fixed and not seconds.
    if (ms !== null) return key === "retry-after-ms" ? Number(headers[key]) || ms : ms;
  }

  if (body && typeof body === "object") {
    const flat = flattenShallow(body);
    for (const key of WAIT_BODY_KEYS) {
      if (!(key in flat)) continue;
      const ms = parseWaitMs(flat[key], now);
      if (ms !== null) return ms;
    }
  }

  // Last resort: the provider wrote the wait into the sentence.
  //
  // **The amount-and-unit group must REPEAT, and must end in `(?![a-z])` rather than `\b`.** With
  // a single group terminated by `\b`, a compound duration matches nothing at all — "resets in
  // 2h30m" returns null, not "30m", because `\D{0,24}?` cannot step over a digit to reach the
  // second component. That is a LOST signal, which is worse than a wrong one because nothing
  // reveals it. Repeating the group hands the whole run to parseWaitMs, which sums components.
  const phrase = text.match(/(?:try again|retry|available|wait|resets?)\D{0,24}?((?:\d+(?:\.\d+)?\s*(?:ms|milliseconds?|s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?)\s*)+)(?![a-z])/);
  if (phrase) return parseWaitMs(phrase[1].trim(), now);

  return null;
}

/**
 * Collect scalar leaves of a nested object into one lower-cased-key map.
 *
 * Providers bury these fields at inconsistent depths — `error.metadata.retry_after`,
 * `details[0].retryDelay` — and a fixed set of paths would miss the next one. Depth is
 * capped so a large body cannot turn this into real work.
 */
function flattenShallow(value, depth = 0, out = {}) {
  if (depth > 4 || value === null || typeof value !== "object") return out;
  for (const [key, val] of Object.entries(value)) {
    if (val === null || val === undefined) continue;
    if (typeof val === "object") {
      flattenShallow(val, depth + 1, out);
      continue;
    }
    const lower = key.toLowerCase();
    if (!(lower in out)) out[lower] = val;
  }
  return out;
}

/**
 * Structured error identifiers the provider declared, lower-cased.
 *
 * Reached through the parsed body when there is one. A provider that names its failure
 * in a field has made a statement, not a description, which is why this outranks
 * everything except a provider-specific rule.
 */
function structuredCodes(body) {
  if (!body || typeof body !== "object") return [];
  const flat = flattenShallow(body);
  const keys = ["code", "type", "status", "reason", "error_code", "errorcode", "error_type", "errortype"];
  const out = [];
  for (const key of keys) {
    const val = flat[key];
    if (typeof val === "string" && val) out.push(val.toLowerCase());
  }
  return out;
}

/**
 * Definitive header statement: the provider says nothing is left.
 *
 * Evaluated before any reported wait because it is not an estimate. "However long you
 * wait, nothing changes" is a stronger claim than "wait this long", so no estimate
 * should be able to override it.
 *
 * A limit of zero is ignored — some providers send `remaining: 0, limit: 0` on requests
 * the bucket does not apply to, and that pair means "not measured", not "exhausted".
 */
function headersDeclareExhausted(headers) {
  for (const [key, value] of Object.entries(headers)) {
    if (!key.includes("remaining")) continue;
    if (!/ratelimit|rate-limit|quota|credit|token/.test(key)) continue;
    const num = Number(String(value).trim());
    if (!Number.isFinite(num) || num > 0) continue;
    const limitKey = key.replace("remaining", "limit");
    if (limitKey in headers) {
      const limit = Number(String(headers[limitKey]).trim());
      if (Number.isFinite(limit) && limit <= 0) continue;
    }
    return true;
  }
  return false;
}

/**
 * Normalise every input into one bag, so the rule steps and the provider rules read the
 * same values and cannot disagree about what the failure said.
 */
function buildContext({ provider, status, errorText, resetsAtMs, signals }, now) {
  const headers = normalizeHeaders(signals?.headers);
  const rawBody = signals?.body;

  let parsedBody = null;
  if (rawBody && typeof rawBody === "object") {
    parsedBody = rawBody;
  } else if (typeof rawBody === "string" && rawBody.trim().startsWith("{")) {
    try { parsedBody = JSON.parse(rawBody); } catch { parsedBody = null; }
  }

  // errorText is frequently the provider's JSON body verbatim — parseUpstreamError falls
  // back to bodyText when it finds no message field — so it is a second chance at the
  // structured fields when no separate body was plumbed through.
  if (!parsedBody && typeof errorText === "string") {
    const start = errorText.indexOf("{");
    if (start !== -1) {
      try { parsedBody = JSON.parse(errorText.slice(start)); } catch { /* not JSON */ }
    }
  }

  const text = [toText(errorText), typeof rawBody === "string" ? rawBody.toLowerCase() : ""]
    .filter(Boolean)
    .join(" ");

  const context = {
    provider: String(provider || "").toLowerCase(),
    status: Number(status) || 0,
    text,
    headers,
    body: parsedBody,
    codes: structuredCodes(parsedBody),
    waitMs: null,
  };

  context.waitMs = resolveWaitMs({ resetsAtMs, headers, body: parsedBody, text }, now);
  return context;
}

// ── Entry point: classifyErrorWeight ─────────────────────────────────────────

/**
 * How heavily a failure counts against the account it happened on.
 *
 * Steps run in order, first opinion wins, and **the order is the reliability order** from the top
 * of this file.
 *
 * Anything unrecognised is light, because the two ways of being wrong are not equally priced:
 * calling a heavy failure light delays writing the account off by a couple of requests, while
 * calling a light failure heavy sends a healthy account to the bottom and keeps it there.
 *
 * @param {object} input
 * @param {string} [input.provider]    Provider id, for the provider-specific rules.
 * @param {number} [input.status]      Upstream HTTP status.
 * @param {string} [input.errorText]   Upstream message, or the raw body when there was none.
 * @param {number} [input.resetsAtMs]  Executor-parsed reset instant, when the provider sent one.
 * @param {object} [input.signals]     `{ headers, body }` captured next to the response.
 * @returns {"heavy"|"light"}
 */
export function classifyErrorWeight(input = {}) {
  const now = Date.now();
  const context = buildContext(input, now);

  // 1. Provider-specific rules — the most specific signal available.
  const providerRule = PROVIDER_RULES[context.provider];
  if (providerRule) {
    const verdict = providerRule(context);
    if (verdict) return verdict;
  }

  // 2. Structured fields the provider declared. Not affected by the suppressor below,
  //    because a declaration does not need disambiguating.
  for (const code of context.codes) {
    if (STRUCTURED_HEAVY.has(code)) return ERROR_WEIGHT.HEAVY;
    if (STRUCTURED_LIGHT.has(code)) return ERROR_WEIGHT.LIGHT;
  }

  // 3. Credential problems, stated in prose. Runs before the status map so an auth
  //    failure dressed as a 400 or a 429 is still recognised, and before anything that
  //    could read the sentence as being about a model.
  if (matchesAny(context.text, AUTH_PHRASES)) return ERROR_WEIGHT.HEAVY;

  // 4. The provider states nothing is left. Not an estimate.
  if (headersDeclareExhausted(context.headers)) return ERROR_WEIGHT.HEAVY;

  // 5. Permanent credit or billing exhaustion. Before the reported wait, because no
  //    amount of waiting adds credit.
  if (matchesAny(context.text, CREDIT_PHRASES)) return ERROR_WEIGHT.HEAVY;

  // 6. A wait the provider reported itself. Its own number beats its own prose.
  if (context.waitMs !== null) {
    return context.waitMs >= HEAVY_WAIT_MS ? ERROR_WEIGHT.HEAVY : ERROR_WEIGHT.LIGHT;
  }

  // 7. Quota exhaustion in prose, once no wait has contradicted it.
  if (matchesAny(context.text, QUOTA_PHRASES)) return ERROR_WEIGHT.HEAVY;

  // 8. Coarse status mapping.
  const byStatus = STATUS_WEIGHT.get(context.status);
  if (byStatus) return byStatus;

  // 9. Unrecognised.
  return ERROR_WEIGHT.LIGHT;
}

// ── Entry point: isBadRequest ────────────────────────────────────────────────

/**
 * Is the request itself at fault?
 *
 * Such a request fails identically on every account, and each failed attempt writes a lock — so
 * one bad request can lock every account on the model and manufacture an outage.
 *
 * **Detection is positive: only a recognised pattern counts.** Never build this as "every 400 is
 * broken except these" — then every case not yet listed switches failover off silently. The list
 * starts narrow and grows.
 *
 * The three carve-outs come first: a rate limit, credit exhaustion or quota exhaustion reported
 * with a 400 is the account's problem, not the request's, and belongs to classifyErrorWeight.
 *
 * @param {object} input
 * @param {number} [input.status]
 * @param {string} [input.errorText]
 * @returns {boolean}
 */
export function isBadRequest({ status, errorText } = {}) {
  if (Number(status) !== 400) return false;

  const text = toText(errorText);
  if (!text) return false;

  if (matchesAny(text, RATE_LIMIT_PHRASES)) return false;
  if (matchesAny(text, CREDIT_PHRASES)) return false;
  if (matchesAny(text, QUOTA_PHRASES)) return false;

  return (
    matchesAny(text, CONTEXT_LENGTH_PHRASES) ||
    matchesAny(text, MALFORMED_MESSAGE_PHRASES) ||
    matchesAny(text, INVALID_PARAMETER_PHRASES)
  );
}
