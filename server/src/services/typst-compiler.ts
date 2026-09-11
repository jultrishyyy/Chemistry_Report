import { spawn } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, mkdtempSync, rmdirSync, existsSync, readdirSync, mkdirSync, renameSync, statSync } from 'fs';
import { join, dirname, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { createHash } from 'crypto';
import { MOCK_IMAGE_DIR } from '../../../shared/mock-data.js';
import { UPLOAD_IMAGE_PATH_PREFIX } from '../../../shared/typst-generator.js';
import { uploadsDir } from '../../../config/index.js';

// 项目字体目录（demo_v1/fonts）：拷字体文件进去即可被 typst 加载。详见 fonts/README.md。
// 一旦本目录里有字体文件，就【只用本目录】渲染（--ignore-system-fonts）——让报告版面在任何服务器上一致，
// 不受该机器系统字体影响。若本目录没有字体（如刚 clone、字体被 gitignore），回退到系统字体（原行为，不锁定）。
const FONTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'fonts');
const HAS_BUNDLED_FONTS = existsSync(FONTS_DIR) && readdirSync(FONTS_DIR).some(f => /\.(ttf|ttc|otf)$/i.test(f));
const FONT_ARGS = HAS_BUNDLED_FONTS ? ['--font-path', FONTS_DIR, '--ignore-system-fonts'] : [];

// Typst 本身会对子集化字体，但在少数包含重复图片对象、特殊 PNG 或历史素材的文档中，
// 生成的 PDF 仍可能异常膨胀。对“大文件”再走一次 Ghostscript：
// - 小 PDF 保持 Typst 原文件不动，避免无意义的二次编码；
// - 只有优化结果确实更小时才采用，失败/未安装 Ghostscript 都自动回退；
// - 180 dpi 足够 A4 报告打印和屏幕查看，单色图保留 300 dpi。
const PDF_OPTIMIZER_VERSION = 'gs-v1-180dpi';
const configuredOptimizeMinBytes = Number(process.env.PDF_OPTIMIZE_MIN_BYTES || 1024 * 1024);
const PDF_OPTIMIZE_MIN_BYTES = Number.isFinite(configuredOptimizeMinBytes)
  ? Math.max(0, configuredOptimizeMinBytes)
  : 1024 * 1024;
const PDF_OPTIMIZER_BINARY = process.env.PDF_OPTIMIZER_BINARY || 'gs';
const PDF_OPTIMIZE_DISABLED = /^(1|true|yes)$/i.test(process.env.PDF_OPTIMIZE_DISABLED || '');
let optimizerUnavailableWarned = false;

// 示例图片目录（demo_v1/samples/sample-images）按本文件位置解析——与 FONTS_DIR 同样的 3 层上溯到仓库根，
// 因此不写死任何机器路径，换服务器/换部署目录都自适应（typst --root / 下读绝对路径，真实上传图同理）。
const SAMPLE_IMAGES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'samples', 'sample-images');

/**
 * 把源码里的示例图片占位符（MOCK_IMAGE_DIR，浏览器端生成 mock 预览时嵌入）替换成本服务器上的真实绝对路径。
 * 仅影响预览里的示例图；真实报告的图片用文员上传的绝对 server_path，不含占位符、不受影响。
 * 用 split/join 做纯字符串替换（不走正则），避免路径里的特殊字符被当作正则元字符。
 */
function resolveSamplePaths(source: string): string {
  const withSamples = source.includes(MOCK_IMAGE_DIR) ? source.split(MOCK_IMAGE_DIR).join(SAMPLE_IMAGES_DIR) : source;
  if (!withSamples.includes(UPLOAD_IMAGE_PATH_PREFIX)) return withSamples;

  // 浏览器只保存相对存储路径；在实际编译服务器上再解析为当前 uploadsDir。
  // 这样迁移部署目录、容器挂载点变化后，历史记录中的图片仍可被 PDF 编译器读取。
  return withSamples.replace(new RegExp(`${escapeRegExp(UPLOAD_IMAGE_PATH_PREFIX)}([^"\\n\\r]*)`, 'g'), (_whole, rawPath: string) => {
    const rel = String(rawPath || '').replace(/\\\\/g, '/');
    if (!rel || rel.includes('..') || rel.startsWith('/')) return join(SAMPLE_IMAGES_DIR, 'before.png');
    const candidate = resolve(uploadsDir, rel);
    // 仅允许解析到上传根目录内；文件被移除时用中性示例图保证预览/下载仍可用，
    // 而不会让一张失效历史图片导致整份原始记录或报告无法生成。
    if (candidate === uploadsDir || !candidate.startsWith(uploadsDir + sep) || !existsSync(candidate)) {
      console.warn(`[typst] uploaded image not found: ${rel}`);
      return join(SAMPLE_IMAGES_DIR, 'before.png');
    }
    return candidate;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface CompileResult {
  pdf: Buffer;
  duration_ms: number;
}

interface CompileError {
  message: string;
  line?: number;
  column?: number;
}

// 并发闸门：每次 spawn 一个 typst CLI 子进程都是 CPU 密集型操作。无上限时，
// 200 人同时生成报告会 fork 出 200 个进程把机器打爆。这里用信号量把同时在跑的
// typst 进程数限制在 TYPST_MAX_CONCURRENCY（默认 4），超出的请求排队等待，逐个执行。
const MAX_CONCURRENCY = Math.max(1, Number(process.env.TYPST_MAX_CONCURRENCY || 4));
let active = 0;
const waiters: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (active < MAX_CONCURRENCY) {
    active++;
    return Promise.resolve();
  }
  return new Promise<void>((res) => waiters.push(res));
}

function releaseSlot(): void {
  const next = waiters.shift();
  if (next) next();        // 槽位转交给排队者，active 计数不变
  else active--;
}

/** 在并发闸门内执行 fn：拿不到槽位就排队，跑完（成功或失败）释放槽位。 */
async function runWithLimit<T>(fn: () => Promise<T>): Promise<T> {
  await acquireSlot();
  try {
    return await fn();
  } finally {
    releaseSlot();
  }
}

const LRU_MAX = 100;
const cache = new Map<string, Buffer>();

function evictIfNeeded() {
  if (cache.size >= LRU_MAX) {
    const firstKey = cache.keys().next().value!;
    cache.delete(firstKey);
  }
}

// 渲染环境指纹：typst-packages 主题源（按文件内容）+ fonts 内置字体（按 size/mtime，字体文件大不读内容）。
// 混入缓存键——否则改主题（如 record-theme 的 #field）或换字体后，同一份 source 仍命中旧 PDF（脏缓存）。
// 启动时算一次即可：两者只随部署/重启变化，运行期不热更（dev 下改主题文件需重启 server 才重新指纹）。
const THEME_PACKAGES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'typst-packages');
const RENDER_ENV_FINGERPRINT = (() => {
  const h = createHash('sha256');
  // 编译后处理策略改变时必须让旧磁盘缓存失效，否则历史的大 PDF 会一直被直接返回。
  h.update(`${PDF_OPTIMIZER_VERSION}:${PDF_OPTIMIZE_MIN_BYTES}:${PDF_OPTIMIZE_DISABLED}`);
  const walk = (dir: string, byContent: boolean) => {
    let names: string[] = [];
    try { names = readdirSync(dir).sort(); } catch { return; }
    for (const name of names) {
      const p = join(dir, name);
      let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) { walk(p, byContent); continue; }
      h.update(p);
      if (byContent) { try { h.update(readFileSync(p)); } catch { /* 读失败按无内容 */ } }
      else h.update(`${st.size}:${st.mtimeMs}`);
    }
  };
  walk(THEME_PACKAGES_DIR, true);
  if (HAS_BUNDLED_FONTS) walk(FONTS_DIR, false);
  return h.digest('hex');
})();

function cacheKey(source: string): string {
  return createHash('sha256').update(RENDER_ENV_FINGERPRINT).update(source).digest('hex');
}

// 磁盘缓存：报告 PDF 之前在【每次查看/下载】时都用 final_typst 现编译，只有进程内 LRU(100条)
// 兜底——重启即失、超过 100 条被挤掉、多进程(cluster)各编各的。200 人反复看报告时这是 CPU 大头。
// 这里把编译产物按 source 的 sha256 落盘：命中直接读盘、跳过 typst 进程。
// 自动失效：报告改了→final_typst 变→哈希变→自然 miss 重编，旧文件留作历史版本缓存（受 MAX_FILES 淘汰）。
// 缓存目录可清空、可用 TYPST_CACHE_DIR 指定（默认 <tmpdir>/cdr-typst-pdf-cache）。设 TYPST_CACHE_DIR=off 关闭。
const DISK_CACHE_DIR = process.env.TYPST_CACHE_DIR === 'off'
  ? null
  : (process.env.TYPST_CACHE_DIR || join(tmpdir(), 'cdr-typst-pdf-cache'));
const DISK_CACHE_MAX_FILES = Math.max(50, Number(process.env.TYPST_CACHE_MAX_FILES || 2000));
let diskWritesSinceSweep = 0;

if (DISK_CACHE_DIR) {
  try { mkdirSync(DISK_CACHE_DIR, { recursive: true }); }
  catch (e: any) { console.error('[typst-cache] mkdir failed, disk cache disabled:', e?.message); }
}

function diskPath(key: string): string | null {
  return DISK_CACHE_DIR ? join(DISK_CACHE_DIR, `${key}.pdf`) : null;
}

/** 读盘缓存（命中返回 Buffer，未命中/出错返回 null——缓存永远是「优化」，不能让它的故障影响主流程）。 */
function readDiskCache(key: string): Buffer | null {
  const p = diskPath(key);
  if (!p) return null;
  try {
    if (existsSync(p)) return readFileSync(p);
  } catch { /* 读盘失败当未命中 */ }
  return null;
}

/** 写盘缓存：先写临时文件再 rename（原子，避免并发下读到半截文件）。失败静默——不影响返回结果。 */
function writeDiskCache(key: string, pdf: Buffer): void {
  const p = diskPath(key);
  if (!p) return;
  try {
    const tmp = `${p}.${process.pid}.tmp`;
    writeFileSync(tmp, pdf);
    renameSync(tmp, p);
    if (++diskWritesSinceSweep >= 50) { diskWritesSinceSweep = 0; sweepDiskCache(); }
  } catch { /* 写盘失败不影响主流程 */ }
}

/** 容量淘汰：文件数超 MAX 时按 mtime 删最旧的，降到 90%。每 50 次写触发一次，不每次扫盘。 */
function sweepDiskCache(): void {
  if (!DISK_CACHE_DIR) return;
  try {
    const files = readdirSync(DISK_CACHE_DIR).filter(f => f.endsWith('.pdf'));
    if (files.length <= DISK_CACHE_MAX_FILES) return;
    const withTime = files.map(f => {
      const fp = join(DISK_CACHE_DIR, f);
      try { return { fp, mtime: statSync(fp).mtimeMs }; } catch { return { fp, mtime: 0 }; }
    }).sort((a, b) => a.mtime - b.mtime);
    const target = Math.floor(DISK_CACHE_MAX_FILES * 0.9);
    for (const { fp } of withTime.slice(0, files.length - target)) {
      try { unlinkSync(fp); } catch { /* 忽略 */ }
    }
  } catch { /* 扫盘失败忽略 */ }
}

/**
 * 压缩异常偏大的 PDF。Ghostscript 是可选依赖：没有安装、执行超时或输出异常时，
 * 一律返回原始 PDF，绝不让“优化”阻断预览和下载。
 */
async function optimizeLargePdf(pdf: Buffer): Promise<Buffer> {
  if (PDF_OPTIMIZE_DISABLED || pdf.length < PDF_OPTIMIZE_MIN_BYTES) return pdf;

  const dir = mkdtempSync(join(tmpdir(), 'pdf-opt-'));
  const inputPath = join(dir, 'input.pdf');
  const outputPath = join(dir, 'output.pdf');
  writeFileSync(inputPath, pdf);

  try {
    const args = [
      '-q',
      '-dNOPAUSE',
      '-dBATCH',
      '-dSAFER',
      '-sDEVICE=pdfwrite',
      '-dCompatibilityLevel=1.7',
      '-dDetectDuplicateImages=true',
      '-dCompressFonts=true',
      '-dSubsetFonts=true',
      '-dEmbedAllFonts=true',
      '-dDownsampleColorImages=true',
      '-dColorImageDownsampleType=/Bicubic',
      '-dColorImageResolution=180',
      '-dAutoFilterColorImages=false',
      '-dColorImageFilter=/DCTEncode',
      '-dJPEGQ=82',
      '-dDownsampleGrayImages=true',
      '-dGrayImageDownsampleType=/Bicubic',
      '-dGrayImageResolution=180',
      '-dAutoFilterGrayImages=false',
      '-dGrayImageFilter=/DCTEncode',
      '-dDownsampleMonoImages=true',
      '-dMonoImageDownsampleType=/Bicubic',
      '-dMonoImageResolution=300',
      `-sOutputFile=${outputPath}`,
      inputPath,
    ];

    const completed = await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };
      const proc = spawn(PDF_OPTIMIZER_BINARY, args, { timeout: 30000 });
      proc.on('close', (code) => finish(code === 0));
      proc.on('error', (err) => {
        if (!optimizerUnavailableWarned) {
          optimizerUnavailableWarned = true;
          console.warn(`[pdf-optimize] Ghostscript unavailable, using Typst PDF unchanged: ${err.message}`);
        }
        finish(false);
      });
    });

    if (!completed || !existsSync(outputPath)) return pdf;
    const optimized = readFileSync(outputPath);
    const isPdf = optimized.length > 1024 && optimized.subarray(0, 5).toString() === '%PDF-';
    // 重写本身可能让简单文档略大；至少缩小 2% 才替换原文件。
    if (!isPdf || optimized.length >= pdf.length * 0.98) return pdf;

    console.info(
      `[pdf-optimize] ${(pdf.length / 1024 / 1024).toFixed(2)} MB -> ${(optimized.length / 1024 / 1024).toFixed(2)} MB`,
    );
    return optimized;
  } catch (err: any) {
    console.warn(`[pdf-optimize] failed, using Typst PDF unchanged: ${err?.message || err}`);
    return pdf;
  } finally {
    try { unlinkSync(inputPath); } catch {}
    try { unlinkSync(outputPath); } catch {}
    try { rmdirSync(dir); } catch {}
  }
}

export async function compileTypst(source: string): Promise<CompileResult> {
  // public_base_url 也写入编译源码和缓存键；更换服务器域名后不会继续返回旧 PDF 链接。
  const resolvedSource = resolveSamplePaths(source);
  const key = cacheKey(resolvedSource);

  // 1) 进程内 LRU
  if (cache.has(key)) {
    return { pdf: cache.get(key)!, duration_ms: 0 };
  }

  // 2) 磁盘缓存（重启/超 LRU/跨进程仍命中）。命中不进并发闸门、不 spawn typst。
  const disk = readDiskCache(key);
  if (disk) {
    evictIfNeeded();
    cache.set(key, disk);
    return { pdf: disk, duration_ms: 0 };
  }

  // 3) 都没命中 → 限流编译
  return runWithLimit(async () => {
  const start = Date.now();
  const dir = mkdtempSync(join(tmpdir(), 'typst-'));
  const inputPath = join(dir, 'input.typ');
  const outputPath = join(dir, 'output.pdf');

  writeFileSync(inputPath, resolvedSource, 'utf-8');

  const typstPdf = await new Promise<Buffer>((resolve, reject) => {
    const proc = spawn('typst', ['compile', '--root', '/', ...FONT_ARGS, inputPath, outputPath], {
      timeout: 10000,
    });

    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      try {
        if (code === 0) {
          const buf = readFileSync(outputPath);
          resolve(buf);
        } else {
          const error = parseTypstError(stderr);
          reject(error);
        }
      } finally {
        try { unlinkSync(inputPath); } catch {}
        try { unlinkSync(outputPath); } catch {}
        try { rmdirSync(dir); } catch {}
      }
    });

    proc.on('error', (err) => {
      // spawn 失败（如 typst 未安装）时 'close' 可能不触发 → 这里兜底清理临时目录，避免泄漏
      try { unlinkSync(inputPath); } catch {}
      try { unlinkSync(outputPath); } catch {}
      try { rmdirSync(dir); } catch {}
      reject({ message: `Failed to spawn typst: ${err.message}` });
    });
  });
  const pdf = await optimizeLargePdf(typstPdf);

  evictIfNeeded();
  cache.set(key, pdf);
  writeDiskCache(key, pdf);   // 落盘，下次查看/下载/重启后直接读盘

  return { pdf, duration_ms: Date.now() - start };
  });
}

function parseTypstError(stderr: string): CompileError {
  const lineMatch = stderr.match(/(\d+):(\d+)/);
  return {
    message: stderr.trim() || 'Unknown compilation error',
    line: lineMatch ? parseInt(lineMatch[1]) : undefined,
    column: lineMatch ? parseInt(lineMatch[2]) : undefined,
  };
}

/** 位置标记（编辑器 ⇄ PDF 双向跳转）：typst query 取回 <__fepos__> 标记的 {kind, code, page, y} */
export interface PosMarker {
  kind: 'group' | 'field';
  code: string;
  page: number;
  y: number; // pt
}

const posCache = new Map<string, PosMarker[]>();

export async function queryTypstPositions(source: string): Promise<PosMarker[]> {
  const resolvedSource = resolveSamplePaths(source);
  const key = cacheKey(resolvedSource);
  if (posCache.has(key)) return posCache.get(key)!;

  return runWithLimit(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'typst-q-'));
  const inputPath = join(dir, 'input.typ');
  writeFileSync(inputPath, resolvedSource, 'utf-8');

  const out = await new Promise<string>((resolve, reject) => {
    const proc = spawn('typst', ['query', '--root', '/', ...FONT_ARGS, inputPath, '<__fepos__>', '--field', 'value'], {
      timeout: 10000,
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => { stdout += c.toString(); });
    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    proc.on('close', (code) => {
      try {
        if (code === 0) resolve(stdout);
        else reject(parseTypstError(stderr));
      } finally {
        try { unlinkSync(inputPath); } catch {}
        try { rmdirSync(dir); } catch {}
      }
    });
    proc.on('error', (err) => {
      try { unlinkSync(inputPath); } catch {}
      try { rmdirSync(dir); } catch {}
      reject({ message: `Failed to spawn typst: ${err.message}` });
    });
  });

  let markers: PosMarker[] = [];
  try {
    markers = JSON.parse(out);
  } catch {
    markers = [];
  }
  if (posCache.size >= LRU_MAX) {
    const firstKey = posCache.keys().next().value!;
    posCache.delete(firstKey);
  }
  posCache.set(key, markers);
  return markers;
  });
}

export function clearCache() {
  cache.clear();
  posCache.clear();
}

export function getCacheSize(): number {
  return cache.size;
}
