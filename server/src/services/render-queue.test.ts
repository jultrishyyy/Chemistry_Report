import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RenderQueue, RenderBusyError, RenderCancelledError, positiveInteger } from './render-queue.js';

function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
test('same task shares work; distinct tasks stay within concurrency and release after errors', async () => {
  const queue = new RenderQueue(1, 2, 1000);
  const gate = deferred(); let calls = 0;
  const first = queue.run('compile:a', async () => { calls++; await gate.promise; return 'pdf'; });
  const duplicate = queue.run('compile:a', async () => { throw Error('must not run'); });
  assert.equal(first, duplicate);
  const second = queue.run('query:a', async () => { throw Error('query failed'); });
  const failure = assert.rejects(second, /query failed/);
  assert.equal(queue.stats().active, 1);
  assert.equal(queue.stats().queued, 1);
  gate.resolve();
  assert.equal(await first, 'pdf'); await failure;
  assert.equal(calls, 1);
  assert.equal(queue.stats().active, 0);
  assert.equal(await queue.run('query:a', async () => 'retry'), 'retry');
});
test('full queue rejects new work but accepts subscribers to an existing task', async () => {
  const queue = new RenderQueue(1, 1, 1000); const gate = deferred();
  const running = queue.run('a', () => gate.promise);
  const queued = queue.run('b', async () => 2);
  assert.equal(queue.run('b', async () => 99), queued);
  await assert.rejects(queue.run('c', async () => 3), RenderBusyError);
  gate.resolve(); await running; assert.equal(await queued, 2);
  assert.equal(queue.stats().queued, 0);
});
test('expired waiters never execute or leak slots; can retry after timeout', async () => {
  const queue = new RenderQueue(1, 2, 20); const gate = deferred(); let executed = false;
  const running = queue.run('a', () => gate.promise);
  await assert.rejects(queue.run('b', async () => { executed = true; }), RenderBusyError);
  assert.equal(queue.stats().queued, 0);
  gate.resolve(); await running;
  assert.equal(executed, false);
  assert.equal(await queue.run('b', async () => 'ok'), 'ok');
  assert.equal(queue.stats().active, 0);
});
test('invalid environment values cannot hang the queue', () => {
  for (const value of ['NaN', '0', '-1', '1.5', '', undefined, Infinity]) assert.equal(positiveInteger(value, 4), 4);
  assert.equal(positiveInteger('2', 4), 2);
});

test('one subscriber leaving does not cancel another subscriber of queued work', async () => {
  const queue = new RenderQueue(1, 2, 1000), gate = deferred();
  const running = queue.run('busy', () => gate.promise);
  const a = new AbortController(), b = new AbortController(); let calls = 0;
  const first = queue.run('pdf', async () => { calls++; return 'pdf'; }, a.signal);
  const second = queue.run('pdf', async () => 'must not run', b.signal);
  const cancelled = assert.rejects(first, RenderCancelledError);
  a.abort(); await cancelled;
  assert.equal(queue.stats().queued, 1);
  gate.resolve(); await running; assert.equal(await second, 'pdf'); assert.equal(calls, 1);
  assert.equal(queue.stats().active, 0);
});

test('all subscribers leaving removes waiting work; immediate retry survives old cleanup', async () => {
  const queue = new RenderQueue(1, 1, 1000), gate = deferred();
  const running = queue.run('busy', () => gate.promise);
  const a = new AbortController(), b = new AbortController(); let oldRan = false;
  const first = queue.run('pdf', async () => { oldRan = true; }, a.signal);
  const second = queue.run('pdf', async () => {}, b.signal);
  const cancelled = Promise.all([assert.rejects(first, RenderCancelledError), assert.rejects(second, RenderCancelledError)]);
  a.abort(); b.abort();
  assert.equal(queue.stats().queued, 0); assert.equal(queue.stats().cancelled, 1);
  const retry = queue.run('pdf', async () => 'fresh');
  await cancelled;
  assert.equal(queue.run('pdf', async () => 'wrong'), retry, 'old finally cannot remove new pending task');
  gate.resolve(); await running;
  assert.equal(await retry, 'fresh'); assert.equal(oldRan, false);
});

test('a formal export keeps queued shared work alive when preview leaves', async () => {
  const queue = new RenderQueue(1, 1, 1000), gate = deferred();
  const running = queue.run('busy', () => gate.promise);
  const controller = new AbortController();
  const preview = queue.run('pdf', async () => 'document', controller.signal);
  const download = queue.run('pdf', async () => 'wrong');
  const cancelled = assert.rejects(preview, RenderCancelledError); controller.abort(); await cancelled;
  assert.equal(queue.stats().queued, 1);
  gate.resolve(); await running; assert.equal(await download, 'document');
});

test('already running compilation is not killed, a later subscriber can reuse it', async () => {
  const queue = new RenderQueue(1, 1, 1000), gate = deferred();
  const controller = new AbortController(); let started = false;
  const preview = queue.run('pdf', async () => { started = true; await gate.promise; return 'done'; }, controller.signal);
  await Promise.resolve(); assert.equal(started, true);
  const cancelled = assert.rejects(preview, RenderCancelledError); controller.abort(); await cancelled;
  assert.equal(queue.stats().active, 1); assert.equal(queue.stats().cancelled, 0);
  const subscriber = queue.run('pdf', async () => 'wrong');
  gate.resolve(); assert.equal(await subscriber, 'done'); assert.equal(queue.stats().active, 0);
});

test('pre-aborted and timed out subscribers do not leak queue slots', async () => {
  const queue = new RenderQueue(1, 1, 15), gate = deferred();
  const already = new AbortController(); already.abort();
  await assert.rejects(queue.run('none', async () => 1, already.signal), RenderCancelledError);
  assert.equal(queue.stats().active, 0);
  const running = queue.run('busy', () => gate.promise);
  const controller = new AbortController();
  await assert.rejects(queue.run('timeout', async () => 1, controller.signal), RenderBusyError);
  controller.abort(); assert.equal(queue.stats().cancelled, 0);
  gate.resolve(); await running; assert.equal(queue.stats().active, 0);
});
