import { Router, Request, Response } from 'express';
import {
  listVersions, getVersion, createDraft, submitForReview, reviewVersion, withdrawVersion,
  forkTemplate, getLineage, syncToChildren, listAuditLog, logTemplateAudit, readActor,
  requestArchive, cancelArchiveRequest, reviewArchiveRequest, rollbackToVersion,
  diffFieldDefinitions, VersionFlowError, actorHasPermission,
} from '../services/template-versions.js';

import { pool } from '../db.js';

const router = Router();

/** 业务流错误带 status（409 冲突 / 403 权限），其余 500 */
function sendError(res: Response, e: any, fallback = 500) {
  res.status(e instanceof VersionFlowError ? e.status : fallback).json({ error: e.message });
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
     ${whereSql}
     ORDER BY t.id ASC`
  );
  res.json(result.rows);
});

router.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  // 返回 base 元数据 + 当前生效版本的字段定义（base 已不存 field_definitions）
  const result = await pool.query(
    `SELECT t.id, t.name, t.version, t.source_file, t.created_at, t.updated_at,
            t.parent_template_id, t.parent_version_id, t.current_version_id, t.archived_at,
            t.archive_requested_by, t.archive_requested_at, t.archive_request_note,
            t.field_mapping,
            cv.version_no AS current_version_no, cv.status AS current_status,
            cv.field_definitions, cv.layout_options, cv.typst_source,
            cv.controlled_no, cv.controlled_issue_date, cv.controlled_effective_date,
            ${OPEN_DRAFT_SQL}
     FROM record_templates t
     LEFT JOIN record_template_versions cv ON cv.id = t.current_version_id
     WHERE t.id = $1`, [id]
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Template not found' });
    return;
  }
  res.json(mergeControlled(result.rows[0]));
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
  res.json(mergeControlled(v));
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
  const r = await getLineage(pool, 'record', Number(req.params.id));
  res.json(r);
});

router.post('/', async (req: Request, res: Response) => {
  const actor = readActor(req as any);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  const { name, field_definitions, typst_source, source_file, layout_options, parent_template_id, parent_version_id } = req.body;
  if (!name || !field_definitions) { res.status(400).json({ error: 'name and field_definitions are required' }); return; }
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
    await client.query('COMMIT');
    res.status(201).json({ ...t, current_version_id: null });
  } catch (e: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

/** PUT /:id 不再直接改主表；改为创建/更新一个 draft（不会立即生效） */
router.put('/:id', async (req: Request, res: Response) => {
  const actor = readActor(req as any);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  const id = Number(req.params.id);
  const { field_definitions, typst_source, layout_options, change_summary, name, draft_updated_at } = req.body;
  if (!field_definitions) { res.status(400).json({ error: 'field_definitions required' }); return; }
  try {
    // name 改动不走版本流，直接改 base（视为元数据）
    if (name) {
      const old = await pool.query(`SELECT name FROM record_templates WHERE id = $1`, [id]);
      if (old.rows[0] && old.rows[0].name !== name) {
        await pool.query(`UPDATE record_templates SET name = $1, updated_at = NOW() WHERE id = $2`, [name, id]);
        await logTemplateAudit(pool, 'record', id, 'rename', actor, { from: old.rows[0].name, to: name });
      }
    }
    const draft = await createDraft(pool, 'record', id, actor.name,
      { field_definitions, layout_options, typst_source, change_summary, draft_updated_at });
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
  const { version_id, change_summary } = req.body;
  if (!version_id) { res.status(400).json({ error: 'version_id required' }); return; }
  try {
    const v = await submitForReview(pool, 'record', Number(version_id), actor.name, actor.role, change_summary);
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
  try {
    const v = await withdrawVersion(pool, 'record', Number(req.params.vid), actor.name, actor.role);
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
  if (!actorHasPermission(req as any, 'record_template.edit')) { res.status(403).json({ error: '当前角色无审核权限（需测试主管）' }); return; }
  const { decision, note } = req.body || {};
  try {
    const v = await reviewVersion(pool, 'record', Number(req.params.vid), decision, actor.name, note || null, actor.role);
    res.json(v);
  } catch (e: any) {
    sendError(res, e, 400);
  }
});

/** 回退到历史版本：克隆该版本内容为新草稿并提交审核（pending），审核通过后生效 */
router.post('/:id/versions/:vid/rollback', async (req: Request, res: Response) => {
  const actor = readActor(req as any);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
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
  const { name, parent_version_id } = req.body;
  if (!name) { res.status(400).json({ error: 'name required' }); return; }
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
  try {
    res.json(await requestArchive(pool, 'record', Number(req.params.id), actor, req.body?.note));
  } catch (e: any) { sendError(res, e, 400); }
});

/** 撤销删除申请（申请人或审核员） */
router.post('/:id/archive-request/cancel', async (req: Request, res: Response) => {
  const actor = readActor(req as any);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  try {
    res.json(await cancelArchiveRequest(pool, 'record', Number(req.params.id), actor));
  } catch (e: any) { sendError(res, e, 400); }
});

/** 审批删除：body {decision: 'approve'|'reject', note?, force?}。批准即归档（申请人≠批准人，仅审核员） */
router.post('/:id/archive-review', async (req: Request, res: Response) => {
  const actor = readActor(req as any);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
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
