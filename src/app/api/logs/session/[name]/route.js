import { NextResponse } from "next/server";
import { readSession } from "@/lib/requestLogsFs.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * FORK(logs): GET /api/logs/session/[name]
 *
 * Full staged payload for one raw dump directory: the client request, the
 * OpenAI pivot, the final upstream request, the provider response (including
 * appended SSE frames) and the response handed back to the client.
 *
 * Fetched lazily, only when a row is opened in the panel, so the list view
 * never pays for reading these files.
 *
 * **`name` is attacker-controlled.** readSession() rejects the traversal vectors and re-checks that
 * the resolved path stays inside the dump root, returning null on any mismatch — a 404 here.
 *
 * **A deny-list, not an allow-list**, and do not tighten it: the writer barely sanitises the model
 * id, so an allow-list silently loses directories and leaves them unprunable. Reasoning is on
 * UNSAFE_NAME_RE in src/lib/requestLogsFs.js.
 */
export async function GET(_request, { params }) {
  try {
    const { name } = await params;
    const session = readSession(name);

    if (!session) {
      // Same response for "unsafe name" and "no such directory" so this cannot
      // be used to probe the filesystem.
      return NextResponse.json({ error: "Log session not found" }, { status: 404 });
    }

    return NextResponse.json(session);
  } catch (error) {
    console.error("[API] /api/logs/session/[name] failed:", error);
    return NextResponse.json({ error: "Failed to read log session" }, { status: 500 });
  }
}
