// FORK(smartlogs): live conversation-to-account bindings for the Smart Logs page.
//
// Must go through `snapshotBindings`, never the routing read — the routing read refreshes a
// binding's last-seen time on purpose, so using it here would make opening the page extend
// every conversation's life. The two are separate functions rather than one with a flag
// exactly so this cannot happen by accident.
//
// Placed under /api/logs so it inherits the loopback-only entry in dashboardGuard.js, which
// matches by prefix. Emits the fingerprint only; the raw session id never leaves the process.

import { NextResponse } from "next/server";
import { BINDING_IDLE_MS, snapshotBindings } from "@/sse/services/sessionAffinity.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/logs/sessions
 *   { sessions: [{ sessionTag, model, connectionId, lastSeenAt, expiresAt }], idleMs }
 *
 * `expiresAt` is an absolute instant, never a remaining duration — a duration is stale by the
 * time it renders. One entry per session-and-model pair, matching the binding's own shape.
 * `idleMs` is echoed so the page need not restate the window.
 */
export async function GET() {
  try {
    return NextResponse.json({
      sessions: snapshotBindings(),
      idleMs: BINDING_IDLE_MS,
    });
  } catch (error) {
    console.error("[API] /api/logs/sessions failed:", error);
    return NextResponse.json({ error: "Failed to read active sessions" }, { status: 500 });
  }
}
