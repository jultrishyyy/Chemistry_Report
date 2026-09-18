import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request, type IncomingHttpHeaders } from 'node:http';
import { gzipSync } from 'node:zlib';
import express from 'express';
import { resolvePrecompressedAsset, servePrecompressedAssets } from './static-assets';

test('precompressed assets prefer supported encodings and reject unsafe paths', t => {
  const dir = mkdtempSync(join(tmpdir(), 'static-assets-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'index-abc.js.gz'), 'gzip');
  writeFileSync(join(dir, 'index-abc.js.br'), 'brotli');
  assert.equal(resolvePrecompressedAsset(dir, '/index-abc.js', 'gzip, deflate')?.encoding, 'gzip');
  assert.equal(resolvePrecompressedAsset(dir, '/index-abc.js', 'gzip;q=0.5, br;q=1')?.encoding, 'br');
  assert.equal(resolvePrecompressedAsset(dir, '/index-abc.js', 'br;q=0, gzip;q=1')?.encoding, 'gzip');
  assert.equal(resolvePrecompressedAsset(dir, '/../index-abc.js', 'gzip'), null);
  assert.equal(resolvePrecompressedAsset(dir, '/missing.js', 'gzip'), null);
  assert.equal(resolvePrecompressedAsset(dir, '/image.png', 'gzip'), null);
});

test('middleware serves gzip with immutable cache and the original content type', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'static-assets-http-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const compressed = gzipSync('console.log("local")');
  writeFileSync(join(dir, 'index-local.js.gz'), compressed);
  const app = express();
  app.use('/assets', servePrecompressedAssets(dir));
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise<void>((resolve, reject) => server.once('listening', resolve).once('error', reject));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing test port');
  const response = await new Promise<{ headers: IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: address.port, path: '/assets/index-local.js', headers: { 'Accept-Encoding': 'gzip' } }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject); req.end();
  });
  assert.equal(response.headers['content-encoding'], 'gzip');
  assert.equal(response.headers['content-type'], 'application/javascript; charset=utf-8');
  assert.match(String(response.headers['cache-control']), /immutable/);
  assert.deepEqual(response.body, compressed);
});
