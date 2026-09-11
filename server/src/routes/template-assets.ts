import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { createReadStream, existsSync, mkdirSync, unlinkSync } from 'fs';
import { extname } from 'path';
import { storeAttachment, resolveStoredFile } from '../services/upload-paths.js';
import { actorHasPermission } from '../services/template-versions.js';

const router = Router();
const tmpDir = '/tmp/template-assets/';
if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
const upload = multer({ dest: tmpDir, limits: { fileSize: 30 * 1024 * 1024 } });

function mimeOf(name: string): string {
  const ext = extname(name).toLowerCase();
  return ext === '.png' ? 'image/png'
    : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
    : ext === '.gif' ? 'image/gif'
    : ext === '.webp' ? 'image/webp'
    : ext === '.pdf' ? 'application/pdf'
    : 'application/octet-stream';
}

/**
 * 模板说明图片：文件引用保存在 field_definitions 版本快照中，物理文件永不随改版删除。
 * 说明字段已不再提供附件类型；服务端也仅接收图片，避免绕过前端继续写入附件资料。
 */
router.post('/upload', upload.single('file'), (req: Request, res: Response) => {
  if (!actorHasPermission(req, 'record_template.edit')) return res.status(403).json({ error: '当前账号无原始记录模板编辑权限' });
  if (!req.file) return res.status(400).json({ error: '请选择文件' });
  try {
    const name = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const ext = extname(name).toLowerCase();
    const supported = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
    if (!supported.includes(ext)) {
      unlinkSync(req.file.path);
      return res.status(400).json({ error: '说明资料仅支持 PNG、JPG、GIF 或 WebP 图片' });
    }
    const templateId = String(req.body?.template_id || 'draft').replace(/[^\w-]/g, '') || 'draft';
    const stored = storeAttachment(req.file.path, name, '_模板说明图片', `原始记录模板_${templateId}`);
    const mime = mimeOf(name);
    res.json({ id: crypto.randomUUID(), name: stored.filename, rel_path: stored.relPath, url: `/api/template-assets/file?p=${encodeURIComponent(stored.relPath)}`, mime_type: mime, size_bytes: req.file.size });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/file', (req: Request, res: Response) => {
  const rel = String(req.query.p || '');
  if (!rel || rel.includes('..')) return res.status(400).json({ error: 'invalid path' });
  const file = resolveStoredFile(rel);
  if (!file) return res.status(404).json({ error: 'not found' });
  const ext = extname(file).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) return res.status(415).json({ error: '模板资料仅支持图片' });
  // <img> 不能携带应用的自定义鉴权头；与 /api/images/file 保持一致，
  // 因此通过不透明的受限相对路径提供模板说明图片的读取。
  res.setHeader('Content-Type', mimeOf(file));
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.split('/').pop() || 'image')}"`);
  createReadStream(file).pipe(res);
});

export default router;
