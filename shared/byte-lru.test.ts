import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ByteLru } from './byte-lru';
test('byte limit evicts least recently used values and tracks replacements', () => {
  const cache = new ByteLru<string>(3, 8, value => value.length);
  cache.set('a', '123'); cache.set('b', '456');
  assert.equal(cache.get('a'), '123');
  cache.set('c', '789');
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.bytes, 6);
  cache.set('a', '1'); assert.equal(cache.bytes, 4);
  cache.set('huge', '123456789'); assert.equal(cache.get('huge'), undefined);
  assert.equal(cache.bytes, 4);
  cache.clear(); assert.equal(cache.bytes, 0); assert.equal(cache.size, 0);
});
test('entry limit remains active even for tiny values; eviction leaves consumers valid', () => {
  const cache = new ByteLru<Uint8Array>(1, 10, value => value.byteLength);
  const data = new Uint8Array([7]); cache.set('a', data);
  const consumer = cache.get('a'); cache.set('b', new Uint8Array([9]));
  assert.equal(cache.get('a'), undefined); assert.equal(consumer?.[0], 7);
  assert.equal(cache.size, 1);
});
