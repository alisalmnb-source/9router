// FORK(smartlogs): why one provider's accounts are in the order they are.
//
// **The ordering is not recomputed here — it calls the same comparator selection does.** A second
// comparator would eventually disagree with the real one, and this screen exists to be trusted.
//
// **Two groups, not one list:** the pool is what the ordering ranks, while a locked account is
// removed rather than ranked. Interleaving them would show an order selection never produces.
//
// A model is always resolved, because the scopes are not symmetric: conversations carried is per
// account, while the demotion date and error counter are per account AND model. A bare "4/10" with
// no model beside it is a number nobody can act on.
//
// Under /api/logs so it inherits loopback-only access.

import { NextResponse } from "next/server";
import { getProviderConnections, getSettings } from "@/lib/db/index.js";
import { ROUTING_STRATEGY, resolveProviderStrategy } from "@/lib/routingStrategy";
import {
  DEMOTE_THRESHOLD,
  demotedAtKey,
  errorScoreKey,
  smartFieldModel,
  sortBySmartRouting,
} from "@/lib/smartRouting";
import { countBindingsByConnection, snapshotBindings } from "@/sse/services/sessionAffinity.js";
import { getEarliestModelLockUntil, isModelLockActive } from "open-sse/services/accountFallback.js";
import { getModelsByProviderId } from "open-sse/config/providerModels.js";
import { AI_PROVIDERS, resolveProviderId } from "@/shared/constants/providers.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Every model worth offering in the selector: the provider's configured models, plus any model
 * a stored field already mentions.
 *
 * The second half matters. A model can be removed from the registry while accounts still carry
 * its counters, and those are exactly the records someone comes here to read — a demotion that
 * cannot be selected is a demotion that cannot be explained.
 */
function collectModels(connections, providerId) {
  const models = new Set(getModelsByProviderId(providerId).map((m) => m.id || m).filter(Boolean));

  // Through smartFieldModel rather than by re-spelling the prefixes here: they have one home in
  // smartRouting.js, and a second copy would keep working right up until either string changed.
  // It also maps the no-model segment to null for us, so nothing model-shaped needs deleting.
  for (const connection of connections) {
    for (const key of Object.keys(connection)) {
      const field = smartFieldModel(key);
      if (field?.model) models.add(field.model);
    }
  }

  return [...models].sort();
}

/**
 * The model the screen opens on.
 *
 * Busiest first — the model carrying the most live conversations on this provider is the one
 * most likely to be worth looking at. Falling back to the first configured model rather than
 * leaving the selector empty: an empty selector blanks half the screen and asks for a choice
 * before showing what the screen is for. The default's job is a sensible starting point, not a
 * correct guess, which is also why the selected model is always named in the UI.
 */
function defaultModel(models, connections, bindings) {
  const ownIds = new Set(connections.map((c) => c.id));
  const perModel = new Map();

  for (const binding of bindings) {
    if (!binding.model || !ownIds.has(binding.connectionId)) continue;
    perModel.set(binding.model, (perModel.get(binding.model) || 0) + 1);
  }

  let best = null;
  let bestCount = 0;
  for (const [model, count] of perModel) {
    if (count > bestCount && models.includes(model)) { best = model; bestCount = count; }
  }

  return best || models[0] || null;
}

/**
 * GET /api/logs/smart-routing/[providerId]?model=<id>
 *
 * Response:
 *   {
 *     provider: { id, name },
 *     models: string[],
 *     model: string|null,
 *     threshold: number,
 *     pool:   [row],   // ranked, exactly as the selection would rank them
 *     locked: [row]    // removed from the pool, with when they return
 *   }
 *
 * A row carries the four ordering inputs plus what a reader needs to make sense of them:
 *   { id, name, isActive, sessionCount, sessionCountForModel,
 *     demotedAt, errorScore, priority, lockedUntil }
 *
 * `sessionCount` is the ordering input and is counted across models, because that is the scope
 * the criterion has. `sessionCountForModel` is the same map narrowed to the selected model
 * and is DISPLAY ONLY — it exists because this was the one column on the screen whose scope did
 * not follow the model selector, which made an account reading "3 conversations / 7 error
 * points" impossible to interpret: the points are per model and the conversations were not.
 * Nothing ranks by it. Handing it to the comparator would change the strategy, not the screen.
 *
 * Nothing here mutates. `countBindingsByConnection` and `snapshotBindings` both sweep expired
 * entries, which changes no answer, and neither refreshes a binding — so opening this page
 * cannot extend a conversation's hold on an account.
 */
export async function GET(request, { params }) {
  try {
    const { providerId: rawProviderId } = await params;
    const providerId = resolveProviderId(rawProviderId);

    const [settings, connections] = await Promise.all([
      getSettings(),
      getProviderConnections({ provider: providerId }),
    ]);

    if (connections.length === 0) {
      return NextResponse.json({ error: "No connections for this provider" }, { status: 404 });
    }

    // Guard rather than filter: reaching this URL for a provider Smart Routing does not govern
    // means the tiles and the settings have drifted apart, and answering with an order that is
    // not in force would be a confidently wrong screen.
    if (resolveProviderStrategy(providerId, settings) !== ROUTING_STRATEGY.SMART) {
      return NextResponse.json(
        { error: "Smart Routing is not the active strategy for this provider" },
        { status: 409 }
      );
    }

    const models = collectModels(connections, providerId);
    const bindings = snapshotBindings();
    const requested = new URL(request.url).searchParams.get("model");
    const model = requested && models.includes(requested)
      ? requested
      : defaultModel(models, connections, bindings);

    const sessionCounts = countBindingsByConnection();

    // The same live map, narrowed to the selected model. Built from the snapshot already taken
    // above rather than from a second read, so both figures describe one instant — two reads
    // could disagree and the smaller number is the one a reader would disbelieve.
    //
    // A binding whose model is null is the "no model known" scope and is deliberately NOT
    // counted for any specific model: it is a conversation held on this account, which is why
    // it still reaches sessionCount, but claiming it for the selected model would be inventing
    // a fact the map does not hold.
    const modelSessionCounts = new Map();
    for (const binding of bindings) {
      if (binding.model !== model) continue;
      modelSessionCounts.set(binding.connectionId, (modelSessionCounts.get(binding.connectionId) || 0) + 1);
    }

    const toRow = (connection) => ({
      id: connection.id,
      name: connection.displayName || connection.name || connection.email || connection.id,
      isActive: connection.isActive !== false,
      sessionCount: sessionCounts.get(connection.id) || 0,
      sessionCountForModel: modelSessionCounts.get(connection.id) || 0,
      demotedAt: connection[demotedAtKey(model)] || null,
      errorScore: Number(connection[errorScoreKey(model)]) || 0,
      priority: connection.priority ?? null,
      lockedUntil: getEarliestModelLockUntil(connection),
    });

    // The same filter the selection applies: a disabled account never reaches the pool either,
    // so it belongs on the excluded side rather than in a ranking it cannot win.
    const pool = [];
    const excluded = [];
    for (const connection of connections) {
      if (connection.isActive === false || isModelLockActive(connection, model)) excluded.push(connection);
      else pool.push(connection);
    }

    return NextResponse.json({
      provider: { id: providerId, name: AI_PROVIDERS[providerId]?.name || providerId },
      models,
      model,
      threshold: DEMOTE_THRESHOLD,
      pool: sortBySmartRouting(pool, { model, sessionCounts }).map(toRow),
      // Sorted by when they come back, so the next one to return is at the top. Ranking them
      // would be meaningless — none of them is a candidate.
      locked: excluded
        .map(toRow)
        .sort((a, b) => String(a.lockedUntil || "").localeCompare(String(b.lockedUntil || ""))),
    });
  } catch (error) {
    console.error("[API] /api/logs/smart-routing/[providerId] failed:", error);
    return NextResponse.json({ error: "Failed to read Smart Routing state" }, { status: 500 });
  }
}
