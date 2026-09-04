// FORK(smartrouting): which account a conversation is currently pinned to.
//
// Why pin at all: the provider-side prompt cache is keyed to the account identity, so changing
// accounts mid-conversation resets it and the same context is charged again.
//
// No switch of its own, and deliberately so — Smart Routing orders accounts by conversations
// carried, so it needs this record regardless, and pinning under either other strategy either
// does nothing or silently redefines that strategy's rotation unit.
//
// Memory, not the database: requests arriving after a restart are new sessions by definition, so
// losing old records is the correct outcome. Stored rows would keep counting against their
// accounts' load long after the conversations ended.
//
// ── Concurrency rule this module exists to satisfy ───────────────────────────
//   > No asynchronous wait between reading shared state and writing it.
// The runtime is single-threaded, so with no await in between two requests cannot interleave.
// **Every export here is synchronous for that reason** — there is no await to place, and adding
// one silently breaks load distribution with no error. The enclosing region is upstream's
// existing selection mutex in auth.js; the ordering and the binding write stay inside it.

import { createHash } from "node:crypto";

/**
 * How long a conversation may go quiet before its account is released.
 *
 * **An idle window, not a lease.** A session that keeps sending stays on the same account for as
 * long as it keeps sending, which can be hours. The clock measures idleness since the last
 * request.
 */
export const BINDING_IDLE_MS = 30 * 60 * 1000;

/** Safety cap between sweeps, mirroring the store caps in open-sse/utils/sessionManager.js. */
const MAX_BINDINGS = 20000;

/** key → { connectionId, lastSeen } */
const bindings = new Map();

/**
 * Binding key: session and model together.
 *
 * The session alone is not enough. A combo's fusion strategy fires the same request at several
 * models at once, and those parallel calls carry identical bodies and headers, so they resolve to
 * identical session ids — keyed on the session alone they would pile onto one account
 * simultaneously, collapsing distribution exactly at peak load.
 *
 * NUL separator, because neither input can contain it, so no pair can collide by concatenation.
 * Not exported: callers go through resolveBindingKey.
 */
function bindingKey(sessionId, model) {
  return `${sessionId}\u0000${model || "__all"}`;
}

/** Drop bindings idle past the window. */
function sweep(now) {
  for (const [key, entry] of bindings) {
    if (now - entry.lastSeen > BINDING_IDLE_MS) bindings.delete(key);
  }
}

/**
 * The account this conversation is pinned to, or null.
 *
 * **Refreshes `lastSeen` on purpose** — the window measures idleness since the last request. Do
 * not use this for display; see snapshotBindings.
 */
export function getBoundConnectionId(key) {
  if (!key) return null;
  const entry = bindings.get(key);
  if (!entry) return null;

  const now = Date.now();
  if (now - entry.lastSeen > BINDING_IDLE_MS) {
    bindings.delete(key);
    return null;
  }

  entry.lastSeen = now;
  return entry.connectionId;
}

/** Pin a conversation to an account, or refresh an existing pin. */
export function bindConnection(key, connectionId) {
  if (!key || !connectionId) return;

  const existing = bindings.get(key);
  if (existing) {
    existing.connectionId = connectionId;
    existing.lastSeen = Date.now();
    return;
  }

  if (bindings.size >= MAX_BINDINGS) {
    const oldest = bindings.keys().next().value;
    if (oldest !== undefined) bindings.delete(oldest);
  }
  bindings.set(key, { connectionId, lastSeen: Date.now() });
}

/**
 * Release one conversation's pin — called when its account turns out locked, or a request on it
 * fails.
 *
 * **Never widen this to release an account's other conversations.** That would destroy all their
 * provider-side caches at once over what may be a transient error, and it would drop the failed
 * account's conversation count to zero — floating it to the TOP of the ordering, since the count
 * is the primary criterion. Each conversation detaches on its own next request.
 */
export function releaseBinding(key) {
  if (key) bindings.delete(key);
}

/**
 * FORK(smartlogs): the only form of a session identity that may leave this process.
 *
 * Tier-1 session ids come straight from the client, so their contents are not ours to decide and
 * can identify a user, while the dashboard is reachable by anyone once requireLogin is off.
 * A fingerprint is enough because the display's job is to GROUP, not to be read.
 *
 * **One definition, and it must stay one.** The session cards read the live map and the log rows
 * read a stored field written on a different code path; the two are matched by eye, so a second
 * transformation gives one conversation two tags and the matching silently stops working.
 */
export function sessionFingerprint(sessionId) {
  if (!sessionId) return null;
  return createHash("sha256").update(String(sessionId)).digest("hex").slice(0, 12);
}

/**
 * FORK(smartlogs): every live binding, for display. **Does not touch `lastSeen`.**
 *
 * A separate function rather than a flag on getBoundConnectionId, because a flag would make the
 * difference optional: the routing read refreshes `lastSeen`, so using it for display would mean
 * **opening the page extends every conversation's life** — the screen changing what it reports.
 *
 * Sweeping first is not an exception. Removing entries already past the window changes no answer;
 * refreshing one does.
 *
 * `expiresAt` is an absolute instant, never a remaining duration.
 *
 * @returns {Array<{sessionTag: string, model: string, connectionId: string, lastSeenAt: string, expiresAt: string}>}
 */
export function snapshotBindings() {
  const now = Date.now();
  sweep(now);

  const out = [];
  for (const [key, entry] of bindings) {
    const separator = key.indexOf("\u0000");
    const sessionId = separator === -1 ? key : key.slice(0, separator);
    const model = separator === -1 ? null : key.slice(separator + 1);
    out.push({
      sessionTag: sessionFingerprint(sessionId),
      model: model === "__all" ? null : model,
      connectionId: entry.connectionId,
      lastSeenAt: new Date(entry.lastSeen).toISOString(),
      expiresAt: new Date(entry.lastSeen + BINDING_IDLE_MS).toISOString(),
    });
  }
  return out;
}

/**
 * How many conversations each account is carrying. Counted across models, not per model — a
 * conversation using two models really is two streams of work.
 *
 * Idle entries are swept first or they would inflate the counts. Merely waiting conversations DO
 * count: that is what lets someone return twenty minutes later and still find their account free.
 * One window, and it is the long one.
 *
 * @returns {Map<string, number>} connectionId → conversation count.
 */
export function countBindingsByConnection() {
  sweep(Date.now());

  const counts = new Map();
  for (const entry of bindings.values()) {
    counts.set(entry.connectionId, (counts.get(entry.connectionId) || 0) + 1);
  }
  return counts;
}

/**
 * The conversation key for a request, or null when there is not one yet.
 *
 * Null is normal on a conversation's first turn; the caller treats it as "select but record
 * nothing". `sessionId` comes from resolveConversationKey in open-sse/utils/sessionManager.js.
 */
export function resolveBindingKey(sessionId, model) {
  return sessionId ? bindingKey(sessionId, model) : null;
}

// Memory guard only — correctness comes from the window checks in getBoundConnectionId and
// countBindingsByConnection. unref'd so it never keeps Node alive, matching sessionManager.js.
const sweepTimer = setInterval(() => sweep(Date.now()), BINDING_IDLE_MS);
if (sweepTimer.unref) sweepTimer.unref();
