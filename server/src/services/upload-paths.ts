/**
 * 上传文件落盘路径规划（图片 / 附件共用）。
 *
 * 目录结构（人类可读、按订单与原始记录分开存，不混在一起）：
 *   <根>/<订单号>/<样品名_测试项目名>/<字段名|附件名>
 *   首页（报告封面，不属任何原始记录）：<根>/<订单号>/_首页/<字段名>
 *
 * 根目录见 config（默认＝项目目录的上一级 /data，可经 storage.local.json / STORAGE_UPLOADS_DIR 改）。
 * 读取时对【历史扁平文件】（旧版 server/uploads 与 server/uploads/images 下的文件）做回退兼容。
 */
import { resolve, extname, basename, join, sep } from 'path';
import { existsSync, mkdirSync, copyFileSync, unlinkSync } from 'fs';
import { uploadsDir, legacyUploadsDir } from '../../../config/index.js';

/** 首页（无原始记录）图片所在的子目录名。 */
export const COVER_DIR = '_首页';

/** 单段目录/文件名清洗：只替换文件系统非法字符，保留连字符/空格/中文；空则回退。 */
export function sanitizeSeg(s: string | null | undefined, fallback = '_'): string {
  const cleaned = String(s ?? '')
    .replace(/[\/\\:*?"<>|]/g, '_')   // 文件系统非法字符 → _
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')              // 去开头的点，避免隐藏文件/穿越
    .slice(0, 120);                   // 控制长度
  return cleaned || fallback;
}

/** 原始记录子文件夹名＝样品名_测试项目名（任一为空时降级）。 */
export function recordDirName(sampleName?: string | null, testName?: string | null): string {
  const s = sanitizeSeg(sampleName, '');
  const t = sanitizeSeg(testName, '');
  if (s && t) return `${s}_${t}`;
  return s || t || '未分类';
}

/** 在 dir 下为 baseName+ext 取一个不冲突的文件名（已存在则加 -2/-3…）。 */
function uniqueFilename(dir: string, baseName: string, ext: string): string {
  let name = `${baseName}${ext}`;
  let i = 2;
  while (existsSync(join(dir, name))) { name = `${baseName}-${i}${ext}`; i++; }
  return name;
}

export interface StoredFile {
  absPath: string;   // 落盘绝对路径（图片渲染用 server_path）
  relPath: string;   // 相对根目录的路径（正斜杠，存 DB / 拼预览 url）
  filename: string;  // 最终文件名（含去重后缀）
}

/**
 * 把临时上传文件移动到 <根>/<order>/<recordDir>/<desiredBaseName><ext>。
 * @param tmpPath         multer 临时文件路径
 * @param orderNo         订单号（订单文件夹名）
 * @param recordDir       原始记录子文件夹名（样品_测试项目，或 _首页）
 * @param desiredBaseName 期望主名（图片＝字段名；附件＝去扩展名的附件名）
 * @param ext             扩展名（含点，如 .jpg；附件取自原文件名）
 */
export function storeUploadedFile(
  tmpPath: string, orderNo: string, recordDir: string, desiredBaseName: string, ext: string,
): StoredFile {
  const orderSeg = sanitizeSeg(orderNo, '未知订单');
  const recSeg = sanitizeSeg(recordDir, '未分类');
  const dir = resolve(uploadsDir, orderSeg, recSeg);
  mkdirSync(dir, { recursive: true });
  const filename = uniqueFilename(dir, sanitizeSeg(desiredBaseName, 'file'), ext || '');
  const absPath = join(dir, filename);
  copyFileSync(tmpPath, absPath);
  try { unlinkSync(tmpPath); } catch { /* 临时文件删除失败不影响主流程 */ }
  const relPath = [orderSeg, recSeg, filename].join('/');
  return { absPath, relPath, filename };
}

/**
 * 把 DB/引用里存的路径还原成磁盘绝对路径，并做历史扁平文件兼容。
 * 解析顺序：① 新结构 <根>/<relPath>；② 旧扁平 <legacy>/<basename>；③ 旧图片 <legacy>/images/<basename>。
 * 全部带【根目录越界】防护，未命中返回 null。
 * @param rel 可能是新相对路径(a/b/c.jpg) 或旧值(uploads/x.xlsx、纯文件名)
 */
export function resolveStoredFile(rel: string): string | null {
  if (!rel) return null;
  const base = basename(rel);
  const candidates = [
    resolve(uploadsDir, rel),                  // 新结构
    resolve(legacyUploadsDir, base),           // 旧扁平附件
    resolve(legacyUploadsDir, 'images', base), // 旧扁平图片
  ];
  for (const c of candidates) {
    const okRoot = (c === uploadsDir || c.startsWith(uploadsDir + sep)
      || c === legacyUploadsDir || c.startsWith(legacyUploadsDir + sep));
    if (okRoot && existsSync(c)) return c;
  }
  return null;
}

/** 图片落点：扩展名取自原文件名，主名＝字段名。 */
export function storeImage(
  tmpPath: string, originalName: string, orderNo: string, recordDir: string, fieldName: string,
): StoredFile {
  const ext = (extname(originalName) || '.jpg').toLowerCase();
  return storeUploadedFile(tmpPath, orderNo, recordDir, fieldName || 'image', ext);
}

/** 附件落点：文件名＝原附件名（主名+扩展名都来自原名）。 */
export function storeAttachment(
  tmpPath: string, originalName: string, orderNo: string, recordDir: string,
): StoredFile {
  const ext = extname(originalName);
  const baseName = ext ? originalName.slice(0, -ext.length) : originalName;
  return storeUploadedFile(tmpPath, orderNo, recordDir, baseName, ext);
}
