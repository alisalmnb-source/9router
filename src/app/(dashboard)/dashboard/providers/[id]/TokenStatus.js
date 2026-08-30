"use client";

import PropTypes from "prop-types";
import { getRelativeTime } from "@/shared/utils";

/**
 * FORK(tokenstat): one line inside a connection row saying what the token is doing.
 *
 * Display only. Every value arrives resolved from GET /api/token-status — eligibility,
 * the last observed attempt, whether the failure was permanent, and the next due time
 * are all decided in src/sse/services/tokenRefreshStatus.js. Nothing is computed here
 * except how to phrase it, because the inputs the decisions need (the per-provider
 * refresh lead, the presence of a refresh token) are not available in the browser.
 *
 * Renders null unless the connection is eligible, so API-key and cookie rows are
 * untouched and a healthy list gains no extra line where there is no token to refresh.
 *
 * **No ticking.** The background sweep runs on a fixed interval, so the refresh happens
 * on the first tick after the due moment rather than at it. A per-second countdown would
 * be claiming a precision the scheduler does not have, and would add a second interval
 * per row on top of CooldownTimer's. The neighbouring CooldownTimer is not reused for
 * the same reason plus one more: its orange clock reads as a cooldown, which is a
 * different thing from a scheduled refresh.
 *
 * Date.now() during render is safe in this one place: `status` only exists after the
 * page's client-side fetch resolves, so there is no server-rendered pass for the value
 * to disagree with.
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
  // There is deliberately no branch for a non-permanent `attempt.code`, because that
  // combination cannot occur: mergeRefreshedCredentials
  // (open-sse/services/oauthCredentialManager.js) passes an `error` field through only
  // when isUnrecoverableRefreshError accepts it, and returns a freshly built object with
  // no `error` key otherwise — so a non-null code has already been classified permanent
  // by the same function that resolves this flag. A failed attempt with no code renders
  // "refresh failed <when>" and no reason, which is the honest answer: upstream gave none.
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
          title={attempt.detail || reasonText}
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
      code: PropTypes.string,
      detail: PropTypes.string,
      permanent: PropTypes.bool,
    }),
  }),
};
