// FORK(smartrouting): strategy names and their UI copy.
//
// Deliberately zero imports, so both Settings surfaces can use it client-side. smartRouting.js
// reaches errorPolicy.js, so importing the option list from there would ship the whole phrase
// table to the browser for three labels.
//
// The first two values are upstream's strings and must not change: auth.js compares against
// "round-robin" and falls through to fill-first for everything else, and installs already have
// one of them stored in settings.

export const ROUTING_STRATEGY = {
  FILL_FIRST: "fill-first",
  ROUND_ROBIN: "round-robin",
  SMART: "smart-routing",
};

/**
 * FORK(smartlogs): which strategy actually governs one provider. Upstream's precedence,
 * unchanged — per-provider override beats global, anything absent resolves to fill-first.
 *
 * Extracted from `getProviderCredentials`, where it was inline, once the Smart Logs page needed
 * the same answer. A second copy would drift silently: the day precedence changes, the page
 * keeps listing the wrong providers and nothing fails.
 *
 * `providerId` must already be resolved — the settings map is keyed by id, not alias, so an
 * alias silently misses the override.
 *
 * @param {string} providerId Resolved provider id.
 * @param {object} settings The settings blob.
 * @returns {string} One of ROUTING_STRATEGY's values.
 */
export function resolveProviderStrategy(providerId, settings) {
  const override = (settings?.providerStrategies || {})[providerId] || {};
  return override.fallbackStrategy || settings?.fallbackStrategy || ROUTING_STRATEGY.FILL_FIRST;
}

/** Global control options. Fill First first, because it is what an unset value resolves to. */
export const ROUTING_STRATEGY_OPTIONS = [
  {
    value: ROUTING_STRATEGY.FILL_FIRST,
    label: "Fill First",
    hint: "Accounts in priority order. The first available one takes every request.",
  },
  {
    value: ROUTING_STRATEGY.ROUND_ROBIN,
    label: "Round Robin",
    hint: "Rotate through accounts every few requests to spread load.",
  },
  {
    value: ROUTING_STRATEGY.SMART,
    label: "Smart Routing",
    hint: "Order accounts by how many conversations they carry and how recently they failed. Keeps a conversation on one account so the provider's cache survives.",
  },
];

/**
 * Sentinel for "no override". A word rather than "" because Select.js always renders an
 * empty-value placeholder option, which would shadow it — the control would read "Select an
 * option" whenever no override was set. Not null either: React treats that as uncontrolled.
 * Never stored; the save path turns it back into deleting the provider's entry.
 */
export const INHERIT_STRATEGY = "inherit";

/** Per-provider control options: inherit, then the same three. */
export const PROVIDER_STRATEGY_OPTIONS = [
  { value: INHERIT_STRATEGY, label: "Global default" },
  ...ROUTING_STRATEGY_OPTIONS.map(({ value, label }) => ({ value, label })),
];

/**
 * Media-provider control options. Smart Routing is shown but never offered.
 *
 * Not offered because media requests are one-shot — both the load and continuity criteria are
 * meaningless there. Still shown when stored, because both surfaces write the same
 * `providerStrategies[<id>]` entry and provider ids overlap between them, so a choice made on
 * the chat page is the value this control reads back.
 *
 * The toggle this replaced tested `=== "round-robin"`, so a stored smart-routing rendered
 * unchecked and the first touch overwrote it. Prepended rather than appended so the truthful
 * value is in view, with a label saying where it belongs.
 *
 * @param {string|null} current The stored override for this provider, or null for inherit.
 * @returns {Array<{value: string, label: string}>}
 */
export function mediaStrategyOptions(current) {
  const offered = ROUTING_STRATEGY_OPTIONS
    .filter((option) => option.value !== ROUTING_STRATEGY.SMART)
    .map(({ value, label }) => ({ value, label }));

  const base = [{ value: INHERIT_STRATEGY, label: "Global default" }, ...offered];
  if (current !== ROUTING_STRATEGY.SMART) return base;

  const smartLabel = ROUTING_STRATEGY_OPTIONS.find((o) => o.value === ROUTING_STRATEGY.SMART)?.label;
  return [
    { value: ROUTING_STRATEGY.SMART, label: `${smartLabel} — set on the chat provider page` },
    ...base,
  ];
}
