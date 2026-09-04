"use client";

// FORK(locks): the only UI for the lock durations resolved in src/lib/lockPolicy.js.
//
// **Self-contained on purpose** — it reads and writes /api/settings itself, so wiring it into the
// Settings page costs one import and one render line in an upstream file that is a conflict magnet.
// Fields render from LOCK_SETTING_KEYS, so a new duration needs no edit here.
//
// Inputs are seconds, storage is milliseconds; the conversion lives in lockPolicy.js so the
// resolver and this card cannot drift on the unit.
//
// **Placeholders show the value an empty field actually produces**, not upstream's number — a
// control that misreports its own reset state is worse than one with no placeholder.

import { useEffect, useState } from "react";
import { Button, Card, Input } from "@/shared/components";
import { LOCK_SETTING_KEYS, defaultLockMs, msToSeconds, secondsToMs } from "@/lib/lockPolicy";

/**
 * Settings blob (ms) → the input values (seconds as strings, "" when unset).
 * Shared by the initial load and the post-save refresh so the two cannot disagree.
 */
function toFieldValues(settings) {
  return Object.fromEntries(
    LOCK_SETTING_KEYS.map(({ key }) => {
      const seconds = msToSeconds(settings?.[key]);
      return [key, seconds === null ? "" : String(seconds)];
    })
  );
}

export default function LockDurationsCard() {
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState({ type: "", message: "" });

  // Async IIFE with a cancelled flag rather than a setState-bearing callback: the
  // react-hooks/set-state-in-effect rule rejects the latter, and this is the shape the
  // fork's other components already use.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/settings", { cache: "no-store" });
        const settings = res.ok ? await res.json() : {};
        if (cancelled) return;
        setValues(toFieldValues(settings));
      } catch {
        if (!cancelled) setStatus({ type: "error", message: "Could not load current values" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const handleChange = (key, next) => {
    setValues((prev) => ({ ...prev, [key]: next }));
    setStatus({ type: "", message: "" });
  };

  // An empty field writes null, which the resolver reads as "use this key's default".
  // That is what makes "clear the field" the reset-to-default gesture.
  const handleSave = async () => {
    setSaving(true);
    setStatus({ type: "", message: "" });
    try {
      const patch = Object.fromEntries(
        LOCK_SETTING_KEYS.map(({ key }) => [key, secondsToMs(values[key])])
      );
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error("Save failed");
      const settings = await res.json();
      setValues(toFieldValues(settings));
      setStatus({ type: "success", message: "Saved. Applies to the next failure." });
    } catch {
      setStatus({ type: "error", message: "Could not save" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500 shrink-0">
          <span className="material-symbols-outlined text-[20px]">lock_clock</span>
        </div>
        <div className="min-w-0">
          <h3 className="text-base sm:text-lg font-semibold">Account Lock Durations</h3>
          <p className="text-xs sm:text-sm text-text-muted">
            How long a connection is held back after a provider error. Seconds. Leave a
            field empty to use the default shown in it.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {/*
          The placeholder is the key's DEFAULT, not upstream's constant — it has to be the
          value an empty field actually produces, or the control lies about its own reset
          state. Where the fork's default differs, upstream's number is named underneath
          instead of being dropped: it is the reference point for judging the change, and it
          is the only place in the UI that still records what this install would have done
          without the fork.
        */}
        {LOCK_SETTING_KEYS.map((entry) => {
          const { key, label, hint, upstreamMs } = entry;
          const defaultMs = defaultLockMs(entry);
          const upstreamSeconds = msToSeconds(upstreamMs);
          const differs = defaultMs !== upstreamMs;

          return (
            <div
              key={key}
              className="flex items-start justify-between gap-4 border-t border-border/50 pt-4 first:border-t-0 first:pt-0"
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm sm:text-base">{label}</p>
                <p className="text-xs sm:text-sm text-text-muted">{hint}</p>
                {differs && (
                  <p className="text-xs text-text-muted/70 mt-0.5">
                    Upstream default: {upstreamSeconds}s
                  </p>
                )}
              </div>
              <Input
                type="number"
                min="1"
                value={values[key] ?? ""}
                placeholder={String(msToSeconds(defaultMs) ?? "")}
                onChange={(e) => handleChange(key, e.target.value)}
                disabled={loading || saving}
                className="w-20 sm:w-24 shrink-0"
                inputClassName="text-center"
              />
            </div>
          );
        })}

        <div className="flex flex-wrap items-center gap-3 border-t border-border/50 pt-4">
          <Button onClick={handleSave} disabled={loading} loading={saving}>
            Save
          </Button>
          {status.message && (
            <span
              className={`text-xs ${status.type === "error" ? "text-red-500" : "text-green-600"}`}
            >
              {status.message}
            </span>
          )}
        </div>

        <p className="text-xs text-text-muted">
          Locks are per connection and per model, and they are stored, so a restart does
          not clear them. A provider that reports its own reset time uses that instead of
          the rate limit ladder, capped by the last field. GitHub&apos;s monthly limit is
          not affected by any of these.
        </p>
      </div>
    </Card>
  );
}
