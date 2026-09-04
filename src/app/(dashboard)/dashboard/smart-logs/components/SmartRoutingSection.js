"use client";

// FORK(smartlogs): one tile per provider Smart Routing governs, each the way into "why were the
// accounts ordered like that".
//
// **Filtering is server-side, by the same resolver the selection path uses**, so this component
// holds no opinion about strategy precedence. Its empty state names the two settings that produce it.

import { useEffect, useState } from "react";
import Link from "next/link";
import Card from "@/shared/components/Card";
import ProviderIcon from "@/shared/components/ProviderIcon";

export default function SmartRoutingSection() {
  const [state, setState] = useState({ status: "loading", providers: [] });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/logs/smart-routing", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        setState({ status: "ready", providers: data.providers || [] });
      } catch {
        if (!cancelled) setState({ status: "error", providers: [] });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const { status, providers } = state;

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold text-text-main">Smart Routing providers</h2>
        <p className="text-sm text-text-muted">
          Only providers Smart Routing currently governs. Open one to see the order its accounts
          are in, and what put them there.
        </p>
      </div>

      {status === "loading" && (
        <p className="flex items-center gap-2 text-sm text-text-muted">
          <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
          Loading providers…
        </p>
      )}

      {status === "error" && (
        <Card padding="md">
          <p className="text-sm text-text-muted">
            Could not load providers. This endpoint answers on localhost only.
          </p>
        </Card>
      )}

      {/* Empty is a configuration statement, not a failure — so it says which setting to change
          rather than leaving the reader to find it. */}
      {status === "ready" && providers.length === 0 && (
        <Card padding="md">
          <p className="text-sm text-text-muted">
            No provider is using Smart Routing.
          </p>
          <p className="mt-2 text-xs text-text-muted">
            Set it globally under Settings → Account Strategy, or for one provider on that
            provider&apos;s page. A per-provider choice overrides the global one, so a provider
            with its own override will not follow a global switch.
          </p>
        </Card>
      )}

      {status === "ready" && providers.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {providers.map((provider) => (
            <Link key={provider.id} href={`/dashboard/smart-logs/${provider.id}`} className="min-w-0">
              <Card padding="md" className="h-full transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                <div className="flex min-w-0 items-center gap-3">
                  <ProviderIcon providerId={provider.id} size={28} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text-main">{provider.name}</p>
                    <p className="text-xs text-text-muted">
                      {provider.activeConnectionCount} of {provider.connectionCount} account
                      {provider.connectionCount === 1 ? "" : "s"} enabled
                    </p>
                  </div>
                  <span className="material-symbols-outlined text-[18px] text-text-muted">chevron_right</span>
                </div>
                <p className="mt-3 border-t border-black/5 pt-2 text-xs text-text-muted dark:border-white/5">
                  {provider.sessionCount} active conversation{provider.sessionCount === 1 ? "" : "s"}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
