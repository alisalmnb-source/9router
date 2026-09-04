// FORK(smartlogs): which providers Smart Routing is actually governing.
//
// Only providers whose *effective* strategy is Smart Routing appear — elsewhere there is no
// meaningful order to show and the counters mean nothing.
//
// **Resolved through the shared precedence helper, never a local copy.** The precedence has two
// branches, and a second copy here would keep listing the wrong providers on the day it changed,
// with nothing failing.
//
// Under /api/logs so it inherits loopback-only access.

import { NextResponse } from "next/server";
import { getProviderConnections, getSettings } from "@/lib/db/index.js";
import { ROUTING_STRATEGY, resolveProviderStrategy } from "@/lib/routingStrategy";
import { countBindingsByConnection } from "@/sse/services/sessionAffinity.js";
import { AI_PROVIDERS } from "@/shared/constants/providers.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/logs/smart-routing
 *
 * Response:
 *   { providers: [{ id, name, connectionCount, activeConnectionCount, sessionCount }] }
 *
 * The candidate set is every provider that has at least one stored connection, not every
 * provider in the registry. A provider with no accounts has nothing to order, so listing it
 * would be a tile that opens onto an empty table.
 *
 * `sessionCount` is summed from the live bindings, which is a per-account figure rolled up to
 * the provider — a conversation using two models really is two streams of work, and both count.
 *
 * Sorted by name so the tiles do not reorder between polls; the ordering that matters is inside
 * a provider, not between them.
 */
export async function GET() {
  try {
    const [settings, connections] = await Promise.all([getSettings(), getProviderConnections()]);

    const byProvider = new Map();
    for (const connection of connections) {
      if (!connection?.provider) continue;
      if (!byProvider.has(connection.provider)) byProvider.set(connection.provider, []);
      byProvider.get(connection.provider).push(connection);
    }

    const sessionCounts = countBindingsByConnection();

    const providers = [];
    for (const [providerId, list] of byProvider) {
      if (resolveProviderStrategy(providerId, settings) !== ROUTING_STRATEGY.SMART) continue;

      let sessionCount = 0;
      for (const connection of list) sessionCount += sessionCounts.get(connection.id) || 0;

      providers.push({
        id: providerId,
        name: AI_PROVIDERS[providerId]?.name || providerId,
        connectionCount: list.length,
        // Disabled accounts never enter the selection pool at all, so the two figures being
        // different is the honest way to show a provider whose accounts are mostly switched off.
        activeConnectionCount: list.filter((c) => c.isActive !== false).length,
        sessionCount,
      });
    }

    providers.sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ providers });
  } catch (error) {
    console.error("[API] /api/logs/smart-routing failed:", error);
    return NextResponse.json({ error: "Failed to list Smart Routing providers" }, { status: 500 });
  }
}
