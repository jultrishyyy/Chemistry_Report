import assert from 'node:assert/strict';
import { summarize } from './perf-baseline.mjs';
const result = summarize([
  {ok: true, ms: 10, status: '200', bytes: 50},
  {ok: true, ms: 20, status: '200', bytes: 60},
  {ok: false, ms: 5000, status: 'TimeoutError', bytes: 0},
], 10000);
assert.equal(result.successRps, .2);
assert.equal(result.errors, 1);
assert.equal(result.p95, 20);
assert.equal(result.p50, 10);
assert.equal(summarize([], 1000).p95, null);
console.log('Performance summary tests passed');
