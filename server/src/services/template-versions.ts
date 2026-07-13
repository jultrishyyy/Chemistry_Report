/**
 * 模板版本流通用 helper
 *
 * record_templates 和 report_templates 的版本管理逻辑完全对称，
 * 这里把表名做参数，避免两份重复。
 *
 * 留痕模型（migration 022）：
 *   - *_template_versions 表回答"每个版本的内容是什么"（append-only；rejected 版本冻结不复用）
 *   - template_audit_log 表回答"谁在什么时候对模板做了什么"（创建/改草稿/提交/撤回/审核/fork/同步/归档/恢复/改名/受控登记）
 *   - 服务函数内只记录"自身完全掌握语义"的事件（审核、fork、同步）；其余由 routes 埋点
 */
import pg from 'pg';
import { diffFieldDefinitions } from '../../../shared/template-diff.js';
import type { TemplateFieldMapping } from '../../../shared/types.js';
import { rolesHavePermission, type Permission } from '../../../shared/rbac.js';

export { diffFieldDefinitions };

export type TemplateKind = 'record' | 'report';

interface Tables {
  base: string;       // record_templates / report_templates
  versions: string;   // record_template_versions / report_template_versions
}

const TABLES: Record<TemplateKind, Tables> = {
  record: { base: 'record_templates', versions: 'record_template_versions' },
  report: { base: 'report_templates', versions: 'report_template_versions' },
};

/** 业务流错误：带 HTTP 状态码（409=冲突类，路由层直接透传） */
export class VersionFlowError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

type Queryable = pg.Pool | pg.PoolClient;

/** 写一条模板操作审计日志（可在事务 client 内调用，随事务提交/回滚） */
export async function logTemplateAudit(
  q: Queryable, kind: TemplateKind, templateId: number, action: string,
  actor: { name: string; role?: string | null }, detail?: any, versionId?: number | null
) {
  await q.query(
    `INSERT INTO template_audit_log (template_kind, template_id, version_id, action, actor_name, actor_role, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [kind, templateId, versionId ?? null, action, actor.name, actor.role || null,
     detail ? JSON.stringify(detail) : null]
  );
}

/** 拉某模板的操作日志（新→旧） */
export async function listAuditLog(pool: pg.Pool, kind: TemplateKind, templateId: number) {
  const r = await pool.query(
    `SELECT id, version_id, action, actor_name, actor_role, detail, created_at
     FROM template_audit_log
     WHERE template_kind = $1 AND template_id = $2
     ORDER BY created_at DESC, id DESC`,
    [kind, templateId]
  );
  return r.rows;
}

/** 列出某模板的所有版本 */
export async function listVersions(pool: pg.Pool, kind: TemplateKind, templateId: number) {
  const { versions } = TABLES[kind];
  const r = await pool.query(
    `SELECT id, version_no, status, author_name, reviewer_name, review_note,
            change_summary, diff_from_prev, created_at, updated_at, reviewed_at
     FROM ${versions} WHERE template_id = $1 ORDER BY version_no DESC`,
    [templateId]
  );
  return r.rows;
}

/** 拿当前生效版本的完整快照（含 field_definitions / typst_source 等） */
export async function getCurrentVersion(pool: pg.Pool, kind: TemplateKind, templateId: number) {
  const { base, versions } = TABLES[kind];
  const r = await pool.query(
    `SELECT v.* FROM ${base} t JOIN ${versions} v ON v.id = t.current_version_id WHERE t.id = $1`,
    [templateId]
  );
  return r.rows[0] || null;
}

/**
 * 拿模板"内容"（field_definitions / layout_options / typst_source）。
 * 优先按指定 versionId 读快照；不传则读当前生效版本。
 *
 * 这是 base 表去除 dual-write 后所有读路径的统一入口——以前直接读
 * record_templates.field_definitions 的代码必须改为调用本函数。
 */
export async function getTemplateContent(
  pool: pg.Pool, kind: TemplateKind, templateId: number, versionId?: number | null
) {
  const { base, versions } = TABLES[kind];
  let row;
  if (versionId) {
    const r = await pool.query(`SELECT * FROM ${versions} WHERE id = $1 AND template_id = $2`,
      [versionId, templateId]);
    row = r.rows[0];
  } else {
    const r = await pool.query(
      `SELECT v.* FROM ${base} t JOIN ${versions} v ON v.id = t.current_version_id WHERE t.id = $1`,
      [templateId]
    );
    row = r.rows[0];
  }
  if (!row) return null;
  return {
    field_definitions: row.field_definitions,
    layout_options: row.layout_options || {},
    typst_source: row.typst_source,
    version_no: row.version_no,
    status: row.status,
  };
}

/** 拿指定版本 */
export async function getVersion(pool: pg.Pool, kind: TemplateKind, versionId: number) {
  const { versions } = TABLES[kind];
  const r = await pool.query(`SELECT * FROM ${versions} WHERE id = $1`, [versionId]);
  return r.rows[0] || null;
}

/**
 * 取"未定稿"行：版本号最大的 draft / pending / rejected，且必须比当前生效版本新。
 * （rejected 行冻结保留后，已被更新版本取代的旧 rejected 是纯历史，不再算未定稿）
 */
async function getOpenVersion(q: Queryable, kind: TemplateKind, templateId: number) {
  const { base, versions } = TABLES[kind];
  const r = await q.query(
    `SELECT v.* FROM ${versions} v
     WHERE v.template_id = $1 AND v.status IN ('draft','pending','rejected')
       AND v.version_no > COALESCE(
         (SELECT cv.version_no FROM ${base} t JOIN ${versions} cv ON cv.id = t.current_version_id
          WHERE t.id = $1), 0)
     ORDER BY v.version_no DESC LIMIT 1`,
    [templateId]
  );
  return r.rows[0] || null;
}

/**
 * 保存草稿。规则（migration 022 起）：
 *   - 最新未定稿是 pending → 409：审核中的版本不可被覆盖，需先撤回（withdraw）
 *   - 最新未定稿是 rejected → 冻结该行为不可变历史，新开 version_no+1 的 draft 行
 *   - 最新未定稿是 draft → 原行更新，但要求乐观锁：body.draft_updated_at 必须等于行上的 updated_at，
 *     不一致 → 409（别人刚保存过）。不传 draft_updated_at 视为旧客户端，跳过校验（兼容）。
 *   - 没有未定稿 → 新开 version_no+1 的 draft 行
 */
export async function createDraft(
  pool: pg.Pool, kind: TemplateKind, templateId: number, authorName: string,
  body: {
    field_definitions: any; layout_options?: any; typst_source?: string;
    change_summary?: string; draft_updated_at?: string;
  }
) {
  const { versions } = TABLES[kind];
  const open = await getOpenVersion(pool, kind, templateId);

  if (open && open.status === 'pending') {
    throw new VersionFlowError(
      `v${open.version_no} 正在审核中（提交人：${open.author_name}），不可直接修改。请先撤回或等待审核结果。`, 409);
  }

  if (open && open.status === 'draft') {
    if (body.draft_updated_at) {
      const mine = new Date(body.draft_updated_at).getTime();
      const theirs = new Date(open.updated_at).getTime();
      if (mine !== theirs) {
        throw new VersionFlowError(
          `草稿已被 ${open.author_name} 在你打开之后保存过，为避免互相覆盖已拒绝本次保存。请刷新后基于最新草稿修改。`, 409);
      }
    }
    const upd = await pool.query(
      `UPDATE ${versions} SET field_definitions = $1::jsonb,
         layout_options = COALESCE($2::jsonb, layout_options),
         typst_source = COALESCE($3, typst_source),
         change_summary = COALESCE($4, change_summary),
         author_name = $5,
         updated_at = NOW()
       WHERE id = $6 RETURNING *`,
      [
        JSON.stringify(body.field_definitions),
        body.layout_options ? JSON.stringify(body.layout_options) : null,
        body.typst_source ?? null,
        body.change_summary ?? null,
        authorName,
        open.id,
      ]
    );
    return upd.rows[0];
  }

  // 无未定稿，或最新未定稿是 rejected（冻结保留）→ 新开一行
  const max = await pool.query(`SELECT COALESCE(MAX(version_no),0) AS m FROM ${versions} WHERE template_id = $1`, [templateId]);
  const nextV = max.rows[0].m + 1;
  const ins = await pool.query(
    `INSERT INTO ${versions} (template_id, version_no, field_definitions, layout_options, typst_source,
                              status, author_name, change_summary)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, 'draft', $6, $7) RETURNING *`,
    [
      templateId, nextV,
      JSON.stringify(body.field_definitions),
      JSON.stringify(body.layout_options || {}),
      body.typst_source ?? null,
      authorName,
      body.change_summary ?? null,
    ]
  );
  return ins.rows[0];
}

/** 提交审核：draft → pending */
export async function submitForReview(pool: pg.Pool, kind: TemplateKind, versionId: number, actorName: string, actorRole?: string, changeSummary?: string) {
  const { versions } = TABLES[kind];
  const cur = await pool.query(`SELECT * FROM ${versions} WHERE id = $1`, [versionId]);
  if (!cur.rows.length) throw new VersionFlowError('版本不存在', 404);
  const v = cur.rows[0];
  // 作者本人可提交；审核员（主管）也可代为提交，避免草稿因作者不在线/不存在而卡在 draft 无法进入审核
  if (v.author_name !== actorName && !isTemplateReviewer(kind, actorRole)) {
    throw new VersionFlowError('只有该草稿的作者或对应审核角色可以提交审核', 403);
  }
  if (v.status !== 'draft' && v.status !== 'rejected') throw new VersionFlowError('当前状态不可提交：' + v.status);
  // rejected 行已冻结为不可变历史：原样重提时复制内容开新版本号行，直接进入 pending
  if (v.status === 'rejected') {
    const max = await pool.query(`SELECT COALESCE(MAX(version_no),0) AS m FROM ${versions} WHERE template_id = $1`, [v.template_id]);
    const ins = await pool.query(
      `INSERT INTO ${versions} (template_id, version_no, field_definitions, layout_options, typst_source,
                                status, author_name, change_summary)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, 'pending', $6, $7) RETURNING *`,
      [v.template_id, max.rows[0].m + 1,
       JSON.stringify(v.field_definitions), JSON.stringify(v.layout_options || {}), v.typst_source,
       actorName, changeSummary ?? v.change_summary]
    );
    return ins.rows[0];
  }
  // 修改说明在「提交审核」时填写：传入则写入本版本（不传则保留草稿期已存的值）
  const upd = await pool.query(
    `UPDATE ${versions} SET status = 'pending', review_note = NULL, reviewer_name = NULL, reviewed_at = NULL,
            change_summary = COALESCE($2, change_summary), updated_at = NOW()
     WHERE id = $1 RETURNING *`, [versionId, changeSummary ?? null]
  );
  return upd.rows[0];
}

/** 撤回审核：pending → draft（作者或审核员），撤回后才能继续编辑 */
export async function withdrawVersion(
  pool: pg.Pool, kind: TemplateKind, versionId: number, actorName: string, actorRole?: string
) {
  const { versions } = TABLES[kind];
  const cur = await pool.query(`SELECT * FROM ${versions} WHERE id = $1`, [versionId]);
  if (!cur.rows.length) throw new VersionFlowError('版本不存在', 404);
  const v = cur.rows[0];
  if (v.status !== 'pending') throw new VersionFlowError('只有待审核（pending）的版本可以撤回');
  if (v.author_name !== actorName && !isTemplateReviewer(kind, actorRole)) {
    throw new VersionFlowError('只有提交人或对应审核角色可以撤回', 403);
  }
  const upd = await pool.query(
    `UPDATE ${versions} SET status = 'draft', updated_at = NOW() WHERE id = $1 RETURNING *`, [versionId]
  );
  return upd.rows[0];
}

/** 审核：approve 或 reject（事件随事务写入 template_audit_log） */
export async function reviewVersion(
  pool: pg.Pool, kind: TemplateKind, versionId: number,
  decision: 'approve' | 'reject', reviewerName: string, note: string | null,
  reviewerRole?: string
) {
  const { base, versions } = TABLES[kind];
  const cur = await pool.query(`SELECT * FROM ${versions} WHERE id = $1`, [versionId]);
  if (!cur.rows.length) throw new VersionFlowError('版本不存在', 404);
  const v = cur.rows[0];
  if (v.status !== 'pending') throw new VersionFlowError('当前不是待审核状态');
  // 允许自审：编辑者可审核自己提交的模板版本（取消"编辑者与审核人不能为同一人"限制）
  const actor = { name: reviewerName, role: reviewerRole || (kind === 'record' ? 'test_supervisor' : 'report_reviewer') };

  if (decision === 'approve') {
    // 算 diff
    const prevApproved = await pool.query(
      `SELECT field_definitions FROM ${versions}
       WHERE template_id = $1 AND status = 'approved' ORDER BY version_no DESC LIMIT 1`,
      [v.template_id]
    );
    const diff = diffFieldDefinitions(
      prevApproved.rows[0]?.field_definitions || null,
      v.field_definitions
    );
    const client = await pool.connect();
    let approved: any;
    try {
      await client.query('BEGIN');
      // 老的 approved → superseded
      await client.query(
        `UPDATE ${versions} SET status = 'superseded' WHERE template_id = $1 AND status = 'approved'`,
        [v.template_id]
      );
      // 当前版本 → approved
      const upd = await client.query(
        `UPDATE ${versions} SET status = 'approved', reviewer_name = $1, review_note = $2,
           reviewed_at = NOW(), updated_at = NOW(), diff_from_prev = $3::jsonb
         WHERE id = $4 RETURNING *`,
        [reviewerName, note, JSON.stringify(diff), versionId]
      );
      // 翻指针（base 不再持有 field_definitions / typst_source / layout_options，
      // 所有读取统一通过 getTemplateContent / current_version_id JOIN 版本表）
      await client.query(`UPDATE ${base} SET current_version_id = $1, updated_at = NOW() WHERE id = $2`,
        [versionId, v.template_id]);
      await logTemplateAudit(client, kind, v.template_id, 'approve', actor,
        { version_no: v.version_no, note, diff_count: diff.length }, versionId);
      await client.query('COMMIT');
      approved = upd.rows[0];
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    // 强制自动同步到【所有有映射的直接子模板】：替换/删除/改名/新增都带过去，
    // 每个子模板生成待审版本、各自重新审核才生效（有未定稿/无映射的子模板会被跳过并在结果中说明）。
    let child_sync: SyncResult | { error: string } | undefined;
    try {
      const kids = await pool.query(
        `SELECT id FROM ${base} WHERE parent_template_id = $1 AND archived_at IS NULL AND field_mapping IS NOT NULL`,
        [v.template_id]
      );
      if (kids.rows.length) {
        child_sync = await syncToChildren(pool, kind, v.template_id, {
          childIds: kids.rows.map((r: any) => r.id), includeAdded: true,
          sourceVersionId: versionId, dryRun: false,
        }, actor);
      }
    } catch (e: any) {
      child_sync = { error: String(e?.message || e) };
    }

    return { ...approved, child_sync };
  }

  // reject
  if (!note || !note.trim()) throw new VersionFlowError('退回必须填写备注');
  const upd = await pool.query(
    `UPDATE ${versions} SET status = 'rejected', reviewer_name = $1, review_note = $2,
            reviewed_at = NOW(), updated_at = NOW()
     WHERE id = $3 RETURNING *`, [reviewerName, note, versionId]
  );
  await logTemplateAudit(pool, kind, v.template_id, 'reject', actor,
    { version_no: v.version_no, note }, versionId);
  return upd.rows[0];
}

/**
 * 回退到历史版本，按"目标版本是否=当前生效版本"和"是否在编辑未定稿"分流：
 *  ①有未定稿草稿/待审时：
 *     · 目标=当前生效版本 → 内容与生效版一致＝无真实改动 → **直接丢弃草稿**（删除草稿行），回到干净生效态，不留草稿、不送审；
 *     · 目标=历史(superseded)版本 → 内容确实不同 → 把草稿内容重置为该版本（仍是草稿、不送审）。
 *    pending 一律先撤回（放弃该次审核，withdrawVersion 内含"仅提交人/审核员"权限校验）。
 *  ②无未定稿 → 克隆该旧版本为新草稿并提交审核（pending），审核通过后生效（历史只追加不破坏）。
 * 存在 rejected 未定稿（冻结历史）时拒绝（先处理）。
 */
export async function rollbackToVersion(
  pool: pg.Pool, kind: TemplateKind, templateId: number, sourceVersionId: number,
  actor: { name: string; role?: string }
) {
  const { base, versions } = TABLES[kind];
  const sv = await pool.query(`SELECT * FROM ${versions} WHERE id = $1 AND template_id = $2`, [sourceVersionId, templateId]);
  if (!sv.rows.length) throw new VersionFlowError('源版本不存在', 404);
  const src = sv.rows[0];
  if (src.status !== 'approved' && src.status !== 'superseded') {
    throw new VersionFlowError('只能回退到已审核通过的历史版本');
  }
  const open = await getOpenVersion(pool, kind, templateId);

  // ① 正在编辑未定稿（草稿/待审）
  if (open && (open.status === 'draft' || open.status === 'pending')) {
    const baseRow = await pool.query(`SELECT current_version_id FROM ${base} WHERE id = $1`, [templateId]);
    const restoringToEffective = baseRow.rows[0]?.current_version_id === Number(sourceVersionId);

    // pending 先撤回（放弃该次审核）
    if (open.status === 'pending') {
      await withdrawVersion(pool, kind, open.id, actor.name, actor.role);  // pending → draft
      await logTemplateAudit(pool, kind, templateId, 'withdraw', actor,
        { version_no: open.version_no, via: 'rollback' }, open.id);
    }

    // 恢复为当前生效版本 → 丢弃草稿（无真实改动，不该留下需要审核的草稿）
    if (restoringToEffective) {
      await pool.query(`DELETE FROM ${versions} WHERE id = $1`, [open.id]);
      await logTemplateAudit(pool, kind, templateId, 'rollback', actor,
        { source_version_no: src.version_no, discarded_draft_version_no: open.version_no, discard_draft: true }, null);
      return { discarded: true, discarded_version_no: open.version_no, current_version_no: src.version_no };
    }

    // 恢复为历史版本 → 重置草稿内容（仍是草稿）
    const resetSummary = `恢复为 v${src.version_no}`;
    const draft = await createDraft(pool, kind, templateId, actor.name, {
      field_definitions: src.field_definitions,
      layout_options: src.layout_options,
      typst_source: src.typst_source,
      change_summary: resetSummary,
    });
    await logTemplateAudit(pool, kind, templateId, 'rollback', actor,
      { source_version_no: src.version_no, draft_version_no: open.version_no, reset_draft: true,
        withdrew_pending: open.status === 'pending' }, draft.id);
    return draft;
  }
  // rejected 未定稿（冻结历史）不能在其上回退
  if (open) {
    throw new VersionFlowError(`存在未定稿版本 v${open.version_no}（${open.status}），请先处理后再回退`, 409);
  }
  // ② 无未定稿：回退到当前生效版本无意义
  const baseRow = await pool.query(`SELECT current_version_id FROM ${base} WHERE id = $1`, [templateId]);
  if (baseRow.rows[0]?.current_version_id === Number(sourceVersionId)) {
    throw new VersionFlowError('该版本已是当前生效版本，无需回退');
  }
  const summary = `回退到 v${src.version_no}`;
  const draft = await createDraft(pool, kind, templateId, actor.name, {
    field_definitions: src.field_definitions,
    layout_options: src.layout_options,
    typst_source: src.typst_source,
    change_summary: summary,
  });
  const pending = await submitForReview(pool, kind, draft.id, actor.name, actor.role, summary);
  await logTemplateAudit(pool, kind, templateId, 'rollback', actor,
    { source_version_no: src.version_no, new_version_no: pending.version_no }, pending.id);
  return pending;
}

/** 由一份 field_definitions 构建恒等字段映射（fork 时刻：子 id == 母 id） */
function buildIdentityMapping(groups: any[] | null | undefined): TemplateFieldMapping {
  const mapping: TemplateFieldMapping = { groups: {}, fields: {} };
  for (const g of groups || []) {
    if (g.id) mapping.groups[g.id] = g.id;
    for (const f of (g.fields || [])) {
      if (f.id) mapping.fields[f.id] = f.id;
    }
  }
  return mapping;
}

/** Fork：从某模板的某版本派生出新模板（写入母子字段映射 + 审计日志） */
export async function forkTemplate(
  pool: pg.Pool, kind: TemplateKind, parentTemplateId: number, parentVersionId: number,
  newName: string, authorName: string, authorRole?: string
) {
  const { base, versions } = TABLES[kind];
  const pv = await pool.query(`SELECT * FROM ${versions} WHERE id = $1 AND template_id = $2`,
    [parentVersionId, parentTemplateId]);
  if (!pv.rows.length) throw new VersionFlowError('母版本不存在', 404);
  const v = pv.rows[0];
  const mapping = buildIdentityMapping(v.field_definitions);
  const actor = { name: authorName, role: authorRole };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let insertSql: string;
    let insertParams: any[];
    // base 表只存元数据（migration 017 已删 field_definitions / typst_source / layout_options）；
    // 字段定义 / 布局 / Typst 源码只写进下面的 v1 版本行。
    if (kind === 'record') {
      insertSql = `INSERT INTO ${base} (name, parent_template_id, parent_version_id, field_mapping)
                   VALUES ($1, $2, $3, $4::jsonb) RETURNING id`;
      insertParams = [newName, parentTemplateId, parentVersionId, JSON.stringify(mapping)];
    } else {
      // report_templates 还有 template_kind / linked_record_template_id 等元数据需要继承
      const parent = await client.query(`SELECT template_kind, linked_record_template_id, test_project_codes FROM ${base} WHERE id = $1`, [parentTemplateId]);
      const p = parent.rows[0];
      insertSql = `INSERT INTO ${base} (name, template_kind, linked_record_template_id, test_project_codes,
                                        parent_template_id, parent_version_id, field_mapping)
                   VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING id`;
      insertParams = [newName, p.template_kind, p.linked_record_template_id, p.test_project_codes,
                      parentTemplateId, parentVersionId, JSON.stringify(mapping)];
    }
    const ins = await client.query(insertSql, insertParams);
    const newTplId = ins.rows[0].id;
    // 创建 v1 直接 approved（因为是从已审核的母版本派生）
    const v1 = await client.query(
      `INSERT INTO ${versions} (template_id, version_no, field_definitions, layout_options, typst_source,
                                status, author_name, reviewer_name, reviewed_at, change_summary)
       VALUES ($1, 1, $2::jsonb, $3::jsonb, $4, 'approved', $5, $5, NOW(), $6) RETURNING id`,
      [
        newTplId,
        JSON.stringify(v.field_definitions),
        JSON.stringify(v.layout_options || {}),
        v.typst_source,
        authorName,
        `从母模板「${parentTemplateId}」v${v.version_no} fork`,
      ]
    );
    await client.query(`UPDATE ${base} SET current_version_id = $1 WHERE id = $2`,
      [v1.rows[0].id, newTplId]);
    await logTemplateAudit(client, kind, parentTemplateId, 'fork_out', actor,
      { child_template_id: newTplId, child_name: newName, source_version_no: v.version_no }, parentVersionId);
    await logTemplateAudit(client, kind, newTplId, 'fork_in', actor,
      { parent_template_id: parentTemplateId, source_version_no: v.version_no }, v1.rows[0].id);
    await client.query('COMMIT');
    return { id: newTplId };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Lineage：用递归 CTE 拉整棵祖先 / 后代树 */
export async function getLineage(pool: pg.Pool, kind: TemplateKind, templateId: number) {
  const { base } = TABLES[kind];
  // 祖先（含自己）
  const ancestors = await pool.query(
    `WITH RECURSIVE up AS (
      SELECT id, name, parent_template_id, parent_version_id, 0 AS depth
      FROM ${base} WHERE id = $1
      UNION ALL
      SELECT t.id, t.name, t.parent_template_id, t.parent_version_id, u.depth + 1
      FROM ${base} t JOIN up u ON t.id = u.parent_template_id
    )
    SELECT * FROM up ORDER BY depth DESC`,
    [templateId]
  );
  // 后代
  const descendants = await pool.query(
    `WITH RECURSIVE down AS (
      SELECT id, name, parent_template_id, parent_version_id, 0 AS depth
      FROM ${base} WHERE id = $1
      UNION ALL
      SELECT t.id, t.name, t.parent_template_id, t.parent_version_id, d.depth + 1
      FROM ${base} t JOIN down d ON t.parent_template_id = d.id
    )
    SELECT * FROM down WHERE id != $1 ORDER BY depth, id`,
    [templateId]
  );
  return { ancestors: ancestors.rows, descendants: descendants.rows };
}

// ---------------------------------------------------------------------------
// 母 → 子同步（migration 022 / field_mapping）
// ---------------------------------------------------------------------------

interface SyncComputation {
  field_definitions: any[];
  stats: { replaced: string[]; removed: string[]; added: string[] };  // 各为字段标签列表
  mappingAdditions: TemplateFieldMapping;     // 本次新增映射（母版新增字段被带入时）
}

/** 在子模板内生成不冲突的新 id（与 FieldEditor 的 genId 同风格：f + 数字） */
function genChildId(used: Set<string>, preferred: string): string {
  if (!used.has(preferred)) { used.add(preferred); return preferred; }
  let n = 100;
  let candidate = `f${n}`;
  while (used.has(candidate)) candidate = `f${++n}`;
  used.add(candidate);
  return candidate;
}

/**
 * 纯计算：把母模板（当前 approved）字段应用到子模板字段集。
 *   - 映射字段母版仍在 → 用母版定义整体替换（保留子字段 id）；内容相同不计入 stats
 *   - 映射字段母版已删 → 从子模板删除
 *   - 母版新增字段（不在映射值域）且 includeAdded → 追加到映射对应的子分组（无映射分组则新建），
 *     子侧 id 防撞生成，新映射条目记入 mappingAdditions
 *   - 子模板自建字段（不在映射键域）永不触碰
 */
export function computeSyncedFieldDefinitions(
  parentGroups: any[], childGroups: any[], mapping: TemplateFieldMapping, includeAdded: boolean
): SyncComputation {
  const fieldMap = mapping?.fields || {};
  const groupMap = mapping?.groups || {};
  // parentFieldId → childFieldId（反查）
  const parentToChild: Record<string, string> = {};
  for (const [childId, parentId] of Object.entries(fieldMap)) parentToChild[parentId] = childId;
  const parentToChildGroup: Record<string, string> = {};
  for (const [childGid, parentGid] of Object.entries(groupMap)) parentToChildGroup[parentGid] = childGid;

  // 母版字段索引
  const parentFieldById: Record<string, { field: any; groupId: string; groupLabel: string }> = {};
  const parentGroupById: Record<string, any> = {};
  for (const g of parentGroups || []) {
    if (g.id) parentGroupById[g.id] = g;
    for (const f of (g.fields || [])) {
      if (f.id) parentFieldById[f.id] = { field: f, groupId: g.id, groupLabel: g.label };
    }
  }

  const usedIds = new Set<string>();
  for (const g of childGroups || []) {
    usedIds.add(g.id);
    for (const f of (g.fields || [])) usedIds.add(f.id);
  }

  const stats = { replaced: [] as string[], removed: [] as string[], added: [] as string[] };
  const mappingAdditions: TemplateFieldMapping = { groups: {}, fields: {} };

  // 1) 替换 / 删除映射字段 + 同步映射分区的标题/展示属性（改名也同步）
  const next = (childGroups || []).map((g: any) => {
    const out: any = {
      ...g,
      fields: (g.fields || []).flatMap((f: any) => {
        const parentId = fieldMap[f.id];
        if (!parentId) return [f];                    // 子模板自建字段：不动
        const p = parentFieldById[parentId];
        if (!p) { stats.removed.push(f.label || f.code || f.id); return []; }  // 母版已删
        const replaced = { ...p.field, id: f.id };
        if (JSON.stringify(replaced) !== JSON.stringify(f)) stats.replaced.push(replaced.label || replaced.code || f.id);
        return [replaced];
      }),
    };
    // 分区级同步：映射到母版分区时，标题/布局/样式随母版（保留子模板侧 id 与 parent_group_id 归属）
    const pg = groupMap[g.id] ? parentGroupById[groupMap[g.id]] : undefined;
    if (pg) {
      for (const k of ['label', 'layout', 'hide_title', 'style']) {
        if (JSON.stringify(pg[k]) !== JSON.stringify(g[k])) {
          if (k === 'label') stats.replaced.push(`分区「${pg.label || g.label}」`);
          out[k] = pg[k];
        }
      }
    }
    return out;
  });

  // 2) 母版新增字段
  if (includeAdded) {
    const mappedParentIds = new Set(Object.values(fieldMap));
    for (const g of parentGroups || []) {
      for (const f of (g.fields || [])) {
        if (!f.id || mappedParentIds.has(f.id)) continue;
        const newId = genChildId(usedIds, f.id);
        const childField = { ...f, id: newId };
        // 找映射的子分组；没有则按母分组建新分组（id 防撞）
        let targetGid = parentToChildGroup[g.id];
        let target = targetGid ? next.find((cg: any) => cg.id === targetGid) : undefined;
        if (!target) {
          const newGid = genChildId(usedIds, g.id);
          // 嵌套分区：母版分组的 parent_group_id 是母版侧 id，要翻译成子模板侧 id；
          // 翻译不到（其父分区没同步过去）则置 undefined 落为顶级
          const translatedParent = g.parent_group_id ? parentToChildGroup[g.parent_group_id] : undefined;
          target = { ...g, id: newGid, parent_group_id: translatedParent, fields: [] };
          next.push(target);
          mappingAdditions.groups[newGid] = g.id;
          parentToChildGroup[g.id] = newGid;
        }
        target.fields.push(childField);
        mappingAdditions.fields[newId] = f.id;
        stats.added.push(f.label || f.code || f.id);
      }
    }
  }

  return { field_definitions: next, stats, mappingAdditions };
}

export interface SyncResult {
  source_version_no: number;
  applied: Array<{ id: number; name: string; version_no: number; stats: SyncComputation['stats'] }>;
  skipped: Array<{ id: number; name: string; reason: string }>;
  /** dry_run 时返回每个子模板的预计变化 */
  preview?: Array<{ id: number; name: string; stats: SyncComputation['stats']; blocked?: string }>;
}

/**
 * 母模板 → 直接子模板 同步。
 * 对每个选中子模板：基于其当前 approved 版本套用母版字段（按 field_mapping），
 * 生成新 pending 版本（须经该子模板的正常审核才生效），并推进 parent_version_id。
 * 子模板有未定稿（draft/pending/rejected 未处理）→ 跳过，绝不覆盖任何人的工作。
 */
export async function syncToChildren(
  pool: pg.Pool, kind: TemplateKind, parentId: number,
  opts: { childIds: number[]; includeAdded: boolean; sourceVersionId?: number | null; dryRun?: boolean },
  actor: { name: string; role?: string }
): Promise<SyncResult> {
  const { base, versions } = TABLES[kind];

  const parentRow = await pool.query(`SELECT id, name, current_version_id FROM ${base} WHERE id = $1`, [parentId]);
  if (!parentRow.rows.length) throw new VersionFlowError('母模板不存在', 404);
  const parent = parentRow.rows[0];

  const sourceVersionId = opts.sourceVersionId || parent.current_version_id;
  const sv = await pool.query(`SELECT * FROM ${versions} WHERE id = $1 AND template_id = $2`, [sourceVersionId, parentId]);
  if (!sv.rows.length) throw new VersionFlowError('源版本不存在', 404);
  const sourceVersion = sv.rows[0];
  if (sourceVersion.status !== 'approved' && sourceVersion.status !== 'superseded') {
    throw new VersionFlowError('只能从已审核通过的版本同步');
  }

  const children = await pool.query(
    `SELECT id, name, field_mapping, current_version_id FROM ${base}
     WHERE parent_template_id = $1 AND archived_at IS NULL AND id = ANY($2::int[])`,
    [parentId, opts.childIds]
  );

  const result: SyncResult = { source_version_no: sourceVersion.version_no, applied: [], skipped: [] };
  if (opts.dryRun) result.preview = [];

  for (const child of children.rows) {
    if (!child.field_mapping) {
      const entry = { id: child.id, name: child.name, reason: '无字段映射（早于映射机制 fork 的子模板）' };
      if (opts.dryRun) result.preview!.push({ id: child.id, name: child.name, stats: { replaced: [], removed: [], added: [] }, blocked: entry.reason });
      else result.skipped.push(entry);
      continue;
    }
    const open = await getOpenVersion(pool, kind, child.id);
    if (open) {
      const reason = `存在未定稿 v${open.version_no}（${open.status === 'pending' ? '审核中' : open.status === 'rejected' ? '已退回待处理' : '草稿'}，作者 ${open.author_name}），不覆盖`;
      if (opts.dryRun) result.preview!.push({ id: child.id, name: child.name, stats: { replaced: [], removed: [], added: [] }, blocked: reason });
      else result.skipped.push({ id: child.id, name: child.name, reason });
      continue;
    }
    const childCur = await pool.query(`SELECT * FROM ${versions} WHERE id = $1`, [child.current_version_id]);
    if (!childCur.rows.length) {
      const entry = { id: child.id, name: child.name, reason: '子模板没有当前生效版本' };
      if (opts.dryRun) result.preview!.push({ id: child.id, name: child.name, stats: { replaced: [], removed: [], added: [] }, blocked: entry.reason });
      else result.skipped.push(entry);
      continue;
    }
    const childVersion = childCur.rows[0];
    const computed = computeSyncedFieldDefinitions(
      sourceVersion.field_definitions, childVersion.field_definitions, child.field_mapping, opts.includeAdded
    );
    const changeCount = computed.stats.replaced.length + computed.stats.removed.length + computed.stats.added.length;

    if (opts.dryRun) {
      result.preview!.push({ id: child.id, name: child.name, stats: computed.stats, ...(changeCount === 0 ? { blocked: '与母版无差异，无需同步' } : {}) });
      continue;
    }
    if (changeCount === 0) {
      result.skipped.push({ id: child.id, name: child.name, reason: '与母版无差异，无需同步' });
      continue;
    }

    const changeSummary =
      `同步自母模板「${parent.name}」v${sourceVersion.version_no}` +
      (sourceVersion.change_summary ? `：${sourceVersion.change_summary}` : '');

    const draft = await createDraft(pool, kind, child.id, actor.name, {
      field_definitions: computed.field_definitions,
      layout_options: childVersion.layout_options,      // 布局/Typst 保持子模板自己的
      typst_source: childVersion.typst_source,
      change_summary: changeSummary,
    });
    const pending = await submitForReview(pool, kind, draft.id, actor.name, actor.role, changeSummary);

    // 推进 parent_version_id + 合并新映射条目
    const hasNewMapping =
      Object.keys(computed.mappingAdditions.fields).length > 0 ||
      Object.keys(computed.mappingAdditions.groups).length > 0;
    const newMapping = hasNewMapping
      ? {
          groups: { ...child.field_mapping.groups, ...computed.mappingAdditions.groups },
          fields: { ...child.field_mapping.fields, ...computed.mappingAdditions.fields },
        }
      : child.field_mapping;
    await pool.query(
      `UPDATE ${base} SET parent_version_id = $1, field_mapping = $2::jsonb, updated_at = NOW() WHERE id = $3`,
      [sourceVersionId, JSON.stringify(newMapping), child.id]
    );
    await logTemplateAudit(pool, kind, child.id, 'sync_in', actor, {
      parent_template_id: parentId, source_version_no: sourceVersion.version_no,
      version_no: pending.version_no, stats: computed.stats,
    }, pending.id);
    result.applied.push({ id: child.id, name: child.name, version_no: pending.version_no, stats: computed.stats });
  }

  if (!opts.dryRun && (result.applied.length || result.skipped.length)) {
    await logTemplateAudit(pool, kind, parentId, 'sync_out', actor, {
      source_version_no: sourceVersion.version_no,
      applied: result.applied.map((a) => a.id),
      skipped: result.skipped.map((s) => ({ id: s.id, reason: s.reason })),
    }, sourceVersionId);
  }
  return result;
}

// ---------------------------------------------------------------------------
// 删除（归档）审批流（migration 023）
// ---------------------------------------------------------------------------

/** 发起删除申请：写 base 行三列 + 审计。已归档 / 已有申请 → 409 */
export async function requestArchive(
  pool: pg.Pool, kind: TemplateKind, templateId: number,
  actor: { name: string; role?: string }, note?: string | null
) {
  const { base } = TABLES[kind];
  const cur = await pool.query(`SELECT id, name, archived_at, archive_requested_by FROM ${base} WHERE id = $1`, [templateId]);
  if (!cur.rows.length) throw new VersionFlowError('模板不存在', 404);
  if (cur.rows[0].archived_at) throw new VersionFlowError('模板已归档', 409);
  if (cur.rows[0].archive_requested_by) {
    throw new VersionFlowError(`已有删除申请（${cur.rows[0].archive_requested_by} 发起），等待审核员审批`, 409);
  }
  await pool.query(
    `UPDATE ${base} SET archive_requested_by = $1, archive_requested_at = NOW(), archive_request_note = $2 WHERE id = $3`,
    [actor.name, note || null, templateId]
  );
  await logTemplateAudit(pool, kind, templateId, 'archive_request', actor, { note: note || null });
  return { ok: true };
}

/** 撤销删除申请：申请人或审核员 */
export async function cancelArchiveRequest(
  pool: pg.Pool, kind: TemplateKind, templateId: number, actor: { name: string; role?: string }
) {
  const { base } = TABLES[kind];
  const cur = await pool.query(`SELECT archive_requested_by FROM ${base} WHERE id = $1`, [templateId]);
  if (!cur.rows.length) throw new VersionFlowError('模板不存在', 404);
  const requester = cur.rows[0].archive_requested_by;
  if (!requester) throw new VersionFlowError('没有待审批的删除申请');
  if (requester !== actor.name && !isTemplateReviewer(kind, actor.role)) {
    throw new VersionFlowError('只有申请人或对应审核角色可以撤销删除申请', 403);
  }
  await pool.query(
    `UPDATE ${base} SET archive_requested_by = NULL, archive_requested_at = NULL, archive_request_note = NULL WHERE id = $1`,
    [templateId]
  );
  await logTemplateAudit(pool, kind, templateId, 'archive_request_cancel', actor, { requested_by: requester });
  return { ok: true };
}

/**
 * 删除审批校验/驳回：
 *   - reject → 在此完成（清申请 + 审计），返回 null
 *   - approve → 校验通过后返回申请行（实际归档由 routes 执行——record/report 的关联清理逻辑不同），
 *     归档成功后 routes 再调 clearArchiveRequest + 审计 'archive'
 */
export async function reviewArchiveRequest(
  pool: pg.Pool, kind: TemplateKind, templateId: number,
  decision: 'approve' | 'reject', actor: { name: string; role?: string }, note?: string | null
) {
  const { base } = TABLES[kind];
  const cur = await pool.query(
    `SELECT archive_requested_by, archive_requested_at, archive_request_note FROM ${base} WHERE id = $1`, [templateId]);
  if (!cur.rows.length) throw new VersionFlowError('模板不存在', 404);
  const row = cur.rows[0];
  if (!row.archive_requested_by) throw new VersionFlowError('没有待审批的删除申请');
  if (!isTemplateReviewer(kind, actor.role)) throw new VersionFlowError('只有对应审核角色可以审批删除', 403);
  // 允许自审：申请人可自行批准自己发起的删除申请（取消"申请人与批准人不能为同一人"限制）
  if (decision === 'reject') {
    if (!note || !note.trim()) throw new VersionFlowError('驳回必须填写备注');
    await pool.query(
      `UPDATE ${base} SET archive_requested_by = NULL, archive_requested_at = NULL, archive_request_note = NULL WHERE id = $1`,
      [templateId]
    );
    await logTemplateAudit(pool, kind, templateId, 'archive_reject', actor,
      { requested_by: row.archive_requested_by, note });
    return null;
  }
  return row;   // approve：routes 执行归档
}

export function readActor(req: any) {
  const rawName = (req.header('X-Demo-User') || '').trim();
  let name = rawName;
  try { name = decodeURIComponent(rawName); } catch { /* */ }
  const role = (req.header('X-Demo-Role') || '').trim();                 // 主显示角色（审计标注）
  const roles = (req.header('X-Demo-Roles') || role).split(',').map((s: string) => s.trim()).filter(Boolean); // 全部角色（鉴权）
  return { name, role, roles };
}

/** 当前请求的角色集合是否拥有某权限（鉴权统一入口，替代写死角色名）。 */
export function actorHasPermission(req: any, perm: Permission): boolean {
  const roles = (req.header('X-Demo-Roles') || req.header('X-Demo-Role') || '').split(',').map((s: string) => s.trim()).filter(Boolean);
  return rolesHavePermission(roles, perm);
}

/** 该（主显示）角色是否为对应模板类型的审核角色：原始记录模板→测试主管，报告模板→报告审核；admin 通用。 */
function isTemplateReviewer(kind: TemplateKind, role?: string): boolean {
  if (role === 'admin') return true;
  return kind === 'record' ? role === 'test_supervisor' : role === 'report_reviewer';
}
