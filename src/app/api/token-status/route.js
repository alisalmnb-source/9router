// FORK(tokenstat): per-connection token refresh status for the Connections list.
//
// Why a separate route rather than adding fields to GET /api/providers: two of the three
// inputs cannot be served from there. The per-provider refresh lead comes from
// getRefreshLeadMs, whose table is derived from the provider registry, so the formula has
// to run server side; and eligibility depends on whether a refresh token exists, which
// that route blanks before answering. Deriving both here keeps upstream's route
// untouched and means no secret has to travel to compute a status line.
//
// Why no LOCAL_ONLY_PATHS entry, unlike /api/logs and /api/locks. Every value this route
// returns is derived from fields GET /api/providers already publishes — expiresAt,
// lastRefreshAt, authType and the fork's own tokenRefreshAttempt, which rides along on
// the record whether this route exists or not. proxy() in src/dashboardGuard.js applies
// deny-by-default to /api/*, so this path inherits exactly the posture /api/providers
// has: authenticated when requireLogin is on, open to any dashboard caller when it is
// off. A loopback entry here would not change what is reachable, and a guard that
// protects nothing invites relying on it. What actually bounds the exposure is the
// reduction at the write point — see REFRESH_ERROR_DETAIL_MAX in tokenRefreshStatus.js.

import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/db/index.js";
import { resolveTokenRefreshStatus } from "@/sse/services/tokenRefreshStatus.js";

// Reads the connection table, so nothing here can be statically rendered or cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/token-status
 *
 * Answers `{ statuses: { <connectionId>: status } }` for every connection, including
 * the ineligible ones as a bare `{ eligible: false }`. Listing them is what lets the UI
 * tell "this connection has no token to refresh" apart from "this connection was not in
 * the response", which would otherwise both render as nothing.
 *
 * The response is built field by field from resolveTokenRefreshStatus and the connection
 * is never spread into it. That is the only thing keeping access tokens, refresh tokens
 * and API keys out of this payload: unlike GET /api/providers, which spreads the record
 * and blanks four keys afterwards, this route names what it emits.
 *
 * No filtering parameters. The Connections page already filters by provider client side,
 * and every entry is a handful of small fields.
 */
export async function GET() {
  try {
    const connections = await getProviderConnections();

    const statuses = {};
    for (const connection of connections) {
      if (!connection?.id) continue;
      statuses[connection.id] = resolveTokenRefreshStatus(connection);
    }

    return NextResponse.json({ statuses });
  } catch (error) {
    console.error("[API] /api/token-status failed:", error);
    return NextResponse.json({ error: "Failed to resolve token status" }, { status: 500 });
  }
}
