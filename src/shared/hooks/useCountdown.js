"use client";

// FORK(smartlogs): shared countdown. Extracted from the CooldownTimer that was inline in
// ConnectionsCard — that component now delegates here, so upstream reworking it must keep the
// delegation or the session cards lose their timer too.
//
// Takes an absolute instant, never a remaining duration: a duration is stale the moment a route
// serialises it, so a page left open would freeze.

import { useEffect, useState } from "react";

export function formatRemaining(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

/**
 * Time left until `until`, re-rendered every second. Returns "" once passed or absent.
 *
 * @param {string|number|Date|null} until Absolute instant, typically an ISO string from a route.
 * @returns {string} e.g. "45s", "12m 3s", "1h 20m", or "".
 */
export function useCountdown(until) {
  const [remaining, setRemaining] = useState("");

  // Constraint: every write goes through `update` and none directly in the effect body — that
  // is what react-hooks/set-state-in-effect accepts. An invalid `until` is handled inside
  // `update` for the same reason; an early return would need its own direct write.
  useEffect(() => {
    const target = until ? new Date(until).getTime() : Number.NaN;
    const valid = Number.isFinite(target);

    const update = () => setRemaining(valid ? formatRemaining(target - Date.now()) : "");
    update();

    if (!valid) return undefined;
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [until]);

  return remaining;
}
