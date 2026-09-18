import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { equipmentSearchTerms, equipmentLikePattern } from '../../../shared/equipment-search.js';

const router = Router();
import { pool } from '../db.js';

const upload = multer({ dest: '/tmp/equipment-imports/' });

/** 把 Excel 单元格里可能是 Date 对象 / 字符串 / null 的"日期"统一转 ISO yyyy-mm-dd 或 null */
function toIsoDate(v: any): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (!s) return null;
  // 形如 2025-02-08 或 2025/02/08 或 2025/2/8 0:00:00
  const m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (m) {
    const y = m[1], mo = m[2].padStart(2, '0'), d = m[3].padStart(2, '0');
    return `${y}-${mo}-${d}`;
  }
  return null;
}

/** GET /api/equipment — 列表 + 搜索 */
router.get('/', async (req, res) => {
  try {
    const { keyword = '', status, limit = 50, offset = 0 } = req.query as any;
    const params: any[] = [];
    const where: string[] = [];
    for (const term of equipmentSearchTerms(keyword)) {
      params.push(equipmentLikePattern(term));
      where.push(`(asset_code ILIKE $${params.length} OR name ILIKE $${params.length} OR model ILIKE $${params.length})`);
    }
    if (status) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(Math.min(200, Math.max(1, Math.floor(Number(limit) || 50))), Math.max(0, Math.floor(Number(offset) || 0)));
    const r = await pool.query(
      `SELECT id, asset_code, name, model, factory_serial, cert_no, trace_date, expire_date, status, category, department
       FROM equipment_library ${whereSql}
       ORDER BY name, asset_code, id LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const total = await pool.query(`SELECT COUNT(*)::int AS n FROM equipment_library ${whereSql}`, params.slice(0, params.length - 2));
    res.json({ items: r.rows, total: total.rows[0].n });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** GET /api/equipment/lookup?codes=A,B,C — 按 asset_code 批量查 */
router.get('/lookup', async (req, res) => {
  try {
    const codes = String(req.query.codes || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!codes.length) return res.json([]);
    const r = await pool.query(
      `SELECT asset_code, name, model, trace_date, expire_date, status FROM equipment_library WHERE asset_code = ANY($1)`,
      [codes]
    );
    res.json(r.rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** GET /api/equipment/:id — 详情 */
router.get('/:id', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM equipment_library WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** POST /api/equipment/import — 上传 Excel 并 upsert */
router.post('/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(req.file.path);
    const ws = wb.worksheets[0];
    if (!ws) return res.status(400).json({ error: 'Empty workbook' });

    // 第 1 行表头
    const headerRow = ws.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
      headers[colNum - 1] = String(cell.value ?? '').trim();
    });

    const colIdx = (label: string) => headers.indexOf(label);
    const idxAsset = colIdx('管理编号');
    const idxName = colIdx('仪器名称');
    const idxModel = colIdx('仪器型号');
    const idxSerial = colIdx('出厂编号');
    const idxCert = colIdx('证书编号');
    const idxTrace = colIdx('溯源日期');
    const idxExpire = colIdx('到期日期');
    const idxStatus = colIdx('状态');
    const idxCategory = colIdx('设备类别');
    const idxDept = colIdx('所属部门');

    if (idxAsset < 0 || idxName < 0) {
      return res.status(400).json({ error: '缺失必要列：管理编号 / 仪器名称' });
    }

    let inserted = 0, updated = 0, skipped = 0;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 2; i <= ws.rowCount; i++) {
        const row = ws.getRow(i);
        const cellVal = (idx: number) => {
          if (idx < 0) return null;
          const c = row.getCell(idx + 1).value;
          if (c === null || c === undefined) return null;
          if (typeof c === 'object' && 'result' in (c as any)) return (c as any).result ?? null;
          if (typeof c === 'object' && 'text' in (c as any)) return (c as any).text ?? null;
          return c;
        };
        const assetCode = cellVal(idxAsset);
        const name = cellVal(idxName);
        if (!assetCode || !name) { skipped++; continue; }

        const payload: Record<string, any> = {};
        headers.forEach((h, j) => {
          if (h) payload[h] = cellVal(j);
        });

        const result = await client.query(
          `INSERT INTO equipment_library
            (asset_code, name, model, factory_serial, cert_no, trace_date, expire_date, status, category, department, raw_payload, imported_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb, NOW(), NOW())
           ON CONFLICT (asset_code) DO UPDATE SET
             name = EXCLUDED.name,
             model = EXCLUDED.model,
             factory_serial = EXCLUDED.factory_serial,
             cert_no = EXCLUDED.cert_no,
             trace_date = EXCLUDED.trace_date,
             expire_date = EXCLUDED.expire_date,
             status = EXCLUDED.status,
             category = EXCLUDED.category,
             department = EXCLUDED.department,
             raw_payload = EXCLUDED.raw_payload,
             updated_at = NOW()
           RETURNING (xmax = 0) AS is_insert`,
          [
            String(assetCode),
            String(name),
            cellVal(idxModel) ? String(cellVal(idxModel)) : null,
            cellVal(idxSerial) ? String(cellVal(idxSerial)) : null,
            cellVal(idxCert) ? String(cellVal(idxCert)) : null,
            toIsoDate(cellVal(idxTrace)),
            toIsoDate(cellVal(idxExpire)),
            cellVal(idxStatus) ? String(cellVal(idxStatus)) : null,
            cellVal(idxCategory) ? String(cellVal(idxCategory)) : null,
            cellVal(idxDept) ? String(cellVal(idxDept)) : null,
            JSON.stringify(payload),
          ]
        );
        if (result.rows[0]?.is_insert) inserted++; else updated++;
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    res.json({ inserted, updated, skipped, total_rows: ws.rowCount - 1 });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
