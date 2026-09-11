import { Router } from 'express';
import multer from 'multer';
import { join } from 'path';
import { existsSync, mkdirSync, createReadStream, unlinkSync, readdirSync, statSync } from 'fs';
import { randomUUID } from 'crypto';
import ExcelJS from 'exceljs';
import { uploadsDir } from '../../../config/index.js';
import { storeAttachment, resolveStoredFile, recordDirName } from '../services/upload-paths.js';
import { requirePermission } from './auth.js';
import { workbookPreview, isExcelTempPath } from '../services/excel-workbook.ts';

const router = Router();
import { pool } from '../db.js';

// 留存的 Excel 附件放在上传根目录下（根目录可配置，见 config/storage.json）。
const UPLOADS_DIR = uploadsDir;
if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });

// Excel 上传临时区。/parse→/extract 之间要复用同一文件，故不能用完即删；
// 改为按时效清理：删超过 EXCEL_TEMP_TTL_HOURS（默认 6h）的旧临时文件，防止 /tmp 里无限堆积。
const EXCEL_TMP_DIR = '/tmp/excel-imports/';
if (!existsSync(EXCEL_TMP_DIR)) mkdirSync(EXCEL_TMP_DIR, { recursive: true });
const EXCEL_TEMP_TTL_MS = Math.max(1, Number(process.env.EXCEL_TEMP_TTL_HOURS || 6)) * 3600_000;

function sweepOldExcelTemps(): void {
  try {
    const now = Date.now();
    for (const f of readdirSync(EXCEL_TMP_DIR)) {
      const fp = join(EXCEL_TMP_DIR, f);
      try { if (now - statSync(fp).mtimeMs > EXCEL_TEMP_TTL_MS) unlinkSync(fp); } catch { /* 忽略单个文件 */ }
    }
  } catch { /* 目录不存在等，忽略 */ }
}
sweepOldExcelTemps();  // 启动时清一次历史残留

const upload = multer({ dest: EXCEL_TMP_DIR });
const workbookUpload = multer({ dest: EXCEL_TMP_DIR, limits: { fileSize: 10 * 1024 * 1024 } });

/** New preview flow returns bounded sheet data, never a server filesystem path. */
router.post('/workbook', requirePermission('record.entry'), (req, res) => {
  workbookUpload.single('file')(req, res, async error => {
    if (error) return res.status(400).json({ error: '文件上传失败或超过10MB，请缩小文件后重试' });
    if (!req.file) return res.status(400).json({ error: '请选择Excel文件' });
    try {
      if (!/\.xlsx$/i.test(req.file.originalname)) return res.status(400).json({ error: '目前支持.xlsx；请将旧.xls文件用Excel另存为.xlsx后导入' });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(req.file.path);
      const sheets = workbookPreview(wb);
      if (!sheets.length) throw new Error('工作簿中没有可读取的Sheet');
      res.json({ sheets });
    } catch (error: any) { res.status(400).json({ error: error.message || 'Excel文件无法解析' }); }
    finally { if (req.file && existsSync(req.file.path)) { try { unlinkSync(req.file.path); } catch { /* TTL cleanup remains available */ } } }
  });
});

/** POST /api/excel-import/parse — 上传 Excel，返回 sheet 列表 + 各 sheet 前几行预览 */
router.post('/parse', requirePermission('record.entry'), upload.single('file'), async (req, res) => {
  try {
    sweepOldExcelTemps();  // 机会性清理旧临时文件
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(req.file.path);

    const sheets: { name: string; rows: number; cols: number; preview: any[][] }[] = [];
    wb.eachSheet((ws) => {
      const preview: any[][] = [];
      const maxPreviewRows = 6;
      ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
        if (rowNum <= maxPreviewRows) {
          preview.push(row.values ? (row.values as any[]).slice(1).map(v => v ?? '') : []);
        }
      });
      sheets.push({
        name: ws.name,
        rows: ws.rowCount,
        cols: ws.columnCount,
        preview,
      });
    });

    res.json({ sheets, tempPath: req.file.path });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/excel-import/extract — 按映射配置提取数据 */
router.post('/extract', requirePermission('record.entry'), async (req, res) => {
  try {
    const { tempPath, sheetName, dataStartRow = 2, columnMapping, rowLabelColumn = 0, dataStartCol, rowCount, colCount } = req.body;
    if (!tempPath || !sheetName) return res.status(400).json({ error: 'Missing tempPath or sheetName' });
    if (!isExcelTempPath(tempPath, EXCEL_TMP_DIR) || !existsSync(tempPath)) {
      return res.status(400).json({ error: '导入临时文件无效或已过期，请重新上传' });
    }

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(tempPath);
    const ws = wb.getWorksheet(sheetName);
    if (!ws) return res.status(404).json({ error: `Sheet "${sheetName}" not found` });

    // 数据块模式（dataStartCol 给定）：只搬矩形数据块，不读行名/不做列映射——
    // 行表头/列表头都由模板配置，Excel 里的表头区整体跳过
    if (dataStartCol !== undefined && dataStartCol !== null) {
      const grid: any[][] = [];
      // 自由表格会传明确的目标尺寸：逐格读取固定矩形，必须保留中间的整空行/空列，
      // 否则 Excel 里的物理位置会在导入后发生上移。数据矩阵不传尺寸，继续兼容旧行为。
      if (Number(rowCount) > 0 && Number(colCount) > 0) {
        const rows = Math.min(500, Math.max(1, Number(rowCount)));
        const cols = Math.min(200, Math.max(1, Number(colCount)));
        for (let r = 0; r < rows; r++) {
          const out: any[] = [];
          const row = ws.getRow(Number(dataStartRow) + 1 + r);
          for (let c = 0; c < cols; c++) {
            const raw = row.getCell(Number(dataStartCol) + 1 + c).value as any;
            const x = raw && typeof raw === 'object' && 'result' in raw ? raw.result : raw;
            out.push(x === null || x === undefined ? '' : x);
          }
          grid.push(out);
        }
        return res.json({ grid, sheetName });
      }
      ws.eachRow((row, rowNum) => {
        if (rowNum <= dataStartRow) return;
        const vals = (row.values as any[])?.slice(1) || [];
        const slice = vals.slice(Number(dataStartCol)).map(v => {
          const x = v && typeof v === 'object' && 'result' in v ? v.result : v;
          return x === null || x === undefined ? '' : x;
        });
        if (slice.some(v => v !== '')) grid.push(slice);
      });
      return res.json({ grid, sheetName });
    }

    const rows: { label: string; values: Record<number, any> }[] = [];
    ws.eachRow((row, rowNum) => {
      if (rowNum <= dataStartRow) return;
      const vals = (row.values as any[])?.slice(1) || [];
      const label = String(vals[rowLabelColumn] ?? '');
      const values: Record<number, any> = {};
      vals.forEach((v, i) => {
        if (i !== rowLabelColumn && v !== null && v !== undefined && v !== '') {
          values[i] = typeof v === 'object' && 'result' in v ? v.result : v;
        }
      });
      if (Object.keys(values).length > 0 || label) {
        rows.push({ label, values });
      }
    });

    res.json({ rows, sheetName });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 由 record_data id 反查 订单号 / 样品名 / 测试项目名（用于按订单·原始记录分文件夹存附件）。
 * 样品名来自 work_orders.payload.samples（按 sample_external_id 匹配），找不到时退回 id。
 */
async function recordContext(recordId: string): Promise<{ orderNo: string; sampleName: string; testName: string }> {
  const r = await pool.query(
    'SELECT order_no, sample_external_id, test_item_name FROM record_data WHERE id=$1', [recordId],
  );
  const row = r.rows[0] || {};
  const orderNo = row.order_no || '';
  const testName = row.test_item_name || '';
  let sampleName = row.sample_external_id || '';
  if (orderNo && row.sample_external_id) {
    const wo = await pool.query('SELECT payload FROM work_orders WHERE order_no=$1', [orderNo]);
    const samples = wo.rows[0]?.payload?.samples || [];
    const hit = samples.find((s: any) => s.id === row.sample_external_id);
    if (hit?.name) sampleName = hit.name;
  }
  return { orderNo, sampleName, testName };
}

/** POST /api/record-data/:id/attachments — 保存文件并记录附件 */
router.post('/:id/attachments', requirePermission('record.entry'), upload.single('file'), async (req, res) => {
  try {
    const recordId = String(req.params.id);
    if (!req.file) return res.status(400).json({ error: 'No file' });

    // multer/busboy 默认按 latin1 解析上传文件名，中文(UTF-8)会变乱码——按字节重新解回 UTF-8。
    // （纯 ASCII 名经此转换不变；故对中文/英文文件名都安全。）
    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');

    // 按 订单号/样品名_测试项目名 分文件夹存，文件名＝原附件名（见 services/upload-paths.ts）。
    const { orderNo, sampleName, testName } = await recordContext(recordId);
    const stored = storeAttachment(
      req.file.path, originalName, orderNo || '_未分类', recordDirName(sampleName, testName),
    );

    const attachment = {
      id: randomUUID(),
      filename: originalName,
      path: stored.relPath,   // 相对上传根目录的新结构路径
      uploaded_at: new Date().toISOString(),
      size_bytes: req.file.size,
      // kind 区分：'excel'＝导入并留存的 Excel（数据表区显示）；'file'＝通用附件（图片旁/录入页底显示）。缺省 file。
      kind: req.body?.kind === 'excel' ? 'excel' : 'file',
    };

    await pool.query(
      `UPDATE record_data SET attachments = COALESCE(attachments, '[]'::jsonb) || $1::jsonb WHERE id = $2`,
      [JSON.stringify([attachment]), recordId]
    );

    res.json(attachment);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/record-data/:id/attachments/:fileId — 下载附件 */
router.get('/:id/attachments/:fileId', async (req, res) => {
  try {
    const { id, fileId } = req.params;
    const result = await pool.query('SELECT attachments FROM record_data WHERE id = $1', [id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Record not found' });

    const attachments = result.rows[0].attachments || [];
    const att = attachments.find((a: any) => a.id === fileId);
    if (!att) return res.status(404).json({ error: 'Attachment not found' });

    // 解析磁盘路径：新结构相对路径(订单/记录/附件名)，兼容历史扁平文件(uploads/xxx)。
    const filePath = resolveStoredFile(att.path);
    if (!filePath) return res.status(404).json({ error: 'File missing' });

    // 下载文件名按 RFC 5987 给 UTF-8 编码（中文不乱码）+ ASCII 兜底，兼容各浏览器
    const utf8Name: string = att.filename || 'attachment';
    const asciiFallback = utf8Name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(utf8Name)}`,
    );
    res.setHeader('Content-Length', statSync(filePath).size);
    createReadStream(filePath).pipe(res);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/record-data/:id/attachments/:fileId — 删除附件记录及其已落盘文件。 */
router.delete('/:id/attachments/:fileId', requirePermission('record.entry'), async (req, res) => {
  try {
    const { id, fileId } = req.params;
    const result = await pool.query('SELECT attachments FROM record_data WHERE id = $1', [id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Record not found' });
    const attachments = Array.isArray(result.rows[0].attachments) ? result.rows[0].attachments : [];
    const attachment = attachments.find((item: any) => item?.id === fileId);
    if (!attachment) return res.status(404).json({ error: 'Attachment not found' });

    // 先更新数据库，文件清理失败不影响用户从记录中移除该附件；路径由 resolveStoredFile 校验。
    const next = attachments.filter((item: any) => item?.id !== fileId);
    await pool.query('UPDATE record_data SET attachments = $1::jsonb WHERE id = $2', [JSON.stringify(next), id]);
    const storedPath = resolveStoredFile(attachment.path);
    if (storedPath && existsSync(storedPath)) {
      try { unlinkSync(storedPath); } catch { /* 已从记录移除，磁盘残留交给后续清理 */ }
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
