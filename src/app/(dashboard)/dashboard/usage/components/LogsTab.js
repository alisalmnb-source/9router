"use client";

// FORK(logs): the Logs tab — one row per upstream attempt, with a side panel
// showing a metadata summary and the raw dump files for that attempt.
//
// Two sources, each doing only what it is good at. The list comes from SQLite
// (/api/logs/records), which is indexed on timestamp, provider, model and
// connectionId, and is also the only place carrying the account, latency and
// token counts. Bodies come from the filesystem (/api/logs/session/[name]) and
// are fetched only when a row is opened, so the list never pays for reading them.
//
// Not the same source as the Details tab: that one reads
// /api/usage/request-details, which blanks every payload for all callers.

import { useCallback, useEffect, useMemo, useState } from "react";
import Badge from "@/shared/components/Badge";
import Button from "@/shared/components/Button";
import Card from "@/shared/components/Card";
import Drawer from "@/shared/components/Drawer";
import Pagination from "@/shared/components/Pagination";
import { cn } from "@/shared/utils/cn";
import { AI_PROVIDERS, getProviderByAlias } from "@/shared/constants/providers";

const OUTCOME_META = {
  ok: { label: "OK", variant: "success", icon: "check_circle" },
  error: { label: "Error", variant: "error", icon: "error" },
  incomplete: { label: "Incomplete", variant: "warning", icon: "pending" },
  unknown: { label: "Unknown", variant: "default", icon: "help" },
};

const OUTCOME_FILTERS = [
  { value: "", label: "All outcomes" },
  { value: "ok", label: "OK" },
  { value: "error", label: "Error" },
  { value: "incomplete", label: "Incomplete" },
];

const EMPTY_FILTERS = { provider: "", model: "", outcome: "", startDate: "", endDate: "" };

const SELECT_CLASS = cn(
  "h-9 px-3 rounded-lg border border-black/10 dark:border-white/10 bg-surface",
  "text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/20",
  "w-full min-w-0 cursor-pointer"
);

const INPUT_CLASS = cn(
  "h-9 px-3 rounded-lg border border-black/10 dark:border-white/10 bg-surface",
  "w-full min-w-0 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/20"
);

const PRE_CLASS = cn(
  "max-h-[360px] max-w-full overflow-auto rounded-lg border border-black/5 bg-black/5",
  "p-3 font-mono text-xs whitespace-pre-wrap break-words text-text-main",
  "dark:border-white/5 dark:bg-white/5 sm:p-4"
);

// ---------------------------------------------------------------------------
// Formatting helpers. The token helpers mirror the Details tab so both views
// report the same numbers for the same row.
// ---------------------------------------------------------------------------

function getCachedTokens(tokens) {
  return tokens?.cached_tokens || tokens?.cache_read_input_tokens || 0;
}

function getCacheCreationTokens(tokens) {
  return tokens?.cache_creation_input_tokens || 0;
}

function getInputTokens(tokens) {
  const prompt = tokens?.prompt_tokens || tokens?.input_tokens || 0;
  // Canonical storage keeps prompt cache-inclusive; the cache fallback covers
  // rows that stored it cache-exclusive. Kept as a deliberate mirror of
  // RequestDetailsTab.getInputTokens, not for this fork's own data: the two tabs
  // read the same rows, so a different rule here would show two input counts for
  // one request. Change it only alongside that copy.
  const cache = getCachedTokens(tokens);
  return prompt < cache ? cache : prompt;
}

function getProviderName(providerId, cache) {
  if (!providerId || !cache) return providerId;
  const cached = cache[providerId];
  if (typeof cached === "string") return cached;
  if (cached?.name) return cached.name;
  const config = getProviderByAlias(providerId) || AI_PROVIDERS[providerId];
  return config?.name || providerId;
}

/**
 * Human label for the account an attempt used. Records store only
 * connectionId, so it is resolved against the live connection list; a short id
 * is shown when the account has since been deleted.
 */
function getAccountLabel(connectionId, accountMap) {
  if (!connectionId) return null;
  const account = accountMap?.[connectionId];
  const label = account?.name || account?.email;
  if (label) return label;
  return `${String(connectionId).slice(0, 8)}…`;
}

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function toPayloadText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// Presentational pieces
// ---------------------------------------------------------------------------

// Both sources are trustworthy, so neither is flagged as suspect — the title
// just says which one answered. Which one that is varies by row: the record
// answers while its stored response is small enough to survive truncation,
// which covers aborted streams, so long successful replies read "logs".
const OUTCOME_SOURCE_TITLE = {
  record: "Determined from the stored record's completion markers",
  logs: "Determined from the raw dump on disk",
};

function OutcomeBadge({ outcome, source, size = "md" }) {
  const meta = OUTCOME_META[outcome] || OUTCOME_META.unknown;
  return (
    <span title={OUTCOME_SOURCE_TITLE[source] || undefined}>
      <Badge variant={meta.variant} size={size} icon={meta.icon}>
        {meta.label}
      </Badge>
    </span>
  );
}

function CopyButton({ text, label = "Copy" }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard needs a secure context; nothing useful to do on failure.
    }
  }, [text]);

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleCopy}
      aria-label={copied ? "Copied to clipboard" : label}
    >
      <span className="material-symbols-outlined text-[16px]">
        {copied ? "check" : "content_copy"}
      </span>
    </Button>
  );
}

// Collapsed on mount, with no prop to override it: a session can hold ten stages and one
// of them can be a megabyte of SSE frames, so opening any by default would make the panel
// pay for reading them every time a row is opened.
function CollapsibleSection({ title, subtitle, children, icon = null }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="overflow-hidden rounded-lg border border-black/5 dark:border-white/5">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        className={cn(
          "flex w-full items-center justify-between gap-2 p-3 text-left",
          "bg-black/[0.02] hover:bg-black/[0.04] dark:bg-white/[0.02] dark:hover:bg-white/[0.04]",
          "transition-colors"
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {icon && <span className="material-symbols-outlined text-[18px] text-text-muted">{icon}</span>}
          <span className="truncate text-sm font-semibold text-text-main">{title}</span>
          {subtitle && <span className="hidden truncate text-xs text-text-muted sm:inline">{subtitle}</span>}
        </span>
        <span
          className={cn(
            "material-symbols-outlined shrink-0 text-[20px] text-text-muted transition-transform duration-200",
            isOpen ? "rotate-90" : ""
          )}
        >
          chevron_right
        </span>
      </button>

      {isOpen && <div className="border-t border-black/5 p-4 dark:border-white/5">{children}</div>}
    </div>
  );
}

/**
 * Render one stage file exactly as it sits on disk.
 *
 * Nothing inside a file is filtered out — this is the raw view, so a field that
 * duplicates another stage is still shown. The only limit is MAX_FILE_BYTES in
 * requestLogsFs.js, which stops a multi-megabyte SSE transcript from locking up
 * the tab; when it bites, the panel points at the file instead.
 */
function PayloadBlock({ value, parseError = false, truncated = false, size = null, fileName = null }) {
  const text = toPayloadText(value);
  const sizeLabel = formatBytes(size);

  if (!text) {
    return <p className="text-sm text-text-muted">[empty]</p>;
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2">
          {/* Derived from what actually arrived, not from a copy of
              requestLogsFs.MAX_FILE_BYTES. A hardcoded figure here would keep
              claiming the old cap after that constant moved. */}
          {truncated && (
            <Badge variant="warning" size="sm" icon="content_cut">
              Showing the first {formatBytes(text.length) || "part"}
            </Badge>
          )}
          {parseError && (
            <Badge variant="warning" size="sm" icon="warning">
              Not valid JSON — shown raw
            </Badge>
          )}
          {sizeLabel && <span className="text-xs text-text-muted">{sizeLabel}</span>}
        </span>
        <CopyButton text={text} />
      </div>

      {truncated && (
        <p className="text-xs text-text-muted">
          Too large to render in full. Open{" "}
          {fileName ? <span className="font-mono">{fileName}</span> : "the file"} in the dump directory above to read
          all {sizeLabel || "of it"}.
        </p>
      )}

      <pre className={PRE_CLASS}>{text}</pre>
    </div>
  );
}

function SummaryField({ label, children }) {
  return (
    <div className="min-w-0">
      <span className="block text-xs text-text-muted">{label}</span>
      <span className="block min-w-0 break-words text-sm text-text-main">{children}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

function RecordPanel({ record, providerNameCache, accountMap }) {
  // Keyed by session name so the fetch result and the row it belongs to can
  // never drift apart. State is written only from the fetch callbacks, and the
  // loading/none cases are derived below rather than stored, which keeps this
  // effect free of synchronous setState.
  const [fetched, setFetched] = useState({ name: null, state: "idle", data: null });

  const sessionName = record?.sessionName;
  const hasLogs = !!record?.hasLogs;

  useEffect(() => {
    if (!sessionName || !hasLogs) return undefined;

    let cancelled = false;

    fetch(`/api/logs/session/${encodeURIComponent(sessionName)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setFetched({ name: sessionName, state: "ready", data });
      })
      .catch(() => {
        if (!cancelled) setFetched({ name: sessionName, state: "error", data: null });
      });

    return () => { cancelled = true; };
  }, [sessionName, hasLogs]);

  const sessionState = !sessionName || !hasLogs
    ? "none"
    : fetched.name === sessionName ? fetched.state : "loading";
  const session = fetched.name === sessionName ? fetched.data : null;

  if (!record) return null;

  const accountLabel = getAccountLabel(record.connectionId, accountMap);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <OutcomeBadge outcome={record.outcome} source={record.outcomeSource} size="lg" />
        {record.errorStatus && record.outcome === "error" && (
          <Badge variant="error" size="md">HTTP {record.errorStatus}</Badge>
        )}
        {/* null is the only absent value to test for: /api/logs/records normalises the
            field with `?? null` on the way out, so it is always present on a row. */}
        {record.stream !== null && (
          <Badge variant={record.stream ? "info" : "default"} size="md">
            {record.stream ? "streaming" : "non-streaming"}
          </Badge>
        )}
      </div>

      {record.outcome === "error" && record.errorMessage && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-red-700 dark:text-red-300">
            Error
          </p>
          <p className="break-words font-mono text-xs text-red-900 dark:text-red-100">
            {record.errorMessage}
          </p>
        </div>
      )}

      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        <SummaryField label="Timestamp">
          {record.timestamp ? new Date(record.timestamp).toLocaleString() : "—"}
        </SummaryField>
        <SummaryField label="Account">
          {accountLabel ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-text-muted">person</span>
              {accountLabel}
            </span>
          ) : "—"}
        </SummaryField>
        <SummaryField label="Provider">
          {getProviderName(record.provider, providerNameCache) || "—"}
        </SummaryField>
        <SummaryField label="Model">
          <span className="font-mono">{record.model || "—"}</span>
        </SummaryField>
        <SummaryField label="Latency">
          <span className="font-mono">
            TTFT {record.latency?.ttft || 0}ms / Total {record.latency?.total || 0}ms
          </span>
        </SummaryField>
        <SummaryField label="Tokens">
          <span className="font-mono">
            in {getInputTokens(record.tokens).toLocaleString()} / out{" "}
            {(record.tokens?.completion_tokens || 0).toLocaleString()}
            {getCachedTokens(record.tokens) > 0 && ` · cached ${getCachedTokens(record.tokens).toLocaleString()}`}
            {getCacheCreationTokens(record.tokens) > 0 && ` · cache+ ${getCacheCreationTokens(record.tokens).toLocaleString()}`}
          </span>
        </SummaryField>
        <SummaryField label="Record ID">
          <span className="break-all font-mono text-xs">{record.id}</span>
        </SummaryField>
      </div>

      {record.connectionId && (
        <p className="text-xs text-text-muted">
          Connection ID <span className="break-all font-mono">{record.connectionId}</span>
        </p>
      )}

      {/* The dump directory, resolved server-side. Shown in full so a file can
          be opened straight from disk — which is also the escape hatch for a
          transcript too large to render inline. */}
      {record.sessionPath && (
        <div className="flex min-w-0 items-start justify-between gap-2 rounded-lg border border-black/5 p-3 dark:border-white/5">
          <div className="min-w-0">
            <span className="block text-xs text-text-muted">Dump directory</span>
            <span className="block break-all font-mono text-xs text-text-main">
              {record.sessionPath}
            </span>
          </div>
          <CopyButton text={record.sessionPath} label="Copy dump directory path" />
        </div>
      )}

      {/* Bodies come only from the dump. The SQLite copies are near-duplicates of
          these stages and worse where they differ — providerRequest lacks the URL
          and headers, providerResponse holds assembled text rather than SSE frames
          — so /api/logs/records drops them server-side rather than hiding them
          here. */}
      <div className="flex min-w-0 flex-col gap-3">
        <h3 className="text-sm font-semibold text-text-main">Raw dump</h3>
        <p className="text-xs text-text-muted">
          Files written to <span className="font-mono">logs/</span> by the router, shown as they are on disk.
          Which stages exist depends on the route the request took and whether it failed.
        </p>

        {sessionState === "none" && (
          <p className="text-sm text-text-muted">No raw dump on disk for this record.</p>
        )}
        {sessionState === "loading" && (
          <p className="flex items-center gap-2 text-sm text-text-muted">
            <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
            Loading raw dump…
          </p>
        )}
        {sessionState === "error" && (
          <p className="text-sm text-text-muted">Could not read the raw dump.</p>
        )}
        {sessionState === "ready" && session?.stages?.length === 0 && (
          <p className="text-sm text-text-muted">The directory exists but holds no stage files yet.</p>
        )}
        {sessionState === "ready" && session?.stages?.map((stage) => (
          <CollapsibleSection
            key={stage.key}
            title={stage.label}
            subtitle={stage.file}
            icon="description"
          >
            <PayloadBlock
              value={stage.kind === "json" && !stage.parseError ? stage.json : stage.text}
              parseError={stage.parseError}
              truncated={stage.truncated}
              size={stage.size}
              fileName={stage.file}
            />
          </CollapsibleSection>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab
// ---------------------------------------------------------------------------

export default function LogsTab() {
  const [query, setQuery] = useState({ page: 1, pageSize: 20 });
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [reloadToken, setReloadToken] = useState(0);
  // Result of the most recently completed fetch, tagged with the query it
  // answers. `loading` is derived from comparing that tag against the current
  // query, so no state is written synchronously inside the effect and a slow
  // response can never overwrite a newer one.
  const [result, setResult] = useState({ key: null, records: [], pagination: null, error: null });
  const [providers, setProviders] = useState([]);
  const [providerNameCache, setProviderNameCache] = useState(null);
  const [accountMap, setAccountMap] = useState(null);
  const [selected, setSelected] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const { page, pageSize } = query;

  // Provider display names and the connectionId → account lookup. Fetched once;
  // both are small and change rarely.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [providersRes, nodesRes, connectionsRes] = await Promise.all([
          fetch("/api/usage/providers"),
          fetch("/api/provider-nodes"),
          fetch("/api/providers"),
        ]);

        if (cancelled) return;

        const providersData = providersRes.ok ? await providersRes.json() : {};
        const nodesData = nodesRes.ok ? await nodesRes.json() : {};
        const connectionsData = connectionsRes.ok ? await connectionsRes.json() : {};
        if (cancelled) return;

        setProviders(providersData.providers || []);

        const nodeNames = {};
        for (const node of nodesData.nodes || []) nodeNames[node.id] = node.name;
        setProviderNameCache({ ...AI_PROVIDERS, ...nodeNames });

        const accounts = {};
        for (const connection of connectionsData.connections || []) {
          if (connection?.id) {
            accounts[connection.id] = {
              name: connection.name,
              email: connection.email,
              provider: connection.provider,
            };
          }
        }
        setAccountMap(accounts);
      } catch {
        if (!cancelled) setAccountMap({});
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // Only the server-side filters belong in the request. `outcome` is derived
  // per row from the filesystem, so it is applied client-side further down.
  const requestUrl = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (filters.provider) params.set("provider", filters.provider);
    if (filters.model) params.set("model", filters.model);
    if (filters.startDate) params.set("startDate", filters.startDate);
    if (filters.endDate) params.set("endDate", filters.endDate);
    return `/api/logs/records?${params}`;
  }, [page, pageSize, filters]);

  const requestKey = `${reloadToken}:${requestUrl}`;

  useEffect(() => {
    let cancelled = false;

    fetch(requestUrl)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setResult({
          key: requestKey,
          records: data.details || [],
          pagination: data.pagination || null,
          error: null,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setResult({
          key: requestKey,
          records: [],
          pagination: null,
          error: error?.message || "Failed to load",
        });
      });

    return () => { cancelled = true; };
  }, [requestUrl, requestKey]);

  const loading = result.key !== requestKey;
  const loadError = result.error;
  const records = result.records;
  const totalItems = result.pagination?.totalItems ?? 0;

  // Outcome is derived per row from the filesystem, so it cannot be a SQL
  // predicate. Filtering it here narrows the current page only, which the hint
  // under the control spells out.
  const visibleRecords = useMemo(() => {
    if (!filters.outcome) return records;
    return records.filter((record) => record.outcome === filters.outcome);
  }, [records, filters.outcome]);

  // Any filter change resets to page 1: keeping the old offset against a
  // narrower result set lands you on an empty page.
  const updateFilter = useCallback((key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setQuery((prev) => ({ ...prev, page: 1 }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setQuery((prev) => ({ ...prev, page: 1 }));
  }, []);

  const openRecord = useCallback((record) => {
    setSelected(record);
    setIsDrawerOpen(true);
  }, []);

  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card padding="md">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor="logs-provider" className="text-sm font-medium text-text-main">Provider</label>
            <select
              id="logs-provider"
              value={filters.provider}
              onChange={(e) => updateFilter("provider", e.target.value)}
              className={SELECT_CLASS}
              style={{ colorScheme: "auto" }}
            >
              <option value="">All providers</option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>{provider.name}</option>
              ))}
            </select>
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor="logs-model" className="text-sm font-medium text-text-main">Model</label>
            <input
              id="logs-model"
              type="text"
              placeholder="Exact model id"
              value={filters.model}
              onChange={(e) => updateFilter("model", e.target.value)}
              className={INPUT_CLASS}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor="logs-outcome" className="text-sm font-medium text-text-main">Outcome</label>
            <select
              id="logs-outcome"
              value={filters.outcome}
              onChange={(e) => updateFilter("outcome", e.target.value)}
              className={SELECT_CLASS}
              style={{ colorScheme: "auto" }}
            >
              {OUTCOME_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor="logs-start" className="text-sm font-medium text-text-main">Start date</label>
            <input
              id="logs-start"
              type="datetime-local"
              value={filters.startDate}
              onChange={(e) => updateFilter("startDate", e.target.value)}
              className={INPUT_CLASS}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor="logs-end" className="text-sm font-medium text-text-main">End date</label>
            <input
              id="logs-end"
              type="datetime-local"
              value={filters.endDate}
              onChange={(e) => updateFilter("endDate", e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-text-muted">
            {filters.outcome
              ? "Outcome is derived from the raw dump, so it filters the current page only."
              : "Rows are one attempt each: an account or model fallback produces a separate row."}
          </p>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={() => setReloadToken((token) => token + 1)}
              disabled={loading}
              icon="refresh"
            >
              Refresh
            </Button>
            <Button variant="ghost" onClick={clearFilters} disabled={!hasFilters}>
              Clear filters
            </Button>
          </div>
        </div>
      </Card>

      <Card padding="none">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px]">
            <thead>
              <tr className="border-b border-black/5 dark:border-white/5">
                <th scope="col" className="p-4 text-left text-sm font-semibold text-text-main">Outcome</th>
                <th scope="col" className="p-4 text-left text-sm font-semibold text-text-main">Timestamp</th>
                <th scope="col" className="p-4 text-left text-sm font-semibold text-text-main">Model</th>
                <th scope="col" className="p-4 text-left text-sm font-semibold text-text-main">Provider</th>
                <th scope="col" className="p-4 text-left text-sm font-semibold text-text-main">Account</th>
                <th scope="col" className="p-4 text-right text-sm font-semibold text-text-main">In</th>
                <th scope="col" className="p-4 text-right text-sm font-semibold text-text-main">Cached</th>
                <th scope="col" className="p-4 text-right text-sm font-semibold text-text-main">Out</th>
                <th scope="col" className="p-4 text-left text-sm font-semibold text-text-main">Latency</th>
                <th scope="col" className="p-4 text-center text-sm font-semibold text-text-main">Raw</th>
                <th scope="col" className="p-4 text-center text-sm font-semibold text-text-main">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={11} className="p-8 text-center text-text-muted">
                    <span className="flex items-center justify-center gap-2">
                      <span className="material-symbols-outlined animate-spin text-[20px]">progress_activity</span>
                      Loading…
                    </span>
                  </td>
                </tr>
              ) : loadError ? (
                <tr>
                  <td colSpan={11} className="p-8 text-center text-text-muted">
                    Failed to load records ({loadError}).
                  </td>
                </tr>
              ) : visibleRecords.length === 0 ? (
                <tr>
                  <td colSpan={11} className="p-8 text-center text-text-muted">
                    No records found.
                  </td>
                </tr>
              ) : (
                visibleRecords.map((record, index) => {
                  const accountLabel = getAccountLabel(record.connectionId, accountMap);
                  return (
                    <tr
                      key={`${record.id}-${index}`}
                      onClick={() => openRecord(record)}
                      className={cn(
                        "cursor-pointer border-b border-black/5 transition-colors last:border-b-0",
                        "hover:bg-black/[0.02] dark:border-white/5 dark:hover:bg-white/[0.02]"
                      )}
                    >
                      <td className="p-4">
                        <OutcomeBadge outcome={record.outcome} source={record.outcomeSource} size="sm" />
                      </td>
                      <td className="whitespace-nowrap p-4 text-sm text-text-main">
                        {record.timestamp ? new Date(record.timestamp).toLocaleString() : "—"}
                      </td>
                      <td className="max-w-[220px] truncate p-4 font-mono text-sm text-text-main">
                        {record.model}
                      </td>
                      <td className="max-w-[150px] truncate p-4 text-sm text-text-main">
                        {getProviderName(record.provider, providerNameCache)}
                      </td>
                      <td className="max-w-[170px] truncate p-4 text-sm text-text-main">
                        {accountLabel ? (
                          <span className="inline-flex min-w-0 items-center gap-1.5">
                            <span className="material-symbols-outlined shrink-0 text-[16px] text-text-muted">person</span>
                            <span className="truncate">{accountLabel}</span>
                          </span>
                        ) : (
                          <span className="text-text-muted">—</span>
                        )}
                      </td>
                      <td className="p-4 text-right font-mono text-sm text-text-main">
                        {getInputTokens(record.tokens).toLocaleString()}
                      </td>
                      <td className="p-4 text-right font-mono text-sm text-text-main">
                        {getCachedTokens(record.tokens) > 0 ? getCachedTokens(record.tokens).toLocaleString() : "—"}
                      </td>
                      <td className="p-4 text-right font-mono text-sm text-text-main">
                        {(record.tokens?.completion_tokens || 0).toLocaleString()}
                      </td>
                      <td className="whitespace-nowrap p-4 text-sm text-text-muted">
                        <span className="font-mono">{record.latency?.total || 0}ms</span>
                        {record.latency?.ttft ? (
                          <span className="ml-1 text-xs">(ttft {record.latency.ttft}ms)</span>
                        ) : null}
                      </td>
                      <td className="p-4 text-center">
                        {record.hasLogs ? (
                          <span
                            className="material-symbols-outlined text-[18px] text-green-600 dark:text-green-400"
                            title="Raw dump available"
                          >
                            folder
                          </span>
                        ) : (
                          <span className="material-symbols-outlined text-[18px] text-text-muted" title="No raw dump">
                            folder_off
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-center">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(event) => {
                            event.stopPropagation();
                            openRecord(record);
                          }}
                        >
                          Detail
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {!loading && !loadError && records.length > 0 && (
          <div className="border-t border-black/5 dark:border-white/5">
            <Pagination
              currentPage={page}
              pageSize={pageSize}
              totalItems={totalItems}
              onPageChange={(newPage) => setQuery((prev) => ({ ...prev, page: newPage }))}
              onPageSizeChange={(newPageSize) => setQuery({ page: 1, pageSize: newPageSize })}
            />
          </div>
        )}
      </Card>

      <Drawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        title="Request log"
        width="xl"
      >
        <RecordPanel
          record={selected}
          providerNameCache={providerNameCache}
          accountMap={accountMap}
        />
      </Drawer>
    </div>
  );
}
