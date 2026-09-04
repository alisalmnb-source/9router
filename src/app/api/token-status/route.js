// FORK(tokenstat): per-connection token refresh status for the Connections list.
//
// A separate route rather than fields on GET /api/providers because two inputs cannot be served
// from there: the per-provider refresh lead is registry-derived and must run server-side, and
// eligibility depends on a refresh token that route blanks before answering.
//
// **The only fork route with no loopback entry, and that is deliberate.** Every value here is
// derived from fields GET /api/providers already publishes, so a loopback entry would not change
// what is reachable — and a guard that protects nothing invites relying on it. What actually bounds
// the exposure is the reduction at the write point, in tokenRefreshStatus.js.
//
// Names every field it emits instead of spreading the record. That is what keeps tokens out.

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
