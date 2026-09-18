import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { brotliCompress, gzip, constants } from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(gzip);
const brotliAsync = promisify(brotliCompress);
const assetsDir = resolve(fileURLToPath(new URL('../client/dist/assets/', import.meta.url)));
const compressible = /\.(?:css|js|mjs|json|svg)$/i;
let sourceBytes = 0, gzipBytes = 0, brotliBytes = 0, count = 0;

for (const name of await readdir(assetsDir)) {
  if (!compressible.test(name) || name.endsWith('.gz') || name.endsWith('.br')) continue;
  const source = await readFile(resolve(assetsDir, name));
  if (source.length < 1024) continue;
  const [gz, br] = await Promise.all([
    gzipAsync(source, { level: 9 }),
    brotliAsync(source, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }),
  ]);
  await Promise.all([
    writeFile(resolve(assetsDir, `${name}.gz`), gz),
    writeFile(resolve(assetsDir, `${name}.br`), br),
  ]);
  sourceBytes += source.length; gzipBytes += gz.length; brotliBytes += br.length; count++;
}

console.log(`[assets] precompressed ${count} files: source=${sourceBytes} gzip=${gzipBytes} br=${brotliBytes}`);
