/** Fixed-size, process-local counters: no URLs, user identities or unbounded samples. */
export function createRequestMetrics() {
  let active = 0, started = 0, completed = 0, aborted = 0, serverErrors = 0, durationMs = 0;
  const bounds = [50, 100, 250, 500, 1000, 2500, 5000, 10000];
  const buckets = Array(bounds.length + 1).fill(0) as number[];
  return {
    start() {
      started++; active++; let done = false;
      return (status: number, elapsedMs: number, disconnected = false) => {
        if (done) return;
        done = true; active--;
        if (disconnected) { aborted++; return; }
        completed++; if (status >= 500) serverErrors++;
        const ms = Math.max(0, elapsedMs); durationMs += ms;
        const index = bounds.findIndex(bound => ms <= bound);
        buckets[index < 0 ? bounds.length : index]++;
      };
    },
    snapshot() { return { active, started, completed, aborted, server_errors: serverErrors,
      duration_ms_sum: durationMs, duration_bucket_upper_ms: [...bounds, null], duration_bucket_counts: [...buckets] }; },
  };
}
export const requestMetrics = createRequestMetrics();
