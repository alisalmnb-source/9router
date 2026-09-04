// FORK(logs): list endpoint for the request log on the Smart Logs page, and the only one the
// list view calls.

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

// Payload fields the panel does not render — the raw dump is the single source for bodies, and it
// holds things these fields do not (unfiltered client body, upstream URL and headers, real SSE
// frames).
//
// **Dropped server-side, not hidden in the UI:** hiding them would keep sending them over the wire
// and leave the reduction somewhere a reader has to go looking for.
const STRIPPED_PAYLOAD_FIELDS = ["request", "providerRequest", "providerResponse", "response"];

/**
 * Retention limit, or null when it cannot be determined.
 *
 * **No local default on purpose** — DEFAULT_SETTINGS owns the number, and repeating it here would
 * be a second source of truth. When settings cannot be read, pruning is skipped rather than run
 * against a guessed threshold; this path deletes directories.
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
 * The only endpoint the list view calls, which is why retention for the dump tree is triggered from
 * here. Metadata only — bodies are fetched per row from /api/logs/session/[name] when a panel opens.
 *
 * A parallel path to upstream's /api/usage/request-details, which blanks every payload for every
 * caller. **That route is left exactly as it is.** Access is loopback-only via dashboardGuard.js.
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

    // The writer never cleans up, so retention hangs off the list request rather than a scheduler —
    // this is the one endpoint the list view always calls. **Consequence: with the view closed,
    // retention does not run at all**, so the limit is a high-water mark, not a live ceiling.
    const maxSessions = await resolveMaxSessions();
    if (maxSessions) maybePruneSessions(maxSessions);

    const result = await getRequestDetails(filter);

    const details = (result.details || []).map((detail) => {
      const sessionName = sessionNameFromLogDir(detail.logDir);
      const hasLogs = sessionName ? sessionExists(sessionName) : false;

      // The stored status cannot tell a finished stream from an aborted one — streamingHandler.js
      // writes "success" at stream open. resolveOutcome derives it instead. **Must run on the full
      // record, before the payloads below are dropped.**
      const logOutcome = hasLogs ? deriveOutcome(sessionName) : null;
      const { outcome, source } = resolveOutcome({ detail, logOutcome });

      const row = { ...detail };
      // Small values the panel still needs from the stripped fields. Both read through `response`,
      // which is a stub once past the size cap — that only happens on a long successful reply, which
      // has no error to report, so these land null exactly when there is nothing to show.
      row.errorStatus = detail.response?.status ?? null;
      row.errorMessage = detail.response?.error ?? null;
      // From the top-level copy requestDetailsRepo writes, never from `request`, which is usually
      // clipped past the size cap.
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
