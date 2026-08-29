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
export const REFRESH_ERROR_DETAIL_MAX = 200;

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
 * and `{ error: "invalid_grant" }` from the dedup wrapper's catch. So `code` holds
 * upstream's classification and `detail` the provider's own code when there is one.
 * Whether that classification means "re-authenticate" is NOT stored — see
 * `resolveTokenRefreshStatus`.
 *
 * @param {boolean} ok
 * @param {object|null} refreshResult  what `refreshProviderCredentials` returned
 * @param {number} [nowMs]
 * @returns {{ at: string, ok: boolean, code: string|null, detail: string|null }}
 */
export function buildRefreshAttempt(ok, refreshResult, nowMs = Date.now()) {
  return {
    at: new Date(nowMs).toISOString(),
    ok: !!ok,
    code: ok ? null : reduceDetail(refreshResult?.error),
    detail: ok ? null : reduceDetail(refreshResult?.code),
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
export function isRefreshEligible(connection) {
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
export function resolveRefreshLeadMs(provider) {
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
export function resolveNextRefreshDueAt(connection) {
  const expiresAtMs = getCredentialExpiryMs(connection);
  if (expiresAtMs === null) return null;
  return new Date(expiresAtMs - resolveRefreshLeadMs(connection?.provider)).toISOString();
}

/**
 * Read the stored attempt back, screening anything that is not the shape this module
 * writes. The field lands in the connection's free-form `data` blob, so a value written
 * by an older build, or by hand, arrives here unvalidated.
 *
 * @param {object} connection
 * @returns {{ at: string, ok: boolean, code: string|null, detail: string|null }|null}
 */
function readRefreshAttempt(connection) {
  const stored = connection?.[REFRESH_ATTEMPT_FIELD];
  if (!stored || typeof stored !== "object") return null;
  if (typeof stored.at !== "string" || typeof stored.ok !== "boolean") return null;
  // Parseability, not just the type. TokenStatus hands `at` to getRelativeTime, which
  // is upstream's and carries no NaN guard of its own: Math.floor(NaN / 60000) fails
  // every comparison in it and the row renders "refreshed NaNd ago". Dropping the whole
  // attempt instead degrades to lastRefreshAt, or to "no refresh recorded yet".
  if (Number.isNaN(new Date(stored.at).getTime())) return null;
  return {
    at: stored.at,
    ok: stored.ok,
    code: reduceDetail(stored.code),
    detail: reduceDetail(stored.detail),
  };
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
 * `lastRefreshAt` is upstream's success-only stamp and is reported only as a fallback
 * for a connection this fork has not yet observed refreshing. It is not
 * interchangeable with `attempt.at`: upstream stamps it on some paths and not others
 * (the reactive 401 refresh and the Test button both usually skip it), so it can be
 * older than reality, and it never carries an outcome. The UI shows one or the other,
 * never both, or it would show two different "last refresh" times for one row.
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

  const attempt = readRefreshAttempt(connection);
  const nextRefreshDueAt = resolveNextRefreshDueAt(connection);
  const lastRefreshMs = getCredentialLastRefreshMs(connection);

  return {
    eligible: true,
    // Whether the background sweep will ever pick this connection up. False means the
    // record has no expiry, so nothing is scheduled and the token is refreshed only
    // when a request fails against it.
    scheduled: nextRefreshDueAt !== null,
    nextRefreshDueAt,
    attempt: attempt
      ? { ...attempt, permanent: isUnrecoverableRefreshError({ error: attempt.code }) }
      : null,
    lastRefreshAt: lastRefreshMs === null ? null : new Date(lastRefreshMs).toISOString(),
  };
}
