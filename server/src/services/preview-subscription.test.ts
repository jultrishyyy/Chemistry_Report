import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { previewSubscription } from './preview-subscription.js';
function transport(preview = true) {
  const req = Object.assign(new EventEmitter(), { get: () => preview ? '1' : undefined, aborted: false });
  const res = Object.assign(new EventEmitter(), { writableEnded: false, destroyed: false });
  const subscription = previewSubscription(req as unknown as Request, res as unknown as Response);
  return { req, res, subscription };
}
test('request body close is normal; premature response close cancels only its subscription', () => {
  const a = transport(), b = transport();
  a.req.emit('close'); assert.equal(a.subscription.signal?.aborted, false);
  a.res.emit('close'); assert.equal(a.subscription.signal?.aborted, true);
  assert.equal(b.subscription.signal?.aborted, false);
  a.subscription.dispose(); b.subscription.dispose();
  assert.equal(a.req.listenerCount('aborted'), 0); assert.equal(b.res.listenerCount('close'), 0);
});
test('completed response and non-preview downloads are not cancelled', () => {
  const a = transport(); a.res.writableEnded = true; a.res.emit('close');
  assert.equal(a.subscription.signal?.aborted, false); a.subscription.dispose();
  const download = transport(false); download.res.emit('close');
  assert.equal(download.subscription.signal, undefined);
});
test('interrupted request body cancels preview', () => {
  const a = transport(); a.req.emit('aborted'); assert.equal(a.subscription.signal?.aborted, true);
  a.subscription.dispose(); assert.equal(a.res.listenerCount('close'), 0);
});
