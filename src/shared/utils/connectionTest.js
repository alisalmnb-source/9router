// FORK(conntest): client-side wrapper around the existing single-connection test.
//
// No test logic lives here. POST /api/providers/<id>/test already tests one connection
// and already returns { valid, error, refreshed }; this only adds the timeout upstream
// does not have and normalises the two failure shapes into one.
//
// The timeout is the reason this file exists. Nothing on that route's server path sets
// an AbortSignal or races a deadline — testUtils.js calls fetch directly — so a provider
// that accepts a connection and then stalls leaves the row spinning until the platform
// gives up. One deadline here covers every provider without touching upstream, which is
// the trade this fork prefers over per-provider server changes.

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
