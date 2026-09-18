interface ProbePool {
  connect(): Promise<{
    query(config: { text: string; query_timeout: number }): Promise<unknown>;
    release(destroy?: boolean): void;
  }>;
}
export interface Readiness { status: 'ready' | 'unavailable'; checked_at: string; }
/** Requires a pool with bounded connection acquisition. One probe at a time, brief result cache. */
export function createReadinessProbe(pool: ProbePool, ttlMs = 5000, now = Date.now) {
  let cached: Readiness | undefined;
  let checked = 0;
  let pending: Promise<Readiness> | undefined;
  return (): Promise<Readiness> => {
    if (pending) return pending;
    if (cached && now() - checked < ttlMs) return Promise.resolve(cached);
    pending = (async () => {
      let client: Awaited<ReturnType<ProbePool['connect']>> | undefined;
      let failed = true;
      try {
        client = await pool.connect();
        await client.query({ text: 'SELECT 1', query_timeout: 1500 });
        failed = false;
      } catch { /* Public probe must not expose database details. */ }
      finally { client?.release(failed); }
      checked = now();
      cached = { status: failed ? 'unavailable' : 'ready', checked_at: new Date(checked).toISOString() };
      return cached;
    })().finally(() => { pending = undefined; });
    return pending;
  };
}
