"use client";

// FORK(attempts): the only UI for the two ceilings resolved in src/lib/attemptPolicy.js.
//
// **Self-contained on purpose** — it reads and writes /api/settings itself, so wiring it into the
// Settings page costs one import and one render line in an upstream file that is a conflict magnet.
// Fields render from ATTEMPT_SETTING_KEYS, so a new limit needs no edit here.
//
// Value fields only: none of the attempt-loop stops gets a switch, because the off state is the one
// that walks a malformed request through every account and locks all of them.
//
// Unit conversion is driven by each entry's `unit`, so this component does not decide it.

import { useEffect, useState } from "react";
import { Button, Card, Input } from "@/shared/components";
import { ATTEMPT_SETTING_KEYS } from "@/lib/attemptPolicy";

/** Milliseconds are stored; seconds are shown. Only the window uses this. */
function isSeconds(entry) {
  return entry.unit === "seconds";
}

function toDisplay(entry, stored) {
  const value = Number(stored);
  if (!Number.isFinite(value) || value <= 0) return "";
  return String(isSeconds(entry) ? Math.round(value / 1000) : Math.round(value));
}

/** "" means "use the built-in value", which the resolver reads from an absent setting. */
function toStored(entry, display) {
  if (display === "" || display === null || display === undefined) return null;
  const value = Number(display);
  if (!Number.isFinite(value) || value <= 0) return null;
  return isSeconds(entry) ? Math.round(value * 1000) : Math.round(value);
}

/**
 * Settings blob → input values. Shared by the initial load and the post-save refresh so the
 * two cannot disagree.
 */
function toFieldValues(settings) {
  return Object.fromEntries(
    ATTEMPT_SETTING_KEYS.map((entry) => [entry.key, toDisplay(entry, settings?.[entry.key])])
  );
}

export default function AttemptLimitsCard() {
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState({ type: "", message: "" });

  // Async IIFE with a cancelled flag rather than a setState-bearing callback: the
  // react-hooks/set-state-in-effect rule rejects the latter, and this is the shape the fork's
  // other components already use.
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

  const handleSave = async () => {
    setSaving(true);
    setStatus({ type: "", message: "" });
    try {
      const patch = Object.fromEntries(
        ATTEMPT_SETTING_KEYS.map((entry) => [entry.key, toStored(entry, values[entry.key])])
      );
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error("Save failed");
      const settings = await res.json();
      setValues(toFieldValues(settings));
      setStatus({ type: "success", message: "Saved. Applies to the next request." });
    } catch {
      setStatus({ type: "error", message: "Could not save" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-teal-500/10 text-teal-500 shrink-0">
          <span className="material-symbols-outlined text-[20px]">repeat</span>
        </div>
        <div className="min-w-0">
          <h3 className="text-base sm:text-lg font-semibold">Account Retry Limits</h3>
          <p className="text-xs sm:text-sm text-text-muted">
            How far one client request may walk the account list when accounts keep failing.
            Leave a field empty to use the built-in value.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {ATTEMPT_SETTING_KEYS.map((entry) => (
          <div
            key={entry.key}
            className="flex items-start justify-between gap-4 border-t border-border/50 pt-4 first:border-t-0 first:pt-0"
          >
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm sm:text-base">{entry.label}</p>
              <p className="text-xs sm:text-sm text-text-muted">{entry.hint}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Input
                type="number"
                min="1"
                value={values[entry.key] ?? ""}
                placeholder={toDisplay(entry, entry.defaultValue)}
                onChange={(e) => handleChange(entry.key, e.target.value)}
                disabled={loading || saving}
                className="w-20 sm:w-24"
                inputClassName="text-center"
              />
              <span className="text-xs text-text-muted w-14">{entry.unit}</span>
            </div>
          </div>
        ))}

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
          Whichever fills first stops the walk. There is no pause between attempts. A request
          that the provider rejects as malformed stops immediately regardless of both limits,
          and so does one whose client has disconnected.
        </p>
      </div>
    </Card>
  );
}
