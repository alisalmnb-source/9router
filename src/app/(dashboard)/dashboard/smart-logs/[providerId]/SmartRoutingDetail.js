"use client";

// FORK(smartlogs): the ordering, and the reason for it, for one provider. Exists because the
// ordering used to be invisible — the counters were written and never read.
//
// **Rendered, never computed.** The order comes from the route, which calls the same comparator
// selection does. Read-only, like the rest of the page.
//
// The demotion is shown as an absolute timestamp: reading the clock in render is a lint error, and
// a relative age would freeze on an open page while getting steadily wronger.

import { useCallback, useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import Badge from "@/shared/components/Badge";
import Button from "@/shared/components/Button";
import Card from "@/shared/components/Card";
import Select from "@/shared/components/Select";
import { cn } from "@/shared/utils/cn";
import { useCountdown } from "@/shared/hooks/useCountdown";

/**
 * How the error counter reads.
 *
 * The trap this guards against: the counter is reset to zero the moment it crosses the
 * threshold, so an account that was just demoted shows "0/10". Read alone that looks
 * healthier than an account sitting at 8/10 — which is backwards. So the score is never
 * presented on its own; a demoted row is marked, and the two are meant to be read together.
 */
function scoreVariant(score, threshold, demotedAt) {
  if (demotedAt) return "warning";
  if (score >= threshold * 0.6) return "warning";
  if (score > 0) return "info";
  return "default";
}

function AccountRow({ row, threshold, rank }) {
  // Ticks, and it is the shared countdown rather than arithmetic in render. Reading the clock
  // during render is impure — react-hooks/purity says so, correctly — and a lock that has to
  // count down needs to re-render anyway, which is what the hook is for.
  const lockRemaining = useCountdown(row.lockedUntil);

  // The demotion is shown as an absolute time, not as "20 minutes ago". Two reasons, and the
  // linter only pointed at the first: a relative age computed in render reads the clock, and it
  // would then sit frozen on an open page, quietly getting wronger. An absolute stamp cannot go
  // stale, and it is also the more useful form here — it lines up with the request log above,
  // which stamps its rows the same way, so a demotion can be matched to the failures that
  // caused it.
  const demotedAt = row.demotedAt ? new Date(row.demotedAt) : null;

  return (
    <tr className="border-b border-black/5 last:border-b-0 dark:border-white/5">
      <td className="p-4 text-sm text-text-muted">{rank ?? "—"}</td>
      <td className="max-w-[220px] p-4">
        <span className="block truncate text-sm text-text-main" title={row.name}>{row.name}</span>
        {!row.isActive && <span className="text-xs text-text-muted">disabled</span>}
      </td>
      {/*
        Two figures, and the big one is the ordering input. The total is what the comparator
        ranks by — that criterion is scoped per account, across models — so it stays primary and
        unqualified. The model-scoped figure sits under it because this was the only column that
        did not follow the model selector, which left "3 conversations / 7 error points" unreadable:
        the points are per model and the conversations were not. It is shown only when it tells you
        something the total does not.
      */}
      <td className="p-4 text-right">
        <span className="font-mono text-sm text-text-main">{row.sessionCount}</span>
        {row.sessionCount > 0 && (
          <span className="block whitespace-nowrap text-xs text-text-muted">
            {row.sessionCountForModel === row.sessionCount
              ? "all on this model"
              : `${row.sessionCountForModel} on this model`}
          </span>
        )}
      </td>
      <td className="p-4 text-sm">
        {demotedAt ? (
          <span className="inline-flex flex-col">
            <Badge variant="warning" size="sm">demoted</Badge>
            <span className="mt-0.5 whitespace-nowrap text-xs text-text-muted">
              {demotedAt.toLocaleString()}
            </span>
          </span>
        ) : (
          <span className="text-text-muted">never</span>
        )}
      </td>
      <td className="p-4 text-sm">
        <Badge variant={scoreVariant(row.errorScore, threshold, row.demotedAt)} size="sm">
          {row.errorScore}/{threshold}
        </Badge>
      </td>
      <td className="p-4 text-right font-mono text-sm text-text-muted">{row.priority ?? "—"}</td>
      <td className="p-4 text-sm">
        {row.lockedUntil ? (
          <span className="font-mono text-xs text-orange-500">{lockRemaining || "expiring"}</span>
        ) : (
          <span className="text-text-muted">—</span>
        )}
      </td>
    </tr>
  );
}

AccountRow.propTypes = {
  row: PropTypes.object.isRequired,
  threshold: PropTypes.number.isRequired,
  rank: PropTypes.number,
};

function AccountTable({ rows, threshold, ranked }) {
  return (
    <Card padding="none">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px]">
          <thead>
            <tr className="border-b border-black/5 dark:border-white/5">
              <th scope="col" className="p-4 text-left text-sm font-semibold text-text-main">#</th>
              <th scope="col" className="p-4 text-left text-sm font-semibold text-text-main">Account</th>
              <th scope="col" className="p-4 text-right text-sm font-semibold text-text-main" title="Criterion 1: conversations carried. The total is counted across models and is what the ordering uses; the second line narrows it to the selected model and is informational.">
                Conversations
              </th>
              <th scope="col" className="p-4 text-left text-sm font-semibold text-text-main" title="Criterion 2: when this account and model was last sent to the bottom">
                Last demoted
              </th>
              <th scope="col" className="p-4 text-left text-sm font-semibold text-text-main" title="Error points against this account and model. Resets to zero on a demotion and on a success.">
                Error budget
              </th>
              <th scope="col" className="p-4 text-right text-sm font-semibold text-text-main" title="Criterion 3: the operator's static order">
                Priority
              </th>
              <th scope="col" className="p-4 text-left text-sm font-semibold text-text-main">Lock</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="p-8 text-center text-text-muted">Nothing here.</td></tr>
            ) : (
              rows.map((row, index) => (
                <AccountRow
                  key={row.id}
                  row={row}
                  threshold={threshold}
                  rank={ranked ? index + 1 : null}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

AccountTable.propTypes = {
  rows: PropTypes.array.isRequired,
  threshold: PropTypes.number.isRequired,
  ranked: PropTypes.bool,
};

export default function SmartRoutingDetail({ providerId }) {
  const [model, setModel] = useState(null);
  const [state, setState] = useState({ status: "loading", data: null, error: null });
  const [reloadToken, setReloadToken] = useState(0);

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (model) params.set("model", model);
    const query = params.toString();
    return `/api/logs/smart-routing/${encodeURIComponent(providerId)}${query ? `?${query}` : ""}`;
  }, [providerId, model]);

  useEffect(() => {
    let cancelled = false;

    fetch(url, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        return body;
      })
      .then((data) => { if (!cancelled) setState({ status: "ready", data, error: null }); })
      .catch((err) => { if (!cancelled) setState({ status: "error", data: null, error: err.message }); });

    return () => { cancelled = true; };
  }, [url, reloadToken]);

  const handleModelChange = useCallback((event) => setModel(event.target.value), []);

  const { status, data, error } = state;

  if (status === "loading") {
    return (
      <p className="flex items-center gap-2 text-sm text-text-muted">
        <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
        Loading Smart Routing state…
      </p>
    );
  }

  if (status === "error") {
    return (
      <Card padding="md">
        <p className="text-sm text-text-main">{error}</p>
        <p className="mt-2 text-xs text-text-muted">
          This endpoint answers on localhost only, and it refuses providers Smart Routing is not
          currently governing.
        </p>
      </Card>
    );
  }

  const { models = [], model: activeModel, threshold, pool = [], locked = [] } = data;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {/*
        The selected model is always on screen, next to the numbers it governs. Two of the four
        columns are per account AND model, so a figure shown without naming its model is a figure
        that will be misread.
      */}
      <Card padding="md">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-main">
              Showing the order for <span className="font-mono">{activeModel || "no model"}</span>
            </p>
            <p className="text-xs text-text-muted">
              Conversations carried is per account, and that total is what the ordering uses; the
              figure under it narrows to this model. Last demoted and the error budget are per
              account and model, so they change with this selection.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {models.length > 0 && (
              <Select
                options={models.map((id) => ({ value: id, label: id }))}
                value={activeModel || ""}
                onChange={handleModelChange}
                className="w-56"
                selectClassName="py-1.5 text-xs"
              />
            )}
            <Button variant="outline" size="sm" icon="refresh" onClick={() => setReloadToken((n) => n + 1)}>
              Refresh
            </Button>
          </div>
        </div>
      </Card>

      <section className="flex min-w-0 flex-col gap-2">
        <h2 className="text-lg font-semibold text-text-main">Selection order</h2>
        <p className="text-sm text-text-muted">
          Fewest conversations first, then whichever was demoted longest ago (never-demoted
          ahead of demoted), then the static priority. A new conversation goes to the account at
          the top.
        </p>
        <AccountTable rows={pool} threshold={threshold} ranked />
      </section>

      {/*
        Kept as a separate group on purpose. Blocking and ordering are two separate layers: a
        locked account is removed from the pool rather than ranked last, so folding these into
        the table above would show an order the selection would never produce.
      */}
      <section className="flex min-w-0 flex-col gap-2">
        <h2 className="text-lg font-semibold text-text-main">Not in the pool</h2>
        <p className="text-sm text-text-muted">
          Locked or disabled accounts. A lock removes an account entirely until it expires — it is
          not the same thing as being ranked last. Soonest to return first.
        </p>
        <AccountTable rows={locked} threshold={threshold} />
      </section>

      <p className={cn("text-xs text-text-muted")}>
        The error budget resets to zero both on a success and on a demotion, so a freshly demoted
        account reads 0/10 — the demotion date is what tells you it happened. Points accumulate
        across lock cycles, not within one, and they keep accumulating even while another strategy
        is selected.
      </p>
    </div>
  );
}

SmartRoutingDetail.propTypes = {
  providerId: PropTypes.string.isRequired,
};
