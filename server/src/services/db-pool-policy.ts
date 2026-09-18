function positive(value: string | undefined, fallback: number) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}
export function dbPoolPolicy(env: Record<string, string | undefined>) {
  return {
    max: positive(env.DB_POOL_MAX, 20),
    connectionTimeoutMillis: positive(env.DB_CONNECTION_TIMEOUT_MS, 5000),
    keepAlive: true,
  };
}
