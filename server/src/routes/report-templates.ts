import { Router, Request, Response } from 'express';
import {
  listVersions, getVersion, createDraft, submitForReview, reviewVersion, withdrawVersion,
  forkTemplate, getLineage, syncToChildren, listAuditLog, logTemplateAudit, readActor,
  requestArchive, cancelArchiveRequest, reviewArchiveRequest, rollbackToVersion,
  diffFieldDefinitions, VersionFlowError, actorHasPermission,
} from '../services/template-versions.js';
import { validateReportBindings, validateProjectConclusions, type DanglingBinding } from '../../../shared/binding-integrity.js';
import type { FieldGroup } from '../../../shared/types.js';

import { pool } from '../db.js';

const router = Router();

function sendError(res: Response, e: any, fallback = 500) {
  res.status(e instanceof VersionFlowError ? e.status : fallback).json({ error: e.message });
}

/**
 * 取某报告模板"关联原始记录模板当前版本"的 groups。
 * 未关联（或关联模板无当前版本）返回 undefined —— 校验器据此报"无法校验"。
 */
async function loadLinkedRecordGroups(reportTemplateId: number): Promise<FieldGroup[] | undefined> {
  const r = await pool.query(
    `SELECT rv.field_definitions
       FROM report_templates rt
       JOIN record_templates rec ON rec.id = rt.linked_record_template_id
       LEFT JOIN record_template_versions rv ON rv.id = rec.current_version_id
      WHERE rt.id = $1 AND rt.linked_record_template_id IS NOT NULL`,
    [reportTemplateId]
  );
  return (r.rows[0]?.field_definitions as FieldGroup[] | undefined) ?? undefined;
}

/** 校验给定报告 groups（+ 检测结论声明）的所有数据绑定是否命中关联原始记录字段集 */
async function checkBindings(reportTemplateId: number, reportGroups: FieldGroup[] | undefined, conclusions?: any[]): Promise<DanglingBinding[]> {
  const recordGroups = await loadLinkedRecordGroups(reportTemplateId);
  return validateReportBindings(reportGroups, recordGroups, conclusions);
}

/** open_draft 子查询：版本号最大的未定稿，且比当前生效版本新（rejected 冻结后旧行是纯历史） */
const OPEN_DRAFT_SQL = `
  (SELECT json_build_object(
      'id', dv.id, 'version_no', dv.version_no, 'status', dv.status, 'author_name', dv.author_name,
      'reviewer_name', dv.reviewer_name, 'review_note', dv.review_note,
      'change_summary', dv.change_summary, 'updated_at', dv.updated_at)
   FROM report_template_versions dv
   WHERE dv.template_id = t.id AND dv.status IN ('draft','pending','rejected')
     AND dv.version_no > COALESCE(cv.version_no, 0)
   ORDER BY dv.version_no DESC LIMIT 1) AS open_draft`;

router.get('/', async (req: Request, res: Response) => {
  const { kind } = req.query as { kind?: string };
  const includeArchived = req.query.include_archived === '1';
  const where: string[] = [];
  const params: any[] = [];
  if (kind) {
    params.push(kind);
    where.push(`t.template_kind = $${params.length}`);
  }
  if (!includeArchived) where.push(`t.archived_at IS NULL`);
  // status=approved：仅返回当前生效版本已审核通过的模板（首页/项目选用时过滤未审核模板）。
  if (req.query.status === 'approved') where.push(`cv.status = 'approved'`);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const result = await pool.query(
    `SELECT t.id, t.name, t.version, t.source_file, t.template_kind, t.test_project_codes,
            t.linked_record_template_id, cv.layout_options, t.created_at, t.updated_at,
            t.parent_template_id, t.current_version_id,
            t.archive_requested_by, t.archive_requested_at, t.archive_request_note,
            cv.version_no AS current_version_no, cv.status AS current_status,
            cv.author_name AS current_author,
            -- 当前生效版本的字段分区数：0＝空/旧版模板（无结构化 content_doc），选用时禁选避免生成出无法编辑的报告
            COALESCE(jsonb_array_length(cv.field_definitions), 0) AS current_field_group_count,
            GREATEST(t.updated_at,
              (SELECT MAX(GREATEST(v.created_at, v.updated_at, COALESCE(v.reviewed_at, v.created_at)))
               FROM report_template_versions v WHERE v.template_id = t.id)) AS last_activity,
            ${OPEN_DRAFT_SQL}
     FROM report_templates t
     LEFT JOIN report_template_versions cv ON cv.id = t.current_version_id
     ${whereSql} ORDER BY t.updated_at DESC`,
    params
  );
  res.json(result.rows);
});

router.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await pool.query(
    `SELECT t.id, t.name, t.version, t.source_file, t.template_kind, t.test_project_codes,
            t.linked_record_template_id, t.created_at, t.updated_at,
            t.parent_template_id, t.parent_version_id, t.current_version_id, t.archived_at,
            t.archive_requested_by, t.archive_requested_at, t.archive_request_note,
            t.field_mapping,
            cv.version_no AS current_version_no, cv.status AS current_status,
            cv.field_definitions, cv.layout_options, cv.typst_source,
            ${OPEN_DRAFT_SQL}
     FROM report_templates t LEFT JOIN report_template_versions cv ON cv.id = t.current_version_id
     WHERE t.id = $1`, [id]
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Report template not found' });
    return;
  }
  res.json(result.rows[0]);
});

router.get('/:id/versions', async (req: Request, res: Response) => {
  res.json(await listVersions(pool, 'report', Number(req.params.id)));
});

router.get('/:id/versions/:vid', async (req: Request, res: Response) => {
  const v = await getVersion(pool, 'report', Number(req.params.vid));
  if (!v) { res.status(404).json({ error: 'Version not found' }); return; }
  res.json(v);
});

/** 实时 diff：该版本 vs 当前生效版本（审核预览用） */
router.get('/:id/versions/:vid/diff', async (req: Request, res: Response) => {
  const v = await getVersion(pool, 'report', Number(req.params.vid));
  if (!v) { res.status(404).json({ error: 'Version not found' }); return; }
  const cur = await pool.query(
    `SELECT cv.field_definitions, cv.version_no FROM report_templates t
     JOIN report_template_versions cv ON cv.id = t.current_version_id WHERE t.id = $1`,
    [req.params.id]
  );
  const base = cur.rows[0] || null;
  res.json({
    against_version_no: base?.version_no ?? null,
    diff: diffFieldDefinitions(base?.field_definitions || null, v.field_definitions),
  });
});

/** 模板操作日志 */
router.get('/:id/audit-log', async (req: Request, res: Response) => {
  res.json(await listAuditLog(pool, 'report', Number(req.params.id)));
});

router.get('/:id/lineage', async (req: Request, res: Response) => {
  res.json(await getLineage(pool, 'report', Number(req.params.id)));
});

/**
 * 报告映射引用完整性校验：校验本报告模板（默认当前版本，可传 ?version=vid 指定）
 * 的所有数据绑定是否命中"关联原始记录模板当前版本"的字段集。
 * 返回 { linked: 是否关联了原始记录模板, warnings: 失效绑定清单 }。
 */
router.get('/:id/binding-check', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const vid = req.query.version ? Number(req.query.version) : null;
  const row = vid
    ? await getVersion(pool, 'report', vid)
    : (await pool.query(
        `SELECT cv.field_definitions, cv.layout_options FROM report_templates t
         LEFT JOIN report_template_versions cv ON cv.id = t.current_version_id WHERE t.id = $1`, [id]
      )).rows[0];
  if (!row) { res.status(404).json({ error: '模板或版本不存在' }); return; }
  const recordGroups = await loadLinkedRecordGroups(id);
  const warnings = validateReportBindings(row.field_definitions as FieldGroup[] | undefined, recordGroups, (row.layout_options as any)?.conclusions);
  res.json({ linked: recordGroups !== undefined, warnings });
});

router.post('/', async (req: Request, res: Response) => {
  const actor = readActor(req as any);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  const {
    name, typst_source, source_file,
    template_kind = 'cover', test_project_codes, linked_record_template_id, layout_options,
    field_definitions, parent_template_id, parent_version_id,
  } = req.body;
  if (!name) { res.status(400).json({ error: 'name is required' }); return; }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO report_templates
         (name, source_file, template_kind, test_project_codes, linked_record_template_id,
          parent_template_id, parent_version_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        name, source_file || null,
        template_kind, test_project_codes || null, linked_record_template_id || null,
        parent_template_id || null, parent_version_id || null,
      ]
    );
    const t = ins.rows[0];
    // 新建模板初始为草稿(draft)、无生效版本(current_version_id 保持 NULL)：
    // 必须走「提交审核 → 审核通过」后才会翻指针生效，未通过前在首页/项目选用等选择框中禁选。
    const v1 = await client.query(
      `INSERT INTO report_template_versions (template_id, version_no, field_definitions, layout_options, typst_source,
                                              status, author_name, change_summary)
       VALUES ($1, 1, $2::jsonb, $3::jsonb, $4, 'draft', $5, $6) RETURNING id`,
      [t.id, JSON.stringify(field_definitions || []), JSON.stringify(layout_options || {}), typst_source || null,
       actor.name, '初始版本']
    );
    await logTemplateAudit(client, 'report', t.id, 'create', actor, { name }, v1.rows[0].id);
    await client.query('COMMIT');
    res.status(201).json({ ...t, current_version_id: null });
  } catch (e: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  const actor = readActor(req as any);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  const id = Number(req.params.id);
  const { name, typst_source, layout_options, field_definitions, change_summary, draft_updated_at,
          template_kind, test_project_codes, linked_record_template_id } = req.body;
  // 元数据立即生效（不走版本流）
  if (name || template_kind || test_project_codes !== undefined || linked_record_template_id !== undefined) {
    const old = name ? await pool.query(`SELECT name FROM report_templates WHERE id = $1`, [id]) : null;
    await pool.query(
      `UPDATE report_templates SET
         name = COALESCE($1, name),
         template_kind = COALESCE($2, template_kind),
         test_project_codes = COALESCE($3, test_project_codes),
         linked_record_template_id = COALESCE($4, linked_record_template_id),
         updated_at = NOW()
       WHERE id = $5`,
      [name || null, template_kind || null, test_project_codes || null, linked_record_template_id || null, id]
    );
    if (name && old?.rows[0] && old.rows[0].name !== name) {
      await logTemplateAudit(pool, 'report', id, 'rename', actor, { from: old.rows[0].name, to: name });
    }
  }
  if (!field_definitions) {
    const r = await pool.query(
      `SELECT t.*, cv.field_definitions, cv.layout_options, cv.typst_source
       FROM report_templates t LEFT JOIN report_template_versions cv ON cv.id = t.current_version_id
       WHERE t.id = $1`, [id]
    );
    res.json(r.rows[0]); return;
  }
  try {
    const draft = await createDraft(pool, 'report', id, actor.name,
      { field_definitions, layout_options, typst_source, change_summary, draft_updated_at });
    await logTemplateAudit(pool, 'report', id, 'update_draft', actor,
      { version_no: draft.version_no }, draft.id);
    // 保存草稿时即校验数据绑定，把失效项随响应带回供编辑器标红/提示（不阻断保存）
    const binding_warnings = await checkBindings(id, field_definitions as FieldGroup[], (layout_options as any)?.conclusions);
    res.json({ ...draft, binding_warnings });
  } catch (e: any) {
    sendError(res, e);
  }
});

router.post('/:id/submit', async (req: Request, res: Response) => {
  const actor = readActor(req as any);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  const { version_id, change_summary } = req.body;
  if (!version_id) { res.status(400).json({ error: 'version_id required' }); return; }
  try {
    // 6.7：项目报告模板提交审核前，强制校验「检测结论声明」必填（未填禁止提交）
    const meta = (await pool.query(
      `SELECT t.template_kind, v.layout_options FROM report_template_versions v
       JOIN report_templates t ON t.id = v.template_id WHERE v.id = $1`, [version_id]
    )).rows[0];
    if (meta?.template_kind === 'project') {
      const lo = meta.layout_options || {};
      const errs = validateProjectConclusions(lo.project_name, lo.conclusions);
      if (errs.length) { res.status(400).json({ error: '检测结论未填写完整：' + errs.join('；') }); return; }
    }
    const v = await submitForReview(pool, 'report', Number(version_id), actor.name, actor.role, change_summary);
    await logTemplateAudit(pool, 'report', Number(req.params.id), 'submit', actor,
      { version_no: v.version_no, change_summary: v.change_summary }, v.id);
    res.json(v);
  } catch (e: any) {
    sendError(res, e, 400);
  }
});

/** 撤回审核（pending → draft，提交人或审核员） */
router.post('/:id/versions/:vid/withdraw', async (req: Request, res: Response) => {
  const actor = readActor(req as any);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  try {
    const v = await withdrawVersion(pool, 'report', Number(req.params.vid), actor.name, actor.role);
    await logTemplateAudit(pool, 'report', Number(req.params.id), 'withdraw', actor,
      { version_no: v.version_no }, v.id);
    res.json(v);
  } catch (e: any) {
    sendError(res, e, 400);
  }
});

router.post('/:id/versions/:vid/review', async (req: Request, res: Response) => {
  const actor = readActor(req as any);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  if (!actorHasPermission(req as any, 'report_template.edit')) { res.status(403).json({ error: '当前角色无审核权限（需报告审核）' }); return; }
  const { decision, note } = req.body || {};
  try {
    const v = await reviewVersion(pool, 'report', Number(req.params.vid), decision, actor.name, note || null, actor.role);
    // 审核通过时附带绑定完整性告警（审核人据此判断是否带病生效）
    let binding_warnings: DanglingBinding[] = [];
    if (decision === 'approve') binding_warnings = await checkBindings(Number(req.params.id), (v as any)?.field_definitions, (v as any)?.layout_options?.conclusions);
    res.json({ ...v, binding_warnings });
  } catch (e: any) {
    sendError(res, e, 400);
  }
});

/** 回退到历史版本：克隆该版本内容为新草稿并提交审核（pending），审核通过后生效 */
router.post('/:id/versions/:vid/rollback', async (req: Request, res: Response) => {
  const actor = readActor(req as any);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  try {
    const v = await rollbackToVersion(pool, 'report', Number(req.params.id), Number(req.params.vid), actor);
    res.json(v);
  } catch (e: any) {
    sendError(res, e, 400);
  }
});

router.post('/:id/fork', async (req: Request, res: Response) => {
  const actor = readActor(req as any);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  const { name, parent_version_id } = req.body;
  if (!name) { res.status(400).json({ error: 'name required' }); return; }
  let pv = parent_version_id;
  if (!pv) {
    const cur = await pool.query(`SELECT current_version_id FROM report_templates WHERE id = $1`, [req.params.id]);
    pv = cur.rows[0]?.current_version_id;
    if (!pv) { res.status(400).json({ error: '母模板没有 current_version_id' }); return; }
  }
  try {
    const r = await forkTemplate(pool, 'report', Number(req.params.id), Number(pv), name, actor.name, actor.role);
    res.status(201).json(r);
  } catch (e: any) {
    sendError(res, e);
  }
});

/** 母 → 子同步（语义同 record-templates，见那边注释） */
router.post('/:id/sync-to-children', async (req: Request, res: Response) => {
  const actor = readActor(req as any);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  const { child_ids, include_added = true, source_version_id, dry_run = false } = req.body || {};
  if (!Array.isArray(child_ids) || child_ids.length === 0) {
    res.status(400).json({ error: 'child_ids required' }); return;
  }
  try {
    const r = await syncToChildren(pool, 'report', Number(req.params.id), {
      childIds: child_ids.map(Number), includeAdded: !!include_added,
      sourceVersionId: source_version_id ? Number(source_version_id) : null, dryRun: !!dry_run,
    }, actor);
    res.json(r);
  } catch (e: any) {
    sendError(res, e);
  }
});

/** 归档执行器（仅由删除审批通过后调用）— reports 表中已生成的历史报告永不删除（合规） */
async function performArchive(id: number, actor: { name: string; role?: string }, requestDetail: any) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // 软删：archived_at 非 NULL 表示模板归档，但版本历史 + 已生成的 reports 行完全保留；申请三列一并清空
    const r = await client.query(
      `UPDATE report_templates SET archived_at = NOW(), updated_at = NOW(),
              archive_requested_by = NULL, archive_requested_at = NULL, archive_request_note = NULL
       WHERE id = $1 AND archived_at IS NULL RETURNING id`,
      [id]
    );
    if (!r.rows.length) {
      await client.query('ROLLBACK');
      return { notFound: true };
    }
    // 子模板解除母关系（报告模板维度）；映射只对在册 parent 有意义，一并清掉
    await client.query('UPDATE report_templates SET parent_template_id = NULL, parent_version_id = NULL, field_mapping = NULL WHERE parent_template_id = $1', [id]);
    await logTemplateAudit(client, 'report', id, 'archive', actor, requestDetail);
    await client.query('COMMIT');
    return { ok: true };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** 发起删除申请 */
router.post('/:id/archive-request', async (req: Request, res: Response) => {
  const actor = readActor(req as any);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  try {
    res.json(await requestArchive(pool, 'report', Number(req.params.id), actor, req.body?.note));
  } catch (e: any) { sendError(res, e, 400); }
});

/** 撤销删除申请 */
router.post('/:id/archive-request/cancel', async (req: Request, res: Response) => {
  const actor = readActor(req as any);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  try {
    res.json(await cancelArchiveRequest(pool, 'report', Number(req.params.id), actor));
  } catch (e: any) { sendError(res, e, 400); }
});

/** 审批删除：body {decision, note}。批准即归档（申请人≠批准人，仅审核员） */
router.post('/:id/archive-review', async (req: Request, res: Response) => {
  const actor = readActor(req as any);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  const { decision, note } = req.body || {};
  try {
    const request = await reviewArchiveRequest(pool, 'report', Number(req.params.id), decision, actor, note);
    if (!request) { res.json({ ok: true, rejected: true }); return; }
    const r = await performArchive(Number(req.params.id), actor, {
      requested_by: request.archive_requested_by, request_note: request.archive_request_note, approve_note: note || null,
    });
    if ((r as any).notFound) { res.status(404).json({ error: '模板不存在或已归档' }); return; }
    res.json({ ok: true, archived: true });
  } catch (e: any) { sendError(res, e); }
});

/** 直接 DELETE 已停用：删除必须经审批流（合规） */
router.delete('/:id', async (_req: Request, res: Response) => {
  res.status(403).json({ error: '删除模板需经审批：请先「申请删除」，由审核员批准后生效' });
});

router.post('/:id/restore', async (req: Request, res: Response) => {
  const actor = readActor(req as any);
  const { id } = req.params;
  const r = await pool.query(
    `UPDATE report_templates SET archived_at = NULL, updated_at = NOW()
     WHERE id = $1 AND archived_at IS NOT NULL RETURNING *`, [id]
  );
  if (!r.rows.length) { res.status(404).json({ error: '模板不存在或未归档' }); return; }
  await logTemplateAudit(pool, 'report', Number(id), 'restore', actor.name ? actor : { name: '未知用户' });
  res.json(r.rows[0]);
});

export default router;
