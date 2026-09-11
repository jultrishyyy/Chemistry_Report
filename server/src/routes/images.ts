import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { extname } from 'path';
import { existsSync, mkdirSync, createReadStream } from 'fs';
import { storeImage, resolveStoredFile } from '../services/upload-paths.js';
import { actorHasPermission } from '../services/template-versions.js';

const router = Router();

function requireImageMutationPermission(req: Request, res: Response, next: NextFunction) {
  if (actorHasPermission(req, 'record.entry') || actorHasPermission(req, 'report.generate')) {
    next();
    return;
  }
  res.status(req.header('X-User-Job') ? 403 : 401).json({ error: '当前账号没有上传图片的权限' });
}

// 上传先落临时区，再按 订单/原始记录/字段名 移动到正式目录（见 services/upload-paths.ts）。
const TMP_DIR = '/tmp/image-uploads/';
if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
const upload = multer({
  dest: TMP_DIR,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('仅支持图片文件'));
  },
});

function mimeOf(name: string): string {
  const ext = extname(name).toLowerCase();
  return ext === '.png' ? 'image/png'
    : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
    : ext === '.gif' ? 'image/gif'
    : ext === '.webp' ? 'image/webp'
    : 'application/octet-stream';
}

/**
 * POST /api/images/upload — 单张上传。
 * 表单附带上下文（决定落盘位置 <根>/<订单号>/<原始记录>/<字段名>）：
 *   order_no    订单号；缺省 → _未分类（如模板试录无订单）
 *   record_dir  原始记录子目录名（前端传「样品名_测试项目名」；首页传 _首页）
 *   field_name  字段名（图片文件名，去重时自动加 -2/-3）
 * 返回 { name, original_name, server_path, rel_path, url, size_bytes }。
 */
router.post('/upload', requireImageMutationPermission, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const orderNo = String(req.body?.order_no || '').trim() || '_未分类';
    const recordDir = String(req.body?.record_dir || '').trim() || '_临时';
    const fieldName = String(req.body?.field_name || '').trim() || 'image';
    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');

    const stored = storeImage(req.file.path, originalName, orderNo, recordDir, fieldName);
    res.json({
      name: stored.filename,
      original_name: originalName,
      server_path: stored.absPath,
      rel_path: stored.relPath,
      url: `/api/images/file?p=${encodeURIComponent(stored.relPath)}`,
      size_bytes: req.file.size,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** GET /api/images/file?p=<相对路径> — 按新结构相对路径读取（带越界防护 + 历史扁平兼容）。 */
router.get('/file', (req, res) => {
  try {
    const rel = String(req.query.p || '');
    if (!rel || rel.includes('..')) return res.status(400).json({ error: 'invalid path' });
    const filePath = resolveStoredFile(rel);
    if (!filePath) return res.status(404).json({ error: 'not found' });
    res.setHeader('Content-Type', mimeOf(filePath));
    res.setHeader('Cache-Control', 'public, max-age=3600');
    createReadStream(filePath).pipe(res);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** GET /api/images/:name — 历史扁平图片兼容（旧引用 url=/api/images/<文件名>）。 */
router.get('/:name', (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    if (name.includes('/') || name.includes('..')) return res.status(400).json({ error: 'invalid name' });
    const filePath = resolveStoredFile(name);
    if (!filePath) return res.status(404).json({ error: 'not found' });
    res.setHeader('Content-Type', mimeOf(name));
    res.setHeader('Cache-Control', 'public, max-age=3600');
    createReadStream(filePath).pipe(res);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
