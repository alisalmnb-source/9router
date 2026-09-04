// FORK(attempts): the one account-retry loop, replacing nine copies — the eight modality
// handlers under src/sse/handlers/ and the hand-rolled walk in the Gemini-native route.
//
// It also adds three rules that had no equivalent upstream: two ceilings on the walk (see
// attemptPolicy.js), a stop when the REQUEST is at fault, and a stop when the client has hung up.
// None is behind a switch — the "off" path is the broken one.
//
// The loop owns credential selection, the exhaustion exits, the ceilings, the abort check, the
// bad-request check, the failure marking and the session unbinding. A caller supplies `attempt`
// and nothing else unless its shape genuinely differs. **Exactly three hooks, for the three real
// differences across the nine sites — a fourth is how this loop redistributes into nine again.**
//
// ── Ordering that is load-bearing ────────────────────────────────────────────
// The bad-request check runs BEFORE classification and BEFORE the account is marked unavailable.
// Classify first and the failure is already labelled transient, too late to act on. Mark first
// and the request stops correctly but an account is locked for a fault that was never its own —
// repeated across a pool, that is the self-inflicted outage this rule exists to prevent.

import { getSettings } from "@/lib/db/index.js";
import { resolveAttemptLimits } from "@/lib/attemptPolicy";
import { isBadRequest } from "@/lib/errorPolicy";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { getProviderCredentials, markAccountUnavailable } from "./auth.js";
import { releaseBinding } from "./sessionAffinity.js";
import * as log from "../utils/logger.js";

/**
 * Nginx's "client closed request". Not a standard code, but it is what proxies and log
 * pipelines already recognise, and no real client is waiting to read it either way.
 */
const CLIENT_CLOSED_REQUEST = 499;

/**
 * Mark a failed attempt, appending the two optional arguments only when there is something to
 * put in them.
 *
 * **The conditional appending is functional, not tidiness.** Two upstream tests assert this call
 * with a five-argument matcher that compares the whole list, so a trailing `null` for a value the
 * caller does not have produces a six- or seven-element list and fails them even though the
 * value is equivalent. The fork edits no upstream test, so the call keeps upstream's shape
 * whenever it has nothing extra to say.
 *
 * Shared with chat.js, which marks failures itself through the onAttemptFailed hook, so the
 * shaping has one home.
 */
export function markAttemptFailure({ connectionId, status, errorText, provider, lockKey, resetsAtMs, errorSignals }) {
  const args = [connectionId, status, errorText, provider, lockKey];
  if (resetsAtMs != null || errorSignals != null) {
    args.push(resetsAtMs ?? null);
    if (errorSignals != null) args.push(errorSignals);
  }
  return markAccountUnavailable(...args);
}

/**
 * Ask for the next usable account.
 *
 * `credentialFallbackProvider` covers the one real variation: some search providers reuse a
 * related chat provider's key. The provider that actually OWNS the connection is returned
 * alongside the credentials, because a lock must be attributed to that one rather than to the
 * provider named in the request.
 */
async function selectAccount({ providerId, credentialFallbackProvider, excludeConnectionIds, lockKey, selectOptions }) {
  // Same rule as markAttemptFailure above: the fourth argument is appended only when it carries
  // something, so a selection with no session key and no pin keeps upstream's three-argument
  // shape. `getProviderCredentials` defaults it to `{}`, so omitting it is equivalent — and an
  // upstream test asserts the exact argument list on the web-fetch path.
  const select = (provider) => {
    const args = [provider, excludeConnectionIds, lockKey];
    if (selectOptions && Object.keys(selectOptions).length > 0) args.push(selectOptions);
    return getProviderCredentials(...args);
  };

  let credentials = await select(providerId);
  if (credentials) return { credentials, credentialProviderId: providerId };

  if (credentialFallbackProvider) {
    credentials = await select(credentialFallbackProvider);
    if (credentials) {
      log.info("AUTH", `\x1b[32m${providerId} reusing ${credentialFallbackProvider} credentials\x1b[0m`);
      return { credentials, credentialProviderId: credentialFallbackProvider };
    }
  }

  return { credentials: null, credentialProviderId: providerId };
}

/**
 * Run one client request across as many accounts as the rules allow.
 *
 * @param {object} params
 * @param {string}   params.provider     Provider id for selection and for error attribution.
 * @param {string|null} [params.lockKey] Lock scope, passed to both selection and marking so a
 *        lock is read back under the key it was written with. Usually the model;
 *        `websearch:<id>` for search; null for account-wide.
 * @param {string}   params.label        Human label for messages, e.g. "[openai/gpt-5]".
 * @param {string}   params.logTag       Log category, e.g. "CHAT".
 * @param {AbortSignal|null} [params.signal] The client's signal. Absent means no abort checks.
 * @param {object}   [params.selectOptions] Forwarded to getProviderCredentials
 *        (`preferredConnectionId`, `sessionKey`).
 * @param {string|null} [params.credentialFallbackProvider]
 * @param {number}   [params.noCredentialsStatus] Status for "provider has no accounts at all".
 *        Parameterised rather than unified: chat answers 404 where the others answer 400, and
 *        both are client-visible.
 * @param {string}   [params.noCredentialsMessage] Message for that case. **The default wording
 *        is asserted by an upstream test**, so it is not free to move.
 * @param {number|null} [params.allLockedStatus] Fixed status for "every account is locked",
 *        overriding the status derived from the last failure. Parameterised for the same reason
 *        as `noCredentialsStatus`: v0.5.65 pinned chat to 503 and left the other seven handlers
 *        deriving it, so one shared expression can no longer serve both.
 * @param {Function} params.attempt      async ({ credentials, credentialProviderId, attemptIndex }) => result
 *        where result is `{ success, response, status, error, resetsAtMs?, errorSignals? }`.
 * @param {Function} [params.shouldRotate] (result) => boolean, ANDed with shouldFallback.
 * @param {Function} [params.onAttemptFailed] async (ctx) => { shouldFallback }. Replaces the
 *        default markAccountUnavailable call; a caller using it is responsible for marking.
 * @param {Function} [params.onExhausted] (ctx) => Response|null. Null falls back to the default.
 * @param {Function} [params.buildFailureResponse] (result) => Response, for the non-rotating exit.
 * @returns {Promise<Response>}
 */
export async function runAccountAttempts({
  provider,
  lockKey = null,
  label,
  logTag,
  signal = null,
  selectOptions = {},
  credentialFallbackProvider = null,
  noCredentialsStatus = HTTP_STATUS.BAD_REQUEST,
  noCredentialsMessage = null,
  allLockedStatus = null,
  attempt,
  shouldRotate = null,
  onAttemptFailed = null,
  onExhausted = null,
  buildFailureResponse = null,
}) {
  const settings = await getSettings().catch(() => ({}));
  const { maxAttempts, windowMs } = resolveAttemptLimits(settings);

  const excludeConnectionIds = new Set();
  const sessionKey = selectOptions?.sessionKey || null;

  let lastError = null;
  let lastStatus = null;
  let lastResponse = null;
  let attempts = 0;
  // Stays null until the first attempt has finished. That is what makes the first attempt
  // unbounded — see attemptPolicy.js.
  let windowStartedAt = null;

  const exhausted = (kind, extra = {}) => {
    if (onExhausted) {
      const custom = onExhausted({ kind, lastError, lastStatus, lastResponse, attempts, ...extra });
      if (custom) return custom;
    }

    if (kind === "all-locked") {
      const message = lastError || extra.lockedError || "Unavailable";
      // FORK(attempts): upstream's v0.5.65 "always 503 when rate-limited" fix landed on the
      // one line this loop hoisted out of nine handlers, so git could not carry it here.
      // **Upstream changed chat only** — the other seven still derive the status, which is why
      // this is an override and not a replacement. Hardcoding 503 here would silently retune
      // seven handlers upstream deliberately left alone.
      const status = allLockedStatus || lastStatus || Number(extra.lockedErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
      log.warn(logTag, `${label} ${message} (${extra.retryAfterHuman})`);
      return unavailableResponse(status, `${label} ${message}`, extra.retryAfter, extra.retryAfterHuman);
    }

    if (kind === "no-credentials") {
      const message = noCredentialsMessage || `No credentials for provider: ${provider}`;
      log.warn("AUTH", message);
      return errorResponse(noCredentialsStatus, message);
    }

    // All three cap kinds mean the same thing to the client: we stopped trying. The last real
    // upstream error says why; a synthesised 503 would replace that with less information.
    if (lastResponse) return lastResponse;
    return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
  };

  while (true) {
    // Client has gone. **Only the walk stops** — an upstream request already in flight is not
    // cancelled, which is a separate and much wider job. Requires the caller to have passed
    // `signal`; a call site that omits it opts out of this with no error.
    if (signal?.aborted) {
      log.warn(logTag, `${label} client disconnected after ${attempts} attempt(s) — stopping`);
      return errorResponse(CLIENT_CLOSED_REQUEST, "Client closed request");
    }

    // Both ceilings, checked before asking for another account so a stopped walk costs no extra
    // selection. Never on the first pass: attempt one always runs.
    if (attempts > 0) {
      if (attempts >= maxAttempts) {
        log.warn(logTag, `${label} attempt limit reached (${attempts}/${maxAttempts}) — stopping`);
        return exhausted("attempt-cap");
      }
      const elapsed = Date.now() - windowStartedAt;
      if (elapsed >= windowMs) {
        log.warn(logTag, `${label} time budget spent (${Math.round(elapsed / 1000)}s of ${Math.round(windowMs / 1000)}s over ${attempts} attempt(s)) — stopping`);
        return exhausted("time-cap");
      }
    }

    const { credentials, credentialProviderId } = await selectAccount({
      providerId: provider,
      credentialFallbackProvider,
      excludeConnectionIds,
      lockKey,
      selectOptions,
    });

    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        return exhausted("all-locked", {
          retryAfter: credentials.retryAfter,
          retryAfterHuman: credentials.retryAfterHuman,
          lockedError: credentials.lastError,
          lockedErrorCode: credentials.lastErrorCode,
        });
      }
      if (excludeConnectionIds.size === 0) return exhausted("no-credentials");
      log.warn(logTag, `${label} no more accounts available after ${attempts} attempt(s)`);
      return exhausted("exhausted");
    }

    attempts += 1;
    const result = await attempt({ credentials, credentialProviderId, attemptIndex: attempts });

    // Started at the END of the first attempt, on purpose.
    if (windowStartedAt === null) windowStartedAt = Date.now();

    if (result.success) return result.response;

    lastError = result.error;
    lastStatus = result.status;
    lastResponse = result.response || null;

    // Before classification, before marking. Such a request fails the same way on every account,
    // and every failed attempt writes a lock — so one bad request could lock every account on
    // the model. At most one account has seen it by now.
    //
    // **Detection is positive:** only a recognised pattern counts. Inverting it ("these codes are
    // malformed except…") would silently disable failover for every case not yet listed.
    if (isBadRequest({ status: result.status, errorText: result.error })) {
      log.warn(logTag, `${label} request rejected as malformed (${result.status}) — not trying other accounts`);
      return lastResponse || errorResponse(result.status || HTTP_STATUS.BAD_REQUEST, lastError || "Bad request");
    }

    const marked = onAttemptFailed
      ? await onAttemptFailed({ credentials, credentialProviderId, result, lockKey })
      : await markAttemptFailure({
        connectionId: credentials.connectionId,
        status: result.status,
        errorText: result.error,
        provider: credentialProviderId,
        lockKey,
        resetsAtMs: result.resetsAtMs,
        errorSignals: result.errorSignals,
      });

    const rotate = !!marked?.shouldFallback && (!shouldRotate || shouldRotate(result));
    if (!rotate) {
      return buildFailureResponse
        ? buildFailureResponse(result)
        : (lastResponse || errorResponse(result.status || HTTP_STATUS.BAD_GATEWAY, lastError || "Provider error"));
    }

    // Only THIS conversation lets go. Others on the same account detach on their own next
    // request — see releaseBinding for why detaching them together is wrong.
    if (sessionKey) releaseBinding(sessionKey);

    log.warn("FALLBACK", `⇄ ACC:${credentials.connectionName} UNAVAILABLE (${result.status}) → NEXT ACCOUNT`);
    excludeConnectionIds.add(credentials.connectionId);
    // No pause here, deliberately. See attemptPolicy.js.
  }
}
