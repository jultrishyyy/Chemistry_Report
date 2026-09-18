import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dbPoolPolicy } from './db-pool-policy.js';
import { createReadinessProbe } from './readiness.js';
import { createRequestMetrics } from './request-metrics.js';

test('pool config preserves size, bounds connection waiting and rejects malformed values', () => {
  assert.deepEqual(dbPoolPolicy({}), { max: 20, connectionTimeoutMillis: 5000, keepAlive: true });
  for (const value of ['0', '-1', 'NaN', '1.5', 'Infinity', '']) {
    assert.equal(dbPoolPolicy({ DB_POOL_MAX: value }).max, 20);
    assert.equal(dbPoolPolicy({ DB_CONNECTION_TIMEOUT_MS: value }).connectionTimeoutMillis, 5000);
  }
  assert.equal(dbPoolPolicy({ DB_POOL_MAX: '12', DB_CONNECTION_TIMEOUT_MS: '8000' }).connectionTimeoutMillis, 8000);
});
test('readiness shares concurrent probes, caches briefly and releases successful connections', async () => {
  let clock = 10000, connects = 0; const releases: boolean[] = [];
  let finish!: () => void;
  const probe = createReadinessProbe({ connect: async () => {
    connects++;
    return { query: async config => {
      assert.deepEqual(config, { text: 'SELECT 1', query_timeout: 1500 });
      await new Promise<void>(resolve => { finish = resolve; });
    }, release: destroy => { releases.push(!!destroy); } };
  } }, 5000, () => clock);
  const first = probe(); assert.equal(probe(), first);
  await Promise.resolve(); finish(); assert.equal((await first).status, 'ready');
  await probe(); assert.equal(connects, 1); assert.deepEqual(releases, [false]);
  clock += 5001;
  const next = probe(); await Promise.resolve(); finish(); await next;
  assert.equal(connects, 2);
});
test('readiness destroys a failed query connection, hides details and can recover', async () => {
  let clock = 10000, failing = true; const releases: boolean[] = [];
  const probe = createReadinessProbe({ connect: async () => ({
    query: async () => { if (failing) throw Error('secret DB host/password'); },
    release: destroy => { releases.push(!!destroy); },
  }) }, 5000, () => clock);
  const result = await probe(); assert.equal(result.status, 'unavailable');
  assert.ok(!JSON.stringify(result).includes('secret')); assert.deepEqual(releases, [true]);
  failing = false; clock += 5001; assert.equal((await probe()).status, 'ready');
  const offline = createReadinessProbe({ connect: async () => { throw Error('connection timeout'); } });
  assert.equal((await offline()).status, 'unavailable');
});
test('request metrics count once on finish/close, track disconnects and use fixed buckets', () => {
  const metrics = createRequestMetrics();
  const first = metrics.start(), second = metrics.start();
  assert.equal(metrics.snapshot().active, 2);
  first(200, 80); first(200, 85, true); second(200, 10, true);
  metrics.start()(503, 15000);
  const result = metrics.snapshot();
  assert.equal(result.active, 0); assert.equal(result.completed, 2); assert.equal(result.aborted, 1);
  assert.equal(result.server_errors, 1); assert.equal(result.duration_ms_sum, 15080);
  assert.equal(result.duration_bucket_counts.reduce((a, b) => a + b, 0), 2);
  result.duration_bucket_counts[0] = 99;
  assert.equal(metrics.snapshot().duration_bucket_counts[0], 0, 'snapshot cannot mutate counters');
});
