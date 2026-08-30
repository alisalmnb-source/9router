/**
 * FORK(tokenstat): the whole policy behind "what is this connection's token doing?".
 *
 * Two halves, deliberately in one file so they cannot drift:
 *
 *  - the WRITE shape — `buildRefreshAttempt` turns one refresh outcome into the record
 *    field `tokenRefreshAttempt`, and is the single place that decides what is stored;
 *  - the READ resolution — `resolveTokenRefreshStatus` answers eligibility, the last
 *    observed attempt and the next scheduled refresh for one connection.
 *
 * Why it lives in `src/sse/services/` rather than beside `src/lib/lockPolicy.js`:
 * `lockPolicy.js` is imported by a client component, so it must stay pure. This module
 * cannot be. It needs `getRefreshLeadMs`, whose `REFRESH_LEAD_MS` table is derived from
 * `PROVIDER_OAUTH` and therefore drags the whole provider registry in, and it needs
 * `BACKGROUND_REFRESH_LEAD_MS` from the scheduler next door — and `src/lib` importing
 * `src/sse` is a direction this codebase uses nowhere else. So the computation stays
 * server side and the UI renders what `/api/token-status` hands it. That split is the
 * `logs` shape (`requestLogsFs.js` + a dumb `LogsTab.js`), not the `locks` shape.
 *
 * **No database import here, by design.** Both existing fork policy modules keep the
 * write out — `lockPolicy.js` resolves a duration and `auth.js` performs the write;
 * `requestLogsFs.js` reads and never rewrites what it read. The one
 * `updateProviderConnection` call for this feature lives in `tokenRefresh.js`, which
 * already imports it. Adding a writer here would give the feature two write paths to
 * keep in step for no gain.
 *
 * **Nothing here is per provider, and that is the constraint to preserve.** Eligibility
 * comes from `isActive`, `authType` and the presence of a refresh token; the schedule comes
 * from upstream's own lead-time lookup; the failure reason is whatever upstream's generic
 * layer happened to return. A branch on a provider id in this file would mean the fork
 * starts tracking a table upstream maintains.
 */

import { getRefreshLeadMs, isUnrecoverableRefreshError } from "open-sse/services/tokenRefresh.js";
import { getCredentialExpiryMs, getCredentialLastRefreshMs } from "open-sse/services/oauthCredentialManager.js";
import { BACKGROUND_REFRESH_LEAD_MS } from "./backgroundTokenRefresh.js";

/**
 * The record field this feature owns. Referenced through the constant everywhere so the
 * string exists once — the write site, the read site and the fork-check grep all agree
 * by construction rather than by inspection.
 */
export const REFRESH_ATTEMPT_FIELD = "tokenRefreshAttempt";

/**
 * Upper bound on the stored provider error detail.
 *
 * Load-bearing rather than cosmetic. `GET /api/providers` spreads the whole connection
 * record and blanks only the four secret fields, and it is not loopback-only — so
 * anything written here is served to whoever can reach the dashboard, and to everyone
 * once `requireLogin` is off. The detail is a short error code in every shape upstream
 * produces today, so the cap only ever fires if upstream starts handing back prose, and
 * that is exactly the case where an unbounded copy could carry a URL or a token
 * fragment onto a public route.
 */
const REFRESH_ERROR_DETAIL_MAX = 200;

/**
 * Reduce a provider-supplied string to something safe to publish: trimmed, bounded, or
 * null when there is nothing to say. Never returns an empty string, so a caller can
 * treat null as "upstream gave no reason" without a second emptiness test.
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
 * `ok` is passed in rather than derived. The caller has already tested
 * `accessToken || apiKey || copilotToken` to decide whether to persist the credentials,
 * and that test is upstream's. Recomputing it here would be a second copy that could
 * disagree with the first, and the visible failure would be a row reporting a failed
 * refresh while new credentials sat on it.
 *
 * The two remaining fields record what upstream handed back and nothing more. Three
 * failure shapes exist in `open-sse/services/tokenRefresh/providers.js` today:
 * `null` (by far the common one — no reason available at all),
 * `{ error: "unrecoverable_refresh_error", code }` from the classified permanent branch,
 * and `{ error: "invalid_grant" }` from the dedup wrapper's catch.
 *
 * **The two stored names are not upstream's, and the mapping is crossed on purpose.**
 * Upstream puts its own classification in `error` and the provider's raw code in `code`,
 * so storing them under those names would give this record a `code` meaning one thing and
 * upstream's `code` meaning another. `classification` and `providerCode` say which is
 * which, and the two locals below exist so the crossing is legible at the assignment
 * rather than only in this paragraph. Whether the classification means "re-authenticate"
 * is NOT stored — see `resolveTokenRefreshStatus`.
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
 * Three conditions, and **all three come from upstream — but from two different levels,
 * which is the part that is easy to get wrong.** `selectConnectionsNeedingRefresh` in
 * `backgroundTokenRefresh.js` supplies the `authType` test (including its `_`-stripping
 * normalisation) and the `refreshToken` test. The `isActive` test is not in that function
 * at all: it is the filter on the list handed to it, `getProviderConnections({ isActive:
 * true })` in `loadActiveConnections`. Reading only the selector misses it, and the
 * resulting row promises a refresh that cannot happen.
 *
 * `isActive` is doubly load-bearing, because the request path applies the same filter —
 * `getProviderConnections({ provider, isActive: true })` in `src/sse/services/auth.js`.
 * So a disabled connection is refreshed by neither the sweep nor a request, which is why
 * it is excluded here rather than merely reported as unscheduled: "refreshes on demand"
 * would be just as untrue as naming a time.
 *
 * Deliberately not a `scheduled`-style soft signal. An excluded connection reports
 * `{ eligible: false }` and its row renders nothing, matching how `ConnectionRow` already
 * hides `CooldownTimer` and `lastError` behind `connection.isActive !== false`. The record
 * keeps its `tokenRefreshAttempt`, so re-enabling the connection brings the line back with
 * its history intact — nothing is lost by staying quiet while it is off.
 *
 * Reads `refreshToken` off the raw record, which is why the route behind this reads
 * connections from the repository rather than through `GET /api/providers` — that route
 * blanks the field.
 *
 * @param {object} connection
 * @returns {boolean}
 */
function isRefreshEligible(connection) {
  if (!connection) return false;
  // `=== false` rather than a truthiness test: `rowToConn` always materialises this as a
  // boolean, but a connection reaching here from anywhere else with the field absent
  // should read as active, which is the same default `ConnectionRow`'s Toggle applies.
  if (connection.isActive === false) return false;
  const authType = String(connection.authType || "").toLowerCase().replace(/_/g, "");
  if (authType !== "oauth") return false;
  return !!connection.refreshToken;
}

/**
 * The effective lead time for one provider — how far ahead of expiry a refresh fires.
 *
 * Mirrors `selectConnectionsNeedingRefresh`'s `Math.max`, and both operands are imported
 * rather than written down. `getRefreshLeadMs` already falls back to
 * `TOKEN_EXPIRY_BUFFER_MS` for a provider with no declared lead, so the `Number.isFinite`
 * guard is only there because the max of a non-number would poison the result.
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
 * The scheduler's test is `expiresAtMs - nowMs < leadMs`, so the instant it starts
 * saying yes is `expiresAtMs - leadMs`. This returns that instant, which is a **due
 * time, not a scheduled one**: the sweep runs on its own interval, so the refresh
 * happens on the first tick after this moment, and a value in the past means "already
 * due" rather than "missed".
 *
 * Null when the record carries no expiry. That is not a gap in this function — such a
 * connection is skipped by `selectConnectionsNeedingRefresh` outright and only ever
 * refreshes reactively, so there is no next time to name and the UI must not invent one.
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
 * Deliberately NOT a validator for the whole shape. `buildRefreshAttempt` above is the
 * only writer — nothing else in this repository names `REFRESH_ATTEMPT_FIELD` — and it
 * emits all four keys unconditionally, so screening them would be defending against a
 * producer that does not exist.
 *
 * The two checks that stay are about what a bad value does downstream, not about who
 * wrote it:
 *
 *   - the object test, because the field lands in a free-form `data` blob and everything
 *     below it reads properties off the result;
 *   - `at` being a parseable date string, because `TokenStatus` hands it to
 *     `getRelativeTime`, which is upstream's and carries no NaN guard of its own:
 *     `Math.floor(NaN / 60000)` fails every comparison in it and the row renders
 *     "refreshed NaNd ago". Returning null instead degrades to `lastRefreshAt`, or to "no
 *     refresh recorded yet". The type and the parseability are one test rather than two
 *     because they answer one question, and together they are what makes the `at: string`
 *     in the return type below true rather than aspirational.
 *
 * `ok` is normalised rather than screened, so the returned shape is boolean by
 * construction and no caller has to test it.
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
 * `tokenRefreshAttempt` has exactly one writer — `recordRefreshAttempt` in
 * `tokenRefresh.js`, reachable only through `checkAndRefreshToken`. Other paths refresh
 * the same credential by calling `refreshProviderCredentials` directly, and
 * `mergeRefreshedCredentials` stamps `lastRefreshAt` on every one of them while nothing
 * records an attempt: `src/app/api/providers/[id]/test/testUtils.js` — the Test button in
 * the same row as this status line — plus `src/app/api/translator/send/route.js`,
 * `src/app/api/usage/[connectionId]/route.js`, and codex login and bulk import.
 *
 * Without this check the stored record wins unconditionally and the row goes stale. The
 * visible failure is a *failed* attempt outliving its cause: press Test, watch it succeed
 * and set `testStatus` back to `active`, and the line under the now-green badge still asks
 * for re-authentication. Re-authenticating does not clear it either, because the record
 * survives the connection update. It would sit there until the sweep next refreshes this
 * connection for real, which for a long-lived token is days away.
 *
 * **The comparison is strict, and its direction is the whole guard — never turn it into an
 * equality test.** On the `checkAndRefreshToken` success path both stamps describe the same
 * event but come from two separate `Date.now()` calls: `mergeRefreshedCredentials` takes
 * the earlier and `buildRefreshAttempt` the later, so `attempt.at` lands 1 to 2 ms ahead
 * and the attempt correctly keeps precedence. `lastRefreshAt` can only end up later than
 * `attempt.at` if one of the paths above wrote it.
 *
 * Applied to successful attempts too, not only failed ones. `lastRefreshAt` is a
 * success-only stamp, so when it wins the row still reads "refreshed …" and only the time
 * changes — from a stale one to the true one. It also keeps the rule to one sentence,
 * "the newer stamp wins", instead of two cases.
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
 * Everything the UI needs about one connection's token, in one object.
 *
 * `permanent` is resolved here rather than stored, using upstream's own
 * `isUnrecoverableRefreshError` against the stored code. Storing it would be a derived
 * value that goes stale the moment upstream retunes which codes count as permanent, and
 * it would go stale plausibly — the flag would still read as a boolean and still look
 * right. Resolving at read time cannot drift from upstream at all.
 *
 * `lastRefreshAt` is upstream's success-only stamp, and the two are not interchangeable:
 * it carries no outcome, so it can only ever say "refreshed", never "failed".
 *
 * **Both fields are always emitted, and `attempt` is the one that wins.** The stale record
 * is dropped by `isSupersededByLastRefresh` — see there for why the fork's own record is
 * not automatically the better of the two — so `attempt` is null exactly when it must not
 * be trusted, and only then does `lastRefreshAt` become the answer. That makes "prefer
 * `attempt`, fall back to `lastRefreshAt`" a complete rule for a consumer, which is the
 * one `TokenStatus.js` applies to put a single history line on the row. Do not reduce this
 * to one field on the way out: `lastRefreshAt` is a success-only stamp, so suppressing it
 * whenever an attempt survives would throw away the last known *success* time — the one
 * thing a future consumer would want beside a failed attempt, and the one thing nothing
 * else on the record carries.
 *
 * Returns `{ eligible: false }` and nothing else for a connection with no refresh to
 * report on, so the caller has one field to branch on and no half-filled object to
 * reason about.
 *
 * @param {object} connection
 * @returns {object}
 */
export function resolveTokenRefreshStatus(connection) {
  if (!isRefreshEligible(connection)) return { eligible: false };

  const nextRefreshDueAt = resolveNextRefreshDueAt(connection);
  const lastRefreshMs = getCredentialLastRefreshMs(connection);
  const stored = readRefreshAttempt(connection);
  const attempt = isSupersededByLastRefresh(stored, lastRefreshMs) ? null : stored;

  return {
    eligible: true,
    // Whether the background sweep will ever pick this connection up. False means the
    // record has no expiry, so nothing is scheduled and the token is refreshed only
    // when a request fails against it.
    scheduled: nextRefreshDueAt !== null,
    nextRefreshDueAt,
    attempt: attempt
      ? { ...attempt, permanent: isUnrecoverableRefreshError({ error: attempt.classification }) }
      : null,
    lastRefreshAt: lastRefreshMs === null ? null : new Date(lastRefreshMs).toISOString(),
  };
}
