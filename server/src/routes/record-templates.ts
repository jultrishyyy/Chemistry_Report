import { Router, Request, Response } from 'express';
import {
  listVersions, getVersion, createDraft, submitForReview, reviewVersion, withdrawVersion,
  forkTemplate, getLineage, syncToChildren, listAuditLog, logTemplateAudit, readActor,
  requestArchive, cancelArchiveRequest, reviewArchiveRequest, rollbackToVersion,
  diffFieldDefinitions, computeSyncedFieldDefinitions, VersionFlowError, actorHasPermission,
} from '../services/template-versions.js';

import { pool } from '../db.js';
import { assertEditLease } from '../services/collaboration.js';
import { ensureRecordIdentityFields } from '../../../shared/record-template-normalize.js';
import { isRecordFieldTransferable } from '../../../shared/record-field-transfer.js';
import { reportBindingReview } from '../../../shared/report-binding-review.js';

const router = Router();

/** Read-only impact preview. Never publishes a draft or rewrites report mappings. */
router.post('/:id/report-impact', async (req: Request, res: Response) => {
  if (!actorHasPermission(req as any, 'record_template.edit') && !actorHasPermission(req as any, 'record.review')) {
    res.status(403).json({ error: '当前账号无检查关联项目权限' }); return;
  }
  const groups = req.body?.groups;
  if (!Array.isArray(groups) || groups.some(g => !g || !Array.isArray(g.fields) || g.fields.some((f: any) => !f || typeof f !== 'object'))) {
    res.status(400).json({ error: '模板内容不完整，请刷新后重试' }); return;
  }
  try {
    const source = await pool.query('SELECT id FROM record_templates WHERE id=$1 AND archived_at IS NULL', [Number(req.params.id)]);
    if (!source.rows.length) { res.status(404).json({ error: '原始记录模板不存在' }); return; }
    const reports = await pool.query(
      `SELECT t.id, t.name, v.field_definitions, v.layout_options, v.id AS version_id,
              v.status AS checked_status
         FROM report_templates t
         LEFT JOIN LATERAL (
           SELECT pv.* FROM report_template_versions pv
            WHERE pv.template_id=t.id
              AND (pv.id=t.current_version_id OR
                (t.current_version_id IS NULL AND pv.status IN ('draft','pending','rejected')))
            ORDER BY pv.version_no DESC, pv.id DESC LIMIT 1
         ) v ON TRUE
        WHERE t.linked_record_template_id=$1 AND t.template_kind='project' AND t.archived_at IS NULL
        ORDER BY t.name, t.id`, [Number(req.params.id)]);
    res.json({ templates: reports.rows.map(row => ({
      id: row.id, name: row.name, checked: !!row.version_id,
      checked_status: row.checked_status || null,
      issues: row.version_id ? reportBindingReview(row.field_definitions || [], groups, row.layout_options?.conclusions || []) : [],
    })) });
  } catch (e: any) { sendError(res, e); }
});

/** 业务流错误带 status（409 冲突 / 403 权限），其余 500 */
function sendError(res: Response, e: any, fallback = 500) {
  res.status(e instanceof VersionFlowError ? e.status : fallback).json({ error: e.message });
}
function requirePermission(req: Request, res: Response, permission: 'record_template.edit' | 'record.review', label: string) {
  if (actorHasPermission(req as any, permission)) return true;
  res.status(403).json({ error: `当前账号无${label}权限` });
  return false;
}

async function syncCommonComponentLinks(db: { query: (sql: string, params?: any[]) => Promise<any> }, templateId: number, groups: any[]) {
  const refs = new Map<number, number | null>();
  for (const group of Array.isArray(groups) ? groups : []) {
    const componentId = Number(group?.common_component_id);
    if (Number.isFinite(componentId)) refs.set(componentId, group?.common_component_version_id ? Number(group.common_component_version_id) : null);
  }
  await db.query('DELETE FROM record_template_common_components WHERE template_id=$1', [templateId]);
  for (const [componentId, versionId] of refs) {
    await db.query(
      `INSERT INTO record_template_common_components (template_id,component_id,synced_component_version_id)
       VALUES ($1,$2,$3)`, [templateId, componentId, versionId],
    );
  }
}

/** 项目组只是模板归类。复用存量方案表保存一对一归属，方法名称/编码不再要求用户配置。 */
async function setTemplateFamily(
  db: { query: (sql: string, params?: any[]) => Promise<any> },
  templateId: number, familyId: number | null, templateName: string,
) {
  if (!familyId) {
    await db.query('DELETE FROM test_method_schemes WHERE record_template_id=$1', [templateId]);
    return;
  }
  await db.query(
    `INSERT INTO test_method_schemes
     (group_id,method_code,method_name,record_template_id,report_project_name,recommended,sort_order)
     VALUES ($1,$2,$3,$4,$3,FALSE,0)
     ON CONFLICT (record_template_id) DO UPDATE SET group_id=EXCLUDED.group_id,
       method_code=EXCLUDED.method_code,method_name=EXCLUDED.method_name,
       report_project_name=EXCLUDED.report_project_name,updated_at=NOW()`,
    [familyId, `template_${templateId}`, templateName, templateId],
  );
}

/** 同名校验：未归档的原始记录模板名称唯一（去首尾空格比较）。占用返回 true，excludeId 排除自身（改名用）。 */
async function recordNameTaken(name: string, excludeId?: number): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM record_templates WHERE archived_at IS NULL AND btrim(name) = btrim($1) AND ($2::int IS NULL OR id <> $2) LIMIT 1`,
    [name, excludeId ?? null]
  );
  return r.rows.length > 0;
}

/** 把版本行的受控列合进 layout_options.controlled，渲染层（themeConfigToTypstDict）据此印顶部受控行 */
function mergeControlled(row: any) {
  if (row && (row.controlled_no || row.controlled_issue_date || row.controlled_effective_date)) {
    row.layout_options = {
      ...(row.layout_options || {}),
      controlled: {
        no: row.controlled_no || '',
        issue_date: row.controlled_issue_date || '',
        effective_date: row.controlled_effective_date || '',
      },
    };
  }
  return row;
}

/**
 * open_draft 子查询：版本号最大的 draft/pending/rejected 且比当前生效版本新。
 * （rejected 冻结保留后，已被新版本取代的旧 rejected 行是纯历史，不算未定稿）
 */
const OPEN_DRAFT_SQL = `
  (SELECT json_build_object(
      'id', dv.id, 'version_no', dv.version_no, 'status', dv.status, 'author_name', dv.author_name,
      'submitted_by_name', dv.submitted_by_name, 'submitted_by_job_no', dv.submitted_by_job_no,
      'reviewer_name', dv.reviewer_name, 'review_note', dv.review_note,
      'change_summary', dv.change_summary, 'updated_at', dv.updated_at)
   FROM record_template_versions dv
   WHERE dv.template_id = t.id AND dv.status IN ('draft','pending','rejected')
     AND dv.version_no > COALESCE(cv.version_no, 0)
   ORDER BY dv.version_no DESC LIMIT 1) AS open_draft`;

router.get('/', async (req: Request, res: Response) => {
  const includeArchived = req.query.include_archived === '1';
  // status=approved：仅返回【当前生效版本已审核通过】的模板，供录入关联等"选用"场景过滤掉未审核模板。
  const approvedOnly = req.query.status === 'approved';
  const conds: string[] = [];
  if (!includeArchived) conds.push('t.archived_at IS NULL');
  if (approvedOnly) conds.push(`cv.status = 'approved'`);
  const whereSql = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const result = await pool.query(
    `SELECT t.id, t.name, t.version, t.source_file, t.created_at, t.updated_at,
            t.parent_template_id, t.current_version_id, t.archived_at,
            ms.id AS method_scheme_id, ms.method_code, ms.method_name, ms.standard AS method_standard,
            tg.id AS template_group_id, tg.code AS template_group_code, tg.name AS template_group_name,
            tg.shared_profile_code,
            t.archive_requested_by, t.archive_requested_at, t.archive_request_note,
            cv.version_no AS current_version_no, cv.status AS current_status,
            cv.author_name AS current_author,
            cv.layout_options->>'project_name' AS project_name,
            GREATEST(t.updated_at,
              (SELECT MAX(GREATEST(v.created_at, v.updated_at, COALESCE(v.reviewed_at, v.created_at)))
               FROM record_template_versions v WHERE v.template_id = t.id)) AS last_activity,
            ${OPEN_DRAFT_SQL}
     FROM record_templates t
     LEFT JOIN record_template_versions cv ON cv.id = t.current_version_id
     LEFT JOIN test_method_schemes ms ON ms.record_template_id = t.id
     LEFT JOIN test_template_groups tg ON tg.id = ms.group_id
     ${whereSql}
     ORDER BY t.id ASC`
  );
  res.json(result.rows);
});

router.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  // 返回 base 元数据 + 当前生效版本的字段定义（base 已不存 field_definitions）。
  // 少量历史模板尚未回填 current_version_id，但仍保有草稿/历史版本；这些模板用于
  // 「以现有模板为骨架」时不应得到空 field_definitions 后被前端误当作空白模板。
  // 因此仅在当前生效版本缺失时，回退到最新版本提供内容；current_version_no/status
  // 仍保留真实的生效状态，不把草稿伪装成已生效。
  const result = await pool.query(
    `SELECT t.id, t.name, t.version, t.source_file, t.created_at, t.updated_at,
            t.parent_template_id, t.parent_version_id, t.current_version_id, t.archived_at,
            ms.id AS method_scheme_id, ms.method_code, ms.method_name, ms.standard AS method_standard,
            ms.report_project_template_id, ms.report_project_name,
            tg.id AS template_group_id, tg.code AS template_group_code, tg.name AS template_group_name,
            tg.shared_profile_code,
            t.archive_requested_by, t.archive_requested_at, t.archive_request_note,
            t.field_mapping,
            cv.version_no AS current_version_no, cv.status AS current_status,
            COALESCE(cv.field_definitions, fallback.field_definitions) AS field_definitions,
            COALESCE(cv.layout_options, fallback.layout_options) AS layout_options,
            COALESCE(cv.typst_source, fallback.typst_source) AS typst_source,
            COALESCE(cv.controlled_no, fallback.controlled_no) AS controlled_no,
            COALESCE(cv.controlled_issue_date, fallback.controlled_issue_date) AS controlled_issue_date,
            COALESCE(cv.controlled_effective_date, fallback.controlled_effective_date) AS controlled_effective_date,
            ${OPEN_DRAFT_SQL}
     FROM record_templates t
     LEFT JOIN record_template_versions cv ON cv.id = t.current_version_id
     LEFT JOIN test_method_schemes ms ON ms.record_template_id = t.id
     LEFT JOIN test_template_groups tg ON tg.id = ms.group_id
     LEFT JOIN LATERAL (
       SELECT v.field_definitions, v.layout_options, v.typst_source,
              v.controlled_no, v.controlled_issue_date, v.controlled_effective_date
       FROM record_template_versions v
       WHERE v.template_id = t.id
       ORDER BY v.version_no DESC, v.id DESC
       LIMIT 1
     ) fallback ON true
     WHERE t.id = $1`, [id]
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Template not found' });
    return;
  }
  const row = mergeControlled(result.rows[0]);
  row.field_definitions = ensureRecordIdentityFields(row.field_definitions);
  res.json(row);
});

/** 列出所有版本 */
router.get('/:id/versions', async (req: Request, res: Response) => {
  const list = await listVersions(pool, 'record', Number(req.params.id));
  res.json(list);
});

/** 拿指定版本完整内容 */
router.get('/:id/versions/:vid', async (req: Request, res: Response) => {
  const v = await getVersion(pool, 'record', Number(req.params.vid));
  if (!v) { res.status(404).json({ error: 'Version not found' }); return; }
  const row = mergeControlled(v);
  row.field_definitions = ensureRecordIdentityFields(row.field_definitions);
  res.json(row);
});

/**
 * 实时 diff：该版本 vs 当前生效版本（审核预览用）。
 * approve 时存的 diff_from_prev 是定版记录，不受本端点影响。
 */
router.get('/:id/versions/:vid/diff', async (req: Request, res: Response) => {
  const v = await getVersion(pool, 'record', Number(req.params.vid));
  if (!v) { res.status(404).json({ error: 'Version not found' }); return; }
  const cur = await pool.query(
    `SELECT cv.field_definitions, cv.version_no FROM record_templates t
     JOIN record_template_versions cv ON cv.id = t.current_version_id WHERE t.id = $1`,
    [req.params.id]
  );
  const base = cur.rows[0] || null;
  res.json({
    against_version_no: base?.version_no ?? null,
    diff: diffFieldDefinitions(base?.field_definitions || null, v.field_definitions),
  });
});

/** 模板操作日志（创建/修改/提交/撤回/审核/fork/同步/归档/恢复/改名/受控登记） */
router.get('/:id/audit-log', async (req: Request, res: Response) => {
  res.json(await listAuditLog(pool, 'record', Number(req.params.id)));
});

/**
 * 受控登记（手动应急通道；接口⑦就绪后由外部回传同样写这里）。
 * 把受控号 / 颁布日期 / 实施日期 写到该模板「当前生效版本」上 → 随版本快照冻结、印到记录顶部。
 */
router.post('/:id/controlled', async (req: Request, res: Response) => {
  const actor = readActor(req as any);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  if (!requirePermission(req, res, 'record_template.edit', '设置模板受控信息')) return;
  const { controlled_no, controlled_issue_date, controlled_effective_date } = req.body || {};
  const r = await pool.query(
    `UPDATE record_template_versions
        SET controlled_no = $1, controlled_issue_date = $2, controlled_effective_date = $3
      WHERE id = (SELECT current_version_id FROM record_templates WHERE id = $4)
      RETURNING id`,
    [controlled_no || null, controlled_issue_date || null, controlled_effective_date || null, Number(req.params.id)]
  );
  if (!r.rows.length) { res.status(404).json({ error: '模板不存在或无当前生效版本' }); return; }
  await logTemplateAudit(pool, 'record', Number(req.params.id), 'controlled', actor,
    { controlled_no, controlled_issue_date, controlled_effective_date }, r.rows[0].id);
  res.json({ ok: true });
});

/** 母子树 */
router.get('/:id/lineage', async (req: Request, res: Response) => {
  const templateId = Number(req.params.id);
  const r = await getLineage(pool, 'record', templateId);
  const family = await pool.query(
    `SELECT g.id,g.name,g.code FROM test_method_schemes mine
       JOIN test_template_groups g ON g.id=mine.group_id
      WHERE mine.record_template_id=$1`, [templateId],
  );
  let familyRelation: any = null;
  if (family.rows.length) {
    const members = await pool.query(
      `SELECT t.id,t.name,t.parent_template_id,t.current_version_id,v.version_no,v.status
         FROM test_method_schemes m JOIN record_templates t ON t.id=m.record_template_id
         LEFT JOIN record_template_versions v ON v.id=t.current_version_id
        WHERE m.group_id=$1 AND t.archived_at IS NULL ORDER BY t.name,t.id`, [family.rows[0].id],
    );
    familyRelation = { ...family.rows[0], members: members.rows };
  }
  res.json({ ...r, family: familyRelation });
});

router.post('/', async (req: Request, res: Response) => {
  const actor = readActor(req as any);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  if (!requirePermission(req, res, 'record_template.edit', '编辑原始记录模板')) return;
  const { name, field_definitions, typst_source, source_file, layout_options, parent_template_id, parent_version_id,
    template_group_id } = req.body;
  if (!name || !field_definitions) { res.status(400).json({ error: 'name and field_definitions are required' }); return; }
  if (await recordNameTaken(name)) { res.status(409).json({ error: `已存在同名原始记录模板「${String(name).trim()}」，请换一个名称`, code: 'duplicate_name' }); return; }
  // 新建模板初始为草稿(draft)、无生效版本：必须走「提交审核 → 审核通过」后才生效，
  // 未通过前在录入关联等选用场景中禁选（服务端 /link 也会兜底 409）。
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // base 只存元数据；字段内容全部走版本表
    const ins = await client.query(
      `INSERT INTO record_templates (name, source_file, parent_template_id, parent_version_id)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, source_file || null, parent_template_id || null, parent_version_id || null]
    );
    const t = ins.rows[0];
    const v1 = await client.query(
      `INSERT INTO record_template_versions (template_id, version_no, field_definitions, layout_options, typst_source,
                                              status, author_name, change_summary)
       VALUES ($1, 1, $2::jsonb, $3::jsonb, $4, 'draft', $5, $6) RETURNING id`,
      [t.id, JSON.stringify(field_definitions), JSON.stringify(layout_options || {}), typst_source || null,
       actor.name, '初始版本']
    );
    await logTemplateAudit(client, 'record', t.id, 'create', actor, { name }, v1.rows[0].id);
    await syncCommonComponentLinks(client, t.id, field_definitions);
    if (template_group_id) await setTemplateFamily(client, t.id, Number(template_group_id), String(name).trim());
    await client.query('COMMIT');
    res.status(201).json({ ...t, current_version_id: null });
  } catch (e: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

/** 只修改项目组归属，不创建内容草稿。 */
router.put('/:id/family', async (req: Request, res: Response) => {
  const actor = readActor(req as any); const id = Number(req.params.id);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  if (!requirePermission(req, res, 'record_template.edit', '编辑原始记录模板')) return;
  const template = await pool.query('SELECT id,name FROM record_templates WHERE id=$1 AND archived_at IS NULL', [id]);
  if (!template.rows.length) { res.status(404).json({ error: '原始记录模板不存在' }); return; }
  try {
    await setTemplateFamily(pool, id, req.body?.template_group_id ? Number(req.body.template_group_id) : null, template.rows[0].name);
    await logTemplateAudit(pool, 'record', id, 'family_change', actor, { template_group_id: req.body?.template_group_id || null });
    res.json({ ok: true, template_group_id: req.body?.template_group_id || null });
  } catch (e: any) { sendError(res, e); }
});

/** PUT /:id 不再直接改主表；改为创建/更新一个 draft（不会立即生效） */
router.put('/:id', async (req: Request, res: Response) => {
  const actor = readActor(req as any);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  if (!requirePermission(req, res, 'record_template.edit', '编辑原始记录模板')) return;
  const id = Number(req.params.id);
  if (!await assertEditLease(req, res, 'record_template', String(id))) return;
  const { field_definitions, typst_source, layout_options, change_summary, name, draft_updated_at,
    template_group_id } = req.body;
  if (!field_definitions) { res.status(400).json({ error: 'field_definitions required' }); return; }
  try {
    // name 改动不走版本流，直接改 base（视为元数据）
    if (name) {
      const old = await pool.query(`SELECT name FROM record_templates WHERE id = $1`, [id]);
      if (old.rows[0] && old.rows[0].name !== name) {
        if (await recordNameTaken(name, id)) { res.status(409).json({ error: `已存在同名原始记录模板「${String(name).trim()}」，请换一个名称`, code: 'duplicate_name' }); return; }
        await pool.query(`UPDATE record_templates SET name = $1, updated_at = NOW() WHERE id = $2`, [name, id]);
        await logTemplateAudit(pool, 'record', id, 'rename', actor, { from: old.rows[0].name, to: name });
      }
    }
    const draft = await createDraft(pool, 'record', id, actor.name,
      { field_definitions, layout_options, typst_source, change_summary, draft_updated_at });
    await syncCommonComponentLinks(pool, id, field_definitions);
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'template_group_id')) {
      await setTemplateFamily(pool, id, template_group_id ? Number(template_group_id) : null,
        String(name || `原始记录模板 ${id}`).trim());
    }
    await logTemplateAudit(pool, 'record', id, 'update_draft', actor,
      { version_no: draft.version_no }, draft.id);
    res.json(draft);
  } catch (e: any) {
    sendError(res, e);
  }
});

/** 提交审核 */
router.post('/:id/submit', async (req: Request, res: Response) => {
  const actor = readActor(req as any);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  if (!requirePermission(req, res, 'record_template.edit', '提交模板审核')) return;
  const { version_id, change_summary } = req.body;
  if (!version_id) { res.status(400).json({ error: 'version_id required' }); return; }
  try {
    const v = await submitForReview(pool, 'record', Number(version_id), actor.name, actor.role, change_summary, actor.jobNo);
    await logTemplateAudit(pool, 'record', Number(req.params.id), 'submit', actor,
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
  if (!requirePermission(req, res, 'record_template.edit', '撤回模板审核')) return;
  try {
    const v = await withdrawVersion(pool, 'record', Number(req.params.vid), actor.name, actor.role, actor.jobNo);
    await logTemplateAudit(pool, 'record', Number(req.params.id), 'withdraw', actor,
      { version_no: v.version_no }, v.id);
    res.json(v);
  } catch (e: any) {
    sendError(res, e, 400);
  }
});

/** 审核（approve / reject 事件由 service 随事务写入审计日志） */
router.post('/:id/versions/:vid/review', async (req: Request, res: Response) => {
  const actor = readActor(req as any);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  if (!requirePermission(req, res, 'record.review', '审核原始记录模板')) return;
  const { decision, note } = req.body || {};
  try {
    const v = await reviewVersion(pool, 'record', Number(req.params.vid), decision, actor.name, note || null, actor.role, actor.jobNo, actor.roles);
    res.json(v);
  } catch (e: any) {
    sendError(res, e, 400);
  }
});

/** 回退到历史版本：克隆该版本内容为新草稿并提交审核（pending），审核通过后生效 */
router.post('/:id/versions/:vid/rollback', async (req: Request, res: Response) => {
  const actor = readActor(req as any);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  if (!requirePermission(req, res, 'record_template.edit', '恢复模板版本')) return;
  try {
    const v = await rollbackToVersion(pool, 'record', Number(req.params.id), Number(req.params.vid), actor);
    res.json(v);
  } catch (e: any) {
    sendError(res, e, 400);
  }
});

/** Fork 派生子模板（fork_out / fork_in 审计 + 字段映射由 service 写入） */
router.post('/:id/fork', async (req: Request, res: Response) => {
  const actor = readActor(req as any);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  if (!requirePermission(req, res, 'record_template.edit', '派生模板')) return;
  const { name, parent_version_id } = req.body;
  if (!name) { res.status(400).json({ error: 'name required' }); return; }
  if (await recordNameTaken(name)) { res.status(409).json({ error: `已存在同名原始记录模板「${String(name).trim()}」，请换一个名称`, code: 'duplicate_name' }); return; }
  // 默认从当前生效版本派生
  let pv = parent_version_id;
  if (!pv) {
    const cur = await pool.query(`SELECT current_version_id FROM record_templates WHERE id = $1`, [req.params.id]);
    pv = cur.rows[0]?.current_version_id;
    if (!pv) { res.status(400).json({ error: '母模板没有 current_version_id' }); return; }
  }
  try {
    const r = await forkTemplate(pool, 'record', Number(req.params.id), Number(pv), name, actor.name, actor.role);
    res.status(201).json(r);
  } catch (e: any) {
    sendError(res, e);
  }
});

/**
 * 母 → 子同步：把源版本（默认当前生效版本）的字段按映射应用到选中的直接子模板，
 * 每个子模板生成 pending 版本，须经各自审核通过才生效。
 * body: {child_ids: number[], include_added?: boolean, source_version_id?: number, dry_run?: boolean}
 */
router.post('/:id/sync-to-children', async (req: Request, res: Response) => {
  const actor = readActor(req as any);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  if (!requirePermission(req, res, 'record_template.edit', '同步模板')) return;
  const { child_ids, include_added = true, source_version_id, dry_run = false } = req.body || {};
  if (!Array.isArray(child_ids) || child_ids.length === 0) {
    res.status(400).json({ error: 'child_ids required' }); return;
  }
  try {
    const r = await syncToChildren(pool, 'record', Number(req.params.id), {
      childIds: child_ids.map(Number), includeAdded: !!include_added,
      sourceVersionId: source_version_id ? Number(source_version_id) : null, dryRun: !!dry_run,
    }, actor);
    res.json(r);
  } catch (e: any) {
    sendError(res, e);
  }
});

/**
 * 项目组成员间按字段标识/编码同步。来源和目标不要求存在母子关系；目标专有字段不会被删除。
 * body: {target_ids:number[], include_added?:boolean, dry_run?:boolean}
 */
router.post('/:id/sync-to-family', async (req: Request, res: Response) => {
  const actor = readActor(req as any); const sourceId = Number(req.params.id);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  if (!requirePermission(req, res, 'record_template.edit', '同步项目组模板')) return;
  const targetIds = [...new Set((Array.isArray(req.body?.target_ids) ? req.body.target_ids : [])
    .map(Number).filter((id: number) => Number.isFinite(id) && id !== sourceId))];
  if (!targetIds.length) { res.status(400).json({ error: '请至少选择一个项目组目标模板' }); return; }
  try {
    const source = await pool.query(
      `SELECT t.id,t.name,t.current_version_id,v.version_no,v.status,v.field_definitions
         FROM record_templates t JOIN record_template_versions v ON v.id=t.current_version_id
        WHERE t.id=$1 AND t.archived_at IS NULL`, [sourceId],
    );
    if (!source.rows.length || source.rows[0].status !== 'approved') {
      throw new VersionFlowError('只能从当前已审核生效的模板同步', 409);
    }
    const membership = await pool.query('SELECT group_id FROM test_method_schemes WHERE record_template_id=$1', [sourceId]);
    if (!membership.rows.length) throw new VersionFlowError('当前模板尚未加入项目组', 409);
    const targets = await pool.query(
      `SELECT t.id,t.name,t.current_version_id,v.version_no,v.field_definitions,v.layout_options,v.typst_source
         FROM test_method_schemes m JOIN record_templates t ON t.id=m.record_template_id
         LEFT JOIN record_template_versions v ON v.id=t.current_version_id
        WHERE m.group_id=$1 AND t.id=ANY($2::int[]) AND t.archived_at IS NULL ORDER BY t.name,t.id`,
      [membership.rows[0].group_id, targetIds],
    );
    if (targets.rows.length !== targetIds.length) throw new VersionFlowError('部分目标模板不属于当前项目组', 409);

    const result: any = { source_version_no: source.rows[0].version_no, applied: [], skipped: [], preview: [] };
    const sourceGroups = source.rows[0].field_definitions || [];
    const sourceFields = sourceGroups.flatMap((group: any) => (group.fields || [])
      .filter((field: any) => isRecordFieldTransferable(field, group))
      .map((field: any) => ({ field, group })));
    for (const target of targets.rows) {
      const open = await pool.query(
        `SELECT version_no,status,author_name FROM record_template_versions
          WHERE template_id=$1 AND status IN ('draft','pending','rejected') AND version_no>$2
          ORDER BY version_no DESC LIMIT 1`, [target.id, Number(target.version_no || 0)],
      );
      if (open.rows.length) {
        const blocked = `存在未定稿 v${open.rows[0].version_no}，为避免覆盖已跳过`;
        if (req.body?.dry_run) result.preview.push({ id: target.id, name: target.name, stats: { replaced: [], removed: [], added: [] }, blocked });
        else result.skipped.push({ id: target.id, name: target.name, reason: blocked });
        continue;
      }
      if (!target.current_version_id) {
        const blocked = '目标模板没有当前生效版本';
        if (req.body?.dry_run) result.preview.push({ id: target.id, name: target.name, stats: { replaced: [], removed: [], added: [] }, blocked });
        else result.skipped.push({ id: target.id, name: target.name, reason: blocked });
        continue;
      }
      const targetGroups = target.field_definitions || [];
      const mapping: any = { groups: {}, fields: {} };
      for (const targetGroup of targetGroups) {
        const sourceGroup = sourceGroups.find((group: any) => group.id === targetGroup.id)
          || sourceGroups.find((group: any) => String(group.label || '').trim() === String(targetGroup.label || '').trim());
        if (sourceGroup) mapping.groups[targetGroup.id] = sourceGroup.id;
        for (const targetField of targetGroup.fields || []) {
          const match = sourceFields.find((entry: any) => entry.field.id === targetField.id)
            || sourceFields.find((entry: any) => entry.field.code && entry.field.code === targetField.code
              && entry.field.type === targetField.type);
          if (match) mapping.fields[targetField.id] = match.field.id;
        }
      }
      const computed = computeSyncedFieldDefinitions(
        sourceGroups,
        targetGroups,
        mapping,
        !!req.body?.include_added,
        { fieldFilter: isRecordFieldTransferable, syncGroupMetadata: false },
      );
      const changeCount = computed.stats.replaced.length + computed.stats.removed.length + computed.stats.added.length;
      if (req.body?.dry_run) {
        result.preview.push({ id: target.id, name: target.name, stats: computed.stats,
          ...(changeCount ? {} : { blocked: '相同字段没有变化，无需同步' }) });
        continue;
      }
      if (!changeCount) { result.skipped.push({ id: target.id, name: target.name, reason: '相同字段没有变化，无需同步' }); continue; }
      const summary = `同步自项目组模板「${source.rows[0].name}」v${source.rows[0].version_no}`;
      const draft = await createDraft(pool, 'record', target.id, actor.name, {
        field_definitions: computed.field_definitions, layout_options: target.layout_options,
        typst_source: target.typst_source, change_summary: summary,
      });
      const pending = await submitForReview(pool, 'record', draft.id, actor.name, actor.role, summary, actor.jobNo);
      await logTemplateAudit(pool, 'record', target.id, 'sync_in', actor, {
        family_source_template_id: sourceId, source_version_no: source.rows[0].version_no,
        version_no: pending.version_no, stats: computed.stats,
      }, pending.id);
      result.applied.push({ id: target.id, name: target.name, version_no: pending.version_no, stats: computed.stats });
    }
    if (!req.body?.dry_run) delete result.preview;
    res.json(result);
  } catch (e: any) { sendError(res, e); }
});

/**
 * 归档执行器（仅由删除审批通过后调用）。
 * record_data 永不物理删除（合规要求）；force 时解除报告模板关联 + 子模板 parent。
 * 返回 {conflict} 表示需要 force 确认（存在活跃报告模板引用）。
 */
async function performArchive(id: number, force: boolean, actor: { name: string; role?: string }, requestDetail: any) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const recCount = (await client.query('SELECT COUNT(*)::int AS n FROM record_data WHERE template_id = $1', [id])).rows[0].n;
    const reportRefCount = (await client.query('SELECT COUNT(*)::int AS n FROM report_templates WHERE linked_record_template_id = $1 AND archived_at IS NULL', [id])).rows[0].n;
    const childCount = (await client.query('SELECT COUNT(*)::int AS n FROM record_templates WHERE parent_template_id = $1 AND archived_at IS NULL', [id])).rows[0].n;
    if (reportRefCount > 0 && !force) {
      await client.query('ROLLBACK');
      return {
        conflict: {
          error: '存在活跃的报告模板引用此模板，无法归档',
          record_data_count: recCount,
          report_template_refs: reportRefCount,
          child_template_count: childCount,
          hint: '带 force:true 重新批准（会解除报告模板的关联 + 子模板的 parent；record_data 始终保留）',
        },
      };
    }
    if (force) {
      await client.query('UPDATE report_templates SET linked_record_template_id = NULL WHERE linked_record_template_id = $1', [id]);
      // 解除母子关系时字段映射一并清掉（映射只对在册 parent 有意义）
      await client.query('UPDATE record_templates SET parent_template_id = NULL, parent_version_id = NULL, field_mapping = NULL WHERE parent_template_id = $1', [id]);
    }
    // 软删：archived_at 非 NULL 的模板列表过滤掉，但 record_data + 版本历史保留；申请三列一并清空
    const r = await client.query(
      `UPDATE record_templates SET archived_at = NOW(), updated_at = NOW(),
              archive_requested_by = NULL, archive_requested_at = NULL, archive_request_note = NULL
       WHERE id = $1 AND archived_at IS NULL RETURNING id`,
      [id]
    );
    if (!r.rows.length) {
      await client.query('ROLLBACK');
      return { notFound: true };
    }
    await logTemplateAudit(client, 'record', id, 'archive', actor,
      { force, record_data_count: recCount, report_template_refs: reportRefCount, child_template_count: childCount, ...requestDetail });
    await client.query('COMMIT');
    return { ok: true, record_data_preserved: recCount };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** 发起删除申请（任何登录用户；需审核员批准后才真正归档） */
router.post('/:id/archive-request', async (req: Request, res: Response) => {
  const actor = readActor(req as any);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  if (!requirePermission(req, res, 'record_template.edit', '删除模板')) return;
  try {
    res.json(await requestArchive(pool, 'record', Number(req.params.id), actor, req.body?.note));
  } catch (e: any) { sendError(res, e, 400); }
});

/** 撤销删除申请（申请人或审核员） */
router.post('/:id/archive-request/cancel', async (req: Request, res: Response) => {
  const actor = readActor(req as any);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  if (!requirePermission(req, res, 'record_template.edit', '撤销删除申请')) return;
  try {
    res.json(await cancelArchiveRequest(pool, 'record', Number(req.params.id), actor));
  } catch (e: any) { sendError(res, e, 400); }
});

/** 审批删除：body {decision: 'approve'|'reject', note?, force?}。批准即归档（申请人≠批准人，仅审核员） */
router.post('/:id/archive-review', async (req: Request, res: Response) => {
  const actor = readActor(req as any);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  if (!requirePermission(req, res, 'record.review', '审批模板删除')) return;
  const { decision, note, force } = req.body || {};
  try {
    const request = await reviewArchiveRequest(pool, 'record', Number(req.params.id), decision, actor, note);
    if (!request) { res.json({ ok: true, rejected: true }); return; }   // reject 已在 service 完成
    const r = await performArchive(Number(req.params.id), !!force, actor, {
      requested_by: request.archive_requested_by, request_note: request.archive_request_note, approve_note: note || null,
    });
    if ((r as any).conflict) { res.status(409).json((r as any).conflict); return; }
    if ((r as any).notFound) { res.status(404).json({ error: '模板不存在或已归档' }); return; }
    res.json({ ok: true, archived: true, ...r });
  } catch (e: any) { sendError(res, e); }
});

/** 直接 DELETE 已停用：删除必须经审批流（合规） */
router.delete('/:id', async (_req: Request, res: Response) => {
  res.status(403).json({ error: '删除模板需经审批：请先「申请删除」，由审核员批准后生效' });
});

/** 恢复已归档的模板 */
router.post('/:id/restore', async (req: Request, res: Response) => {
  const actor = readActor(req as any);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  if (!requirePermission(req, res, 'record_template.edit', '恢复模板')) return;
  const { id } = req.params;
  const r = await pool.query(
    `UPDATE record_templates SET archived_at = NULL, updated_at = NOW()
     WHERE id = $1 AND archived_at IS NOT NULL RETURNING *`,
    [id]
  );
  if (!r.rows.length) { res.status(404).json({ error: '模板不存在或未归档' }); return; }
  await logTemplateAudit(pool, 'record', Number(id), 'restore', actor.name ? actor : { name: '未知用户' });
  res.json(r.rows[0]);
});

export default router;
