// FORK(logs): the token arithmetic the Usage tabs share.
//
// Extracted rather than copied, and the reason is that the two tabs render the same
// `requestDetails` rows: RequestDetailsTab reads them through
// /api/usage/request-details and LogsTab through /api/logs/records, so a rule that
// differed between them would show two input-token counts for one request. Duplication
// could not be made to guarantee that — nothing greps for a semantic drift between two
// copies, and the numbers stay plausible on both sides while disagreeing — so the copies
// were replaced with this one definition.
//
// Pure, no imports, no framework: both callers are client components, and this file is
// also cheap enough for a server route to reach for if one ever needs the same numbers.
//
// The cost to know at merge time: this is why `RequestDetailsTab.js` is in the fork's
// Modified table. Upstream re-adding its own local copies of these three functions is a
// conflict that resolves by deleting them again, not by keeping both.

/**
 * Cache-read tokens, under either vendor's spelling.
 *
 * OpenAI reports `cached_tokens`; Anthropic reports `cache_read_input_tokens`. A row
 * carries one or the other, never both, so the `||` is a choice rather than a sum.
 *
 * @param {object|null|undefined} tokens
 * @returns {number}
 */
export function getCachedTokens(tokens) {
  return tokens?.cached_tokens || tokens?.cache_read_input_tokens || 0;
}

/**
 * Tokens written into the cache on this request, which only Anthropic reports.
 *
 * Separate from the read count because they are billed differently and a row can carry
 * both.
 *
 * @param {object|null|undefined} tokens
 * @returns {number}
 */
export function getCacheCreationTokens(tokens) {
  return tokens?.cache_creation_input_tokens || 0;
}

/**
 * Input tokens for a row, cache-inclusive.
 *
 * Canonical storage keeps `prompt_tokens` cache-inclusive. Legacy Claude rows may have
 * stored it cache-exclusive, so a prompt count below the cache count is read as one of
 * those and the larger value wins — otherwise those rows under-report input.
 *
 * @param {object|null|undefined} tokens
 * @returns {number}
 */
export function getInputTokens(tokens) {
  const prompt = tokens?.prompt_tokens || tokens?.input_tokens || 0;
  const cache = getCachedTokens(tokens);
  return prompt < cache ? cache : prompt;
}
