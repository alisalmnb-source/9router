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
  // Test button in this same row among them. /api/token-status compares the two and sends
  // only the newer, so at most one arrives here — see isSupersededByLastRefresh in
  // src/sse/services/tokenRefreshStatus.js. Showing both would put two different
  // "last refresh" times on one row.
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

  // Only a permanent failure changes what you would do about it, so it is the only
  // failure that gets words rather than a code. Upstream classifies these; see
  // isUnrecoverableRefreshError.
  const reasonText = historyIsError
    ? attempt.permanent
      ? "re-authentication needed"
      : attempt.code || null
    : null;

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
