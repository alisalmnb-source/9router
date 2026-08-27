// FORK(logs): list endpoint for the Logs tab, and the only one the list view calls.

import { NextResponse } from "next/server";
import { getRequestDetails, getSettings } from "@/lib/db/index.js";
import {
  deriveOutcome,
  maybePruneSessions,
  resolveOutcome,
  sessionDirPath,
  sessionExists,
  sessionNameFromLogDir,
} from "@/lib/requestLogsFs.js";

// Payload fields the panel does not render. The raw dump under logs/ is the single
// source for request and response bodies: it holds the unfiltered client body, the
// upstream URL and headers, and the actual SSE frames, none of which these fields
// carry.
//
// Dropping them server-side rather than hiding them in the UI is what keeps a page
// small. No figure is quoted on purpose: the saving is pageSize × these four fields
// × observabilityMaxJsonSize, and all three are configurable, so any number written
// here would describe one configuration and then quietly lie about the rest.
const STRIPPED_PAYLOAD_FIELDS = ["request", "providerRequest", "providerResponse", "response"];

/**
 * Retention limit, or null when it cannot be determined.
 *
 * Deliberately no local default. settingsRepo's DEFAULT_SETTINGS supplies 1000
 * through mergeWithDefaults, and repeating the number here would be a second
 * source of truth that disagrees the moment one side changes. When settings
 * cannot be read, pruning is skipped rather than run against a guessed
 * threshold — that is the one failure mode worth avoiding here, since this path
 * deletes directories.
 */
async function resolveMaxSessions() {
  try {
    const settings = await getSettings();
    const value = Number(settings?.requestLogsMaxSessions);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

// Touches the filesystem to resolve each row's raw dump, so it cannot be
// statically rendered or cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/logs/records
 *
 * List source for the Logs tab, and the only endpoint its list view calls, so
 * retention for the logs/ tree is triggered from here.
 *
 * Rows carry metadata only — account, provider, model, latency, tokens, outcome.
 * Bodies are not included at all: they live in the raw dump and are fetched per
 * row from /api/logs/session/[name] when the panel opens.
 *
 * Separate from /api/usage/request-details, which blanks every payload for all
 * callers (upstream commit 8a527fec). That route is left exactly as it is.
 *
 * Access control comes from src/dashboardGuard.js: /api/* is deny-by-default,
 * and /api/logs is additionally listed in LOCAL_ONLY_PATHS so a tunnel or
 * Tailscale host cannot reach unredacted conversation content.
 *
 * Query: page, pageSize (1-100), provider, model, connectionId, status,
 *        startDate, endDate
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);

    const pageRaw = parseInt(searchParams.get("page"), 10);
    const page = Number.isNaN(pageRaw) ? 1 : pageRaw;
    const pageSizeRaw = parseInt(searchParams.get("pageSize"), 10);
    const pageSize = Number.isNaN(pageSizeRaw) ? 20 : pageSizeRaw;

    if (page < 1) {
      return NextResponse.json({ error: "Page must be >= 1" }, { status: 400 });
    }
    if (pageSize < 1 || pageSize > 100) {
      return NextResponse.json({ error: "PageSize must be between 1 and 100" }, { status: 400 });
    }

    const filter = { page, pageSize };
    // Each of these becomes a WHERE clause in requestDetailsRepo.getRequestDetails,
    // so none of it is post-filtered here. Three ride an index (provider, model,
    // connectionId); `status` is an unindexed column scan and the dates are a range
    // scan on the timestamp index.
    //
    // Deliberately wider than the tab, which only sends provider, model and the two
    // dates. connectionId and status are here for querying the endpoint by hand —
    // the tab's own outcome filter is derived per row and cannot be a SQL predicate.
    for (const key of ["provider", "model", "connectionId", "status", "startDate", "endDate"]) {
      const value = searchParams.get(key);
      if (value) filter[key] = value;
    }

    // requestLogger.js writes one directory per upstream attempt and never
    // cleans up, so retention has to be driven from somewhere. It hangs off the
    // list request rather than a scheduler, because this is the one endpoint the
    // list view always calls.
    //
    // The tab does not poll — it fetches on mount and whenever a filter, page or
    // refresh changes the URL. So PRUNE_THROTTLE_MS is a floor between runs, not
    // a schedule: with the tab closed, retention does not run at all.
    const maxSessions = await resolveMaxSessions();
    if (maxSessions) maybePruneSessions(maxSessions);

    const result = await getRequestDetails(filter);

    const details = (result.details || []).map((detail) => {
      const sessionName = sessionNameFromLogDir(detail.logDir);
      const hasLogs = sessionName ? sessionExists(sessionName) : false;

      // streamingHandler.js hardcodes status:"success" both when a stream opens and
      // when it completes, so the stored status cannot tell a finished stream from
      // an aborted one. resolveOutcome works it out from the record's completion
      // markers, falling back to the dump. It must run on the full record, before
      // the payloads below are dropped.
      const logOutcome = hasLogs ? deriveOutcome(sessionName) : null;
      const { outcome, source } = resolveOutcome({ detail, logOutcome });

      const row = { ...detail };
      // Small values the panel still needs out of the stripped fields. Both read
      // through `response`, which is a {_truncated, …} stub once it passes the
      // size cap — that only happens on a long successful reply, which carries no
      // error to report, so these land as null exactly when there is nothing to
      // show.
      row.errorStatus = detail.response?.status ?? null;
      row.errorMessage = detail.response?.error ?? null;
      // Read from the top-level copy requestDetailsRepo writes, never from
      // `request`, which is usually clipped past the size cap.
      row.stream = detail.stream ?? null;
      for (const field of STRIPPED_PAYLOAD_FIELDS) delete row[field];

      return {
        ...row,
        // Bare directory name; the panel passes it to /api/logs/session/[name].
        sessionName,
        // Resolved fresh, so it points at where the files actually are now.
        sessionPath: hasLogs ? sessionDirPath(sessionName) : null,
        hasLogs,
        outcome,
        outcomeSource: source,
      };
    });

    return NextResponse.json({ ...result, details });
  } catch (error) {
    console.error("[API] /api/logs/records failed:", error);
    return NextResponse.json({ error: "Failed to fetch log records" }, { status: 500 });
  }
}
