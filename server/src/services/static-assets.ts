import type { RequestHandler } from 'express';
import { basename, extname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

type AssetEncoding = 'br' | 'gzip';

function acceptedEncodings(header: string | undefined): AssetEncoding[] {
  const quality = new Map<string, number>();
  for (const part of String(header || '').toLowerCase().split(',')) {
    const [name, ...parameters] = part.trim().split(';');
    if (!name) continue;
    const q = parameters.map(value => /^q\s*=\s*(\d(?:\.\d+)?)$/.exec(value.trim()))
      .find(Boolean)?.[1];
    quality.set(name, q == null ? 1 : Number(q));
  }
  const accepted = (name: AssetEncoding) => quality.get(name) ?? quality.get('*') ?? 0;
  return (['br', 'gzip'] as AssetEncoding[]).filter(name => accepted(name) > 0)
    .sort((a, b) => accepted(b) - accepted(a) || (a === 'br' ? -1 : 1));
}

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
};

export function resolvePrecompressedAsset(assetDir: string, requestPath: string, acceptEncoding?: string) {
  let name: string;
  try { name = decodeURIComponent(requestPath).replace(/^\/+/, ''); } catch { return null; }
  if (!name || name !== basename(name) || name.startsWith('.')) return null;
  const contentType = CONTENT_TYPES[extname(name).toLowerCase()];
  if (!contentType) return null;
  const source = resolve(assetDir, name);
  for (const encoding of acceptedEncodings(acceptEncoding)) {
    const path = `${source}.${encoding === 'gzip' ? 'gz' : 'br'}`;
    if (existsSync(path)) return { path, encoding, contentType };
  }
  return null;
}

/** Serve build-time compressed immutable Vite assets without a runtime compressor. */
export function servePrecompressedAssets(assetDir: string): RequestHandler {
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { next(); return; }
    const asset = resolvePrecompressedAsset(assetDir, req.path, req.header('Accept-Encoding'));
    if (!asset) { next(); return; }
    res.set({
      'Content-Type': asset.contentType,
      'Content-Encoding': asset.encoding,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Vary': 'Accept-Encoding',
      'X-Content-Type-Options': 'nosniff',
    });
    res.sendFile(asset.path, error => { if (error) next(error); });
  };
}
