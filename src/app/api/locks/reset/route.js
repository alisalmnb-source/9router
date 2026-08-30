// FORK(locks): clear every model lock on one connection, plus the error state that
// upstream leaves behind until the next successful request.
//
// Why a new route rather than PUT /api/providers/[id]: that handler is a strict
// allowlist (name, priority, globalPriority, defaultModel, isActive, apiKey,
// testStatus, lastError, lastErrorAt, providerSpecificData). modelLock_* and
// backoffLevel are not in it, so nothing sent there can clear a lock.
//
// Why not /api/models/availability: its clearCooldown action is scoped to
// provider + model and clears that key across every connection of the provider. A
// button on one connection's row must not touch its siblings.
//
// Why the /api/locks prefix: LOCAL_ONLY_PATHS in src/dashboardGuard.js matches with
// startsWith, so a path segment in the middle — /api/providers/<id>/reset-lock — cannot
// be expressed there and would sit outside the guard. See "Rules that outlive a
// feature" in FORK-CHANGES.md.

import { NextResponse } from "next/server";
import { getProviderConnectionById, updateProviderConnection } from "@/lib/db/index.js";
import { buildClearModelLocksUpdate } from "open-sse/services/accountFallback.js";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const { connectionId } = await request.json();
    if (!connectionId || typeof connectionId !== "string") {
      return NextResponse.json({ error: "connectionId is required" }, { status: 400 });
    }

    const connection = await getProviderConnectionById(connectionId);
    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    // Upstream's own helper, so the lock key naming lives in exactly one place. It
    // enumerates by prefix off the record rather than from a fixed list, which is why
    // it cannot miss a lock this route does not know about.
    const clearLocks = buildClearModelLocksUpdate(connection);

    // Mirrors the reset block in clearAccountError (src/sse/services/auth.js). Clearing
    // the locks alone would leave testStatus "unavailable" and lastError on screen until
    // a real request succeeded, and would leave backoffLevel where it was so the next
    // failure resumed the ladder mid-climb.
    await updateProviderConnection(connectionId, {
      ...clearLocks,
      testStatus: "active",
      lastError: null,
      errorCode: null,
      lastErrorAt: null,
      backoffLevel: 0,
    });

    // No count in the body on purpose. The caller re-reads the connection list to redraw
    // the row, so a number here would have no reader, and the only one worth reporting —
    // how many locks were actually released — is not what a scan of the pre-update record
    // measures: modelLock_* keys whose timestamp has already passed are still present on
    // it and are cleared by the same update.
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[API] /api/locks/reset failed:", error);
    return NextResponse.json({ error: "Failed to reset locks" }, { status: 500 });
  }
}
