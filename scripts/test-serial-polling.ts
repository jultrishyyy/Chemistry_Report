import assert from 'node:assert/strict';
import { startSerialPolling } from '../client/src/utils/serialPolling';
const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
const timers = new Map<number, () => void>(); let id = 0;
globalThis.setTimeout = ((fn: () => void) => { timers.set(++id, fn); return id; }) as any;
globalThis.clearTimeout = ((key: number) => { timers.delete(key); }) as any;
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
try {
  let calls = 0; let resolve!: () => void;
  const stop = startSerialPolling(() => { calls++; return new Promise<void>(r => { resolve = r; }); }, () => 5000);
  assert.equal(calls, 1); assert.equal(timers.size, 0, 'no timer during an outstanding request');
  resolve(); await flush(); assert.equal(timers.size, 1);
  const callback = [...timers.values()][0]; timers.clear(); callback();
  assert.equal(calls, 2); assert.equal(timers.size, 0);
  stop(); resolve(); await flush(); assert.equal(timers.size, 0, 'late response must not restart stopped polling');
  const stopFail = startSerialPolling(async () => { throw Error('network'); }, () => 5000);
  await flush(); assert.equal(timers.size, 1, 'failure schedules recovery without an unhandled rejection');
  stopFail(); assert.equal(timers.size, 0);
  console.log('Serial polling: no overlap, stop during request, failure recovery passed');
} finally { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; }
