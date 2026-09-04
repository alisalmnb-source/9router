// FORK(conntest): client-side wrapper around the existing single-connection test.
//
// No test logic lives here. POST /api/providers/<id>/test already tests one connection
// and already returns { valid, error, refreshed }; this adds a deadline for the whole
// round trip and normalises the two failure shapes into one.
//
// The deadline is the reason this file exists. Since v0.5.59 upstream also bounds each individual
// server-side fetch at 15000ms — but that is per fetch, and one test can make several in sequence,
// so this is still what stops the row spinning.
//
// **Keep it above upstream's per-fetch bound.** Being the longer of the two is what lets a stalled
// provider trip upstream's bound first, so the row reports the real error. Set it lower and it
// pre-empts that bound and replaces every such error with the generic message below — on exactly
// the failures this button exists to diagnose. A precedence decision, not a value decision.

const TEST_TIMEOUT_MS = 30000;

/**
 * Run the connection test for one connection.
 *
 * Never throws: a network failure, a timeout and a provider rejection all come back in
 * the same shape, because the caller renders all three identically.
 *
 * @param {string} connectionId
 * @returns {Promise<{ valid: boolean, error: string|null }>}
 */
export async function runConnectionTest(connectionId) {
  try {
    const res = await fetch(`/api/providers/${connectionId}/test`, {
      method: "POST",
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });
    const data = await res.json().catch(() => ({}));
    return {
      valid: !!data.valid,
      error: data.valid ? null : data.error || `Test failed (${res.status})`,
    };
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    return {
      valid: false,
      error: timedOut
        ? `No response within ${Math.round(TEST_TIMEOUT_MS / 1000)}s`
        : error?.message || "Test failed",
    };
  }
}
