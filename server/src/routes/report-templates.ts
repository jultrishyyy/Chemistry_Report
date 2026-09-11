import { Router, Request, Response } from 'express';
import {
  listVersions, getVersion, createDraft, submitForReview, reviewVersion, withdrawVersion,
  forkTemplate, getLineage, syncToChildren, listAuditLog, logTemplateAudit, readActor,
  requestArchive, cancelArchiveRequest, reviewArchiveRequest, rollbackToVersion,
  diffFieldDefinitions, computeSyncedFieldDefinitions, VersionFlowError, actorHasPermission,
} from '../services/template-versions.js';
import { validateReportBindings, validateProjectConclusions, type DanglingBinding } from '../../../shared/binding-integrity.ts';
import type { FieldGroup } from '../../../shared/types.js';
// Explicit source prevents stale tsc artifacts from changing server-side inheritance.
import { buildProjectGroupsFromRecord, detectProjectConclusionBinding } from '../../../shared/report-inherit.ts';

import { pool } from '../db.js';
import { assertEditLease } from '../services/collaboration.js';

const router = Router();

function sendError(res: Response, e: any, fallback = 500) {
  res.status(e instanceof VersionFlowError ? e.status : fallback).json({ error: e.message });
}
function requirePermission(req: Request, res: Response, permission: 'report_template.edit' | 'report.review', label: string) {
  if (actorHasPermission(req as any, permission)) return true;
  res.status(403).json({ error: `当前账号无${label}权限` });
  return false;
}

/** 报告模板 kind 的中文名（同名校验提示用）。 */
const KIND_LABEL: Record<string, string> = { cover: '首页', cover_page: '封面', project: '项目' };
/** 同名校验：未归档报告模板【同 kind 内】名称唯一（去首尾空格）。占用返回 true，excludeId 排除自身（改名用）。 */
async function reportNameTaken(name: string, kind: string, excludeId?: number): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM report_templates WHERE archived_at IS NULL AND template_kind = $1 AND btrim(name) = btrim($2) AND ($3::int IS NULL OR id <> $3) LIMIT 1`,
    [kind, name, excludeId ?? null]
  );
  return r.rows.length > 0;
}

async function assertReportGroupKind(
  db: { query: (sql: string, params?: any[]) => Promise<any> },
  familyId: unknown,
  templateKind: string,
) {
  if (!familyId) return;
  const result = await db.query(
    `SELECT template_kind FROM report_project_template_families
      WHERE id=$1 AND archived_at IS NULL`, [Number(familyId)],
  );
  if (!result.rows.length) throw new VersionFlowError('所选项目组不存在或已删除', 400);
  if (result.rows[0].template_kind !== templateKind) {
    throw new VersionFlowError('模板类型与所选项目组类型不一致', 400);
  }
}

/**
 * 取某报告模板关联原始记录的有效 groups：生效版本优先；没有生效版本时回退最新未定稿版本。
 * 必须与客户端 fetchRecordTemplateForLink 同口径，否则仅有草稿的记录模板会在保存报告时被整表误报失效。
 */
async function loadLinkedRecordGroups(reportTemplateId: number): Promise<FieldGroup[] | undefined> {
  const r = await pool.query(
    `SELECT COALESCE(rv.field_definitions, draft.field_definitions) AS field_definitions
       FROM report_templates rt
       JOIN record_templates rec ON rec.id = rt.linked_record_template_id
       LEFT JOIN record_template_versions rv ON rv.id = rec.current_version_id
       LEFT JOIN LATERAL (
         SELECT v.field_definitions
           FROM record_template_versions v
          WHERE v.template_id = rec.id AND v.status IN ('draft', 'pending', 'rejected')
          ORDER BY v.version_no DESC LIMIT 1
       ) draft ON TRUE
      WHERE rt.id = $1 AND rt.linked_record_template_id IS NOT NULL`,
    [reportTemplateId]
  );
  return (r.rows[0]?.field_definitions as FieldGroup[] | undefined) ?? undefined;
}

/** 校验给定报告 groups（+ 检测结论声明）的所有数据绑定是否命中关联原始记录字段集 */
async function checkBindings(reportTemplateId: number, reportGroups: FieldGroup[] | undefined, conclusions?: any[]): Promise<DanglingBinding[]> {
  const recordGroups = await loadLinkedRecordGroups(reportTemplateId);
  const hasRecordConclusion = !!recordGroups?.some(group =>
    (group.section_role === 'conclusion' && group.fields?.some(field => field.conclusion_role === 'project_name'))
    || group.fields?.some(field => field.type === 'record_conclusion' && field.record_conclusion));
  return validateReportBindings(reportGroups, recordGroups, hasRecordConclusion ? [] : conclusions);
}

async function assertFamilyInheritedGroupsUnchanged(templateId: number, submittedGroups: FieldGroup[]) {
  const result = await pool.query(
    `SELECT t.field_mapping,COALESCE(cv.field_definitions,fallback.field_definitions) AS field_definitions
       FROM report_templates t
       LEFT JOIN report_template_versions cv ON cv.id=t.current_version_id
       LEFT JOIN LATERAL (
         SELECT v.field_definitions FROM report_template_versions v WHERE v.template_id=t.id
         ORDER BY v.version_no DESC,v.id DESC LIMIT 1
       ) fallback ON TRUE
      WHERE t.id=$1`, [templateId],
  );
  const row = result.rows[0];
  const inheritedParentIds: string[] = row?.field_mapping?.inherited_group_ids;
  if (!Array.isArray(inheritedParentIds)) return;
  const mappedChildIds = Object.entries(row.field_mapping?.groups || {})
    .filter(([, parentId]) => inheritedParentIds.includes(String(parentId))).map(([childId]) => childId);
  const before = new Map((row.field_definitions || []).map((group: any) => [String(group.id), group]));
  const after = new Map((submittedGroups || []).map((group: any) => [String(group.id), group]));
  const changed = mappedChildIds.filter(id => JSON.stringify(before.get(id)) !== JSON.stringify(after.get(id)))
    .map(id => (before.get(id) as any)?.label || (after.get(id) as any)?.label || id);
  if (changed.length) throw new VersionFlowError(
    `分区「${changed.join('、')}」继承自报告项目组基础模板，不能在单个派生项目模板中修改`,409,
  );
}

/** open_draft 子查询：版本号最大的未定稿，且比当前生效版本新（rejected 冻结后旧行是纯历史） */
const OPEN_DRAFT_SQL = `
  (SELECT json_build_object(
      'id', dv.id, 'version_no', dv.version_no, 'status', dv.status, 'author_name', dv.author_name,
      'submitted_by_name', dv.submitted_by_name, 'submitted_by_job_no', dv.submitted_by_job_no,
      'reviewer_name', dv.reviewer_name, 'review_note', dv.review_note,
      'change_summary', dv.change_summary, 'updated_at', dv.updated_at)
   FROM report_template_versions dv
   WHERE dv.template_id = t.id AND dv.status IN ('draft','pending','rejected')
     AND dv.version_no > COALESCE(cv.version_no, 0)
   ORDER BY dv.version_no DESC LIMIT 1) AS open_draft`;

router.get('/', async (req: Request, res: Response) => {
  const { kind } = req.query as { kind?: string };
  const hostManufacturerId = req.query.host_manufacturer_id ? Number(req.query.host_manufacturer_id) : null;
  const includeArchived = req.query.include_archived === '1';
  const where: string[] = [];
  const params: any[] = [];
  if (kind) {
    params.push(kind);
    where.push(`t.template_kind = $${params.length}`);
  }
  if (hostManufacturerId) { params.push(hostManufacturerId); where.push(`t.host_manufacturer_id = $${params.length}`); }
  if (!includeArchived) where.push(`t.archived_at IS NULL`);
  // status=approved：仅返回当前生效版本已审核通过的模板（首页/项目选用时过滤未审核模板）。
  if (req.query.status === 'approved') where.push(`cv.status = 'approved'`);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const result = await pool.query(
    `SELECT t.id, t.name, t.version, t.source_file, t.template_kind, t.test_project_codes,
            t.linked_record_template_id,
            t.report_project_family_id,pf.name AS report_project_family_name,
            pf.record_template_group_id,pf.base_report_template_id,
            linked_rt.name AS linked_record_template_name,
            linked_rv.layout_options->>'project_name' AS linked_record_project_name,
            t.host_manufacturer_id, hm.name AS host_manufacturer_name,
            hm.category AS host_manufacturer_category, cv.layout_options, t.created_at, t.updated_at,
            t.parent_template_id, t.current_version_id,
            t.archive_requested_by, t.archive_requested_at, t.archive_request_note,
            cv.version_no AS current_version_no, cv.status AS current_status,
            cv.author_name AS current_author,
            cv.reviewer_name AS current_reviewer,
            -- 当前生效版本的字段分区数：0＝空/旧版模板（无结构化 content_doc），选用时禁选避免生成出无法编辑的报告
            COALESCE(jsonb_array_length(cv.field_definitions), 0) AS current_field_group_count,
            GREATEST(t.updated_at,
              (SELECT MAX(GREATEST(v.created_at, v.updated_at, COALESCE(v.reviewed_at, v.created_at)))
               FROM report_template_versions v WHERE v.template_id = t.id)) AS last_activity,
            ${OPEN_DRAFT_SQL}
     FROM report_templates t LEFT JOIN report_project_template_families pf ON pf.id=t.report_project_family_id
     LEFT JOIN host_manufacturers hm ON hm.id = t.host_manufacturer_id
     LEFT JOIN record_templates linked_rt ON linked_rt.id = t.linked_record_template_id
     LEFT JOIN record_template_versions linked_rv ON linked_rv.id = linked_rt.current_version_id
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
            t.linked_record_template_id,t.report_project_family_id,pf.name AS report_project_family_name,
            pf.record_template_group_id,pf.base_report_template_id,
            t.host_manufacturer_id, hm.name AS host_manufacturer_name,
            hm.category AS host_manufacturer_category, t.created_at, t.updated_at,
            t.parent_template_id, t.parent_version_id, t.current_version_id, t.archived_at,
            t.archive_requested_by, t.archive_requested_at, t.archive_request_note,
            t.field_mapping,
            cv.version_no AS current_version_no, cv.status AS current_status,
            cv.field_definitions, cv.layout_options, cv.typst_source,
            ${OPEN_DRAFT_SQL}
     FROM report_templates t LEFT JOIN report_project_template_families pf ON pf.id=t.report_project_family_id
     LEFT JOIN host_manufacturers hm ON hm.id = t.host_manufacturer_id
     LEFT JOIN report_template_versions cv ON cv.id = t.current_version_id
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
  const templateId = Number(req.params.id);
  const relation = await getLineage(pool, 'report', templateId);
  const family = await pool.query(
    `SELECT f.id,f.name,f.code,f.template_kind
       FROM report_templates t
       JOIN report_project_template_families f ON f.id=t.report_project_family_id
      WHERE t.id=$1 AND f.archived_at IS NULL`, [templateId],
  );
  let familyRelation: any = null;
  if (family.rows.length) {
    const members = await pool.query(
      `SELECT t.id,t.name,t.template_kind,t.parent_template_id,t.current_version_id,v.version_no,v.status
         FROM report_templates t
         LEFT JOIN report_template_versions v ON v.id=t.current_version_id
        WHERE t.report_project_family_id=$1 AND t.archived_at IS NULL
        ORDER BY t.name,t.id`, [family.rows[0].id],
    );
    familyRelation = { ...family.rows[0], members: members.rows };
  }
  res.json({ ...relation, family: familyRelation });
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
  const hasRecordConclusion = !!recordGroups?.some(group =>
    (group.section_role === 'conclusion' && group.fields?.some(field => field.conclusion_role === 'project_name'))
    || group.fields?.some(field => field.type === 'record_conclusion' && field.record_conclusion));
  const warnings = validateReportBindings(row.field_definitions as FieldGroup[] | undefined, recordGroups,
    hasRecordConclusion ? [] : (row.layout_options as any)?.conclusions);
  res.json({ linked: recordGroups !== undefined, warnings });
});

router.post('/', async (req: Request, res: Response) => {
  const actor = readActor(req as any);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  if (!requirePermission(req, res, 'report_template.edit', '编辑报告模板')) return;
  const {
    name, typst_source, source_file,
    template_kind = 'cover', test_project_codes, linked_record_template_id, host_manufacturer_id, report_project_family_id, layout_options,
    field_definitions, parent_template_id, parent_version_id,
  } = req.body;
  if (!name) { res.status(400).json({ error: 'name is required' }); return; }
  if (await reportNameTaken(name, template_kind)) {
    res.status(409).json({ error: `已存在同名${KIND_LABEL[template_kind] || ''}模板「${String(name).trim()}」，请换一个名称`, code: 'duplicate_name' });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await assertReportGroupKind(client, report_project_family_id, template_kind);
    let initialFieldDefinitions: FieldGroup[] = Array.isArray(field_definitions) ? field_definitions : [];
    let initialLayoutOptions: Record<string, any> = layout_options && typeof layout_options === 'object' ? { ...layout_options } : {};
    let inheritanceResult: { mapped: number; manual: number; record_template_id: number } | null = null;

    // 新建项目模板勾选“从关联原始记录拉取”时，在创建事务内直接生成并保存完整 v1 草稿。
    // 不再只写 pending 标记后依赖编辑器 useEffect，否则首次进入可能仍看到空模板。
    if (template_kind === 'project' && linked_record_template_id && initialLayoutOptions.pending_record_inherit) {
      const linked = await client.query(
        `SELECT r.id, r.name,
                COALESCE(cv.version_no, fallback.version_no, r.version) AS version_no,
                COALESCE(cv.field_definitions, fallback.field_definitions) AS field_definitions
           FROM record_templates r
           LEFT JOIN record_template_versions cv ON cv.id = r.current_version_id
           LEFT JOIN LATERAL (
             SELECT v.version_no, v.field_definitions
               FROM record_template_versions v
              WHERE v.template_id = r.id
              ORDER BY v.version_no DESC, v.id DESC
              LIMIT 1
           ) fallback ON TRUE
          WHERE r.id = $1 AND r.archived_at IS NULL`,
        [linked_record_template_id],
      );
      if (!linked.rows.length) throw new VersionFlowError('关联的原始记录模板不存在或已归档', 400);
      const recordGroups: FieldGroup[] = Array.isArray(linked.rows[0].field_definitions)
        ? linked.rows[0].field_definitions
        : [];
      if (!recordGroups.some(group => Array.isArray(group.fields) && group.fields.length > 0)) {
        throw new VersionFlowError(`关联的原始记录模板「${linked.rows[0].name}」没有可生成的字段`, 400);
      }
      const inherited = buildProjectGroupsFromRecord({ groups: recordGroups });
      const hasRecordConclusion = recordGroups.some(group =>
        (group.section_role === 'conclusion' && group.fields?.some(field => field.conclusion_role === 'project_name'))
        || group.fields?.some(field => field.type === 'record_conclusion' && field.record_conclusion));
      const conclusion = hasRecordConclusion ? null : detectProjectConclusionBinding({ groups: recordGroups });
      initialFieldDefinitions = inherited.groups;
      initialLayoutOptions = {
        ...initialLayoutOptions,
        theme_config: { ...(initialLayoutOptions.theme_config || {}), ...inherited.theme_config },
        inherited_record_template_id: Number(linked.rows[0].id),
        inherited_record_version: Number(linked.rows[0].version_no || 1),
        conclusions: Array.isArray(initialLayoutOptions.conclusions) && initialLayoutOptions.conclusions.length
          ? initialLayoutOptions.conclusions
          : conclusion ? [conclusion] : [],
      };
      delete initialLayoutOptions.pending_record_inherit;
      const generatedWarnings = validateReportBindings(initialFieldDefinitions, recordGroups,
        hasRecordConclusion ? [] : initialLayoutOptions.conclusions);
      if (generatedWarnings.length) {
        throw new VersionFlowError(`从关联原始记录生成失败：存在 ${generatedWarnings.length} 处无效映射`, 400);
      }
      inheritanceResult = {
        mapped: inherited.mapped.length,
        manual: inherited.manual.length,
        record_template_id: Number(linked.rows[0].id),
      };
    }
    const ins = await client.query(
      `INSERT INTO report_templates
         (name, source_file, template_kind, test_project_codes, linked_record_template_id, host_manufacturer_id,
          report_project_family_id,parent_template_id, parent_version_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        name, source_file || null,
        template_kind, test_project_codes || null, linked_record_template_id || null, host_manufacturer_id || null,
        report_project_family_id || null,parent_template_id || null, parent_version_id || null,
      ]
    );
    const t = ins.rows[0];
    // 新建模板初始为草稿(draft)、无生效版本(current_version_id 保持 NULL)：
    // 必须走「提交审核 → 审核通过」后才会翻指针生效，未通过前在首页/项目选用等选择框中禁选。
    const v1 = await client.query(
      `INSERT INTO report_template_versions (template_id, version_no, field_definitions, layout_options, typst_source,
                                              status, author_name, change_summary)
       VALUES ($1, 1, $2::jsonb, $3::jsonb, $4, 'draft', $5, $6) RETURNING id`,
      [t.id, JSON.stringify(initialFieldDefinitions), JSON.stringify(initialLayoutOptions), typst_source || null,
       actor.name, '初始版本']
    );
    await logTemplateAudit(client, 'report', t.id, 'create', actor, {
      name,
      ...(inheritanceResult ? { inherited_from_record: inheritanceResult } : {}),
    }, v1.rows[0].id);
    await client.query('COMMIT');
    res.status(201).json({ ...t, current_version_id: null, inheritance: inheritanceResult });
  } catch (e: any) {
    await client.query('ROLLBACK');
    sendError(res, e);
  } finally {
    client.release();
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  const actor = readActor(req as any);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  if (!requirePermission(req, res, 'report_template.edit', '编辑报告模板')) return;
  const id = Number(req.params.id);
  const { name, typst_source, layout_options, field_definitions, change_summary, draft_updated_at,
          template_kind, test_project_codes, linked_record_template_id, host_manufacturer_id,report_project_family_id } = req.body;
  const currentMeta = await pool.query('SELECT template_kind,report_project_family_id FROM report_templates WHERE id=$1', [id]);
  if (!currentMeta.rows.length) { res.status(404).json({ error: '报告模板不存在' }); return; }
  const effectiveKind = template_kind || currentMeta.rows[0].template_kind;
  const effectiveFamilyId = report_project_family_id !== undefined ? report_project_family_id : currentMeta.rows[0].report_project_family_id;
  try {
    await assertReportGroupKind(pool, effectiveFamilyId, effectiveKind);
  } catch (error: any) {
    sendError(res, error, 400); return;
  }
  // 元数据立即生效（不走版本流）
  if (name || template_kind || test_project_codes !== undefined || linked_record_template_id !== undefined || host_manufacturer_id !== undefined || report_project_family_id !== undefined) {
    const old = name ? await pool.query(`SELECT name, template_kind FROM report_templates WHERE id = $1`, [id]) : null;
    if (name && old?.rows[0] && old.rows[0].name !== name) {
      const effKind = template_kind || old.rows[0].template_kind;   // kind 也可能同时改，按最终 kind 判重
      if (await reportNameTaken(name, effKind, id)) {
        res.status(409).json({ error: `已存在同名${KIND_LABEL[effKind] || ''}模板「${String(name).trim()}」，请换一个名称`, code: 'duplicate_name' });
        return;
      }
    }
    await pool.query(
      `UPDATE report_templates SET
         name = COALESCE($1, name),
         template_kind = COALESCE($2, template_kind),
         test_project_codes = COALESCE($3, test_project_codes),
         linked_record_template_id = CASE WHEN $4::boolean THEN $5 ELSE linked_record_template_id END,
         host_manufacturer_id = CASE WHEN $6::boolean THEN $7 ELSE host_manufacturer_id END,
         report_project_family_id = CASE WHEN $8::boolean THEN $9 ELSE report_project_family_id END,
         updated_at = NOW()
       WHERE id = $10`,
      [name || null, template_kind || null, test_project_codes || null,
       linked_record_template_id !== undefined, linked_record_template_id || null,
       host_manufacturer_id !== undefined, host_manufacturer_id || null,
       report_project_family_id !== undefined,report_project_family_id || null,id]
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
  if (!await assertEditLease(req, res, 'report_template', String(id))) return;
  try {
    await assertFamilyInheritedGroupsUnchanged(id, field_definitions as FieldGroup[]);
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
  if (!requirePermission(req, res, 'report_template.edit', '提交模板审核')) return;
  const { version_id, change_summary } = req.body;
  if (!version_id) { res.status(400).json({ error: 'version_id required' }); return; }
  try {
    // 6.7：项目报告模板提交审核前，强制校验「检测结论声明」必填（未填禁止提交）
    const meta = (await pool.query(
      `SELECT t.id AS template_id, t.template_kind, v.layout_options FROM report_template_versions v
       JOIN report_templates t ON t.id = v.template_id WHERE v.id = $1`, [version_id]
    )).rows[0];
    if (meta?.template_kind === 'project') {
      const lo = meta.layout_options || {};
      const recordGroups = await loadLinkedRecordGroups(Number(meta.template_id));
      const hasRecordConclusion = !!recordGroups?.some(group =>
        (group.section_role === 'conclusion' && group.fields?.some(field => field.conclusion_role === 'project_name'))
        || group.fields?.some(field => field.type === 'record_conclusion' && field.record_conclusion));
      const errs = hasRecordConclusion ? [] : validateProjectConclusions(lo.conclusions);
      if (errs.length) { res.status(400).json({ error: '检测结论未填写完整：' + errs.join('；') }); return; }
    }
    const v = await submitForReview(pool, 'report', Number(version_id), actor.name, actor.role, change_summary, actor.jobNo);
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
  if (!requirePermission(req, res, 'report_template.edit', '撤回模板审核')) return;
  try {
    const v = await withdrawVersion(pool, 'report', Number(req.params.vid), actor.name, actor.role, actor.jobNo);
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
  if (!requirePermission(req, res, 'report.review', '审核报告模板')) return;
  const { decision, note } = req.body || {};
  try {
    const v = await reviewVersion(pool, 'report', Number(req.params.vid), decision, actor.name, note || null, actor.role, actor.jobNo, actor.roles);
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
  if (!requirePermission(req, res, 'report_template.edit', '恢复模板版本')) return;
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
  if (!requirePermission(req, res, 'report_template.edit', '派生模板')) return;
  const { name, parent_version_id } = req.body;
  if (!name) { res.status(400).json({ error: 'name required' }); return; }
  {
    const pk = await pool.query(`SELECT template_kind FROM report_templates WHERE id = $1`, [req.params.id]);
    const kind = pk.rows[0]?.template_kind || 'cover';
    if (await reportNameTaken(name, kind)) { res.status(409).json({ error: `已存在同名${KIND_LABEL[kind] || ''}模板「${String(name).trim()}」，请换一个名称`, code: 'duplicate_name' }); return; }
  }
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
  if (!requirePermission(req, res, 'report_template.edit', '同步模板')) return;
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

/** 项目组成员间按字段标识/编码同步；项目报告额外校验同步后的原始记录数据绑定。 */
router.post('/:id/sync-to-family', async (req: Request, res: Response) => {
  const actor = readActor(req as any); const sourceId = Number(req.params.id);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  if (!requirePermission(req, res, 'report_template.edit', '同步项目组模板')) return;
  const targetIds = [...new Set((Array.isArray(req.body?.target_ids) ? req.body.target_ids : [])
    .map(Number).filter((id: number) => Number.isFinite(id) && id !== sourceId))];
  if (!targetIds.length) { res.status(400).json({ error: '请至少选择一个项目组目标模板' }); return; }
  try {
    const source = await pool.query(
      `SELECT t.id,t.name,t.template_kind,t.report_project_family_id,t.current_version_id,
              v.version_no,v.status,v.field_definitions
         FROM report_templates t JOIN report_template_versions v ON v.id=t.current_version_id
        WHERE t.id=$1 AND t.archived_at IS NULL`, [sourceId],
    );
    if (!source.rows.length || source.rows[0].status !== 'approved') {
      throw new VersionFlowError('只能从当前已审核生效的模板同步', 409);
    }
    const familyId = source.rows[0].report_project_family_id;
    if (!familyId) throw new VersionFlowError('当前模板尚未加入项目组', 409);
    const targets = await pool.query(
      `SELECT t.id,t.name,t.template_kind,t.current_version_id,v.version_no,
              v.field_definitions,v.layout_options,v.typst_source
         FROM report_templates t LEFT JOIN report_template_versions v ON v.id=t.current_version_id
        WHERE t.report_project_family_id=$1 AND t.id=ANY($2::int[]) AND t.archived_at IS NULL
        ORDER BY t.name,t.id`, [familyId, targetIds],
    );
    if (targets.rows.length !== targetIds.length) throw new VersionFlowError('部分目标模板不属于当前项目组', 409);
    if (targets.rows.some(target => target.template_kind !== source.rows[0].template_kind)) {
      throw new VersionFlowError('同组模板类型不一致，无法同步', 409);
    }

    const result: any = { source_version_no: source.rows[0].version_no, applied: [], skipped: [], preview: [] };
    const sourceGroups = source.rows[0].field_definitions || [];
    const sourceFields = sourceGroups.flatMap((group: any) =>
      (group.fields || []).map((field: any) => ({ field, group })));
    for (const target of targets.rows) {
      const open = await pool.query(
        `SELECT version_no,status FROM report_template_versions
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
      const computed = computeSyncedFieldDefinitions(sourceGroups, targetGroups, mapping, !!req.body?.include_added);
      const changeCount = computed.stats.replaced.length + computed.stats.removed.length + computed.stats.added.length;
      const bindingWarnings = source.rows[0].template_kind === 'project'
        ? await checkBindings(target.id, computed.field_definitions, target.layout_options?.conclusions)
        : [];
      const blocked = bindingWarnings.length
        ? `同步后会产生 ${bindingWarnings.length} 处无效数据绑定`
        : !changeCount ? '相同字段没有变化，无需同步' : null;
      if (req.body?.dry_run) {
        result.preview.push({ id: target.id, name: target.name, stats: computed.stats, ...(blocked ? { blocked } : {}) });
        continue;
      }
      if (blocked) { result.skipped.push({ id: target.id, name: target.name, reason: blocked }); continue; }
      const summary = `同步自项目组模板「${source.rows[0].name}」v${source.rows[0].version_no}`;
      const draft = await createDraft(pool, 'report', target.id, actor.name, {
        field_definitions: computed.field_definitions, layout_options: target.layout_options,
        typst_source: target.typst_source, change_summary: summary,
      });
      const pending = await submitForReview(pool, 'report', draft.id, actor.name, actor.role, summary, actor.jobNo);
      await logTemplateAudit(pool, 'report', target.id, 'sync_in', actor, {
        family_source_template_id: sourceId, source_version_no: source.rows[0].version_no,
        version_no: pending.version_no, stats: computed.stats,
      }, pending.id);
      result.applied.push({ id: target.id, name: target.name, version_no: pending.version_no, stats: computed.stats });
    }
    if (!req.body?.dry_run) delete result.preview;
    res.json(result);
  } catch (e: any) { sendError(res, e); }
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
  if (!requirePermission(req, res, 'report_template.edit', '删除模板')) return;
  try {
    res.json(await requestArchive(pool, 'report', Number(req.params.id), actor, req.body?.note));
  } catch (e: any) { sendError(res, e, 400); }
});

/** 撤销删除申请 */
router.post('/:id/archive-request/cancel', async (req: Request, res: Response) => {
  const actor = readActor(req as any);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  if (!requirePermission(req, res, 'report_template.edit', '撤销删除申请')) return;
  try {
    res.json(await cancelArchiveRequest(pool, 'report', Number(req.params.id), actor));
  } catch (e: any) { sendError(res, e, 400); }
});

/** 审批删除：body {decision, note}。批准即归档（申请人≠批准人，仅审核员） */
router.post('/:id/archive-review', async (req: Request, res: Response) => {
  const actor = readActor(req as any);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  if (!requirePermission(req, res, 'report.review', '审批模板删除')) return;
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
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  if (!requirePermission(req, res, 'report_template.edit', '恢复模板')) return;
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
