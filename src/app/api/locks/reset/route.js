// FORK(locks): clear every model lock on one connection, plus the error state that
// upstream leaves behind until the next successful request.
//
// A new route rather than PUT /api/providers/[id] because that handler is a strict allowlist and
// neither modelLock_* nor backoffLevel is on it — anything sent there silently clears nothing.
//
// Not /api/models/availability either: its clear action is scoped to provider plus model and clears
// that key across every connection of the provider. A button on one row must not touch its siblings.
//
// **The /api/locks prefix is load-bearing:** the loopback list matches by prefix, so a path with a
// segment in the middle (/api/providers/<id>/reset-lock) could not be expressed there and would sit
// outside the guard entirely.

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
