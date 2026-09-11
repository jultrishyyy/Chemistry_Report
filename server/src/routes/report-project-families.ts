import { Router, type Request, type Response } from 'express';
import { pool } from '../db.js';
import {
  actorHasPermission, forkTemplate, readActor, syncToChildren, VersionFlowError,
} from '../services/template-versions.js';

const router: Router = Router();
const cleanText = (value: unknown) => String(value ?? '').trim();
const generatedCode = () => `report_group_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

function requireEdit(req: Request, res: Response) {
  if (actorHasPermission(req as any, 'report_template.edit')) return true;
  res.status(403).json({ error: '当前账号无编辑报告模板权限' }); return false;
}

function expandGroups(groups: any[], requested: unknown): string[] {
  const selected = new Set(Array.isArray(requested) ? requested.map(String) : []);
  if (!selected.size) throw new VersionFlowError('请至少选择一个继承分区');
  const known = new Set(groups.map(group => String(group.id)));
  for (const id of selected) if (!known.has(id)) throw new VersionFlowError(`基础项目模板中不存在分区 ${id}`);
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of groups) {
      if (group.parent_group_id && selected.has(String(group.parent_group_id)) && !selected.has(String(group.id))) {
        selected.add(String(group.id)); changed = true;
      }
    }
  }
  return [...selected];
}

router.get('/', async (req: Request, res: Response) => {
  const requestedKind = cleanText(req.query.kind);
  const kind = requestedKind === 'cover' || requestedKind === 'project' ? requestedKind : null;
  const families = await pool.query(
    `SELECT f.*,g.name AS record_template_group_name,g.code AS record_template_group_code,
            hm.name AS host_manufacturer_name,hm.category AS host_manufacturer_category,
            bt.name AS base_report_template_name,bv.version_no AS base_version_no,bv.status AS base_status
       FROM report_project_template_families f
       LEFT JOIN test_template_groups g ON g.id=f.record_template_group_id
       LEFT JOIN host_manufacturers hm ON hm.id=f.host_manufacturer_id
       LEFT JOIN report_templates bt ON bt.id=f.base_report_template_id
       LEFT JOIN report_template_versions bv ON bv.id=bt.current_version_id
      WHERE f.archived_at IS NULL AND ($1::text IS NULL OR f.template_kind=$1)
      ORDER BY hm.name NULLS FIRST,f.name,f.id`,
    [kind],
  );
  const members = await pool.query(
    `SELECT t.id,t.name,t.report_project_family_id,t.linked_record_template_id,t.parent_template_id,
            t.parent_version_id,t.field_mapping,t.host_manufacturer_id,t.current_version_id,
            rv.version_no,rv.status,rec.name AS linked_record_template_name
       FROM report_templates t
       JOIN report_project_template_families f ON f.id=t.report_project_family_id
       LEFT JOIN report_template_versions rv ON rv.id=t.current_version_id
       LEFT JOIN record_templates rec ON rec.id=t.linked_record_template_id
      WHERE t.archived_at IS NULL AND f.archived_at IS NULL
        AND t.template_kind=f.template_kind AND ($1::text IS NULL OR f.template_kind=$1)
      ORDER BY t.name,t.id`,
    [kind],
  );
  const byFamily = new Map<number, any[]>();
  for (const member of members.rows) {
    const list = byFamily.get(Number(member.report_project_family_id)) || [];
    list.push(member); byFamily.set(Number(member.report_project_family_id), list);
  }
  res.json(families.rows.map(family => ({ ...family, templates: byFamily.get(Number(family.id)) || [] })));
});

router.post('/', async (req: Request, res: Response) => {
  if (!requireEdit(req, res)) return;
  const recordGroupId = req.body?.record_template_group_id ? Number(req.body.record_template_group_id) : null;
  const templateKind = req.body?.template_kind === 'cover' ? 'cover' : 'project';
  const name = cleanText(req.body?.name); const code = generatedCode();
  if (!name) { res.status(400).json({ error: '项目组名称必填' }); return; }
  try {
    const result = await pool.query(
      `INSERT INTO report_project_template_families
       (record_template_group_id,host_manufacturer_id,code,name,description,template_kind)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [recordGroupId, req.body?.host_manufacturer_id ? Number(req.body.host_manufacturer_id) : null,
       code, name, cleanText(req.body?.description) || null, templateKind],
    );
    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    res.status(error?.code === '23505' ? 409 : 500).json({ error: error?.code === '23505'
      ? '已存在相同配置的项目组，请修改名称或主机厂后重试' : error.message });
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  if (!requireEdit(req, res)) return;
  const current = await pool.query('SELECT * FROM report_project_template_families WHERE id=$1 AND archived_at IS NULL', [Number(req.params.id)]);
  if (!current.rows.length) { res.status(404).json({ error: '报告项目组不存在' }); return; }
  const before = current.rows[0];
  try {
    const result = await pool.query(
      `UPDATE report_project_template_families SET name=$1,description=$2,
       host_manufacturer_id=$3,enabled=$4,updated_at=NOW() WHERE id=$5 RETURNING *`,
      [req.body?.name != null ? cleanText(req.body.name) : before.name,
       Object.prototype.hasOwnProperty.call(req.body || {}, 'description') ? cleanText(req.body.description) || null : before.description,
       Object.prototype.hasOwnProperty.call(req.body || {}, 'host_manufacturer_id')
         ? (req.body.host_manufacturer_id ? Number(req.body.host_manufacturer_id) : null) : before.host_manufacturer_id,
       typeof req.body?.enabled === 'boolean' ? req.body.enabled : before.enabled,Number(req.params.id)],
    );
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(error?.code === '23505' ? 409 : 500).json({ error: error?.code === '23505'
      ? '已存在相同配置的项目组，请修改名称或主机厂后重试' : error.message });
  }
});

/** 把已有同类独立报告模板归入项目组。 */
router.post('/:id/templates', async (req: Request, res: Response) => {
  if (!requireEdit(req, res)) return;
  const familyId = Number(req.params.id);
  const requestedIds = Array.isArray(req.body?.template_ids) ? req.body.template_ids : [req.body?.template_id];
  const templateIds = [...new Set(requestedIds.map(Number).filter(Number.isFinite))];
  if (!templateIds.length) { res.status(400).json({ error: '请至少选择一个模板' }); return; }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const family = await db.query(
      `SELECT id,template_kind FROM report_project_template_families
        WHERE id=$1 AND archived_at IS NULL FOR UPDATE`, [familyId],
    );
    if (!family.rows.length) throw new VersionFlowError('项目组不存在或已删除', 404);
    const candidates = await db.query(
      `SELECT id,name,template_kind,report_project_family_id
         FROM report_templates WHERE id=ANY($1::int[]) AND archived_at IS NULL FOR UPDATE`, [templateIds],
    );
    if (candidates.rows.length !== templateIds.length) throw new VersionFlowError('部分模板不存在或已删除', 409);
    const invalid = candidates.rows.filter(row => row.template_kind !== family.rows[0].template_kind || row.report_project_family_id != null);
    if (invalid.length) throw new VersionFlowError(`以下模板类型不匹配或已属于项目组：${invalid.map(row => row.name).join('、')}`, 409);
    const result = await db.query(
      `UPDATE report_templates t SET report_project_family_id=$1,updated_at=NOW()
        FROM report_project_template_families f
       WHERE t.id=ANY($2::int[]) AND f.id=$1 AND f.archived_at IS NULL
         AND t.template_kind=f.template_kind AND t.archived_at IS NULL
         AND t.report_project_family_id IS NULL
       RETURNING t.*`, [familyId, templateIds],
    );
    if (result.rows.length !== templateIds.length) throw new VersionFlowError('部分模板未能加入项目组，请刷新后重试', 409);
    await db.query('COMMIT');
    res.json({ templates: result.rows, count: result.rows.length });
  } catch (error: any) {
    await db.query('ROLLBACK');
    res.status(error instanceof VersionFlowError ? error.status : 500).json({ error: error.message });
  } finally { db.release(); }
});

router.put('/:id/base-template', async (req: Request, res: Response) => {
  if (!requireEdit(req, res)) return;
  const familyId = Number(req.params.id); const templateId = Number(req.body?.template_id);
  const actor = readActor(req as any);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const familyResult = await db.query('SELECT * FROM report_project_template_families WHERE id=$1 FOR UPDATE', [familyId]);
    if (!familyResult.rows.length) throw new VersionFlowError('报告项目组不存在', 404);
    const family = familyResult.rows[0];
    if (family.base_report_template_id && Number(family.base_report_template_id) !== templateId) {
      const count = await db.query('SELECT COUNT(*)::int AS count FROM report_templates WHERE parent_template_id=$1 AND archived_at IS NULL', [family.base_report_template_id]);
      if (count.rows[0].count > 0) throw new VersionFlowError('该报告项目组已有派生模板，不能直接更换基础模板', 409);
    }
    const templateResult = await db.query(
      `SELECT t.*,v.field_definitions,v.status,v.version_no
         FROM report_templates t JOIN report_template_versions v ON v.id=t.current_version_id
        WHERE t.id=$1 AND t.template_kind='project' AND t.archived_at IS NULL`, [templateId],
    );
    if (!templateResult.rows.length) throw new VersionFlowError('基础项目模板不存在或尚无生效版本', 404);
    const template = templateResult.rows[0];
    if (template.status !== 'approved') throw new VersionFlowError('只能将已审核生效的项目模板设为项目组基础模板');
    if (template.parent_template_id) throw new VersionFlowError('派生项目模板不能再设为项目组基础模板', 409);
    const inheritedGroupIds = expandGroups(template.field_definitions || [], req.body?.inherited_group_ids);
    await db.query('UPDATE report_templates SET report_project_family_id=$1,host_manufacturer_id=$2,updated_at=NOW() WHERE id=$3',
      [familyId, family.host_manufacturer_id, templateId]);
    await db.query(
      `UPDATE report_project_template_families SET base_report_template_id=$1,inherited_group_ids=$2::jsonb,updated_at=NOW() WHERE id=$3`,
      [templateId, JSON.stringify(inheritedGroupIds), familyId],
    );
    const children = await db.query(
      `SELECT t.id,t.field_mapping,cv.field_definitions FROM report_templates t
       LEFT JOIN report_template_versions cv ON cv.id=t.current_version_id
       WHERE t.report_project_family_id=$1 AND t.parent_template_id=$2 AND t.archived_at IS NULL`, [familyId, templateId],
    );
    for (const child of children.rows) {
      const old = child.field_mapping || { groups: {}, fields: {} };
      const childGroups = child.field_definitions || [];
      const next: any = { groups: {}, fields: {}, inherited_group_ids: inheritedGroupIds };
      for (const parentGroup of template.field_definitions || []) {
        if (!inheritedGroupIds.includes(String(parentGroup.id))) continue;
        const childGroupId = Object.entries(old.groups || {}).find(([, parentId]) => parentId === parentGroup.id)?.[0]
          || childGroups.find((item: any) => item.inheritance_source_group_id === parentGroup.id || item.id === parentGroup.id)?.id;
        if (!childGroupId) continue;
        next.groups[childGroupId] = parentGroup.id;
        const childGroup = childGroups.find((item: any) => item.id === childGroupId);
        for (const parentField of parentGroup.fields || []) {
          const childFieldId = Object.entries(old.fields || {}).find(([, parentId]) => parentId === parentField.id)?.[0]
            || (childGroup?.fields || []).find((item: any) => item.id === parentField.id || item.code === parentField.code)?.id;
          if (childFieldId) next.fields[childFieldId] = parentField.id;
        }
      }
      await db.query('UPDATE report_templates SET field_mapping=$1::jsonb WHERE id=$2', [JSON.stringify(next), child.id]);
    }
    await db.query('COMMIT');
    let childSync: any = null;
    if (children.rows.length) {
      try {
        childSync = await syncToChildren(pool, 'report', templateId, {
          childIds: children.rows.map(child => Number(child.id)),includeAdded: true,dryRun: false,
        }, actor);
      } catch (error: any) { childSync = { error: error.message }; }
    }
    res.json({ template_id: templateId,inherited_group_ids: inheritedGroupIds,child_sync: childSync });
  } catch (error: any) {
    await db.query('ROLLBACK');
    res.status(error instanceof VersionFlowError ? error.status : 500).json({ error: error.message });
  } finally { db.release(); }
});

router.post('/:id/derive', async (req: Request, res: Response) => {
  if (!requireEdit(req, res)) return;
  const familyId = Number(req.params.id); const name = cleanText(req.body?.name);
  const recordTemplateId = Number(req.body?.linked_record_template_id);
  if (!name || !Number.isFinite(recordTemplateId)) { res.status(400).json({ error: '模板名称和关联原始记录模板必填' }); return; }
  const actor = readActor(req as any);
  try {
    const familyResult = await pool.query(
      `SELECT f.*,bt.current_version_id,bv.status,bv.field_definitions
         FROM report_project_template_families f
         LEFT JOIN report_templates bt ON bt.id=f.base_report_template_id
         LEFT JOIN report_template_versions bv ON bv.id=bt.current_version_id
        WHERE f.id=$1`, [familyId],
    );
    if (!familyResult.rows.length) throw new VersionFlowError('报告项目组不存在', 404);
    const family = familyResult.rows[0];
    if (!family.base_report_template_id || !family.current_version_id) throw new VersionFlowError('请先设置项目组基础模板', 409);
    if (family.status !== 'approved') throw new VersionFlowError('项目组基础模板尚未审核生效', 409);
    const record = await pool.query(
      'SELECT r.id,r.name FROM record_templates r WHERE r.id=$1 AND r.archived_at IS NULL',
      [recordTemplateId],
    );
    if (!record.rows.length) throw new VersionFlowError('所选原始记录模板不存在或已删除', 409);
    const duplicate = await pool.query("SELECT 1 FROM report_templates WHERE template_kind='project' AND archived_at IS NULL AND btrim(name)=btrim($1)", [name]);
    if (duplicate.rows.length) throw new VersionFlowError(`已存在同名项目模板「${name}」`, 409);
    const inheritedGroupIds = expandGroups(family.field_definitions || [], family.inherited_group_ids);
    const created = await forkTemplate(pool,'report',Number(family.base_report_template_id),Number(family.current_version_id),
      name,actor.name,actor.role,{
        inheritedGroupIds,
        afterCreate: async (client,newTemplateId) => {
          await client.query(
            `UPDATE report_templates SET report_project_family_id=$1,host_manufacturer_id=$2,
             linked_record_template_id=$3,updated_at=NOW() WHERE id=$4`,
            [familyId,family.host_manufacturer_id,recordTemplateId,newTemplateId],
          );
          // 报告数据绑定可能因测试方法不同而需要人工确认；派生结果必须作为草稿进入正常审核流。
          await client.query(
            `UPDATE report_template_versions SET status='draft',reviewer_name=NULL,reviewed_at=NULL,
             change_summary=$1,updated_at=NOW() WHERE template_id=$2 AND version_no=1`,
            [`从报告项目组基础模板派生，需确认“${record.rows[0].name}”的数据绑定`,newTemplateId],
          );
          await client.query('UPDATE report_templates SET current_version_id=NULL WHERE id=$1',[newTemplateId]);
        },
      });
    res.status(201).json({ ...created,family_id: familyId,linked_record_template_id: recordTemplateId,
      inherited_group_ids: inheritedGroupIds });
  } catch (error: any) {
    res.status(error instanceof VersionFlowError ? error.status : error?.code === '23505' ? 409 : 500).json({ error: error.message });
  }
});

async function logGroupArchiveAction(
  db: { query: (sql: string, params?: any[]) => Promise<any> }, groupId: number,
  action: 'archive_request' | 'archive_request_cancel' | 'archive_reject' | 'archive',
  actor: { name: string; role?: string }, detail: Record<string, unknown> = {},
) {
  await db.query(
    `INSERT INTO report_project_group_audit_log (group_id,action,actor_name,actor_role,detail)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [groupId, action, actor.name, actor.role || null, JSON.stringify(detail)],
  );
}

router.post('/:id/archive-request', async (req: Request, res: Response) => {
  if (!requireEdit(req, res)) return;
  const groupId = Number(req.params.id); const actor = readActor(req as any);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const current = await db.query(
      'SELECT id,archived_at,archive_requested_by FROM report_project_template_families WHERE id=$1 FOR UPDATE', [groupId],
    );
    if (!current.rows.length) throw new VersionFlowError('项目组不存在', 404);
    if (current.rows[0].archived_at) throw new VersionFlowError('项目组已删除', 409);
    if (current.rows[0].archive_requested_by) {
      throw new VersionFlowError(`已有删除申请（${current.rows[0].archive_requested_by} 发起），等待审核`, 409);
    }
    const note = cleanText(req.body?.note) || null;
    await db.query(
      `UPDATE report_project_template_families SET archive_requested_by=$1,archive_requested_at=NOW(),
       archive_request_note=$2,updated_at=NOW() WHERE id=$3`, [actor.name, note, groupId],
    );
    await logGroupArchiveAction(db, groupId, 'archive_request', actor, { note });
    await db.query('COMMIT'); res.json({ ok: true });
  } catch (error: any) {
    await db.query('ROLLBACK'); res.status(error.status || 500).json({ error: error.message });
  } finally { db.release(); }
});

router.post('/:id/archive-request/cancel', async (req: Request, res: Response) => {
  if (!requireEdit(req, res)) return;
  const groupId = Number(req.params.id); const actor = readActor(req as any);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const current = await db.query(
      `SELECT archive_requested_by FROM report_project_template_families
        WHERE id=$1 AND archived_at IS NULL FOR UPDATE`, [groupId],
    );
    if (!current.rows.length) throw new VersionFlowError('项目组不存在', 404);
    const requester = current.rows[0].archive_requested_by;
    if (!requester) throw new VersionFlowError('没有待审核的删除申请', 409);
    if (requester !== actor.name && !actorHasPermission(req as any, 'report.review')) {
      throw new VersionFlowError('只有申请人或审核员可以撤回删除申请', 403);
    }
    await db.query(
      `UPDATE report_project_template_families SET archive_requested_by=NULL,archive_requested_at=NULL,
       archive_request_note=NULL,updated_at=NOW() WHERE id=$1`, [groupId],
    );
    await logGroupArchiveAction(db, groupId, 'archive_request_cancel', actor, { requested_by: requester });
    await db.query('COMMIT'); res.json({ ok: true });
  } catch (error: any) {
    await db.query('ROLLBACK'); res.status(error.status || 500).json({ error: error.message });
  } finally { db.release(); }
});

router.post('/:id/archive-review', async (req: Request, res: Response) => {
  const actor = readActor(req as any);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  if (!actorHasPermission(req as any, 'report.review')) {
    res.status(403).json({ error: '当前账号无审核报告项目组删除权限' }); return;
  }
  const groupId = Number(req.params.id);
  const decision = req.body?.decision === 'reject' ? 'reject' : req.body?.decision === 'approve' ? 'approve' : null;
  const note = cleanText(req.body?.note) || null;
  if (!decision) { res.status(400).json({ error: '审核决定必须为 approve 或 reject' }); return; }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const current = await db.query(
      `SELECT archive_requested_by,archive_request_note FROM report_project_template_families
        WHERE id=$1 AND archived_at IS NULL FOR UPDATE`, [groupId],
    );
    if (!current.rows.length) throw new VersionFlowError('项目组不存在', 404);
    const group = current.rows[0];
    if (!group.archive_requested_by) throw new VersionFlowError('没有待审核的删除申请', 409);
    const isAdmin = actor.role === 'admin' || actor.roles?.includes('admin');
    if (group.archive_requested_by === actor.name && !isAdmin) {
      throw new VersionFlowError('申请人不能审核自己的删除申请，请由其他审核人处理', 403);
    }
    if (decision === 'reject') {
      if (!note) throw new VersionFlowError('驳回必须填写备注', 400);
      await db.query(
        `UPDATE report_project_template_families SET archive_requested_by=NULL,archive_requested_at=NULL,
         archive_request_note=NULL,updated_at=NOW() WHERE id=$1`, [groupId],
      );
      await logGroupArchiveAction(db, groupId, 'archive_reject', actor, {
        requested_by: group.archive_requested_by, request_note: group.archive_request_note, note,
      });
      await db.query('COMMIT'); res.json({ ok: true, rejected: true }); return;
    }
    const memberCount = (await db.query(
      'SELECT COUNT(*)::int AS count FROM report_templates WHERE report_project_family_id=$1 AND archived_at IS NULL', [groupId],
    )).rows[0].count;
    await db.query(
      'UPDATE report_templates SET report_project_family_id=NULL,updated_at=NOW() WHERE report_project_family_id=$1', [groupId],
    );
    await db.query(
      `UPDATE report_project_template_families SET archived_at=NOW(),enabled=FALSE,
       archive_requested_by=NULL,archive_requested_at=NULL,archive_request_note=NULL,updated_at=NOW() WHERE id=$1`, [groupId],
    );
    await logGroupArchiveAction(db, groupId, 'archive', actor, {
      requested_by: group.archive_requested_by, request_note: group.archive_request_note,
      approve_note: note, detached_template_count: memberCount,
    });
    await db.query('COMMIT');
    res.json({ ok: true, archived: true, detached_template_count: memberCount });
  } catch (error: any) {
    await db.query('ROLLBACK'); res.status(error.status || 500).json({ error: error.message });
  } finally { db.release(); }
});

export default router;
