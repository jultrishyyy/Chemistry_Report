import { Router, Request, Response } from 'express';

import { pool } from '../db.js';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  const { status } = req.query;
  let query = 'SELECT p.*, t.name as template_name FROM ad_hoc_field_proposals p JOIN record_templates t ON p.template_id = t.id';
  const params: any[] = [];
  if (status) {
    query += ' WHERE p.status = $1';
    params.push(status);
  }
  query += ' ORDER BY p.created_at DESC';
  const result = await pool.query(query, params);
  res.json(result.rows);
});

router.post('/', async (req: Request, res: Response) => {
  const { template_id, field_definition } = req.body;
  if (!template_id || !field_definition) {
    res.status(400).json({ error: 'template_id and field_definition required' });
    return;
  }
  const result = await pool.query(
    'INSERT INTO ad_hoc_field_proposals (template_id, field_definition) VALUES ($1, $2) RETURNING *',
    [template_id, JSON.stringify(field_definition)]
  );
  res.status(201).json(result.rows[0]);
});

router.post('/:id/approve', async (req: Request, res: Response) => {
  const { id } = req.params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get proposal
    const propResult = await client.query('SELECT * FROM ad_hoc_field_proposals WHERE id = $1 AND status = $2', [id, 'pending']);
    if (propResult.rows.length === 0) {
      res.status(404).json({ error: 'Proposal not found or already reviewed' });
      return;
    }
    const proposal = propResult.rows[0];

    // Get current template
    const tplResult = await client.query(
      `SELECT t.*, cv.field_definitions, cv.layout_options, cv.typst_source
       FROM record_templates t LEFT JOIN record_template_versions cv ON cv.id = t.current_version_id
       WHERE t.id = $1`,
      [proposal.template_id]
    );
    const template = tplResult.rows[0];

    // Merge field into last group
    const fieldDefs = template.field_definitions;
    if (fieldDefs.length > 0) {
      fieldDefs[fieldDefs.length - 1].fields.push(proposal.field_definition);
    }

    // ⚠️ migration 017 后 base 表不再持有 field_definitions。
    // proposals 审核流尚未对接模板版本流，本路由暂时禁用合并写入——
    // 改造方案：把合并结果通过 services/template-versions.ts 中 createDraft 创建 draft，
    // 让模板审核员二次确认后才生效。详见 README "P2 #11 字段提议接入"。
    await client.query('ROLLBACK');
    res.status(501).json({
      error: 'proposals 审核流尚未对接模板版本流，本接口暂时禁用',
      hint: '请引导工程师在模板编辑器里手动添加字段并提交模板审核',
    });
    return;
    /* eslint-disable */
    // 保留旧实现以便后续重构参考：
    // await client.query(
    //   'UPDATE record_templates SET field_definitions = $1, version = version + 1, updated_at = NOW() WHERE id = $2',
    //   [JSON.stringify(fieldDefs), proposal.template_id]
    // );

    // Mark approved
    await client.query(
      'UPDATE ad_hoc_field_proposals SET status = $1, reviewed_at = NOW() WHERE id = $2',
      ['approved', id]
    );

    await client.query('COMMIT');
    res.json({ ok: true, message: 'Approved and merged into template' });
  } catch (e: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

router.post('/:id/reject', async (req: Request, res: Response) => {
  const { id } = req.params;
  await pool.query('UPDATE ad_hoc_field_proposals SET status = $1, reviewed_at = NOW() WHERE id = $2', ['rejected', id]);
  res.json({ ok: true });
});

export default router;
