"use client";

// FORK(smartlogs): one card per live conversation — which conversation is pinned to which account
// and model, and how long before the pin is released.
//
// Reads the sessions route, which goes through a snapshot that does **not** refresh a binding's
// last-seen time. That is what makes this section safe to leave open; wired to the routing read
// instead, watching the page would keep every conversation alive.
//
// Carries the copy for the two states that would otherwise read as breakage: empty after a restart
// (bindings are in memory by design) and the localhost-only failure.

import { useEffect, useState } from "react";
import Badge from "@/shared/components/Badge";
import Button from "@/shared/components/Button";
import Card from "@/shared/components/Card";
import { AI_PROVIDERS, getProviderByAlias } from "@/shared/constants/providers";
import { useCountdown } from "@/shared/hooks/useCountdown";

const POLL_MS = 5000;

function minutesLabel(ms) {
  const minutes = Math.round(Number(ms) / 60000);
  return Number.isFinite(minutes) && minutes > 0 ? `${minutes} minutes` : "the configured window";
}

function providerLabel(providerId) {
  if (!providerId) return null;
  const config = getProviderByAlias(providerId) || AI_PROVIDERS[providerId];
  return config?.name || providerId;
}

/**
 * One conversation.
 *
 * The countdown is derived from `expiresAt` rather than displayed from a server-sent duration,
 * so it keeps ticking correctly on a page nobody is touching. An empty string back from the
 * hook means the instant has passed and the next poll will drop the card, so the label falls
 * back to "expiring" rather than showing "0s" for a second.
 */
function SessionCard({ session, account }) {
  const remaining = useCountdown(session.expiresAt);

  const accountLabel = account?.name || account?.email
    || (session.connectionId ? `${String(session.connectionId).slice(0, 8)}…` : "unknown account");
  const provider = providerLabel(account?.provider);

  return (
    <Card padding="md">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-xs text-text-muted" title="Conversation fingerprint">
            {session.sessionTag}
          </span>
          <Badge variant={remaining ? "info" : "warning"} size="sm">
            {remaining || "expiring"}
          </Badge>
        </div>

        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate text-sm font-medium text-text-main" title={accountLabel}>
            <span className="material-symbols-outlined mr-1 align-[-3px] text-[16px] text-text-muted">person</span>
            {accountLabel}
          </span>
          <span className="truncate font-mono text-xs text-text-muted" title={session.model || undefined}>
            {session.model || "no model"}
          </span>
          {provider && <span className="truncate text-xs text-text-muted">{provider}</span>}
        </div>

        <div className="border-t border-black/5 pt-2 text-xs text-text-muted dark:border-white/5">
          Last request {session.lastSeenAt ? new Date(session.lastSeenAt).toLocaleTimeString() : "—"}
        </div>
      </div>
    </Card>
  );
}

export default function ActiveSessionsSection() {
  const [state, setState] = useState({ status: "loading", sessions: [], idleMs: null });
  const [accounts, setAccounts] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  // connectionId → account, so a card can name the account rather than show an id. Fetched
  // once: the list is small and changes rarely, and a deleted account degrades to a short id.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/providers", { cache: "no-store" });
        const data = res.ok ? await res.json() : {};
        if (cancelled) return;
        const map = {};
        for (const connection of data.connections || []) {
          if (connection?.id) {
            map[connection.id] = {
              name: connection.name,
              email: connection.email,
              provider: connection.provider,
            };
          }
        }
        setAccounts(map);
      } catch {
        if (!cancelled) setAccounts({});
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch("/api/logs/sessions", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        setState({ status: "ready", sessions: data.sessions || [], idleMs: data.idleMs ?? null });
      } catch {
        if (!cancelled) setState({ status: "error", sessions: [], idleMs: null });
      }
    };

    load();
    const timer = setInterval(load, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [reloadToken]);

  const { status, sessions, idleMs } = state;

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-text-main">Active conversations</h2>
          <p className="text-sm text-text-muted">
            Each conversation stays on the account it was given until it goes quiet for{" "}
            {minutesLabel(idleMs)}. One card per conversation and model — a conversation using
            two models holds two accounts.
          </p>
        </div>
        <Button variant="outline" size="sm" icon="refresh" onClick={() => setReloadToken((n) => n + 1)}>
          Refresh
        </Button>
      </div>

      {status === "loading" && (
        <p className="flex items-center gap-2 text-sm text-text-muted">
          <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
          Loading active conversations…
        </p>
      )}

      {status === "error" && (
        <Card padding="md">
          <p className="text-sm text-text-muted">
            Could not read active conversations. This endpoint answers on localhost only, so it
            is expected to fail when the dashboard is reached through a tunnel or another host.
          </p>
        </Card>
      )}

      {/*
        An empty list is the normal state after a restart, not a fault. Bindings are held in
        memory on purpose: restored from disk they would describe conversations that ended long
        ago while still counting against their accounts' load. Saying so is required — a bare
        "none" reads as a broken page.
      */}
      {status === "ready" && sessions.length === 0 && (
        <Card padding="md">
          <p className="text-sm text-text-muted">
            No conversation is currently pinned to an account.
          </p>
          <p className="mt-2 text-xs text-text-muted">
            This is also what you see just after a restart. Pins are held in memory by design —
            requests arriving after a restart belong to new conversations, so the old pins would
            be describing conversations that had already ended. A conversation is pinned from its
            second turn onward, since the first turn has nothing stable to identify it by yet.
          </p>
        </Card>
      )}

      {status === "ready" && sessions.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sessions.map((session) => (
            <SessionCard
              key={`${session.sessionTag}-${session.model || "none"}`}
              session={session}
              account={accounts?.[session.connectionId]}
            />
          ))}
        </div>
      )}
    </section>
  );
}
