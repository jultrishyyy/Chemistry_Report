import { Router, type Request, type Response } from 'express';
import { pool } from '../db.js';
import { requirePermission } from './auth.js';
import { actorHasPermission } from '../services/template-versions.js';
import { validateDeviceReferences, validateRecordConclusions, writeAuditLog } from './record-data.js';
import type { FieldGroup } from '../../../shared/types.js';
import { notifyCompletedTasksForRecords, type TaskStateSyncResult } from '../services/external-task-state.js';

const router: Router = Router();

function actor(req: Request) {
  const raw = (req.header('X-Demo-User') || '').trim();
  let name = raw; try { name = decodeURIComponent(raw); } catch { /* keep raw */ }
  const role = (req.header('X-Demo-Role') || '').trim();
  const roles = (req.header('X-Demo-Roles') || role).split(',').map(value => value.trim()).filter(Boolean);
  return { name, role, roles, jobNo: (req.header('X-User-Job') || '').trim() };
}

router.get('/', async (req: Request, res: Response) => {
  const values: any[] = [];
  const where: string[] = [];
  for (const [queryKey, column] of [['order_no', 'b.order_no'], ['sample_external_id', 'b.sample_external_id'], ['test_item_name', 'b.test_item_name']] as const) {
    if (req.query[queryKey]) { values.push(String(req.query[queryKey])); where.push(`${column}=$${values.length}`); }
  }
  const result = await pool.query(
    `SELECT b.*, g.name AS template_group_name, COUNT(i.id)::int AS record_count
       FROM record_batches b
       LEFT JOIN test_template_groups g ON g.id=b.template_group_id
       LEFT JOIN record_batch_items i ON i.batch_id=b.id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      GROUP BY b.id,g.name ORDER BY b.updated_at DESC`, values,
  );
  res.json(result.rows);
});

router.get('/:id', async (req: Request, res: Response) => {
  const result = await pool.query(
    `SELECT b.*, g.name AS template_group_name,
            COALESCE(json_agg(json_build_object(
              'item_id', i.id, 'method_scheme_id', i.method_scheme_id,
              'method_code', m.method_code, 'method_name', m.method_name,
              'record_data_id', r.id, 'record_template_id', r.template_id,
              'record_template_name', rt.name, 'audit_status', r.audit_status,
              'item_status', i.item_status, 'cancelled_by_name', i.cancelled_by_name,
              'cancelled_at', i.cancelled_at, 'cancel_reason', i.cancel_reason,
              'report_project_template_id', m.report_project_template_id,
              'report_project_name', m.report_project_name, 'sort_order', i.sort_order
            ) ORDER BY i.sort_order,i.id) FILTER (WHERE i.id IS NOT NULL), '[]'::json) AS items
       FROM record_batches b
       LEFT JOIN test_template_groups g ON g.id=b.template_group_id
       LEFT JOIN record_batch_items i ON i.batch_id=b.id
       LEFT JOIN test_method_schemes m ON m.id=i.method_scheme_id
       LEFT JOIN record_data r ON r.id=i.record_data_id
       LEFT JOIN record_templates rt ON rt.id=r.template_id
      WHERE b.id=$1 GROUP BY b.id,g.name`, [Number(req.params.id)],
  );
  if (!result.rows.length) { res.status(404).json({ error: '录入批次不存在' }); return; }
  res.json(result.rows[0]);
});

/** 一次选择多种测试方法，为每个方法建立独立 record_data，并挂到同一录入批次。 */
router.post('/', requirePermission('record.entry'), async (req: Request, res: Response) => {
  const who = actor(req);
  const { order_no, sample_external_id, test_item_name, template_group_id, method_scheme_ids, shared_data } = req.body || {};
  const ids = [...new Set((Array.isArray(method_scheme_ids) ? method_scheme_ids : []).map(Number).filter(Number.isFinite))];
  if (!order_no || !sample_external_id || !test_item_name || !ids.length) {
    res.status(400).json({ error: '委托单、样品、项目和至少一种测试方法必填' }); return;
  }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const existingBatch = await db.query(
      `SELECT id,audit_status FROM record_batches
        WHERE order_no=$1 AND sample_external_id=$2 AND test_item_name=$3
        ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [order_no, sample_external_id, test_item_name],
    );
    if (existingBatch.rows.length) {
      throw Object.assign(new Error(`该样品项目已有录入批次 #${existingBatch.rows[0].id}，请在现有批次中继续录入`), { status: 409 });
    }
    const schemes = await db.query(
      `SELECT m.*, t.current_version_id, v.status AS version_status, g.shared_profile_code
         FROM test_method_schemes m
         JOIN test_template_groups g ON g.id=m.group_id
         JOIN record_templates t ON t.id=m.record_template_id AND t.archived_at IS NULL
         JOIN record_template_versions v ON v.id=t.current_version_id
        WHERE m.id=ANY($1) AND m.enabled=TRUE ORDER BY m.sort_order,m.id`, [ids],
    );
    if (schemes.rows.length !== ids.length) throw Object.assign(new Error('部分测试方法不存在、已停用或原始记录模板未生效'), { status: 400 });
    if (schemes.rows.some(row => row.version_status !== 'approved')) throw Object.assign(new Error('部分原始记录模板尚未审核通过'), { status: 400 });
    const groups = new Set(schemes.rows.map(row => Number(row.group_id)));
    if (template_group_id && !groups.has(Number(template_group_id))) throw Object.assign(new Error('所选测试方法与项目组不一致'), { status: 400 });
    const primaryGroup = template_group_id ? Number(template_group_id) : Number(schemes.rows[0].group_id);
    const profileCodes = new Set(schemes.rows.map(row => String(row.shared_profile_code || 'default')));
    if (profileCodes.size > 1) throw Object.assign(new Error('所选方法使用不同公共信息方案，不能在同一批次共享字段'), { status: 409 });
    const inserted = await db.query(
      `INSERT INTO record_batches
       (order_no,sample_external_id,test_item_name,template_group_id,shared_profile_code,shared_data,audit_status,tester_name,tested_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,'draft',$7,NOW()) RETURNING *`,
      [order_no, sample_external_id, test_item_name, primaryGroup, [...profileCodes][0], JSON.stringify(shared_data || {}), who.name],
    );
    const batch = inserted.rows[0];
    for (let index = 0; index < schemes.rows.length; index++) {
      const scheme = schemes.rows[index];
      const existing = await db.query(
        `SELECT id,record_batch_id,audit_status FROM record_data
          WHERE template_id=$1 AND order_no=$2 AND sample_external_id=$3 AND test_item_name=$4
          ORDER BY id DESC LIMIT 1`, [scheme.record_template_id, order_no, sample_external_id, test_item_name],
      );
      let recordId: number;
      if (existing.rows.length) {
        if (existing.rows[0].record_batch_id) throw Object.assign(new Error(`方法“${scheme.method_name}”已有所属录入批次`), { status: 409 });
        if (existing.rows[0].audit_status === 'reviewed') throw Object.assign(new Error(`方法“${scheme.method_name}”已有审核通过记录，不能并入新批次`), { status: 409 });
        recordId = Number(existing.rows[0].id);
        await db.query('UPDATE record_data SET record_batch_id=$1 WHERE id=$2', [batch.id, recordId]);
      } else {
        const record = await db.query(
          `INSERT INTO record_data
           (template_id,template_version,template_version_id,raw_data,derived_data,ad_hoc_fields,
            order_no,sample_external_id,test_item_name,tester_name,tested_at,audit_status,current_version,record_batch_id)
           VALUES ($1,1,$2,'{}'::jsonb,'{}'::jsonb,'[]'::jsonb,$3,$4,$5,$6,NOW(),'draft',1,$7) RETURNING id`,
          [scheme.record_template_id, scheme.current_version_id, order_no, sample_external_id, test_item_name, who.name, batch.id],
        );
        recordId = Number(record.rows[0].id);
      }
      await db.query(
        `INSERT INTO record_batch_items (batch_id,method_scheme_id,record_data_id,sort_order) VALUES ($1,$2,$3,$4)`,
        [batch.id, scheme.id, recordId, index],
      );
    }
    // 同步订单项目的模板关联集合，让现有订单详情/任务列表无需新分支即可显示这批独立原始记录。
    const workOrder = await db.query('SELECT payload FROM work_orders WHERE order_no=$1 FOR UPDATE', [order_no]);
    if (workOrder.rows.length) {
      const payload = workOrder.rows[0].payload || {};
      const sample = (Array.isArray(payload.samples) ? payload.samples : []).find((item: any) => String(item.id) === String(sample_external_id));
      const test = (sample?.test_infos || []).find((item: any) => String(item.name) === String(test_item_name));
      if (test) {
        const linked = new Set<number>(Array.isArray(test.linked_template_ids)
          ? test.linked_template_ids.map(Number)
          : test.linked_template_id ? [Number(test.linked_template_id)] : []);
        schemes.rows.forEach(row => linked.add(Number(row.record_template_id)));
        test.linked_template_ids = [...linked]; delete test.linked_template_id;
        await db.query('UPDATE work_orders SET payload=$1::jsonb,updated_at=NOW() WHERE order_no=$2', [JSON.stringify(payload), order_no]);
      }
    }
    await db.query('COMMIT');
    const detail = await pool.query('SELECT * FROM record_batches WHERE id=$1', [batch.id]);
    res.status(201).json(detail.rows[0]);
  } catch (error: any) {
    await db.query('ROLLBACK');
    res.status(error.status || 500).json({ error: error.message });
  } finally { db.release(); }
});

/** 录入过程中向现有批次追加测试方法；待审或已有部分通过时必须先完成相应退回流程。 */
router.post('/:id/methods', requirePermission('record.entry'), async (req: Request, res: Response) => {
  const who = actor(req); const batchId = Number(req.params.id);
  const ids = [...new Set((Array.isArray(req.body?.method_scheme_ids) ? req.body.method_scheme_ids : []).map(Number).filter(Number.isFinite))];
  if (!ids.length) { res.status(400).json({ error: '至少选择一种要追加的测试方法' }); return; }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const batchResult = await db.query('SELECT * FROM record_batches WHERE id=$1 FOR UPDATE', [batchId]);
    if (!batchResult.rows.length) throw Object.assign(new Error('录入批次不存在'), { status: 404 });
    const batch = batchResult.rows[0];
    if (!['draft', 'rejected'].includes(batch.audit_status)) throw Object.assign(new Error('只有草稿或已退回批次可以追加测试方法'), { status: 409 });
    const approved = await db.query(`SELECT 1 FROM record_data WHERE record_batch_id=$1 AND audit_status='reviewed' LIMIT 1`, [batchId]);
    if (approved.rows.length) throw Object.assign(new Error('批次已有部分原始记录审核通过，不能直接追加方法；请先由审核员将整个批次退回'), { status: 409 });
    const schemes = await db.query(
      `SELECT m.*,t.current_version_id,v.status AS version_status,g.shared_profile_code
         FROM test_method_schemes m
         JOIN test_template_groups g ON g.id=m.group_id
         JOIN record_templates t ON t.id=m.record_template_id AND t.archived_at IS NULL
         JOIN record_template_versions v ON v.id=t.current_version_id
        WHERE m.id=ANY($1) AND m.enabled=TRUE ORDER BY m.sort_order,m.id`, [ids],
    );
    if (schemes.rows.length !== ids.length || schemes.rows.some(row => row.version_status !== 'approved')) {
      throw Object.assign(new Error('部分测试方法不存在、已停用或原始记录模板未审核通过'), { status: 400 });
    }
    if (schemes.rows.some(row => String(row.shared_profile_code || 'default') !== String(batch.shared_profile_code || 'default'))) {
      throw Object.assign(new Error('所选方法与当前批次的公共信息方案不兼容'), { status: 409 });
    }
    const existingMethods = await db.query('SELECT method_scheme_id FROM record_batch_items WHERE batch_id=$1', [batchId]);
    const used = new Set(existingMethods.rows.map(row => Number(row.method_scheme_id)));
    if (schemes.rows.some(row => used.has(Number(row.id)))) throw Object.assign(new Error('所选测试方法已在当前批次中'), { status: 409 });
    const orderResult = await db.query('SELECT payload FROM work_orders WHERE order_no=$1 FOR UPDATE', [batch.order_no]);
    let nextSortResult = await db.query('SELECT COALESCE(MAX(sort_order),-1)+1 AS next_sort FROM record_batch_items WHERE batch_id=$1', [batchId]);
    let nextSort = Number(nextSortResult.rows[0]?.next_sort || 0);
    for (const scheme of schemes.rows) {
      const existing = await db.query(
        `SELECT id,record_batch_id,audit_status FROM record_data
          WHERE template_id=$1 AND order_no=$2 AND sample_external_id=$3 AND test_item_name=$4
          ORDER BY id DESC LIMIT 1`,
        [scheme.record_template_id, batch.order_no, batch.sample_external_id, batch.test_item_name],
      );
      let recordId: number;
      if (existing.rows.length) {
        if (existing.rows[0].record_batch_id && Number(existing.rows[0].record_batch_id) !== batchId) throw Object.assign(new Error(`方法“${scheme.method_name}”已有所属录入批次`), { status: 409 });
        if (existing.rows[0].audit_status === 'reviewed') throw Object.assign(new Error(`方法“${scheme.method_name}”已有审核通过记录`), { status: 409 });
        recordId = Number(existing.rows[0].id);
        await db.query(`UPDATE record_data SET record_batch_id=$1,updated_at=NOW() WHERE id=$2`, [batchId, recordId]);
      } else {
        const inserted = await db.query(
          `INSERT INTO record_data
           (template_id,template_version,template_version_id,raw_data,derived_data,ad_hoc_fields,
            order_no,sample_external_id,test_item_name,tester_name,tested_at,audit_status,current_version,record_batch_id)
           VALUES ($1,1,$2,'{}'::jsonb,'{}'::jsonb,'[]'::jsonb,$3,$4,$5,$6,NOW(),'draft',1,$7) RETURNING id`,
          [scheme.record_template_id, scheme.current_version_id, batch.order_no, batch.sample_external_id, batch.test_item_name, who.name, batchId],
        );
        recordId = Number(inserted.rows[0].id);
      }
      await db.query(`INSERT INTO record_batch_items (batch_id,method_scheme_id,record_data_id,sort_order) VALUES ($1,$2,$3,$4)`, [batchId, scheme.id, recordId, nextSort++]);
    }
    if (orderResult.rows.length) {
      const payload = orderResult.rows[0].payload || {};
      const sample = (Array.isArray(payload.samples) ? payload.samples : []).find((item: any) => String(item.id) === String(batch.sample_external_id));
      const test = (sample?.test_infos || []).find((item: any) => String(item.name) === String(batch.test_item_name));
      if (test) {
        const linked = new Set<number>(Array.isArray(test.linked_template_ids) ? test.linked_template_ids.map(Number) : test.linked_template_id ? [Number(test.linked_template_id)] : []);
        schemes.rows.forEach(row => linked.add(Number(row.record_template_id)));
        test.linked_template_ids = [...linked]; delete test.linked_template_id;
        await db.query('UPDATE work_orders SET payload=$1::jsonb,updated_at=NOW() WHERE order_no=$2', [JSON.stringify(payload), batch.order_no]);
      }
    }
    await db.query('UPDATE record_batches SET current_version=current_version+1,updated_at=NOW() WHERE id=$1', [batchId]);
    await db.query('COMMIT');
    res.status(201).json({ ok: true, batch_id: batchId, added_method_scheme_ids: ids });
  } catch (error: any) {
    await db.query('ROLLBACK'); res.status(error.status || 500).json({ error: error.message });
  } finally { db.release(); }
});

/** 停做某种方法：逻辑取消并保留原始记录、数据、附件和审计链。 */
router.post('/:id/methods/:methodSchemeId/cancel', requirePermission('record.entry'), async (req: Request, res: Response) => {
  const who = actor(req); const batchId = Number(req.params.id); const methodSchemeId = Number(req.params.methodSchemeId);
  const reason = String(req.body?.reason || '').trim();
  if (!reason) { res.status(400).json({ error: '取消检测必须填写原因' }); return; }
  const db = await pool.connect();
  let auditRow: any = null;
  try {
    await db.query('BEGIN');
    const result = await db.query(
      `SELECT b.audit_status AS batch_status,b.order_no,b.shared_data,
              i.id AS item_id,i.item_status,r.id AS record_data_id,r.audit_status AS record_status,
              r.raw_data,r.derived_data,r.current_version,m.method_name
         FROM record_batches b
         JOIN record_batch_items i ON i.batch_id=b.id
         JOIN record_data r ON r.id=i.record_data_id
         LEFT JOIN test_method_schemes m ON m.id=i.method_scheme_id
        WHERE b.id=$1 AND i.method_scheme_id=$2 FOR UPDATE OF b,i,r`, [batchId, methodSchemeId],
    );
    if (!result.rows.length) throw Object.assign(new Error('该测试方法不属于当前录入批次'), { status: 404 });
    const row = result.rows[0]; auditRow = row;
    if (row.item_status === 'cancelled') throw Object.assign(new Error('该测试方法已经标记为取消检测'), { status: 409 });
    if (!['draft', 'rejected'].includes(row.batch_status)) throw Object.assign(new Error('只有草稿或整批退回阶段可以取消测试方法'), { status: 409 });
    if (['pending', 'reviewed'].includes(row.record_status)) throw Object.assign(new Error('待审核或已通过记录不能直接取消，请先完成退回'), { status: 409 });
    const nextVersion = Number(row.current_version || 1) + 1;
    await db.query(
      `UPDATE record_batch_items SET item_status='cancelled',cancelled_by_name=$1,cancelled_at=NOW(),cancel_reason=$2 WHERE id=$3`,
      [who.name, reason, row.item_id],
    );
    await db.query(
      `UPDATE record_data SET cancelled_by_name=$1,cancelled_at=NOW(),cancel_reason=$2,current_version=$3,updated_at=NOW() WHERE id=$4`,
      [who.name, reason, nextVersion, row.record_data_id],
    );
    await db.query('UPDATE record_batches SET current_version=current_version+1,updated_at=NOW() WHERE id=$1', [batchId]);
    await syncBatchStatus(db, batchId);
    await db.query('COMMIT');
    await writeAuditLog({
      recordId: row.record_data_id, orderNo: row.order_no, action: 'update', actorName: who.name,
      actorRole: who.role || 'test_engineer', versionNo: nextVersion,
      dataSnapshot: { ...(row.shared_data || {}), ...(row.raw_data || {}), ...(row.derived_data || {}) },
      statusAfter: 'cancelled', note: `取消检测：${reason}`,
    });
    res.json({ ok: true, batch_id: batchId, method_scheme_id: methodSchemeId, record_data_id: row.record_data_id, item_status: 'cancelled' });
  } catch (error: any) {
    await db.query('ROLLBACK'); res.status(error.status || 500).json({ error: error.message });
  } finally { db.release(); }
});

router.put('/:id/shared-data', requirePermission('record.entry'), async (req: Request, res: Response) => {
  const approved = await pool.query(
    `SELECT 1 FROM record_data WHERE record_batch_id=$1 AND audit_status='reviewed' LIMIT 1`,
    [Number(req.params.id)],
  );
  if (approved.rows.length) {
    res.status(409).json({ error: '批次已有部分原始记录审核通过，公共字段已锁定；如需修改公共字段，请由审核员将整个批次退回' }); return;
  }
  const result = await pool.query(
    `UPDATE record_batches SET shared_data=$1::jsonb,current_version=current_version+1,updated_at=NOW()
      WHERE id=$2 AND audit_status IN ('draft','rejected') RETURNING *`,
    [JSON.stringify(req.body?.shared_data || {}), Number(req.params.id)],
  );
  if (!result.rows.length) { res.status(409).json({ error: '批次不存在，或当前状态不可修改公共信息' }); return; }
  res.json(result.rows[0]);
});

async function batchRows(batchId: number) {
  const result = await pool.query(
    `SELECT b.*,r.id AS record_data_id,r.template_version_id,r.raw_data,r.derived_data,r.audit_status AS record_status,
            r.current_version AS record_version
       FROM record_batches b JOIN record_batch_items i ON i.batch_id=b.id JOIN record_data r ON r.id=i.record_data_id
      WHERE b.id=$1 AND i.item_status='active' AND r.cancelled_at IS NULL ORDER BY i.sort_order,i.id`, [batchId],
  );
  return result.rows;
}

/** 根据各原始记录的实际状态汇总批次状态；混合状态优先显示仍需处理的 pending/rejected/draft。 */
async function syncBatchStatus(db: { query: (sql: string, params?: any[]) => Promise<any> }, batchId: number) {
  const counts = await db.query(
    `SELECT r.audit_status,COUNT(*)::int AS count
       FROM record_batch_items i JOIN record_data r ON r.id=i.record_data_id
      WHERE i.batch_id=$1 AND i.item_status='active' AND r.cancelled_at IS NULL GROUP BY r.audit_status`, [batchId],
  );
  const map = new Map(counts.rows.map((row: any) => [row.audit_status, Number(row.count)]));
  const status = !counts.rows.length ? 'draft' : map.get('pending') ? 'pending' : map.get('rejected') ? 'rejected' : map.get('draft') ? 'draft' : 'reviewed';
  await db.query(
    `UPDATE record_batches SET audit_status=$1,
       reviewer_name=CASE WHEN $1='reviewed' THEN reviewer_name ELSE NULL END,
       reviewed_at=CASE WHEN $1='reviewed' THEN reviewed_at ELSE NULL END,
       updated_at=NOW() WHERE id=$2`, [status, batchId],
  );
  return status;
}

router.post('/:id/submit', requirePermission('record.entry'), async (req: Request, res: Response) => {
  const who = actor(req); const batchId = Number(req.params.id); const rows = await batchRows(batchId);
  if (!rows.length) { res.status(404).json({ error: '录入批次不存在或没有原始记录' }); return; }
  const submissionRows = rows.filter(row => ['draft', 'rejected'].includes(row.record_status));
  if (!submissionRows.length) { res.status(409).json({ error: '批次中没有可提交的草稿或被退回记录' }); return; }
  const errors: string[] = [];
  for (const row of submissionRows) {
    const merged = { ...(row.raw_data || {}), ...(row.shared_data || {}) };
    const device = await validateDeviceReferences(row.template_version_id, merged);
    const conclusions = await validateRecordConclusions(row.template_version_id, merged);
    errors.push(...device.map(issue => `记录#${row.record_data_id}：${issue.message}`), ...conclusions.map(issue => `记录#${row.record_data_id}：${issue}`));
    const version = await pool.query('SELECT field_definitions FROM record_template_versions WHERE id=$1', [row.template_version_id]);
    const groups = (version.rows[0]?.field_definitions || []) as FieldGroup[];
    for (const field of groups.flatMap(group => group.fields || []).filter(field => field.data_scope === 'batch_shared' && field.required)) {
      const value = (row.shared_data || {})[field.code];
      if (value == null || value === '' || (Array.isArray(value) && !value.length)) errors.push(`公共字段“${field.label}”不能为空`);
    }
  }
  if (errors.length) { res.status(400).json({ error: [...new Set(errors)].join('；'), validation_errors: [...new Set(errors)] }); return; }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query(`UPDATE record_batches SET audit_status='pending',submitted_by_name=$1,submitted_by_job_no=$2,submitted_at=NOW(),reject_note=NULL,updated_at=NOW() WHERE id=$3`, [who.name, who.jobNo || null, batchId]);
    await db.query(`UPDATE record_data SET audit_status='pending',submitted_by_name=$1,submitted_by_job_no=$2,reviewer_name=NULL,reviewed_at=NULL,reject_note=NULL,current_version=current_version+1,updated_at=NOW() WHERE record_batch_id=$3 AND audit_status IN ('draft','rejected')`, [who.name, who.jobNo || null, batchId]);
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); }
  for (const row of submissionRows) await writeAuditLog({ recordId: row.record_data_id, orderNo: row.order_no, action: 'submit', actorName: who.name, actorRole: who.role || 'test_engineer', versionNo: Number(row.record_version || 1) + 1, dataSnapshot: { ...(row.shared_data || {}), ...(row.raw_data || {}), ...(row.derived_data || {}) }, statusAfter: 'pending', note: `录入批次 #${batchId} 提交待审记录` });
  res.json({ ok: true, batch_id: batchId, audit_status: 'pending' });
});

router.post('/:id/withdraw', requirePermission('record.entry'), async (req: Request, res: Response) => {
  const who = actor(req); const batchId = Number(req.params.id);
  const current = await pool.query('SELECT * FROM record_batches WHERE id=$1', [batchId]);
  if (!current.rows.length) { res.status(404).json({ error: '录入批次不存在' }); return; }
  const row = current.rows[0];
  if (row.audit_status !== 'pending') { res.status(409).json({ error: '只有待审核批次可以撤回' }); return; }
  const partlyApproved = await pool.query(`SELECT 1 FROM record_data WHERE record_batch_id=$1 AND audit_status='reviewed' LIMIT 1`, [batchId]);
  if (partlyApproved.rows.length) { res.status(409).json({ error: '批次已有部分记录审核通过，剩余待审记录不能由提交人直接撤回；请由审核员完成审核或统一退回' }); return; }
  const isSubmitter = row.submitted_by_job_no ? row.submitted_by_job_no === who.jobNo : row.submitted_by_name === who.name;
  if (!isSubmitter) { res.status(403).json({ error: '只有本次提交人可以撤回' }); return; }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query(`UPDATE record_data SET audit_status='draft',current_version=current_version+1,updated_at=NOW() WHERE record_batch_id=$1 AND audit_status='pending'`, [batchId]);
    await syncBatchStatus(db, batchId);
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); }
  res.json({ ok: true, batch_id: batchId, audit_status: 'draft' });
});

router.post('/:id/review', async (req: Request, res: Response) => {
  const who = actor(req); const batchId = Number(req.params.id); const { decision, note } = req.body || {};
  if (!who.name) { res.status(401).json({ error: '未登录' }); return; }
  if (!actorHasPermission(req as any, 'record.review')) { res.status(403).json({ error: '无原始记录审核权限' }); return; }
  if (!['approve', 'reject'].includes(decision)) { res.status(400).json({ error: 'decision 必须是 approve 或 reject' }); return; }
  if (decision === 'reject' && !String(note || '').trim()) { res.status(400).json({ error: '退回必须填写原因' }); return; }
  const rows = await batchRows(batchId);
  if (!rows.length) { res.status(404).json({ error: '录入批次不存在' }); return; }
  const requestedIds = Array.isArray(req.body?.record_data_ids)
    ? [...new Set(req.body.record_data_ids.map(Number).filter(Number.isFinite))]
    : rows.filter(row => row.record_status === 'pending').map(row => Number(row.record_data_id));
  const targets = rows.filter(row => requestedIds.includes(Number(row.record_data_id)));
  if (!targets.length || targets.length !== requestedIds.length) { res.status(400).json({ error: '请选择属于本批次的待审核记录' }); return; }
  const invalid = targets.filter(row => decision === 'approve'
    ? row.record_status !== 'pending'
    : !['pending', 'reviewed'].includes(row.record_status));
  if (invalid.length) { res.status(409).json({ error: decision === 'approve' ? '只有待审核记录可以通过' : '只有待审核或已通过记录可以退回' }); return; }
  const isSubmitter = rows[0].submitted_by_job_no ? rows[0].submitted_by_job_no === who.jobNo : rows[0].submitted_by_name === who.name;
  if (isSubmitter && !who.roles.includes('admin')) { res.status(403).json({ error: '提交人不能审核自己的录入批次' }); return; }
  const nextStatus = decision === 'approve' ? 'reviewed' : 'rejected';
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const targetIds = targets.map(row => Number(row.record_data_id));
    if (decision === 'approve') {
      await db.query(`UPDATE record_data SET audit_status='reviewed',reviewer_name=$1,reviewed_at=NOW(),reject_note=NULL,current_version=current_version+1,updated_at=NOW() WHERE id=ANY($2::int[])`, [who.name, targetIds]);
      await db.query(`UPDATE reports SET stale=TRUE WHERE record_data_ids && $1::int[]`, [targetIds]);
      await db.query(
        `UPDATE rework_tickets SET status='resolved',resolved_by_name=$1,resolved_at=NOW(),
                resolution_note=COALESCE(resolution_note,'批次数据重审通过，自动关单')
          WHERE record_data_id=ANY($2::int[]) AND target_stage='data_entry' AND status<>'resolved'`,
        [who.name, targetIds],
      );
    } else {
      await db.query(`UPDATE record_data SET audit_status='rejected',reviewer_name=NULL,reviewed_at=NULL,reject_note=$1,current_version=current_version+1,updated_at=NOW() WHERE id=ANY($2::int[])`, [String(note).trim(), targetIds]);
      await db.query(`UPDATE reports SET stale=TRUE WHERE record_data_ids && $1::int[]`, [targetIds]);
    }
    await db.query(`UPDATE record_batches SET reviewer_name=$1,reviewed_at=NOW(),reject_note=$2,updated_at=NOW() WHERE id=$3`, [who.name, decision === 'reject' ? String(note).trim() : null, batchId]);
    await syncBatchStatus(db, batchId);
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); }
  for (const row of targets) await writeAuditLog({ recordId: row.record_data_id, orderNo: row.order_no, action: decision === 'approve' ? 'review' : 'reject', actorName: who.name, actorRole: who.role || 'test_supervisor', versionNo: Number(row.record_version || 1) + 1, dataSnapshot: { ...(row.shared_data || {}), ...(row.raw_data || {}), ...(row.derived_data || {}) }, statusAfter: nextStatus, note: note || `录入批次 #${batchId} 部分审核` });
  const refreshed = await pool.query('SELECT audit_status FROM record_batches WHERE id=$1', [batchId]);
  let taskStateUpdates: TaskStateSyncResult[] = [];
  if (decision === 'approve') {
    try {
      taskStateUpdates = await notifyCompletedTasksForRecords(targets.map(row => Number(row.record_data_id)));
    } catch (error: any) {
      console.error('[batch-review] 写入/发送外部任务完工通知失败:', error?.message || error);
      taskStateUpdates = [{
        order_no: String(rows[0].order_no), sample_external_id: String(rows[0].sample_external_id),
        test_item_name: String(rows[0].test_item_name), status: 'failed',
        error: `完工通知处理异常：${error?.message || error}`,
      }];
    }
  }
  res.json({ ok: true, batch_id: batchId, audit_status: refreshed.rows[0]?.audit_status, reviewed_record_ids: targets.map(row => Number(row.record_data_id)), task_state_updates: taskStateUpdates });
});

export default router;
