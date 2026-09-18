import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGracefulShutdown } from './graceful-shutdown.js';
import { startPeriodicWorker } from './periodic-worker.js';
import { RenderQueue } from './render-queue.js';
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
};
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
test('shutdown stops admission immediately, drains before database close and handles repeated signals once', async () => {
  const http = deferred(), background = deferred(), render = deferred();
  const events: string[] = []; const exits: number[] = [];
  const lifecycle = createGracefulShutdown({ timeoutMs: 1000,
    drainHttp: () => { events.push('http'); return http.promise; },
    stopBackground: () => { events.push('background'); return background.promise; },
    drainRender: () => { events.push('render'); return render.promise; },
    closeDatabase: async () => { events.push('database'); },
    forceClose: () => { events.push('force'); }, exit: code => { exits.push(code); }, report: () => {},
  });
  const stop = lifecycle.stop('SIGTERM'); assert.equal(lifecycle.isStopping(), true);
  assert.equal(lifecycle.stop('SIGINT'), stop);
  await flush(); assert.deepEqual(events, ['http', 'background']);
  http.resolve(); await flush(); assert.ok(!events.includes('render'));
  background.resolve(); await flush(); assert.ok(events.includes('render')); assert.ok(!events.includes('database'));
  render.resolve(); await stop; assert.deepEqual(events, ['http', 'background', 'render', 'database']);
  assert.deepEqual(exits, [0]);
});
test('deadline forces closure once without closing the database under ongoing work', async () => {
  const http = deferred(); const events: string[] = [], exits: number[] = [];
  const lifecycle = createGracefulShutdown({ timeoutMs: 15,
    drainHttp: () => http.promise, stopBackground: async () => {}, drainRender: async () => {},
    closeDatabase: async () => { events.push('database'); }, forceClose: () => { events.push('force'); },
    exit: code => { exits.push(code); }, report: () => {},
  });
  await lifecycle.stop('SIGTERM'); assert.deepEqual(events, ['force']); assert.deepEqual(exits, [1]);
  http.resolve(); await flush(); assert.deepEqual(events, ['force']); assert.deepEqual(exits, [1]);
});
test('drain failure exits unsuccessfully instead of claiming success', async () => {
  const exits: number[] = [];
  const lifecycle = createGracefulShutdown({ timeoutMs: 1000,
    drainHttp: async () => { throw Error('close failed'); }, stopBackground: async () => {}, drainRender: async () => {},
    closeDatabase: async () => { throw Error('must not get here'); }, forceClose: () => {},
    exit: code => { exits.push(code); }, report: () => {},
  });
  await lifecycle.stop('SIGTERM'); assert.deepEqual(exits, [1]);
});
test('background worker avoids overlap, stops new ticks and awaits current batch', async () => {
  const gate = deferred(); let calls = 0, errors = 0;
  const stop = startPeriodicWorker(async () => { calls++; await gate.promise; }, () => { errors++; }, 1, 5);
  await new Promise(resolve => setTimeout(resolve, 25)); assert.equal(calls, 1);
  let ended = false; const stopping = stop().then(() => { ended = true; });
  await flush(); assert.equal(ended, false);
  gate.resolve(); await stopping;
  await new Promise(resolve => setTimeout(resolve, 15)); assert.equal(calls, 1); assert.equal(errors, 0);
});
test('draining waits for an already running preview even after the browser left', async () => {
  const queue = new RenderQueue(1, 1, 1000), gate = deferred(), controller = new AbortController();
  const work = queue.run('pdf', () => gate.promise, controller.signal);
  const cancelled = assert.rejects(work); await flush(); controller.abort(); await cancelled;
  let ended = false; const drain = queue.drain().then(() => { ended = true; });
  await flush(); assert.equal(ended, false); gate.resolve(); await drain; assert.equal(ended, true);
});
