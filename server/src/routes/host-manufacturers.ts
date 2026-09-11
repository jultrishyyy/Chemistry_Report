import { Router, Request, Response } from 'express';
import { pool } from '../db.js';
import { actorHasPermission, readActor } from '../services/template-versions.js';

const router = Router();

function canEdit(req: Request, res: Response) {
  const actor = readActor(req as any);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return false; }
  if (!actorHasPermission(req as any, 'report_template.edit')) {
    res.status(403).json({ error: '当前账号无编辑报告模板权限' }); return false;
  }
  return true;
}

function values(body: any) {
  return {
    name: String(body?.name || '').trim(),
    category: body?.category ? String(body.category).trim() : null,
    short_name: body?.short_name ? String(body.short_name).trim() : null,
    remark: body?.remark ? String(body.remark).trim() : null,
  };
}
const generatedCode = () => `manufacturer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

router.get('/', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const params: any[] = [];
  const where = ['archived_at IS NULL'];
  if (q) {
    params.push(`%${q}%`);
    where.push(`(name ILIKE $${params.length} OR COALESCE(category, '') ILIKE $${params.length} OR COALESCE(short_name, '') ILIKE $${params.length} OR COALESCE(code, '') ILIKE $${params.length})`);
  }
  const r = await pool.query(`SELECT * FROM host_manufacturers WHERE ${where.join(' AND ')} ORDER BY name, id`, params);
  res.json(r.rows);
});

router.post('/', async (req, res) => {
  if (!canEdit(req, res)) return;
  const v = values(req.body);
  if (!v.name) { res.status(400).json({ error: '主机厂名称不能为空' }); return; }
  try {
    const r = await pool.query(
      `INSERT INTO host_manufacturers (name, category, short_name, code, remark) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [v.name, v.category, v.short_name, generatedCode(), v.remark],
    );
    res.status(201).json(r.rows[0]);
  } catch (e: any) {
    if (e.code === '23505') { res.status(409).json({ error: '已存在同名主机厂' }); return; }
    res.status(500).json({ error: e.message });
  }
});

router.put('/:id', async (req, res) => {
  if (!canEdit(req, res)) return;
  const v = values(req.body);
  if (!v.name) { res.status(400).json({ error: '主机厂名称不能为空' }); return; }
  try {
    const r = await pool.query(
      `UPDATE host_manufacturers SET name=$1, category=$2, short_name=$3, remark=$4, updated_at=NOW()
       WHERE id=$5 AND archived_at IS NULL RETURNING *`, [v.name, v.category, v.short_name, v.remark, Number(req.params.id)]);
    if (!r.rows.length) { res.status(404).json({ error: '主机厂不存在或已删除' }); return; }
    res.json(r.rows[0]);
  } catch (e: any) {
    if (e.code === '23505') { res.status(409).json({ error: '已存在同名主机厂' }); return; }
    res.status(500).json({ error: e.message });
  }
});

// 软删除，已关联的历史模板仍能正确显示其主机厂。
router.delete('/:id', async (req, res) => {
  if (!canEdit(req, res)) return;
  const r = await pool.query('UPDATE host_manufacturers SET archived_at=NOW(), updated_at=NOW() WHERE id=$1 AND archived_at IS NULL RETURNING id', [Number(req.params.id)]);
  if (!r.rows.length) { res.status(404).json({ error: '主机厂不存在或已删除' }); return; }
  res.json({ ok: true });
});

export default router;
