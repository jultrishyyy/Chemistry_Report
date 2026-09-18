import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, readdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PdfDiskCache } from './pdf-disk-cache.js';
const key = (n: number) => n.toString(16).padStart(64, '0');
test('byte/file limits, oversized skip and concurrent writes leave no temporary files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lims-disk-cache-test-'));
  try {
    const cache = new PdfDiskCache(dir, 3, 10);
    await cache.write(key(1), Buffer.from('123456'));
    await cache.write(key(2), Buffer.from('abcdef'));
    assert.equal(await cache.read(key(1)), null);
    assert.equal((await cache.read(key(2)))?.toString(), 'abcdef');
    await cache.write(key(3), Buffer.alloc(11)); assert.equal(await cache.read(key(3)), null);
    await Promise.all([cache.write(key(4), Buffer.from('a')), cache.write(key(4), Buffer.from('bb')), cache.write(key(5), Buffer.from('c'))]);
    assert.ok(cache.stats().bytes <= 10); assert.ok(cache.stats().files <= 3);
    assert.equal((await cache.read(key(4)))?.toString(), 'bb');
    assert.ok((await readdir(dir)).every(name => !name.endsWith('.tmp')));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('startup evicts only owned cache PDFs; ignores unrelated files and symlinks', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lims-disk-cache-test-'));
  try {
    await writeFile(join(dir, 'report.pdf'), 'business data');
    await writeFile(join(dir, `${key(1)}.pdf`), Buffer.alloc(20));
    await symlink(join(dir, 'report.pdf'), join(dir, `${key(2)}.pdf`));
    const cache = new PdfDiskCache(dir, 2, 10);
    assert.equal(await cache.read(key(1)), null);
    assert.equal(await cache.read(key(2)), null);
    assert.equal(await readFile(join(dir, 'report.pdf'), 'utf8'), 'business data');
    assert.ok((await readdir(dir)).includes(`${key(2)}.pdf`));
    await cache.write('../outside', Buffer.from('bad'));
    assert.equal(cache.stats().files, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('disabled or inaccessible caches never fail a report', async () => {
  const disabled = new PdfDiskCache(null, 1, 10);
  await disabled.write(key(1), Buffer.from('pdf')); assert.equal(await disabled.read(key(1)), null);
  const dir = await mkdtemp(join(tmpdir(), 'lims-disk-cache-test-'));
  try {
    const path = join(dir, 'file'); await writeFile(path, 'not a directory');
    const cache = new PdfDiskCache(path, 1, 10);
    await cache.write(key(1), Buffer.from('pdf')); assert.equal(await cache.read(key(1)), null);
    assert.equal(cache.stats().enabled, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
