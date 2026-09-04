"use client";

import PropTypes from "prop-types";
import { getRelativeTime } from "@/shared/utils";

/**
 * FORK(tokenstat): one line inside a connection row saying what the token is doing.
 *
 * **Display only** — every value arrives already resolved from the status route, because the inputs
 * the decisions need (the per-provider refresh lead, the presence of a refresh token) are not
 * available in the browser. Nothing here computes anything but phrasing.
 *
 * Renders null unless the connection is eligible, so API-key and cookie rows gain no line.
 *
 * **No ticking, deliberately.** The sweep runs on a fixed interval, so the refresh happens on the
 * first tick after the due moment; a per-second countdown would claim a precision the scheduler
 * does not have. The neighbouring CooldownTimer is not reused for that reason and one more: an
 * orange clock reads as a cooldown, which is a different thing.
 *
 * Date.now() in render is safe here only because `status` exists after a client-side fetch, so
 * there is no server-rendered pass to disagree with.
 */

/** Coarse forward-looking counterpart to getRelativeTime, sharing its m/h/d vocabulary
 *  so both halves of the line read the same way. */
function formatTimeUntil(isoDate) {
  const diff = new Date(isoDate).getTime() - Date.now();
  if (!Number.isFinite(diff)) return null;
  if (diff <= 0) return null;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "in under a minute";
  if (mins < 60) return `in ~${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ~${hours}h`;
  return `in ~${Math.round(hours / 24)}d`;
}

export default function TokenStatus({ status }) {
  if (!status?.eligible) return null;

  const { attempt, lastRefreshAt, scheduled, nextRefreshDueAt } = status;

  // Three cases, in order of how much they tell you. The fork's own record is the richer
  // one because it carries an outcome, but it is not always the current one: several paths
  // refresh the token and stamp upstream's lastRefreshAt without recording an attempt, the
  // Test button in this same row among them.
  //
  // **Both fields usually arrive, so this if/else chain is the choice, not a null check.**
  // /api/token-status nulls `attempt` when it has been superseded rather than dropping
  // `lastRefreshAt` — see isSupersededByLastRefresh in
  // src/sse/services/tokenRefreshStatus.js — so preferring `attempt` here is what keeps
  // one "last refresh" time on the row. Never render both branches; two timestamps that
  // describe the same event, milliseconds apart, read as two refreshes.
  let historyText;
  let historyIsError = false;
  if (attempt) {
    historyIsError = !attempt.ok;
    historyText = attempt.ok
      ? `refreshed ${getRelativeTime(attempt.at)}`
      : `refresh failed ${getRelativeTime(attempt.at)}`;
  } else if (lastRefreshAt) {
    historyText = `refreshed ${getRelativeTime(lastRefreshAt)}`;
  } else {
    historyText = "no refresh recorded yet";
  }

  // A permanent failure is the only one that changes what you would do about it, so it is
  // the only one that gets words. Upstream classifies these; see isUnrecoverableRefreshError.
  //
  // There is deliberately no branch for a non-permanent `attempt.classification`, because
  // that combination cannot occur: mergeRefreshedCredentials
  // (open-sse/services/oauthCredentialManager.js) passes an `error` field through only
  // when isUnrecoverableRefreshError accepts it, and returns a freshly built object with
  // no `error` key otherwise — so a non-null classification has already been judged
  // permanent by the same function that resolves this flag. A failed attempt with no
  // classification renders "refresh failed <when>" and no reason, which is the honest
  // answer: upstream gave none.
  const reasonText = historyIsError && attempt.permanent ? "re-authentication needed" : null;

  const untilText = nextRefreshDueAt ? formatTimeUntil(nextRefreshDueAt) : null;
  // A due time already in the past is not an error: the sweep fires on its next tick.
  // "on demand" is the honest phrasing for a record with no expiry, which the scheduler
  // never selects at all.
  const nextText = !scheduled
    ? "refreshes on demand"
    : untilText
      ? `next ${untilText}`
      : "refresh due";

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <span className={`max-w-full truncate text-[11px] sm:max-w-[420px] ${historyIsError ? "text-red-500" : "text-text-muted"}`}>
        Token: {historyText}
      </span>
      {reasonText && (
        <span
          className="max-w-full truncate text-[11px] text-red-500 sm:max-w-[220px]"
          title={attempt.providerCode || reasonText}
        >
          {reasonText}
        </span>
      )}
      <span className="text-[11px] text-text-muted">{nextText}</span>
    </div>
  );
}

TokenStatus.propTypes = {
  status: PropTypes.shape({
    eligible: PropTypes.bool,
    scheduled: PropTypes.bool,
    nextRefreshDueAt: PropTypes.string,
    lastRefreshAt: PropTypes.string,
    attempt: PropTypes.shape({
      at: PropTypes.string,
      ok: PropTypes.bool,
      classification: PropTypes.string,
      providerCode: PropTypes.string,
      permanent: PropTypes.bool,
    }),
  }),
};
