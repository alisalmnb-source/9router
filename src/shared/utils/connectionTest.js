// FORK(conntest): client-side wrapper around the existing single-connection test.
//
// No test logic lives here. POST /api/providers/<id>/test already tests one connection
// and already returns { valid, error, refreshed }; this adds a deadline for the whole
// round trip and normalises the two failure shapes into one.
//
// The deadline is the reason this file exists, and since v0.5.59 it is no longer the only
// one in the path. fetchWithConnectionProxy in testUtils.js now defaults options.signal to
// AbortSignal.timeout(15000), and no call site overrides it, so every individual
// server-side fetch is bounded. That bound is per fetch, not per request: a single test
// can make several in sequence, and neither testUtils.js nor the route races a deadline
// for the response as a whole. So TEST_TIMEOUT_MS is still what stops the row spinning.
//
// Keep it above 15000. Being the longer of the two is what makes a stalled provider trip
// upstream's per-fetch bound first, so the row reports the real error; set it lower and it
// pre-empts that bound and replaces every such error with the generic message below.

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
