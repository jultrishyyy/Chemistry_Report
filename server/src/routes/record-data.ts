import { Router, Request, Response } from 'express';
import { statSync } from 'fs';
import { actorHasPermission } from '../services/template-versions.js';
import { requirePermission } from './auth.js';
import { resolveStoredFile } from '../services/upload-paths.js';
import type { FieldDefinition, FieldGroup } from '../../../shared/types.js';
import { extractRecordConclusion } from '../../../shared/record-conclusion.js';
import { sampleAxisErrors } from '../../../shared/free-grid-samples.ts';
import { notifyCompletedTasksForRecords, type TaskStateSyncResult } from '../services/external-task-state.js';

import { pool } from '../db.js';

const router = Router();

function fillAttachmentSizes(row: any) {
  if (!Array.isArray(row?.attachments)) return row;
  return {
    ...row,
    attachments: row.attachments.map((attachment: any) => {
      if (attachment?.size_bytes != null || !attachment?.path) return attachment;
      try {
        const filePath = resolveStoredFile(attachment.path);
        return filePath ? { ...attachment, size_bytes: statSync(filePath).size } : attachment;
      } catch {
        return attachment;
      }
    }),
  };
}

function readActor(req: Request) {
  // HTTP 头按 Latin-1 解读，前端发来的是 URL 编码的 UTF-8，这里解回来
  const rawName = (req.header('X-Demo-User') || '').trim();
  let name = rawName;
  try { name = decodeURIComponent(rawName); } catch { /* fallback to raw */ }
  const role = (req.header('X-Demo-Role') || '').trim();
  const roles = (req.header('X-Demo-Roles') || role).split(',').map(s => s.trim()).filter(Boolean);
  const jobNo = (req.header('X-User-Job') || '').trim();
  return { name, role, roles, jobNo };
}

type DeviceValidationIssue = {
  field_code: string;
  field_label: string;
  asset_code?: string;
  reason: 'required' | 'single_only' | 'outside_preset' | 'not_found' | 'invalid_status' | 'expired';
  message: string;
};

/**
 * 提交审核前校验设备引用。草稿不拦截；进入 pending 的所有路径都必须在服务端复核，
 * 防止绕过前端写入不存在、超期或已停用的设备。
 */
export async function validateDeviceReferences(templateVersionId: number | null, rawData: Record<string, any>): Promise<DeviceValidationIssue[]> {
  if (!templateVersionId) return [];
  const version = await pool.query(
    'SELECT field_definitions FROM record_template_versions WHERE id = $1', [templateVersionId]
  );
  const groups = (version.rows[0]?.field_definitions || []) as FieldGroup[];
  const deviceFields = groups.flatMap(group => group.fields || []).filter(field => field.type === 'device_ref');
  if (!deviceFields.length) return [];

  const issues: DeviceValidationIssue[] = [];
  const codeFields = new Map<string, FieldDefinition[]>();
  for (const field of deviceFields) {
    const raw = rawData?.[field.code];
    const codes = (Array.isArray(raw) ? raw : [])
      .map(value => value && typeof value === 'object' ? value.asset_code ?? value.code : value)
      .map(value => String(value ?? '').trim())
      .filter(Boolean);
    if (field.required && codes.length === 0) {
      issues.push({ field_code: field.code, field_label: field.label, reason: 'required', message: `${field.label}必须选择设备` });
    }
    if (field.device_ref_config?.selection_mode === 'single' && codes.length > 1) {
      issues.push({ field_code: field.code, field_label: field.label, reason: 'single_only', message: `${field.label}只允许选择一台设备` });
    }
    if (field.device_ref_config?.allow_library_search === false) {
      const presets = new Set(field.device_ref_config.preset_asset_codes || []);
      for (const code of codes) if (!presets.has(code)) {
        issues.push({ field_code: field.code, field_label: field.label, asset_code: code, reason: 'outside_preset', message: `${field.label}中的设备 ${code} 不在模板允许的常用设备范围内` });
      }
    }
    for (const code of codes) {
      const fields = codeFields.get(code) || [];
      fields.push(field);
      codeFields.set(code, fields);
    }
  }

  const codes = Array.from(codeFields.keys());
  if (!codes.length) return issues;
  const equipment = await pool.query(
    `SELECT asset_code, status, expire_date, (expire_date < CURRENT_DATE) AS expired
       FROM equipment_library
      WHERE asset_code = ANY($1)`, [codes]
  );
  const found = new Map(equipment.rows.map(row => [String(row.asset_code), row]));
  for (const code of codes) {
    const row = found.get(code);
    for (const field of codeFields.get(code) || []) {
      if (!row) {
        issues.push({ field_code: field.code, field_label: field.label, asset_code: code, reason: 'not_found', message: `设备库中不存在 ${code}` });
        continue;
      }
      const status = String(row.status || '').trim();
      if (status && /(超期|停用|报废|不合格)/.test(status)) {
        issues.push({ field_code: field.code, field_label: field.label, asset_code: code, reason: 'invalid_status', message: `设备 ${code} 当前状态为“${status}”` });
      }
      const expireDate = row.expire_date ? new Date(row.expire_date).toISOString().slice(0, 10) : '';
      if (row.expired && !issues.some(issue => issue.asset_code === code && issue.reason === 'invalid_status')) {
        issues.push({ field_code: field.code, field_label: field.label, asset_code: code, reason: 'expired', message: `设备 ${code} 已于 ${expireDate} 到期` });
      }
    }
  }
  return issues;
}

/** 提交审核前校验结构化报告结论；未检测/不适用项允许留空，但至少要有一个已完成且进入报告的结论项。 */
export async function validateRecordConclusions(templateVersionId: number | null, rawData: Record<string, any>): Promise<string[]> {
  if (!templateVersionId) return [];
  const version = await pool.query(
    'SELECT field_definitions FROM record_template_versions WHERE id = $1', [templateVersionId]
  );
  const groups = (version.rows[0]?.field_definitions || []) as FieldGroup[];
  const sampleErrors = groups.flatMap(group => group.fields || []).flatMap(field => field.free_table
    ? sampleAxisErrors(field.free_table, rawData[field.code] || {}).map(error => `${field.label || field.code}：${error}`) : []);
  const modular = extractRecordConclusion({ id: 0, name: '', version: 0, groups }, rawData);
  if (modular?.source === 'module') {
    const errors: string[] = [...sampleErrors];
    if (!modular.project_name) errors.push('结论：项目名称不能为空');
    if (modular.judgment_field?.required && !modular.judgment_requirement) errors.push(`${modular.project_name || '总项目'}：判定要求不能为空`);
    if (modular.conclusion_field?.required && !modular.conclusion) errors.push(`${modular.project_name || '总项目'}：结论不能为空`);
    for (const item of modular.items) {
      if (!item.name) errors.push('结论：子项目名称不能为空');
      if (item.judgment_field?.required && !item.judgment_requirement) errors.push(`${item.name || '子项目'}：判定要求不能为空`);
      if (item.conclusion_field?.required && !item.conclusion) errors.push(`${item.name || '子项目'}：结论不能为空`);
    }
    return [...new Set(errors)];
  }
  const fields = groups.flatMap(group => group.fields || []).filter(field => field.type === 'record_conclusion' && field.record_conclusion);
  const errors: string[] = [...sampleErrors];
  for (const field of fields) {
    const cfg = field.record_conclusion!;
    const raw = rawData?.[field.code] && typeof rawData[field.code] === 'object' ? rawData[field.code] : {};
    const projectName = String(raw.project_name ?? cfg.project_name ?? '').trim();
    if (!projectName) errors.push(`${field.label || '报告结论'}：项目名称不能为空`);
    if (cfg.mode === 'children' && cfg.project_summary) {
      const summary = cfg.project_summary;
      if (summary.judgment_enabled !== false && summary.judgment_required === true
        && !String(raw.project_judgment_requirement ?? summary.judgment_requirement ?? '').trim()) {
        errors.push(`${projectName || field.label || '报告结论'}：总项目判定要求不能为空`);
      }
      if (summary.conclusion_enabled !== false && summary.conclusion_required === true
        && !String(raw.project_conclusion ?? '').trim()) {
        errors.push(`${projectName || field.label || '报告结论'}：总结论不能为空`);
      }
    }
    const values: any[] = Array.isArray(raw.items) ? raw.items : [];
    let reportable = 0;
    for (const definition of cfg.items || []) {
      const value = values.find(item => item?.item_code === definition.code || item?.code === definition.code) || {};
      const status = value.execution_status || 'completed';
      const enabled = value.report_enabled ?? definition.default_report_enabled !== false;
      if (status !== 'completed' || !enabled) continue;
      reportable++;
      const itemName = cfg.mode === 'children' ? String(value.display_name ?? definition.name ?? '').trim() : projectName;
      if (!itemName) errors.push(`${field.label || '报告结论'}：已完成的子项目名称不能为空`);
      const judgmentRequired = definition.judgment_required ?? definition.required !== false;
      const conclusionRequired = definition.conclusion_required ?? definition.required !== false;
      if (judgmentRequired && !String(value.judgment_requirement ?? definition.judgment_requirement ?? '').trim()) errors.push(`${itemName || projectName}：判定要求不能为空`);
      if (conclusionRequired && !String(value.conclusion ?? '').trim()) errors.push(`${itemName || projectName}：结论不能为空`);
    }
    if (!reportable && cfg.allow_no_completed_items !== true) errors.push(`${field.label || '报告结论'}：至少需要一个“已完成且进入报告”的结论项`);
  }
  return [...new Set(errors)];
}

/** 写一条审核日志（版本流水）。所有写路径都走它。 */
export async function writeAuditLog(opts: {
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
                      current_version, record_batch_id, reject_note, submitted_by_name, submitted_by_job_no,
                      cancelled_by_name, cancelled_at, cancel_reason,
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
  const result = await pool.query(
    `SELECT r.*, b.shared_data AS batch_shared_data, b.audit_status AS batch_audit_status
       FROM record_data r LEFT JOIN record_batches b ON b.id=r.record_batch_id
      WHERE r.id=$1`, [id],
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Record not found' });
    return;
  }
  res.json(fillAttachmentSizes(result.rows[0]));
});

router.post('/', requirePermission('record.entry'), async (req: Request, res: Response) => {
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

  if (status === 'pending') {
    const deviceIssues = await validateDeviceReferences(versionId, raw_data);
    if (deviceIssues.length) {
      res.status(400).json({ error: `测试设备校验未通过：${deviceIssues.map(issue => issue.message).join('；')}`, device_errors: deviceIssues });
      return;
    }
    const conclusionIssues = await validateRecordConclusions(versionId, raw_data);
    if (conclusionIssues.length) {
      res.status(400).json({ error: `报告结论校验未通过：${conclusionIssues.join('；')}`, conclusion_errors: conclusionIssues });
      return;
    }
  }

  const hasContext = !!(order_no && sample_external_id && test_item_name);
  const existingQ = hasContext
    ? `SELECT id, current_version, audit_status, cancelled_at FROM record_data
         WHERE template_id = $1 AND order_no = $2 AND sample_external_id = $3 AND test_item_name = $4
         ORDER BY id ASC LIMIT 1`
    : `SELECT id, current_version, audit_status, cancelled_at FROM record_data WHERE template_id = $1 AND order_no IS NULL ORDER BY id ASC LIMIT 1`;
  const existingP = hasContext
    ? [template_id, order_no, sample_external_id, test_item_name]
    : [template_id];
  const existing = await pool.query(existingQ, existingP);

  const snapshot = { ...raw_data, ...(derived_data || {}) };

  if (existing.rows.length > 0) {
    if (existing.rows[0].cancelled_at) {
      res.status(409).json({ error: '该方法记录已标记为取消检测，不能通过普通录入入口重新启用' }); return;
    }
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
        submitted_by_name = CASE WHEN $12 = 'pending' THEN $13 ELSE NULL END,
        submitted_by_job_no = CASE WHEN $12 = 'pending' THEN $14 ELSE NULL END,
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
        status, actor.name, actor.jobNo || null,
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
        tester_name, tested_at, audit_status, submitted_by_name, submitted_by_job_no, current_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11,
             CASE WHEN $11 = 'pending' THEN $10 ELSE NULL END,
             CASE WHEN $11 = 'pending' THEN $12 ELSE NULL END, 1) RETURNING *`,
    [
      template_id, template_version || 1, versionId,
      JSON.stringify(raw_data),
      JSON.stringify(derived_data || {}),
      JSON.stringify(ad_hoc_fields || []),
      order_no || null, sample_external_id || null, test_item_name || null,
      actor.name, status, actor.jobNo || null,
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
 * 兼容两种 body：
 * 1. 旧字段：{ ..., field_code, images: [] }
 * 2. 图片分区：{ ..., image_collection_key, image_collection, legacy_images_by_field }
 */
router.put('/images', requirePermission('record.entry'), async (req: Request, res: Response) => {
  const {
    template_id, order_no, sample_external_id, test_item_name,
    field_code, images,
    image_collection_key, image_collection, legacy_images_by_field,
  } = req.body;
  const legacyFieldUpdate = !!field_code && Array.isArray(images);
  const collectionUpdate =
    typeof image_collection_key === 'string'
    && image_collection_key.startsWith('__image_collection__::')
    && image_collection
    && typeof image_collection === 'object'
    && !Array.isArray(image_collection)
    && legacy_images_by_field
    && typeof legacy_images_by_field === 'object'
    && !Array.isArray(legacy_images_by_field);
  if (!template_id || (!legacyFieldUpdate && !collectionUpdate)) {
    res.status(400).json({ error: '图片字段数组或图片分区集合参数不完整' }); return;
  }
  const rawPatch: Record<string, any> = legacyFieldUpdate
    ? { [field_code]: images }
    : { ...legacy_images_by_field, [image_collection_key]: image_collection };
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
      ? `SELECT id, current_version, raw_data, audit_status, record_batch_id, cancelled_at FROM record_data
           WHERE template_id=$1 AND order_no=$2 AND sample_external_id=$3 AND test_item_name=$4 ORDER BY id ASC LIMIT 1`
      : `SELECT id, current_version, raw_data, audit_status, record_batch_id, cancelled_at FROM record_data WHERE template_id=$1 AND order_no IS NULL ORDER BY id ASC LIMIT 1`,
    hasContext ? [template_id, order_no, sample_external_id, test_item_name] : [template_id]
  );

  if (existing.rows.length) {
    const row = existing.rows[0];
    if (row.cancelled_at) { res.status(409).json({ error: '该原始记录已取消检测，不能修改图片' }); return; }
    if (row.audit_status === 'reviewed') {
      res.status(409).json({ error: '该记录已审核通过、已锁定，不能修改图片；如需修改请在报告生成处「退回原始记录」' }); return;
    }
    const raw = { ...(row.raw_data || {}), ...rawPatch };
    const nextVersion = (row.current_version || 1) + 1;
    const nextStatus = row.record_batch_id ? (row.audit_status === 'rejected' ? 'rejected' : 'draft') : 'pending';
    const updated = await pool.query(
      `UPDATE record_data SET raw_data=$1, tester_name=$2, tested_at=NOW(),
         reviewer_name=NULL, reviewed_at=NULL, audit_status=$3, reject_note=CASE WHEN $3='draft' THEN NULL ELSE reject_note END,
         submitted_by_name=CASE WHEN $3='pending' THEN $4 ELSE NULL END,
         submitted_by_job_no=CASE WHEN $3='pending' THEN $5 ELSE NULL END,
         current_version=$6, updated_at=NOW()
       WHERE id=$7 RETURNING *`,
      [JSON.stringify(raw), actor.name, nextStatus, actor.name, actor.jobNo || null, nextVersion, row.id]
    );
    await writeAuditLog({
      recordId: row.id, orderNo: order_no || null, action: 'update',
      actorName: actor.name, actorRole: actor.role || 'test_engineer',
      versionNo: nextVersion, dataSnapshot: raw, statusAfter: nextStatus,
      note: '上传/更新图片',
    });
    res.json(updated.rows[0]);
    return;
  }

  const raw = rawPatch;
  const inserted = await pool.query(
    `INSERT INTO record_data
       (template_id, template_version, template_version_id, raw_data, derived_data, ad_hoc_fields,
        order_no, sample_external_id, test_item_name, tester_name, tested_at, audit_status, submitted_by_name, submitted_by_job_no, current_version)
     VALUES ($1, 1, $2, $3, '{}'::jsonb, '[]'::jsonb, $4, $5, $6, $7, NOW(), 'pending', $7, $8, 1) RETURNING *`,
    [template_id, versionId, JSON.stringify(raw), order_no || null, sample_external_id || null, test_item_name || null, actor.name, actor.jobNo || null]
  );
  await writeAuditLog({
    recordId: inserted.rows[0].id, orderNo: order_no || null, action: 'submit',
    actorName: actor.name, actorRole: actor.role || 'test_engineer',
    versionNo: 1, dataSnapshot: raw, statusAfter: 'pending', note: '上传图片（新建记录）',
  });
  res.status(201).json(inserted.rows[0]);
});

router.put('/:id', requirePermission('record.entry'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const {
    raw_data, derived_data, ad_hoc_fields,
    raw_patch, derived_patch, remove_raw_fields, remove_derived_fields,
    base_raw_data, base_derived_data,
  } = req.body;
  const status: 'draft' | 'pending' = req.body.status === 'draft' ? 'draft' : 'pending';
  const actor = readActor(req);
  if (!actor.name) { res.status(401).json({ error: '未登录或缺少 X-Demo-User 头' }); return; }
  const db = await pool.connect();
  let row: any;
  let nextVersion = 1;
  try {
    await db.query('BEGIN');
    // 行锁让两位录入人员同时保存时依次合并，避免“都读到旧值”后仍发生覆盖。
    const cur = await db.query(
      'SELECT current_version, audit_status, template_version_id, raw_data, derived_data, record_batch_id, cancelled_at FROM record_data WHERE id = $1 FOR UPDATE',
      [id],
    );
    if (!cur.rows.length) {
      await db.query('ROLLBACK');
      res.status(404).json({ error: 'Record not found' }); return;
    }
    if (cur.rows[0].audit_status === 'reviewed') {
      await db.query('ROLLBACK');
      res.status(409).json({ error: '该记录已审核通过、已锁定，不能修改；如需修改请在报告生成处「退回原始记录」' }); return;
    }
    if (cur.rows[0].cancelled_at) {
      await db.query('ROLLBACK'); res.status(409).json({ error: '该原始记录已标记为取消检测，只能查看和追溯' }); return;
    }
    if (status === 'pending' && cur.rows[0].record_batch_id) {
      await db.query('ROLLBACK');
      res.status(409).json({ error: '该记录属于多方法录入批次，请在批次页面一次提交全部原始记录', record_batch_id: cur.rows[0].record_batch_id }); return;
    }
    const patchMode = raw_patch != null || derived_patch != null
      || Array.isArray(remove_raw_fields) || Array.isArray(remove_derived_fields);
    if (patchMode) {
      const rawChanged = [...Object.keys(raw_patch || {}), ...(Array.isArray(remove_raw_fields) ? remove_raw_fields.map(String) : [])];
      const derivedChanged = [...Object.keys(derived_patch || {}), ...(Array.isArray(remove_derived_fields) ? remove_derived_fields.map(String) : [])];
      const conflicts = [
        ...rawChanged.filter(code => JSON.stringify((cur.rows[0].raw_data || {})[code]) !== JSON.stringify((base_raw_data || {})[code])),
        ...derivedChanged.filter(code => JSON.stringify((cur.rows[0].derived_data || {})[code]) !== JSON.stringify((base_derived_data || {})[code])),
      ];
      if (conflicts.length) {
        await db.query('ROLLBACK');
        res.status(409).json({
          error: `以下字段刚被其他人员修改，请刷新后确认：${[...new Set(conflicts)].join('、')}`,
          code: 'field_edit_conflict', conflict_fields: [...new Set(conflicts)],
        });
        return;
      }
    }
    const nextRaw: Record<string, any> = patchMode
      ? { ...(cur.rows[0].raw_data || {}), ...(raw_patch || {}) }
      : (raw_data ?? cur.rows[0].raw_data ?? {});
    const nextDerived: Record<string, any> = patchMode
      ? { ...(cur.rows[0].derived_data || {}), ...(derived_patch || {}) }
      : (derived_data ?? cur.rows[0].derived_data ?? {});
    for (const code of Array.isArray(remove_raw_fields) ? remove_raw_fields : []) delete nextRaw[String(code)];
    for (const code of Array.isArray(remove_derived_fields) ? remove_derived_fields : []) delete nextDerived[String(code)];
    if (status === 'pending') {
      const deviceIssues = await validateDeviceReferences(cur.rows[0].template_version_id, nextRaw);
      if (deviceIssues.length) {
        await db.query('ROLLBACK');
        res.status(400).json({ error: `测试设备校验未通过：${deviceIssues.map(issue => issue.message).join('；')}`, device_errors: deviceIssues });
        return;
      }
      const conclusionIssues = await validateRecordConclusions(cur.rows[0].template_version_id, nextRaw);
      if (conclusionIssues.length) {
        await db.query('ROLLBACK');
        res.status(400).json({ error: `报告结论校验未通过：${conclusionIssues.join('；')}`, conclusion_errors: conclusionIssues });
        return;
      }
    }
    nextVersion = (cur.rows[0].current_version || 1) + 1;
    const result = await db.query(
      `UPDATE record_data SET raw_data = $1, derived_data = $2,
         ad_hoc_fields = COALESCE($3, ad_hoc_fields),
         tester_name = $4, tested_at = NOW(),
         reviewer_name = NULL, reviewed_at = NULL, audit_status = $7, reject_note = NULL,
         submitted_by_name = CASE WHEN $7 = 'pending' THEN $8 ELSE NULL END,
         submitted_by_job_no = CASE WHEN $7 = 'pending' THEN $9 ELSE NULL END,
         current_version = $5, updated_at = NOW()
       WHERE id = $6 RETURNING *`,
      [JSON.stringify(nextRaw), JSON.stringify(nextDerived), ad_hoc_fields ? JSON.stringify(ad_hoc_fields) : null,
        actor.name, nextVersion, id, status, actor.name, actor.jobNo || null],
    );
    row = result.rows[0];
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
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
router.post('/:id/submit', requirePermission('record.entry'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const actor = readActor(req);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  const cur = await pool.query(
    'SELECT id, audit_status, order_no, raw_data, derived_data, current_version, template_version_id, record_batch_id, cancelled_at FROM record_data WHERE id = $1', [id]
  );
  if (!cur.rows.length) { res.status(404).json({ error: 'Record not found' }); return; }
  const row = cur.rows[0];
  if (row.cancelled_at) { res.status(409).json({ error: '该原始记录已取消检测，不能提交审核' }); return; }
  if (row.record_batch_id) { res.status(409).json({ error: '该记录属于多方法录入批次，请在批次页面一次提交', record_batch_id: row.record_batch_id }); return; }
  if (row.audit_status !== 'draft' && row.audit_status !== 'rejected') {
    res.status(400).json({ error: '只有草稿或被退回的记录可以提交审核' }); return;
  }
  const deviceIssues = await validateDeviceReferences(row.template_version_id, row.raw_data || {});
  if (deviceIssues.length) {
    res.status(400).json({ error: `测试设备校验未通过：${deviceIssues.map(issue => issue.message).join('；')}`, device_errors: deviceIssues });
    return;
  }
  const conclusionIssues = await validateRecordConclusions(row.template_version_id, row.raw_data || {});
  if (conclusionIssues.length) {
    res.status(400).json({ error: `报告结论校验未通过：${conclusionIssues.join('；')}`, conclusion_errors: conclusionIssues });
    return;
  }
  const nextVersion = (row.current_version || 1) + 1;
  const updated = await pool.query(
    `UPDATE record_data SET audit_status='pending', reject_note=NULL, submitted_by_name=$1, submitted_by_job_no=$2,
       current_version=$3, updated_at=NOW() WHERE id=$4 RETURNING *`,
    [actor.name, actor.jobNo || null, nextVersion, id]
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
router.post('/:id/withdraw', requirePermission('record.entry'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const actor = readActor(req);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  const cur = await pool.query(
    'SELECT id, audit_status, submitted_by_name, submitted_by_job_no, tester_name, order_no, raw_data, derived_data, current_version, record_batch_id FROM record_data WHERE id = $1', [id]
  );
  if (!cur.rows.length) { res.status(404).json({ error: 'Record not found' }); return; }
  const row = cur.rows[0];
  if (row.record_batch_id) { res.status(409).json({ error: '该记录属于多方法录入批次，请从批次撤回', record_batch_id: row.record_batch_id }); return; }
  if (row.audit_status !== 'pending') {
    res.status(400).json({ error: '只有待审核的记录可以撤回' }); return;
  }
  const isSubmitter = row.submitted_by_job_no
    ? row.submitted_by_job_no === actor.jobNo
    : (row.submitted_by_name || row.tester_name) === actor.name;
  if (!isSubmitter) { res.status(403).json({ error: '只有本次提交人可以撤回审核' }); return; }
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
    'SELECT id, audit_status, tester_name, submitted_by_name, submitted_by_job_no, order_no, sample_external_id, test_item_name, raw_data, derived_data, current_version, record_batch_id, cancelled_at FROM record_data WHERE id = $1', [id]
  );
  if (!cur.rows.length) { res.status(404).json({ error: 'Record not found' }); return; }
  const row = cur.rows[0];
  if (row.cancelled_at) { res.status(409).json({ error: '该原始记录已取消检测，不能审核' }); return; }
  if (row.record_batch_id) { res.status(409).json({ error: '该记录属于多方法录入批次，请一次审核整个批次', record_batch_id: row.record_batch_id }); return; }
  if (row.audit_status !== 'pending') {
    res.status(400).json({
      error: row.audit_status === 'draft' ? '该记录还是草稿，未提交审核'
        : row.audit_status === 'reviewed' ? '该记录已审核通过'
          : '该记录不在待审核状态',
    }); return;
  }
  const isSubmitter = row.submitted_by_job_no
    ? row.submitted_by_job_no === actor.jobNo
    : (row.submitted_by_name || row.tester_name) === actor.name;
  if (isSubmitter && !actor.roles.includes('admin')) {
    res.status(403).json({ error: '提交人不能审核自己提交的记录，请由其他审核人处理' }); return;
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
    let taskStateUpdates: TaskStateSyncResult[] = [];
    try {
      taskStateUpdates = await notifyCompletedTasksForRecords([Number(row.id)]);
    } catch (error: any) {
      console.error('[record-review] 写入/发送外部任务完工通知失败:', error?.message || error);
      taskStateUpdates = [{
        order_no: String(row.order_no), sample_external_id: String(row.sample_external_id || ''),
        test_item_name: String(row.test_item_name || ''), status: 'failed',
        error: `完工通知处理异常：${error?.message || error}`,
      }];
    }
    res.json({ ...updated.rows[0], task_state_updates: taskStateUpdates });
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
