import { Router, Request, Response } from 'express';

import { pool } from '../db.js';

const router = Router();

const SELECT_COLS = `order_no, customer_name, received_at, payload, source, created_at, updated_at`;

function readActor(req: Request) {
  const rawName = (req.header('X-Demo-User') || '').trim();
  let name = rawName;
  try { name = decodeURIComponent(rawName); } catch { /* fallback */ }
  const role = (req.header('X-Demo-Role') || '').trim();
  return { name, role };
}

function linkedIdsOf(test: any): number[] {
  if (Array.isArray(test?.linked_template_ids)) return test.linked_template_ids.filter((n: any) => typeof n === 'number');
  return typeof test?.linked_template_id === 'number' ? [test.linked_template_id] : [];
}

interface IncomingTestInfo { name?: string; standard?: string }
interface IncomingSample { id?: string; name?: string; test_infos?: IncomingTestInfo[] }

/**
 * 规范化前端传入的 samples：补样品 id（s1/s2…，与外部接口口径一致）、
 * 去掉空项、只保留 name/standard（关联模板在录入工作台另行设置）。
 */
function normalizeSamples(raw: unknown): { ok: true; samples: any[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'samples 必须是数组' };
  const samples: any[] = [];
  raw.forEach((s: IncomingSample, i) => {
    const name = (s?.name || '').trim();
    if (!name) return; // 跳过没名字的空样品
    const tests = Array.isArray(s?.test_infos) ? s.test_infos : [];
    const test_infos = tests
      .map((t) => ({ name: (t?.name || '').trim(), standard: (t?.standard || '').trim() || undefined }))
      .filter((t) => t.name);
    samples.push({ id: (s?.id || '').trim() || `s${i + 1}`, name, test_infos });
  });
  if (!samples.length) return { ok: false, error: '至少需要一个带名称的样品' };
  return { ok: true, samples };
}

router.get('/', async (_req: Request, res: Response) => {
  const result = await pool.query(
    `SELECT ${SELECT_COLS}
     FROM work_orders ORDER BY received_at DESC NULLS LAST, order_no DESC`
  );
  res.json(result.rows);
});

router.get('/:orderNo', async (req: Request, res: Response) => {
  const { orderNo } = req.params;
  const result = await pool.query(
    `SELECT ${SELECT_COLS} FROM work_orders WHERE order_no = $1`,
    [orderNo]
  );
  if (!result.rows.length) {
    res.status(404).json({ error: 'Work order not found' });
    return;
  }
  res.json(result.rows[0]);
});

/** 手动新建订单（source=manual），与接口传入的单完全同构 */
router.post('/', async (req: Request, res: Response) => {
  const { order_no, customer_name, received_at, samples } = req.body as {
    order_no?: string; customer_name?: string; received_at?: string; samples?: unknown;
  };
  const orderNo = (order_no || '').trim();
  if (!orderNo) { res.status(400).json({ error: '委托单号不能为空' }); return; }

  const norm = normalizeSamples(samples);
  if (!norm.ok) { res.status(400).json({ error: norm.error }); return; }

  const exists = await pool.query('SELECT 1 FROM work_orders WHERE order_no = $1', [orderNo]);
  if (exists.rows.length) { res.status(409).json({ error: `委托单号 ${orderNo} 已存在` }); return; }

  const payload = { samples: norm.samples };
  const inserted = await pool.query(
    `INSERT INTO work_orders (order_no, customer_name, received_at, payload, source)
     VALUES ($1, $2, $3, $4::jsonb, 'manual') RETURNING ${SELECT_COLS}`,
    [orderNo, (customer_name || '').trim() || null, received_at || null, JSON.stringify(payload)]
  );
  res.status(201).json(inserted.rows[0]);
});

/**
 * 删除订单 + 其关联数据（record_data / reports / 批次 / 退回工单 / 报告审计）。
 * record_data 删除会级联清掉 record_audit_log（FK ON DELETE CASCADE）。
 * 按依赖顺序删，避免外键约束报错。
 */
router.delete('/:orderNo', async (req: Request, res: Response) => {
  const { orderNo } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT 1 FROM work_orders WHERE order_no = $1', [orderNo]);
    if (!found.rows.length) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Work order not found' });
      return;
    }
    await client.query(`DELETE FROM report_audit_log WHERE report_id IN (SELECT id FROM reports WHERE order_no = $1)`, [orderNo]);
    await client.query(`DELETE FROM rework_tickets WHERE order_no = $1`, [orderNo]);
    await client.query(`DELETE FROM reports WHERE order_no = $1`, [orderNo]);
    await client.query(`DELETE FROM report_batches WHERE order_no = $1`, [orderNo]);
    await client.query(`DELETE FROM record_data WHERE order_no = $1`, [orderNo]);
    await client.query(`DELETE FROM work_orders WHERE order_no = $1`, [orderNo]);
    await client.query('COMMIT');
    res.json({ ok: true, order_no: orderNo });
  } catch (e: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

/**
 * 关联/解除关联：一个测试项目可关联【一个或多个】原始记录模板。
 * body：{ sample_id, test_name, linked_template_id, op }
 *   op = 'add'（默认）→ 把 linked_template_id 加入该项目的关联集合（去重）
 *   op = 'remove'     → 从集合移除该 linked_template_id
 * 规范化：始终写 `linked_template_ids: number[]`，并清掉旧的单值 `linked_template_id`。
 * 解除关联：
 *   - 该上下文有【已审核通过(reviewed)】的 record_data → 409 拒绝解除（已审核数据不可被任何操作销毁；
 *     解锁唯一路径＝报告端「退回原始记录」rework → rejected 后再操作）。
 *   - 其余状态（draft / pending / rejected / 旧数据无状态）→ 解除同时【全部删除】该
 *     「模板 × 本订单样品×项目」的 record_data，使重新关联是干净的空白新录入
 *     （否则旧数据随上下文键被重新加载、且锁定在旧模板版本——重关联仍留存旧数据）。
 *   - record_audit_log 随 FK ON DELETE CASCADE 清理；引用被删记录的 rework_tickets：
 *     未关闭的先置 resolved（记录已不存在、工单失去意义，且避免 data_entry 锁永远挂住报告），再解除引用。
 */
router.put('/:orderNo/link', async (req: Request, res: Response) => {
  const { orderNo } = req.params;
  const { sample_id, test_name, linked_template_id, op } = req.body as {
    sample_id?: string;
    test_name?: string;
    linked_template_id?: number | null;
    op?: 'add' | 'remove';
  };
  if (!sample_id || !test_name) {
    res.status(400).json({ error: 'sample_id and test_name are required' });
    return;
  }
  if (linked_template_id == null) {
    res.status(400).json({ error: 'linked_template_id is required' });
    return;
  }
  const action: 'add' | 'remove' = op === 'remove' ? 'remove' : 'add';

  // 关联护栏：只允许关联【当前生效版本已审核通过】的模板（前端弹窗同样禁选未审核模板，这里防异常调用）。
  // 未审核模板的 base 表 field_definitions 只在 approve 时刷新，关联后录入/渲染都是空结构。
  if (action === 'add') {
    const tv = await pool.query(
      `SELECT v.status FROM record_templates t
         LEFT JOIN record_template_versions v ON v.id = t.current_version_id
       WHERE t.id = $1`, [linked_template_id]);
    if (!tv.rows.length) { res.status(404).json({ error: '模板不存在' }); return; }
    if (tv.rows[0].status !== 'approved') {
      res.status(409).json({ error: '该模板还没有审核通过的生效版本，不能关联。请先在「原始记录模板」中提交并通过审核。' });
      return;
    }
  }

  const cur = await pool.query('SELECT payload FROM work_orders WHERE order_no = $1', [orderNo]);
  if (!cur.rows.length) {
    res.status(404).json({ error: 'Work order not found' });
    return;
  }
  const payload = cur.rows[0].payload || {};
  const samples = Array.isArray(payload.samples) ? payload.samples : [];
  const sample = samples.find((s: any) => s.id === sample_id);
  if (!sample) { res.status(404).json({ error: 'Sample not found' }); return; }
  const test = (sample.test_infos || []).find((t: any) => t.name === test_name);
  if (!test) { res.status(404).json({ error: 'Test item not found' }); return; }

  // 读取当前关联集合（兼容旧单值 linked_template_id）
  let ids: number[] = Array.isArray(test.linked_template_ids)
    ? test.linked_template_ids.filter((n: any) => typeof n === 'number')
    : (typeof test.linked_template_id === 'number' ? [test.linked_template_id] : []);

  if (action === 'remove') {
    ids = ids.filter((id) => id !== linked_template_id);
  } else if (!ids.includes(linked_template_id)) {
    ids.push(linked_template_id);
  }
  test.linked_template_ids = ids;
  delete test.linked_template_id; // 迁移：清掉旧单值字段，统一用数组

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ctxParams = [linked_template_id, orderNo, sample_id, test_name];
    const matchWhere = `template_id = $1 AND order_no = $2 AND sample_external_id = $3 AND test_item_name = $4`;
    if (action === 'remove') {
      // 已审核通过的数据受保护：拒绝解除关联（解锁须走报告端「退回原始记录」rework）
      const reviewed = await client.query(
        `SELECT 1 FROM record_data WHERE ${matchWhere} AND audit_status = 'reviewed' LIMIT 1`, ctxParams);
      if (reviewed.rows.length) {
        await client.query('ROLLBACK');
        res.status(409).json({ error: '该原始记录已审核通过，不能解除关联。如需修改，请先从报告端「退回原始记录」解锁。' });
        return;
      }
    }
    const updated = await client.query(
      `UPDATE work_orders SET payload = $1::jsonb, updated_at = NOW() WHERE order_no = $2 RETURNING *`,
      [JSON.stringify(payload), orderNo]
    );
    let removedRecords = 0;
    if (action === 'remove') {
      // 解除关联 → 删除该「模板 × 本订单样品×项目」的【全部】record_data（草稿/待审核/被退回），
      // 重新关联即干净的空白新录入。record_audit_log 随 FK ON DELETE CASCADE 清理。
      // 引用被删记录的 rework_tickets：未关闭的先置 resolved（记录已删、工单失去意义，
      // 且避免 data_entry 锁因永不重审而挂死报告），再统一解除引用（record_data_id 置空，列可空）。
      await client.query(
        `UPDATE rework_tickets SET status = 'resolved', resolved_at = NOW(),
                resolution_note = COALESCE(resolution_note, '') || '[系统] 原始记录已解除关联，录入数据已删除'
           WHERE record_data_id IN (SELECT id FROM record_data WHERE ${matchWhere})
             AND status <> 'resolved'`,
        ctxParams
      );
      await client.query(
        `UPDATE rework_tickets SET record_data_id = NULL
           WHERE record_data_id IN (SELECT id FROM record_data WHERE ${matchWhere})`,
        ctxParams
      );
      const del = await client.query(`DELETE FROM record_data WHERE ${matchWhere}`, ctxParams);
      removedRecords = del.rowCount || 0;
    }
    await client.query('COMMIT');
    res.json({ ...updated.rows[0], removed_records: removedRecords });
  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/**
 * 编辑订单结构（改/增删 样品·测试项目）。不走数据审核流，但留痕 + 护栏。
 *
 * body：{ samples: [{ id?, name, test_infos: [{ _orig_name?, name, standard? }] }] }
 *   - 样品用 id 配对（无 id = 新增样品，后端分配 sN）
 *   - 测试项目用 _orig_name 配对（无 _orig_name = 新增项目）
 *
 * 护栏（全部命中即整单回滚，返回 409 + blocked 列表）：
 *   - 删除「有已录 record_data」的样品 / 测试项目 → 拦截
 *   - 同一样品下测试项目名重复 / 名称为空 → 拦截
 * 级联：改测试项目名 → UPDATE record_data.test_item_name（唯一键的一部分）
 * 关联：改名/改标准时保留该项目原有 linked_template_ids
 */
router.put('/:orderNo/structure', async (req: Request, res: Response) => {
  const { orderNo } = req.params;
  const newSamples = Array.isArray(req.body?.samples) ? req.body.samples : null;
  if (!newSamples) { res.status(400).json({ error: 'samples 必须是数组' }); return; }
  const actor = readActor(req);
  if (!actor.name) { res.status(401).json({ error: '未登录或缺少 X-Demo-User 头' }); return; }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query('SELECT payload FROM work_orders WHERE order_no = $1', [orderNo]);
    if (!cur.rows.length) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Work order not found' }); return; }
    const oldSamples: any[] = Array.isArray(cur.rows[0].payload?.samples) ? cur.rows[0].payload.samples : [];
    const oldMeta = cur.rows[0].payload?.meta;  // 订单级接口元数据，结构编辑要保留（不能被重建 payload 丢掉）
    const oldById = new Map(oldSamples.map(s => [s.id, s]));

    const recCount = async (sampleId: string, testName?: string): Promise<number> => {
      const q = testName
        ? 'SELECT COUNT(*)::int AS n FROM record_data WHERE order_no=$1 AND sample_external_id=$2 AND test_item_name=$3'
        : 'SELECT COUNT(*)::int AS n FROM record_data WHERE order_no=$1 AND sample_external_id=$2';
      const p = testName ? [orderNo, sampleId, testName] : [orderNo, sampleId];
      return (await client.query(q, p)).rows[0].n;
    };

    const usedIds = new Set(oldSamples.map(s => s.id));
    const nextSampleId = () => { let i = 1; while (usedIds.has(`s${i}`)) i++; usedIds.add(`s${i}`); return `s${i}`; };

    const ops: any[] = [];
    const blocked: string[] = [];
    const resultSamples: any[] = [];

    // 1. 删除的样品（旧有、新无）
    const newSampleIds = new Set(newSamples.filter((s: any) => s.id).map((s: any) => s.id));
    for (const old of oldSamples) {
      if (!newSampleIds.has(old.id)) {
        const n = await recCount(old.id);
        if (n > 0) blocked.push(`样品「${old.name}」下有 ${n} 条已录数据，不能删除（请先处理数据）`);
        else ops.push({ type: 'sample_delete', sample_id: old.id, name: old.name });
      }
    }

    // 2. 逐个处理新结构里的样品
    for (const ns of newSamples) {
      const isNew = !ns.id;
      const old = isNew ? null : oldById.get(ns.id);
      if (!isNew && !old) { blocked.push(`样品 id ${ns.id} 不存在`); continue; }
      const name = (ns.name || '').trim();
      if (!name) { blocked.push('样品名称不能为空'); continue; }
      const sid = isNew ? nextSampleId() : ns.id;
      if (isNew) ops.push({ type: 'sample_add', sample_id: sid, name });
      else if (name !== old.name) ops.push({ type: 'sample_rename', sample_id: sid, from: old.name, to: name });

      const oldTests: any[] = old?.test_infos || [];
      const oldByName = new Map(oldTests.map((t: any) => [t.name, t]));
      const keptOrig = new Set<string>();
      const seenNames = new Set<string>();
      const resultTests: any[] = [];

      for (const nt of (ns.test_infos || [])) {
        const tname = (nt.name || '').trim();
        if (!tname) { blocked.push(`样品「${name}」有测试项目名称为空`); continue; }
        if (seenNames.has(tname)) { blocked.push(`样品「${name}」存在重复测试项目「${tname}」`); continue; }
        seenNames.add(tname);
        const standard = (nt.standard || '').trim() || undefined;
        const origName: string | undefined = nt._orig_name;
        const ot = origName ? oldByName.get(origName) : undefined;
        if (ot) {
          keptOrig.add(origName!);
          if (tname !== origName) ops.push({ type: 'test_rename', sample_id: sid, from: origName, to: tname });
          if (standard !== (ot.standard || undefined)) ops.push({ type: 'test_standard', sample_id: sid, name: tname });
          // 保留分单的接口扩展字段（test_method/limit_content/leader/dates 等），只覆盖 name/standard/关联
          resultTests.push({ ...ot, name: tname, standard, linked_template_ids: linkedIdsOf(ot) });
        } else {
          if (!isNew) ops.push({ type: 'test_add', sample_id: sid, name: tname });
          resultTests.push({ name: tname, standard, linked_template_ids: [] });
        }
      }

      // 删除的测试项目（旧有、新结构未保留）
      for (const ot of oldTests) {
        if (!keptOrig.has(ot.name)) {
          const n = await recCount(sid, ot.name);
          if (n > 0) blocked.push(`项目「${old.name} · ${ot.name}」有 ${n} 条已录数据，不能删除（请先处理数据）`);
          else ops.push({ type: 'test_delete', sample_id: sid, name: ot.name });
        }
      }

      // 保留样品的接口扩展字段（barcode/sort_no/model），只覆盖 id/name/test_infos
      resultSamples.push({ ...(old || {}), id: sid, name, test_infos: resultTests });
    }

    if (blocked.length) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: '部分修改被拦截，未保存', blocked });
      return;
    }
    if (!ops.length) {
      await client.query('ROLLBACK');
      res.status(200).json({ ...cur.rows[0], order_no: orderNo, no_change: true });
      return;
    }

    // 级联：改名同步 record_data.test_item_name
    for (const op of ops) {
      if (op.type === 'test_rename') {
        await client.query(
          `UPDATE record_data SET test_item_name=$1, updated_at=NOW()
           WHERE order_no=$2 AND sample_external_id=$3 AND test_item_name=$4`,
          [op.to, orderNo, op.sample_id, op.from]
        );
      }
    }

    await client.query(
      `UPDATE work_orders SET payload=$1::jsonb, updated_at=NOW() WHERE order_no=$2`,
      [JSON.stringify({ samples: resultSamples, ...(oldMeta ? { meta: oldMeta } : {}) }), orderNo]
    );

    const c = (type: string) => ops.filter(o => o.type === type).length;
    const summaryParts = [
      [c('sample_add'), '新增样品'], [c('sample_rename'), '重命名样品'], [c('sample_delete'), '删除样品'],
      [c('test_add'), '新增项目'], [c('test_rename'), '重命名项目'], [c('test_standard'), '改标准'], [c('test_delete'), '删除项目'],
    ].filter(([n]) => (n as number) > 0).map(([n, label]) => `${label} ${n}`);
    const summary = summaryParts.join(' · ') || '无变化';

    await client.query(
      `INSERT INTO work_order_audit_log (order_no, actor_name, actor_role, summary, detail)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [orderNo, actor.name, actor.role || null, summary, JSON.stringify(ops)]
    );

    await client.query('COMMIT');
    const updated = await pool.query(`SELECT ${SELECT_COLS} FROM work_orders WHERE order_no=$1`, [orderNo]);
    res.json({ ...updated.rows[0], summary });
  } catch (e: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

/** 订单结构变更留痕 */
router.get('/:orderNo/audit-log', async (req: Request, res: Response) => {
  const { orderNo } = req.params;
  const result = await pool.query(
    `SELECT id, order_no, actor_name, actor_role, summary, detail, created_at
     FROM work_order_audit_log WHERE order_no=$1 ORDER BY created_at DESC`,
    [orderNo]
  );
  res.json(result.rows);
});

export default router;
