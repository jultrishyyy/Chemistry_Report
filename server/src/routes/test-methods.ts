import { Router, type Request, type Response } from 'express';
import { pool } from '../db.js';
import { requirePermission } from './auth.js';
import { actorHasPermission, forkTemplate, readActor, syncToChildren, VersionFlowError } from '../services/template-versions.js';

const router: Router = Router();

const cleanCode = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, '_');
const cleanText = (value: unknown) => String(value ?? '').trim();

function actorName(req: Request) {
  const raw = (req.header('X-Demo-User') || '').trim();
  try { return decodeURIComponent(raw); } catch { return raw; }
}

function decorateCommonGroups(groups: any[], component: any, version: any) {
  return JSON.parse(JSON.stringify(Array.isArray(groups) ? groups : [])).map((group: any) => ({
    ...group,
    common_component_id: Number(component.id),
    common_component_code: component.code,
    common_component_name: component.name,
    common_component_version_id: Number(version.id),
    common_component_version_no: Number(version.version_no),
    fields: (group.fields || []).map((field: any) => ({ ...field, data_scope: 'batch_shared' })),
  }));
}

router.get('/groups', async (_req: Request, res: Response) => {
  const groups = await pool.query(
    `SELECT g.*,
            COALESCE(json_agg(json_build_object(
              'id', m.id, 'group_id', m.group_id, 'method_code', m.method_code, 'method_name', m.method_name,
              'standard', m.standard, 'record_template_id', m.record_template_id,
              'record_template_name', rt.name,
              'parent_template_id', rt.parent_template_id,
              'parent_version_id', rt.parent_version_id,
              'field_mapping', rt.field_mapping,
              'report_project_template_id', rpt.id,
              'report_project_template_name', rpt.name,
              'report_project_name', m.report_project_name,
              'recommended', m.recommended, 'enabled', m.enabled, 'sort_order', m.sort_order
            ) ORDER BY m.sort_order, m.id) FILTER (WHERE m.id IS NOT NULL), '[]'::json) AS methods
       FROM test_template_groups g
       LEFT JOIN test_method_schemes m ON m.group_id = g.id
       LEFT JOIN record_templates rt ON rt.id = m.record_template_id
       LEFT JOIN LATERAL (
         SELECT p.id,p.name FROM report_templates p
          WHERE p.template_kind='project' AND p.archived_at IS NULL AND p.linked_record_template_id=m.record_template_id
          ORDER BY p.id LIMIT 1
       ) rpt ON TRUE
      WHERE g.archived_at IS NULL
      GROUP BY g.id
      ORDER BY g.enabled DESC, g.name, g.id`
  );
  const baseTemplates = await pool.query(
    `SELECT g.id AS group_id,g.base_record_template_id,g.inherited_group_ids,
            t.name AS base_record_template_name,cv.version_no AS base_version_no,cv.status AS base_status,
            cv.field_definitions AS base_field_definitions
       FROM test_template_groups g
       LEFT JOIN record_templates t ON t.id=g.base_record_template_id
       LEFT JOIN record_template_versions cv ON cv.id=t.current_version_id`,
  );
  const baseByGroup = new Map(baseTemplates.rows.map(row => [Number(row.group_id), row]));
  const components = await pool.query(
    `SELECT c.id,c.group_id,c.code,c.name,c.source_template_id,c.enabled,c.current_version_id,
            v.version_no,v.field_groups,v.updated_at
       FROM record_common_components c
       LEFT JOIN LATERAL (
         SELECT cv.version_no,cv.field_groups,cv.created_at AS updated_at
           FROM record_common_component_versions cv WHERE cv.id=c.current_version_id
       ) v ON TRUE
      ORDER BY c.enabled DESC,c.name,c.id`,
  );
  const byGroup = new Map<number, any[]>();
  components.rows.forEach(component => {
    const list = byGroup.get(Number(component.group_id)) || [];
    list.push(component); byGroup.set(Number(component.group_id), list);
  });
  res.json(groups.rows.map(group => ({
    ...group,
    ...(baseByGroup.get(Number(group.id)) || {}),
    // 旧公共组件只读返回用于存量兼容；新界面不再提供多组件配置入口。
    legacy_components: byGroup.get(Number(group.id)) || [],
  })));
});

function expandInheritedGroups(groups: any[], requested: unknown): string[] {
  const selected = new Set(Array.isArray(requested) ? requested.map(String) : []);
  if (!selected.size) throw new VersionFlowError('请至少选择一个继承分区');
  const known = new Set(groups.map(group => String(group.id)));
  for (const id of selected) if (!known.has(id)) throw new VersionFlowError(`分区 ${id} 不存在于基础模板`);
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

/** 历史兼容：设置项目组基础模板。新界面不再使用此入口。 */
router.put('/groups/:id/base-template', requirePermission('record_template.edit'), async (req: Request, res: Response) => {
  const groupId = Number(req.params.id);
  const templateId = Number(req.body?.template_id);
  const actor = readActor(req as any);
  if (!Number.isFinite(templateId)) { res.status(400).json({ error: '基础原始记录模板必填' }); return; }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const groupResult = await db.query('SELECT * FROM test_template_groups WHERE id=$1 FOR UPDATE', [groupId]);
    if (!groupResult.rows.length) throw new VersionFlowError('项目组不存在', 404);
    const previousBaseId = Number(groupResult.rows[0].base_record_template_id || 0);
    if (previousBaseId && previousBaseId !== templateId) {
      const children = await db.query('SELECT COUNT(*)::int AS count FROM record_templates WHERE parent_template_id=$1 AND archived_at IS NULL', [previousBaseId]);
      if (children.rows[0].count > 0) throw new VersionFlowError('该项目组已有派生模板，不能直接更换基础模板；请先处理现有派生关系', 409);
    }
    const templateResult = await db.query(
      `SELECT t.*,v.status,v.field_definitions,v.version_no
         FROM record_templates t JOIN record_template_versions v ON v.id=t.current_version_id
        WHERE t.id=$1 AND t.archived_at IS NULL`, [templateId],
    );
    if (!templateResult.rows.length) throw new VersionFlowError('基础模板不存在或尚无生效版本', 404);
    const template = templateResult.rows[0];
    if (template.status !== 'approved') throw new VersionFlowError('只能将已审核生效的模板设为项目组基础模板');
    if (template.parent_template_id) throw new VersionFlowError('派生模板不能再设为项目组基础模板，请选择独立母模板', 409);
    const occupied = await db.query('SELECT group_id FROM test_method_schemes WHERE record_template_id=$1', [templateId]);
    if (occupied.rows.length && Number(occupied.rows[0].group_id) !== groupId) {
      throw new VersionFlowError('该原始记录模板已属于其他项目组', 409);
    }
    const inheritedGroupIds = expandInheritedGroups(template.field_definitions || [], req.body?.inherited_group_ids);
    await db.query(
      `UPDATE test_template_groups SET base_record_template_id=$1,inherited_group_ids=$2::jsonb,updated_at=NOW() WHERE id=$3`,
      [templateId, JSON.stringify(inheritedGroupIds), groupId],
    );
    await db.query(
      `INSERT INTO test_method_schemes
       (group_id,method_code,method_name,record_template_id,report_project_name,recommended,sort_order)
       VALUES ($1,$2,$3,$4,$3,TRUE,0)
       ON CONFLICT (record_template_id) DO UPDATE SET group_id=EXCLUDED.group_id,recommended=TRUE,updated_at=NOW()`,
      [groupId, cleanCode(req.body?.method_code || `base_${templateId}`), cleanText(req.body?.method_name || template.name), templateId],
    );
    // 调整已有直接派生模板的继承边界；模板内容仍通过下一次差异同步产生待审核版本。
    const children = await db.query(
      `SELECT t.id,t.field_mapping,cv.field_definitions
         FROM record_templates t
         JOIN test_method_schemes m ON m.record_template_id=t.id AND m.group_id=$1
         LEFT JOIN record_template_versions cv ON cv.id=t.current_version_id
        WHERE t.parent_template_id=$2 AND t.archived_at IS NULL`, [groupId, templateId],
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
      await db.query('UPDATE record_templates SET field_mapping=$1::jsonb,updated_at=NOW() WHERE id=$2', [JSON.stringify(next), child.id]);
    }
    await db.query('COMMIT');
    let childSync: any = null;
    if (children.rows.length) {
      try {
        childSync = await syncToChildren(pool, 'record', templateId, {
          childIds: children.rows.map(child => Number(child.id)), includeAdded: true, dryRun: false,
        }, actor);
      } catch (syncError: any) {
        childSync = { error: syncError.message };
      }
    }
    res.json({ template_id: templateId, template_name: template.name, inherited_group_ids: inheritedGroupIds,
      child_count: children.rows.length, child_sync: childSync });
  } catch (error: any) {
    await db.query('ROLLBACK');
    res.status(error instanceof VersionFlowError ? error.status : error?.code === '23505' ? 409 : 500).json({ error: error.message });
  } finally { db.release(); }
});

/** 历史兼容：从项目组基础模板派生测试方法。 */
router.post('/groups/:id/derive', requirePermission('record_template.edit'), async (req: Request, res: Response) => {
  const groupId = Number(req.params.id);
  const name = cleanText(req.body?.name);
  const methodName = cleanText(req.body?.method_name || name);
  const methodCode = cleanCode(req.body?.method_code || methodName);
  if (!name || !methodName || !methodCode) { res.status(400).json({ error: '模板名称、方法名称和方法编码必填' }); return; }
  const actor = readActor(req as any);
  try {
    const groupResult = await pool.query(
      `SELECT g.*,t.current_version_id,v.status,v.field_definitions
         FROM test_template_groups g
         LEFT JOIN record_templates t ON t.id=g.base_record_template_id
         LEFT JOIN record_template_versions v ON v.id=t.current_version_id
        WHERE g.id=$1`, [groupId],
    );
    if (!groupResult.rows.length) throw new VersionFlowError('项目组不存在', 404);
    const group = groupResult.rows[0];
    if (!group.base_record_template_id || !group.current_version_id) throw new VersionFlowError('请先设置项目组基础模板', 409);
    if (group.status !== 'approved') throw new VersionFlowError('基础模板尚未审核生效', 409);
    const duplicateName = await pool.query('SELECT 1 FROM record_templates WHERE archived_at IS NULL AND btrim(name)=btrim($1)', [name]);
    if (duplicateName.rows.length) throw new VersionFlowError(`已存在同名原始记录模板「${name}」`, 409);
    const inheritedGroupIds = expandInheritedGroups(group.field_definitions || [], group.inherited_group_ids);
    const created = await forkTemplate(
      pool, 'record', Number(group.base_record_template_id), Number(group.current_version_id),
      name, actor.name, actor.role, {
        inheritedGroupIds,
        afterCreate: async (client, newTemplateId) => {
          await client.query(
            `INSERT INTO test_method_schemes
             (group_id,method_code,method_name,standard,record_template_id,report_project_name,recommended,sort_order)
             VALUES ($1,$2,$3,$4,$5,$3,FALSE,$6)`,
            [groupId, methodCode, methodName, cleanText(req.body?.standard) || null,
             newTemplateId, Number(req.body?.sort_order || 0)],
          );
        },
      },
    );
    res.status(201).json({ ...created, group_id: groupId, parent_template_id: Number(group.base_record_template_id), inherited_group_ids: inheritedGroupIds });
  } catch (error: any) {
    res.status(error instanceof VersionFlowError ? error.status : error?.code === '23505' ? 409 : 500)
      .json({ error: error?.code === '23505' ? '方法编码重复，或模板已被其他项目组使用' : error.message });
  }
});

router.get('/components/:id', async (req: Request, res: Response) => {
  const result = await pool.query(
    `SELECT c.*,g.name AS group_name,v.version_no,v.field_groups,v.change_note,v.author_name
       FROM record_common_components c
       JOIN test_template_groups g ON g.id=c.group_id
       JOIN record_common_component_versions v ON v.id=c.current_version_id
      WHERE c.id=$1`, [Number(req.params.id)],
  );
  if (!result.rows.length) { res.status(404).json({ error: '公共区域不存在' }); return; }
  const row = result.rows[0];
  res.json({ ...row, decorated_groups: decorateCommonGroups(row.field_groups, row, { id: row.current_version_id, version_no: row.version_no }) });
});

/** 历史兼容：从任意已设计分区提取项目组公共组件。 */
router.post('/groups/:id/components', requirePermission('record_template.edit'), async (req: Request, res: Response) => {
  const name = cleanText(req.body?.name); const code = cleanCode(req.body?.code);
  const fieldGroups = Array.isArray(req.body?.field_groups) ? req.body.field_groups : [];
  if (!name || !code || !fieldGroups.length) { res.status(400).json({ error: '公共区域名称、编码和至少一个分区必填' }); return; }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const inserted = await db.query(
      `INSERT INTO record_common_components (group_id,code,name,source_template_id)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [Number(req.params.id), code, name, req.body?.source_template_id ? Number(req.body.source_template_id) : null],
    );
    const component = inserted.rows[0];
    const prepared = fieldGroups.map((group: any) => ({
      ...group,
      fields: (group.fields || []).map((field: any) => ({ ...field, data_scope: 'batch_shared' })),
    }));
    const version = await db.query(
      `INSERT INTO record_common_component_versions (component_id,version_no,field_groups,change_note,author_name)
       VALUES ($1,1,$2::jsonb,$3,$4) RETURNING *`,
      [component.id, JSON.stringify(prepared), cleanText(req.body?.change_note) || '从原始记录模板提取', actorName(req)],
    );
    await db.query('UPDATE record_common_components SET current_version_id=$1 WHERE id=$2', [version.rows[0].id, component.id]);
    if (component.source_template_id) {
      const source = await db.query('SELECT name FROM record_templates WHERE id=$1', [component.source_template_id]);
      if (source.rows.length) {
        await db.query(
          `INSERT INTO test_method_schemes
           (group_id,method_code,method_name,record_template_id,report_project_name,recommended,sort_order)
           VALUES ($1,$2,$3,$4,$3,FALSE,0)
           ON CONFLICT (record_template_id) DO UPDATE SET group_id=EXCLUDED.group_id,updated_at=NOW()`,
          [Number(req.params.id), `method_${component.source_template_id}`, source.rows[0].name, component.source_template_id],
        );
      }
    }
    await db.query('COMMIT');
    res.status(201).json({ ...component, current_version_id: version.rows[0].id, version_no: 1, field_groups: prepared,
      decorated_groups: decorateCommonGroups(prepared, component, version.rows[0]) });
  } catch (error: any) {
    await db.query('ROLLBACK');
    res.status(error?.code === '23505' ? 409 : 500).json({ error: error?.code === '23505' ? '该项目组中公共区域编码已存在' : error.message });
  } finally { db.release(); }
});

/** 公共组件修改产生新版本，不静默改写任何原始记录模板。 */
router.put('/components/:id', requirePermission('record_template.edit'), async (req: Request, res: Response) => {
  const fieldGroups = Array.isArray(req.body?.field_groups) ? req.body.field_groups : [];
  if (!fieldGroups.length) { res.status(400).json({ error: '公共区域至少包含一个分区' }); return; }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const current = await db.query('SELECT * FROM record_common_components WHERE id=$1 FOR UPDATE', [Number(req.params.id)]);
    if (!current.rows.length) throw Object.assign(new Error('公共区域不存在'), { status: 404 });
    const component = current.rows[0];
    const next = await db.query('SELECT COALESCE(MAX(version_no),0)+1 AS version_no FROM record_common_component_versions WHERE component_id=$1', [component.id]);
    const prepared = fieldGroups.map((group: any) => ({ ...group, fields: (group.fields || []).map((field: any) => ({ ...field, data_scope: 'batch_shared' })) }));
    const version = await db.query(
      `INSERT INTO record_common_component_versions (component_id,version_no,field_groups,change_note,author_name)
       VALUES ($1,$2,$3::jsonb,$4,$5) RETURNING *`,
      [component.id, next.rows[0].version_no, JSON.stringify(prepared), cleanText(req.body?.change_note) || null, actorName(req)],
    );
    await db.query(
      `UPDATE record_common_components SET name=COALESCE($1,name),current_version_id=$2,updated_at=NOW() WHERE id=$3`,
      [req.body?.name ? cleanText(req.body.name) : null, version.rows[0].id, component.id],
    );
    await db.query('COMMIT');
    res.json({ ...component, name: req.body?.name ? cleanText(req.body.name) : component.name,
      current_version_id: version.rows[0].id, version_no: version.rows[0].version_no,
      decorated_groups: decorateCommonGroups(prepared, component, version.rows[0]) });
  } catch (error: any) {
    await db.query('ROLLBACK'); res.status(error.status || 500).json({ error: error.message });
  } finally { db.release(); }
});

router.post('/groups', requirePermission('record_template.edit'), async (req: Request, res: Response) => {
  const name = cleanText(req.body?.name);
  const code = cleanCode(req.body?.code) || `family_${Date.now()}`;
  if (!name) { res.status(400).json({ error: '项目组名称必填' }); return; }
  try {
    const result = await pool.query(
      `INSERT INTO test_template_groups (code, name, description, shared_profile_code)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [code, name, cleanText(req.body?.description) || null, cleanCode(req.body?.shared_profile_code) || 'default'],
    );
    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    res.status(error?.code === '23505' ? 409 : 500).json({ error: error?.code === '23505' ? `项目组编码 ${code} 已存在` : error.message });
  }
});

router.put('/groups/:id', requirePermission('record_template.edit'), async (req: Request, res: Response) => {
  const current = await pool.query('SELECT * FROM test_template_groups WHERE id=$1 AND archived_at IS NULL', [Number(req.params.id)]);
  if (!current.rows.length) { res.status(404).json({ error: '项目组不存在' }); return; }
  const before = current.rows[0];
  const nextName = req.body?.name != null ? cleanText(req.body.name) : before.name;
  if (!nextName) { res.status(400).json({ error: '项目组名称必填' }); return; }
  const result = await pool.query(
    `UPDATE test_template_groups SET name=$1,updated_at=NOW() WHERE id=$2 RETURNING *`,
    [nextName, Number(req.params.id)],
  );
  res.json(result.rows[0]);
});

async function logGroupArchiveAction(
  db: { query: (sql: string, params?: any[]) => Promise<any> }, groupId: number,
  action: 'archive_request' | 'archive_request_cancel' | 'archive_reject' | 'archive',
  actor: { name: string; role?: string }, detail: Record<string, unknown> = {},
) {
  await db.query(
    `INSERT INTO test_template_group_audit_log (group_id,action,actor_name,actor_role,detail)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [groupId, action, actor.name, actor.role || null, JSON.stringify(detail)],
  );
}

/** 发起项目组删除申请；批准前项目组仍可正常使用。 */
router.post('/groups/:id/archive-request', requirePermission('record_template.edit'), async (req: Request, res: Response) => {
  const groupId = Number(req.params.id); const actor = readActor(req as any);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const current = await db.query(
      'SELECT id,name,archived_at,archive_requested_by FROM test_template_groups WHERE id=$1 FOR UPDATE', [groupId],
    );
    if (!current.rows.length) throw new VersionFlowError('项目组不存在', 404);
    if (current.rows[0].archived_at) throw new VersionFlowError('项目组已删除', 409);
    if (current.rows[0].archive_requested_by) {
      throw new VersionFlowError(`已有删除申请（${current.rows[0].archive_requested_by} 发起），等待审核`, 409);
    }
    const note = cleanText(req.body?.note) || null;
    await db.query(
      `UPDATE test_template_groups SET archive_requested_by=$1,archive_requested_at=NOW(),archive_request_note=$2,updated_at=NOW()
       WHERE id=$3`, [actor.name, note, groupId],
    );
    await logGroupArchiveAction(db, groupId, 'archive_request', actor, { note });
    await db.query('COMMIT'); res.json({ ok: true });
  } catch (error: any) {
    await db.query('ROLLBACK'); res.status(error.status || 500).json({ error: error.message });
  } finally { db.release(); }
});

/** 申请人或具有审核权限的人员可撤回项目组删除申请。 */
router.post('/groups/:id/archive-request/cancel', requirePermission('record_template.edit'), async (req: Request, res: Response) => {
  const groupId = Number(req.params.id); const actor = readActor(req as any);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const current = await db.query(
      'SELECT archive_requested_by FROM test_template_groups WHERE id=$1 AND archived_at IS NULL FOR UPDATE', [groupId],
    );
    if (!current.rows.length) throw new VersionFlowError('项目组不存在', 404);
    const requester = current.rows[0].archive_requested_by;
    if (!requester) throw new VersionFlowError('没有待审核的删除申请', 409);
    if (requester !== actor.name && !actorHasPermission(req as any, 'record.review')) {
      throw new VersionFlowError('只有申请人或审核员可以撤回删除申请', 403);
    }
    await db.query(
      `UPDATE test_template_groups SET archive_requested_by=NULL,archive_requested_at=NULL,archive_request_note=NULL,updated_at=NOW()
       WHERE id=$1`, [groupId],
    );
    await logGroupArchiveAction(db, groupId, 'archive_request_cancel', actor, { requested_by: requester });
    await db.query('COMMIT'); res.json({ ok: true });
  } catch (error: any) {
    await db.query('ROLLBACK'); res.status(error.status || 500).json({ error: error.message });
  } finally { db.release(); }
});

/** 审核项目组删除申请。批准后软删除项目组，并解除模板的当前项目组归属。 */
router.post('/groups/:id/archive-review', requirePermission('record.review'), async (req: Request, res: Response) => {
  const groupId = Number(req.params.id); const actor = readActor(req as any);
  const decision = req.body?.decision === 'reject' ? 'reject' : req.body?.decision === 'approve' ? 'approve' : null;
  const note = cleanText(req.body?.note) || null;
  if (!decision) { res.status(400).json({ error: '审核决定必须为 approve 或 reject' }); return; }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const current = await db.query(
      `SELECT id,name,archive_requested_by,archive_requested_at,archive_request_note
         FROM test_template_groups WHERE id=$1 AND archived_at IS NULL FOR UPDATE`, [groupId],
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
        `UPDATE test_template_groups SET archive_requested_by=NULL,archive_requested_at=NULL,archive_request_note=NULL,updated_at=NOW()
         WHERE id=$1`, [groupId],
      );
      await logGroupArchiveAction(db, groupId, 'archive_reject', actor, {
        requested_by: group.archive_requested_by, request_note: group.archive_request_note, note,
      });
      await db.query('COMMIT'); res.json({ ok: true, rejected: true }); return;
    }
    const memberCount = (await db.query(
      'SELECT COUNT(*)::int AS count FROM test_method_schemes WHERE group_id=$1', [groupId],
    )).rows[0].count;
    // 项目组是归类容器；删除项目组不删除模板，只解除模板的当前归属。
    await db.query('DELETE FROM test_method_schemes WHERE group_id=$1', [groupId]);
    await db.query(
      `UPDATE test_template_groups SET archived_at=NOW(),enabled=FALSE,
       archive_requested_by=NULL,archive_requested_at=NULL,archive_request_note=NULL,updated_at=NOW() WHERE id=$1`, [groupId],
    );
    await logGroupArchiveAction(db, groupId, 'archive', actor, {
      requested_by: group.archive_requested_by, request_note: group.archive_request_note,
      approve_note: note, detached_template_count: memberCount,
    });
    await db.query('COMMIT'); res.json({ ok: true, archived: true, detached_template_count: memberCount });
  } catch (error: any) {
    await db.query('ROLLBACK'); res.status(error.status || 500).json({ error: error.message });
  } finally { db.release(); }
});

/** 将已有原始记录模板加入项目组。方法字段仅作存量表结构兼容，对用户隐藏。 */
router.post('/groups/:id/templates', requirePermission('record_template.edit'), async (req: Request, res: Response) => {
  const groupId = Number(req.params.id);
  const requestedIds = Array.isArray(req.body?.template_ids) ? req.body.template_ids : [req.body?.template_id];
  const templateIds = [...new Set(requestedIds.map(Number).filter(Number.isFinite))];
  if (!templateIds.length) { res.status(400).json({ error: '请至少选择一个原始记录模板' }); return; }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const group = await db.query(
      'SELECT id FROM test_template_groups WHERE id=$1 AND archived_at IS NULL FOR UPDATE', [groupId],
    );
    if (!group.rows.length) throw new VersionFlowError('项目组不存在', 404);
    const templates = await db.query(
      `SELECT t.id,t.name,m.group_id
         FROM record_templates t
         LEFT JOIN test_method_schemes m ON m.record_template_id=t.id
        WHERE t.id=ANY($1::int[]) AND t.archived_at IS NULL
        FOR UPDATE OF t`, [templateIds],
    );
    if (templates.rows.length !== templateIds.length) throw new VersionFlowError('部分原始记录模板不存在或已删除', 409);
    const occupied = templates.rows.filter(row => row.group_id != null);
    if (occupied.length) throw new VersionFlowError(`以下模板已属于项目组：${occupied.map(row => row.name).join('、')}`, 409);
    const inserted = [];
    for (const template of templates.rows) {
      const result = await db.query(
        `INSERT INTO test_method_schemes
         (group_id,method_code,method_name,record_template_id,report_project_name,recommended,sort_order)
         VALUES ($1,$2,$3,$4,$3,FALSE,0) RETURNING *`,
        [groupId, `template_${template.id}`, template.name, template.id],
      );
      inserted.push(result.rows[0]);
    }
    await db.query('COMMIT');
    res.status(201).json({ templates: inserted, count: inserted.length });
  } catch (error: any) {
    await db.query('ROLLBACK');
    res.status(error instanceof VersionFlowError ? error.status : error?.code === '23505' ? 409 : 500)
      .json({ error: error?.code === '23505' ? '该模板已归入项目组，或组内标识冲突' : error.message });
  } finally { db.release(); }
});

/** 从项目组移除模板；不删除模板及其历史数据。 */
router.delete('/groups/:id/templates/:templateId', requirePermission('record_template.edit'), async (req: Request, res: Response) => {
  const result = await pool.query(
    `DELETE FROM test_method_schemes WHERE group_id=$1 AND record_template_id=$2 RETURNING id`,
    [Number(req.params.id), Number(req.params.templateId)],
  );
  if (!result.rows.length) { res.status(404).json({ error: '该模板不在此项目组中' }); return; }
  res.json({ ok: true });
});

router.post('/groups/:id/methods', requirePermission('record_template.edit'), async (req: Request, res: Response) => {
  const methodCode = cleanCode(req.body?.method_code);
  const methodName = cleanText(req.body?.method_name);
  const projectName = cleanText(req.body?.report_project_name) || methodName;
  if (!methodCode || !methodName || !req.body?.record_template_id) {
    res.status(400).json({ error: '方法编码、方法名称和原始记录模板必填' }); return;
  }
  try {
    const result = await pool.query(
      `INSERT INTO test_method_schemes
       (group_id, method_code, method_name, standard, record_template_id, report_project_template_id,
        report_project_name, recommended, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [Number(req.params.id), methodCode, methodName, cleanText(req.body?.standard) || null,
       Number(req.body.record_template_id), null,
       projectName, !!req.body?.recommended, Number(req.body?.sort_order || 0)],
    );
    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    const duplicate = error?.code === '23505';
    res.status(duplicate ? 409 : 500).json({ error: duplicate ? '方法编码重复，或该原始记录模板已归入其他测试方法' : error.message });
  }
});

router.put('/methods/:id', requirePermission('record_template.edit'), async (req: Request, res: Response) => {
  try {
    const current = await pool.query('SELECT * FROM test_method_schemes WHERE id=$1', [Number(req.params.id)]);
    if (!current.rows.length) { res.status(404).json({ error: '测试方法不存在' }); return; }
    const before = current.rows[0];
    const recordTemplateId = req.body?.record_template_id != null ? Number(req.body.record_template_id) : Number(before.record_template_id);
    // 报告模板必须在报告项目模板侧通过 linked_record_template_id 主动关联；方法管理不再写此关系。
    const reportTemplateId = null;
    const result = await pool.query(
      `UPDATE test_method_schemes SET
       group_id=$1, method_code=$2, method_name=$3,
       standard=$4, record_template_id=$5, report_project_template_id=$6,
       report_project_name=$7, recommended=$8,
       enabled=$9, sort_order=$10, updated_at=NOW()
       WHERE id=$11 RETURNING *`,
      [req.body?.group_id != null ? Number(req.body.group_id) : before.group_id,
       req.body?.method_code != null ? cleanCode(req.body.method_code) : before.method_code,
       req.body?.method_name != null ? cleanText(req.body.method_name) : before.method_name,
       Object.prototype.hasOwnProperty.call(req.body || {}, 'standard') ? cleanText(req.body.standard) || null : before.standard,
       recordTemplateId, reportTemplateId,
       req.body?.report_project_name != null ? cleanText(req.body.report_project_name) : before.report_project_name,
       typeof req.body?.recommended === 'boolean' ? req.body.recommended : before.recommended,
       typeof req.body?.enabled === 'boolean' ? req.body.enabled : before.enabled,
       req.body?.sort_order != null ? Number(req.body.sort_order) : before.sort_order, Number(req.params.id)],
    );
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(error?.code === '23505' ? 409 : 500).json({ error: error?.code === '23505' ? '方法编码重复，或原始记录模板已被其他方法使用' : error.message });
  }
});

export default router;
