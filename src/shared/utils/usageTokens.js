// FORK(logs): the token arithmetic both request-detail views share.
//
// Extracted, not copied: these three were local to RequestDetailsTab.js and duplicated in the
// fork's request log, which renders the same rows — a drift showed two input counts for one
// request and no grep could see it. This extraction is the only reason RequestDetailsTab.js is
// a fork-modified file at all.
//
// Merge note: upstream re-adding its own local copies alongside the import is a SyntaxError, so
// most bad resolutions fail the build. The one that does not is deleting the import and keeping
// upstream's copies — that builds, and reopens the drift.
//
// Pure, no imports, safe on client and server.

/**
 * Cache-read tokens, under either vendor's spelling. A row carries one or the other, never
 * both, so the `||` is a choice rather than a sum.
 *
 * @param {object|null|undefined} tokens
 * @returns {number}
 */
export function getCachedTokens(tokens) {
  return tokens?.cached_tokens || tokens?.cache_read_input_tokens || 0;
}

/**
 * Tokens written into the cache on this request. Separate from the read count because they are
 * billed differently and a row can carry both.
 *
 * @param {object|null|undefined} tokens
 * @returns {number}
 */
export function getCacheCreationTokens(tokens) {
  return tokens?.cache_creation_input_tokens || 0;
}

/**
 * Input tokens for a row, cache-inclusive. Legacy rows may have stored the prompt count
 * cache-exclusive, so a prompt below the cache count is read as one of those and the larger
 * value wins — otherwise those rows under-report input.
 *
 * @param {object|null|undefined} tokens
 * @returns {number}
 */
export function getInputTokens(tokens) {
  const prompt = tokens?.prompt_tokens || tokens?.input_tokens || 0;
  const cache = getCachedTokens(tokens);
  return prompt < cache ? cache : prompt;
}
