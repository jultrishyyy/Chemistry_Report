import { Router, Request, Response } from 'express';
import { actorHasPermission } from '../services/template-versions.js';

import { pool } from '../db.js';

const router = Router();

function readActor(req: Request) {
  // HTTP 头按 Latin-1 解读，前端发来的是 URL 编码的 UTF-8，这里解回来
  const rawName = (req.header('X-Demo-User') || '').trim();
  let name = rawName;
  try { name = decodeURIComponent(rawName); } catch { /* fallback to raw */ }
  const role = (req.header('X-Demo-Role') || '').trim();
  return { name, role };
}

/** 写一条审核日志（版本流水）。所有写路径都走它。 */
async function writeAuditLog(opts: {
  recordId: number;
  orderNo: string | null;
  action: 'submit' | 'update' | 'review' | 'reject';
  actorName: string;
  actorRole: string;
  versionNo: number;
  dataSnapshot: Record<string, any>;
  statusAfter: string;
  note?: string | null;
}) {
  await pool.query(
    `INSERT INTO record_audit_log
       (record_id, order_no, action, actor_name, actor_role, note,
        version_no, data_snapshot, status_after)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
    [
      opts.recordId, opts.orderNo, opts.action, opts.actorName, opts.actorRole,
      opts.note || null,
      opts.versionNo, JSON.stringify(opts.dataSnapshot), opts.statusAfter,
    ]
  );
}

router.get('/', async (req: Request, res: Response) => {
  const { template_id, order_no } = req.query;
  let query = `SELECT id, template_id, template_version, template_version_id,
                      order_no, sample_external_id, test_item_name,
                      tester_name, tested_at, reviewer_name, reviewed_at, audit_status,
                      current_version, reject_note,
                      submitted_at, updated_at FROM record_data`;
  const conds: string[] = [];
  const params: any[] = [];
  if (template_id) { params.push(template_id); conds.push(`template_id = $${params.length}`); }
  if (order_no)    { params.push(order_no);    conds.push(`order_no = $${params.length}`); }
  if (conds.length) query += ' WHERE ' + conds.join(' AND ');
  query += ' ORDER BY updated_at DESC';
  const result = await pool.query(query, params);
  res.json(result.rows);
});

router.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await pool.query('SELECT * FROM record_data WHERE id = $1', [id]);
  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Record not found' });
    return;
  }
  res.json(result.rows[0]);
});

router.post('/', async (req: Request, res: Response) => {
  const {
    template_id, template_version, template_version_id: bodyVersionId,
    raw_data, derived_data, ad_hoc_fields,
    order_no, sample_external_id, test_item_name,
  } = req.body;
  if (!template_id || !raw_data) {
    res.status(400).json({ error: 'template_id and raw_data are required' });
    return;
  }
  const actor = readActor(req);
  if (!actor.name) { res.status(401).json({ error: '未登录或缺少 X-Demo-User 头' }); return; }

  // 保存为草稿（status='draft'）还是提交审核（默认 'pending'）。草稿不进审核队列。
  const status: 'draft' | 'pending' = req.body.status === 'draft' ? 'draft' : 'pending';

  // 解析 template_version_id：客户端没传则取 template 当前生效版本（必须是 approved，避免 draft 被录入）
  let versionId: number | null = bodyVersionId || null;
  if (!versionId) {
    const cv = await pool.query(
      `SELECT t.current_version_id, v.status
       FROM record_templates t LEFT JOIN record_template_versions v ON v.id = t.current_version_id
       WHERE t.id = $1`, [template_id]
    );
    if (!cv.rows.length) { res.status(404).json({ error: '模板不存在' }); return; }
    if (!cv.rows[0].current_version_id) { res.status(400).json({ error: '模板尚无生效版本' }); return; }
    if (cv.rows[0].status !== 'approved') {
      res.status(400).json({ error: `模板版本状态为 ${cv.rows[0].status}，不可录入` }); return;
    }
    versionId = cv.rows[0].current_version_id;
  }

  const hasContext = !!(order_no && sample_external_id && test_item_name);
  const existingQ = hasContext
    ? `SELECT id, current_version, audit_status FROM record_data
         WHERE template_id = $1 AND order_no = $2 AND sample_external_id = $3 AND test_item_name = $4
         ORDER BY id ASC LIMIT 1`
    : `SELECT id, current_version, audit_status FROM record_data WHERE template_id = $1 AND order_no IS NULL ORDER BY id ASC LIMIT 1`;
  const existingP = hasContext
    ? [template_id, order_no, sample_external_id, test_item_name]
    : [template_id];
  const existing = await pool.query(existingQ, existingP);

  const snapshot = { ...raw_data, ...(derived_data || {}) };

  if (existing.rows.length > 0) {
    // 审核通过后锁定：已 reviewed 的记录不能直接改（保证与已出报告/已审数据一致）。
    // 如需修改：报告端「退回原始记录」会把它置回 rejected 后才可编辑。
    if (existing.rows[0].audit_status === 'reviewed') {
      res.status(409).json({ error: '该记录已审核通过、已锁定，不能修改；如需修改请在报告生成处「退回原始记录」' }); return;
    }
    const recId = existing.rows[0].id;
    const nextVersion = (existing.rows[0].current_version || 1) + 1;
    const updated = await pool.query(
      `UPDATE record_data SET raw_data = $1, derived_data = $2, ad_hoc_fields = $3,
        template_version = COALESCE($4, template_version),
        template_version_id = $5,
        order_no = COALESCE($6, order_no),
        sample_external_id = COALESCE($7, sample_external_id),
        test_item_name = COALESCE($8, test_item_name),
        tester_name = $9, tested_at = NOW(),
        reviewer_name = NULL, reviewed_at = NULL, audit_status = $12,
        reject_note = NULL,
        current_version = $10,
        updated_at = NOW()
       WHERE id = $11 RETURNING *`,
      [
        JSON.stringify(raw_data),
        JSON.stringify(derived_data || {}),
        JSON.stringify(ad_hoc_fields || []),
        template_version || null,
        versionId,
        order_no || null,
        sample_external_id || null,
        test_item_name || null,
        actor.name,
        nextVersion,
        recId,
        status,
      ]
    );
    await writeAuditLog({
      recordId: recId, orderNo: order_no || null,
      action: 'update', actorName: actor.name, actorRole: actor.role || 'test_engineer',
      versionNo: nextVersion, dataSnapshot: snapshot, statusAfter: status,
      note: status === 'draft' ? '保存草稿' : undefined,
    });
    res.status(200).json(updated.rows[0]);
    return;
  }

  const inserted = await pool.query(
    `INSERT INTO record_data
       (template_id, template_version, template_version_id, raw_data, derived_data, ad_hoc_fields,
        order_no, sample_external_id, test_item_name,
        tester_name, tested_at, audit_status, current_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11, 1) RETURNING *`,
    [
      template_id, template_version || 1, versionId,
      JSON.stringify(raw_data),
      JSON.stringify(derived_data || {}),
      JSON.stringify(ad_hoc_fields || []),
      order_no || null, sample_external_id || null, test_item_name || null,
      actor.name, status,
    ]
  );
  await writeAuditLog({
    recordId: inserted.rows[0].id, orderNo: order_no || null,
    action: status === 'draft' ? 'update' : 'submit', actorName: actor.name, actorRole: actor.role || 'test_engineer',
    versionNo: 1, dataSnapshot: snapshot, statusAfter: status,
    note: status === 'draft' ? '创建草稿' : undefined,
  });
  res.status(201).json(inserted.rows[0]);
});

/**
 * 单独上传/更新某条记录的【图片字段】（与完整数据录入解耦：详情页「上传图片」按钮、移动端拍照页都走这里）。
 * 只合并指定 field_code 的图片数组，不动其它字段；找不到对应记录则新建（图片可先于数据录入）。
 * 图片属于原始记录 ⇒ 视为数据变更：重置 audit_status=pending 并写审计。
 * ⚠️ 必须注册在 `PUT /:id` 之前，否则 'images' 会被当成 :id。
 * body：{ template_id, order_no?, sample_external_id?, test_item_name?, field_code, images: [] }
 */
router.put('/images', async (req: Request, res: Response) => {
  const { template_id, order_no, sample_external_id, test_item_name, field_code, images } = req.body;
  if (!template_id || !field_code || !Array.isArray(images)) {
    res.status(400).json({ error: 'template_id、field_code、images(数组) 必填' }); return;
  }
  const actor = readActor(req);
  if (!actor.name) { res.status(401).json({ error: '未登录或缺少 X-Demo-User 头' }); return; }

  // 取生效版本（必须 approved）
  const cv = await pool.query(
    `SELECT t.current_version_id, v.status
     FROM record_templates t LEFT JOIN record_template_versions v ON v.id = t.current_version_id
     WHERE t.id = $1`, [template_id]
  );
  if (!cv.rows.length) { res.status(404).json({ error: '模板不存在' }); return; }
  if (!cv.rows[0].current_version_id) { res.status(400).json({ error: '模板尚无生效版本' }); return; }
  if (cv.rows[0].status !== 'approved') { res.status(400).json({ error: `模板版本状态为 ${cv.rows[0].status}，不可录入` }); return; }
  const versionId = cv.rows[0].current_version_id;

  const hasContext = !!(order_no && sample_external_id && test_item_name);
  const existing = await pool.query(
    hasContext
      ? `SELECT id, current_version, raw_data, audit_status FROM record_data
           WHERE template_id=$1 AND order_no=$2 AND sample_external_id=$3 AND test_item_name=$4 ORDER BY id ASC LIMIT 1`
      : `SELECT id, current_version, raw_data, audit_status FROM record_data WHERE template_id=$1 AND order_no IS NULL ORDER BY id ASC LIMIT 1`,
    hasContext ? [template_id, order_no, sample_external_id, test_item_name] : [template_id]
  );

  if (existing.rows.length) {
    const row = existing.rows[0];
    if (row.audit_status === 'reviewed') {
      res.status(409).json({ error: '该记录已审核通过、已锁定，不能修改图片；如需修改请在报告生成处「退回原始记录」' }); return;
    }
    const raw = { ...(row.raw_data || {}), [field_code]: images };
    const nextVersion = (row.current_version || 1) + 1;
    const updated = await pool.query(
      `UPDATE record_data SET raw_data=$1, tester_name=$2, tested_at=NOW(),
         reviewer_name=NULL, reviewed_at=NULL, audit_status='pending', reject_note=NULL,
         current_version=$3, updated_at=NOW()
       WHERE id=$4 RETURNING *`,
      [JSON.stringify(raw), actor.name, nextVersion, row.id]
    );
    await writeAuditLog({
      recordId: row.id, orderNo: order_no || null, action: 'update',
      actorName: actor.name, actorRole: actor.role || 'test_engineer',
      versionNo: nextVersion, dataSnapshot: raw, statusAfter: 'pending',
      note: '上传/更新图片',
    });
    res.json(updated.rows[0]);
    return;
  }

  const raw = { [field_code]: images };
  const inserted = await pool.query(
    `INSERT INTO record_data
       (template_id, template_version, template_version_id, raw_data, derived_data, ad_hoc_fields,
        order_no, sample_external_id, test_item_name, tester_name, tested_at, audit_status, current_version)
     VALUES ($1, 1, $2, $3, '{}'::jsonb, '[]'::jsonb, $4, $5, $6, $7, NOW(), 'pending', 1) RETURNING *`,
    [template_id, versionId, JSON.stringify(raw), order_no || null, sample_external_id || null, test_item_name || null, actor.name]
  );
  await writeAuditLog({
    recordId: inserted.rows[0].id, orderNo: order_no || null, action: 'submit',
    actorName: actor.name, actorRole: actor.role || 'test_engineer',
    versionNo: 1, dataSnapshot: raw, statusAfter: 'pending', note: '上传图片（新建记录）',
  });
  res.status(201).json(inserted.rows[0]);
});

router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { raw_data, derived_data, ad_hoc_fields } = req.body;
  const status: 'draft' | 'pending' = req.body.status === 'draft' ? 'draft' : 'pending';
  const actor = readActor(req);
  if (!actor.name) { res.status(401).json({ error: '未登录或缺少 X-Demo-User 头' }); return; }
  const cur = await pool.query('SELECT current_version, audit_status FROM record_data WHERE id = $1', [id]);
  if (!cur.rows.length) { res.status(404).json({ error: 'Record not found' }); return; }
  if (cur.rows[0].audit_status === 'reviewed') {
    res.status(409).json({ error: '该记录已审核通过、已锁定，不能修改；如需修改请在报告生成处「退回原始记录」' }); return;
  }
  const nextVersion = (cur.rows[0].current_version || 1) + 1;
  const result = await pool.query(
    `UPDATE record_data SET raw_data = COALESCE($1, raw_data), derived_data = COALESCE($2, derived_data),
       ad_hoc_fields = COALESCE($3, ad_hoc_fields),
       tester_name = $4, tested_at = NOW(),
       reviewer_name = NULL, reviewed_at = NULL, audit_status = $7, reject_note = NULL,
       current_version = $5,
       updated_at = NOW()
     WHERE id = $6 RETURNING *`,
    [
      raw_data ? JSON.stringify(raw_data) : null,
      derived_data ? JSON.stringify(derived_data) : null,
      ad_hoc_fields ? JSON.stringify(ad_hoc_fields) : null,
      actor.name,
      nextVersion,
      id,
      status,
    ]
  );
  const row = result.rows[0];
  const snapshot = { ...(row.raw_data || {}), ...(row.derived_data || {}) };
  await writeAuditLog({
    recordId: row.id, orderNo: row.order_no,
    action: 'update', actorName: actor.name, actorRole: actor.role || 'test_engineer',
    versionNo: nextVersion, dataSnapshot: snapshot, statusAfter: status,
    note: status === 'draft' ? '保存草稿' : '更新数据并提交审核',
  });
  res.json(row);
});

/** 提交审核：草稿 / 被退回 → 待审核（详情页主检用，数据已存，只做状态流转） */
router.post('/:id/submit', async (req: Request, res: Response) => {
  const { id } = req.params;
  const actor = readActor(req);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  const cur = await pool.query(
    'SELECT id, audit_status, order_no, raw_data, derived_data, current_version FROM record_data WHERE id = $1', [id]
  );
  if (!cur.rows.length) { res.status(404).json({ error: 'Record not found' }); return; }
  const row = cur.rows[0];
  if (row.audit_status !== 'draft' && row.audit_status !== 'rejected') {
    res.status(400).json({ error: '只有草稿或被退回的记录可以提交审核' }); return;
  }
  const nextVersion = (row.current_version || 1) + 1;
  const updated = await pool.query(
    `UPDATE record_data SET audit_status='pending', reject_note=NULL, current_version=$1, updated_at=NOW()
     WHERE id=$2 RETURNING *`, [nextVersion, id]
  );
  await writeAuditLog({
    recordId: row.id, orderNo: row.order_no, action: 'submit',
    actorName: actor.name, actorRole: actor.role || 'test_engineer',
    versionNo: nextVersion, dataSnapshot: { ...(row.raw_data || {}), ...(row.derived_data || {}) },
    statusAfter: 'pending', note: '提交审核',
  });
  res.json(updated.rows[0]);
});

/** 撤回：待审核 → 草稿（主检撤回自己提交的、尚未被审的记录） */
router.post('/:id/withdraw', async (req: Request, res: Response) => {
  const { id } = req.params;
  const actor = readActor(req);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  const cur = await pool.query(
    'SELECT id, audit_status, order_no, raw_data, derived_data, current_version FROM record_data WHERE id = $1', [id]
  );
  if (!cur.rows.length) { res.status(404).json({ error: 'Record not found' }); return; }
  const row = cur.rows[0];
  if (row.audit_status !== 'pending') {
    res.status(400).json({ error: '只有待审核的记录可以撤回' }); return;
  }
  const nextVersion = (row.current_version || 1) + 1;
  const updated = await pool.query(
    `UPDATE record_data SET audit_status='draft', current_version=$1, updated_at=NOW()
     WHERE id=$2 RETURNING *`, [nextVersion, id]
  );
  await writeAuditLog({
    recordId: row.id, orderNo: row.order_no, action: 'update',
    actorName: actor.name, actorRole: actor.role || 'test_engineer',
    versionNo: nextVersion, dataSnapshot: { ...(row.raw_data || {}), ...(row.derived_data || {}) },
    statusAfter: 'draft', note: '撤回审核（回到草稿）',
  });
  res.json(updated.rows[0]);
});

/** 审核：decision = approve | reject。reject 必须带 note */
router.post('/:id/review', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { decision, note } = req.body || {};
  const actor = readActor(req);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  if (!actorHasPermission(req, 'record.review')) { res.status(403).json({ error: '当前用户无审核权限（需测试主管）' }); return; }
  if (decision !== 'approve' && decision !== 'reject') {
    res.status(400).json({ error: 'decision 必须是 approve 或 reject' }); return;
  }
  if (decision === 'reject' && !(note && String(note).trim())) {
    res.status(400).json({ error: '退回必须填写备注' }); return;
  }

  const cur = await pool.query(
    'SELECT id, audit_status, tester_name, order_no, raw_data, derived_data, current_version FROM record_data WHERE id = $1', [id]
  );
  if (!cur.rows.length) { res.status(404).json({ error: 'Record not found' }); return; }
  const row = cur.rows[0];
  // 允许自审：主检可审核自己的记录（取消"主检与审核人不能为同一人"限制）
  if (row.audit_status !== 'pending') {
    res.status(400).json({
      error: row.audit_status === 'draft' ? '该记录还是草稿，未提交审核'
        : row.audit_status === 'reviewed' ? '该记录已审核通过'
          : '该记录不在待审核状态',
    }); return;
  }

  const snapshot = { ...(row.raw_data || {}), ...(row.derived_data || {}) };
  const nextVersion = (row.current_version || 1) + 1;

  if (decision === 'approve') {
    const updated = await pool.query(
      `UPDATE record_data SET reviewer_name = $1, reviewed_at = NOW(), audit_status = 'reviewed',
         reject_note = NULL, current_version = $2, updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [actor.name, nextVersion, id]
    );
    await writeAuditLog({
      recordId: row.id, orderNo: row.order_no,
      action: 'review', actorName: actor.name, actorRole: actor.role || 'test_supervisor',
      versionNo: nextVersion, dataSnapshot: snapshot, statusAfter: 'reviewed',
      note: note || null,
    });
    // 退回闭环（P-Flow-1）：数据重审通过后，引用它的已生成报告标 stale（源数据已更新，建议重新生成），
    // 并自动解决该记录的待返工工单。
    await pool.query(
      `UPDATE reports SET stale = true WHERE $1 = ANY(record_data_ids)`, [row.id]
    );
    await pool.query(
      `UPDATE rework_tickets SET status = 'resolved', resolved_by_name = $1, resolved_at = NOW(),
         resolution_note = COALESCE(resolution_note, '数据重审通过，自动关单')
       WHERE record_data_id = $2 AND target_stage = 'data_entry' AND status <> 'resolved'`,
      [actor.name, row.id]
    );
    res.json(updated.rows[0]);
    return;
  }

  // reject
  const updated = await pool.query(
    `UPDATE record_data SET audit_status = 'rejected', reject_note = $1,
       reviewer_name = NULL, reviewed_at = NULL,
       current_version = $2, updated_at = NOW()
     WHERE id = $3 RETURNING *`,
    [note, nextVersion, id]
  );
  await writeAuditLog({
    recordId: row.id, orderNo: row.order_no,
    action: 'reject', actorName: actor.name, actorRole: actor.role || 'test_supervisor',
    versionNo: nextVersion, dataSnapshot: snapshot, statusAfter: 'rejected',
    note: note,
  });
  res.json(updated.rows[0]);
});

export default router;
