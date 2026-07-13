/**
 * 外部系统【接收端点】—— 递归智能"推送"接口的落点。
 *
 * 接口文档《递归智能接口文档》：
 *   - 1.1 PushOrderInfos     委托单信息   → POST /api/external/orders       ✅ 已实现
 *   - 1.2 PushReportInfos    报告取号信息 → POST /api/external/reports      ✅ 已实现
 *   - 1.3 RefreshReportInfo  报告改号+退回 → POST /api/external/report-modify ✅ 已实现（data_entry/report_edit + RecordState/SecondAuditDate/Remark）
 *   - 1.4 PushReportFile     回传报告 PDF → 出站 POST /api/external/requisitions/:id/deliver（SOAP）✅
 *
 * 解析逻辑在 services/external-orders.ts（parseOrderInfos）。本路由只负责
 * HTTP 接收 + 入库 work_orders（与界面「新建订单」同构）。
 */
import { Router, Request, Response } from 'express';
import { parseOrderInfos, type ExternalOrder } from '../services/external-orders.js';
import { parseReportInfos, matchRequisitionScope, buildReportMetaFromReq, dateOnly } from '../services/external-report-info.js';
import { generateAndStoreReport } from './reports.js';
import { compileTypst } from '../services/typst-compiler.js';
import { submitReportToDiGui } from '../services/external-report-delivery.js';
import { parseReportFeedback } from '../services/external-report-feedback.js';
import { returnReportForEdit, returnReportToDataEntry, markReportApproved } from '../services/rework-ops.js';

import { pool } from '../db.js';

const router = Router();

function readActor(req: Request): string | null {
  const raw = (req.header('X-Demo-User') || '').trim();
  if (!raw) return null;
  try { return decodeURIComponent(raw); } catch { return raw; }
}

/** 读旧 payload 里某测试项目的关联模板集（兼容旧单值 linked_template_id）。 */
function linkedIdsOf(test: any): number[] {
  if (Array.isArray(test?.linked_template_ids)) return test.linked_template_ids.filter((n: any) => typeof n === 'number');
  return typeof test?.linked_template_id === 'number' ? [test.linked_template_id] : [];
}

/**
 * 文员侧锁谓词：报告是否存在【未关闭的 data_entry 返工工单】。
 * 接口 1.3 ModifyType=data_entry 退回时会建该工单；数据重审通过后 record-data.ts 自动关单，锁随之解除。
 * 锁存在时文员不能重新生成 / 编辑 / 回传该报告（须等实验室数据重新审核通过）。
 * @param db pool 或事务内 client 均可。
 */
async function hasOpenDataEntryRework(db: { query: (...a: any[]) => Promise<any> }, reportId: number): Promise<boolean> {
  if (!reportId) return false;
  // 命中两种未关闭的 data_entry 退回工单：① 直接挂在本报告上(report_id)；
  // ② 退回的那条原始记录被本报告引用(record_data_id ∈ reports.record_data_ids)——
  //    文员从录入进度/报告编辑里「退回原始记录」时工单常只带 record_data_id（无 report_id），
  //    仍须阻断本报告的交付/重生成，直到该数据重审通过。
  const r = await db.query(
    `SELECT 1 FROM rework_tickets t
       WHERE t.target_stage = 'data_entry' AND t.status <> 'resolved'
         AND ( t.report_id = $1
            OR t.record_data_id = ANY( SELECT unnest(record_data_ids) FROM reports WHERE id = $1 ) )
       LIMIT 1`,
    [reportId],
  );
  return r.rows.length > 0;
}

/**
 * 取该报告未关闭的【报告退回(scope=report)】工单（接口 1.3 report_edit / 外部回执 needs_revision）。
 * 报告退回＝在原报告上「编辑修改」而非重生成：前端据此在该报告条目下方展示退回意见、放开编辑/送审。
 * @returns 工单 {id, reason, suggestion} 或 null。
 */
async function getOpenReportRework(
  db: { query: (...a: any[]) => Promise<any> }, reportId: number,
): Promise<{ id: number; reason: string | null; suggestion: string | null } | null> {
  if (!reportId) return null;
  const r = await db.query(
    `SELECT id, reason, suggestion FROM rework_tickets
       WHERE report_id = $1 AND scope = 'report' AND status <> 'resolved'
       ORDER BY created_at DESC LIMIT 1`,
    [reportId],
  );
  return r.rows.length ? r.rows[0] : null;
}

/**
 * upsert 单张外部委托单到 work_orders（source=external）。
 * - 新单：直接插入。
 * - 已存在：更新 customer_name/received_at/meta + 合并 samples，并按【样品名 + 项目名】
 *   保留工程师已设置的 linked_template_ids（关联状态不因再次推送而丢失）。
 *   已录 record_data 永不删除——若新推送移除了某样品/项目，旧记录留库（孤儿），返回告警。
 */
async function upsertOrder(order: ExternalOrder): Promise<{ action: 'inserted' | 'updated'; warnings: string[] }> {
  const warnings: string[] = [];
  const existing = await pool.query('SELECT payload FROM work_orders WHERE order_no = $1', [order.order_no]);

  if (!existing.rows.length) {
    const payload = { samples: order.samples, ...(order.meta ? { meta: order.meta } : {}) };
    await pool.query(
      `INSERT INTO work_orders (order_no, customer_name, received_at, payload, source)
       VALUES ($1, $2, $3, $4::jsonb, 'external')`,
      [order.order_no, order.customer_name || null, order.received_at || null, JSON.stringify(payload)]
    );
    return { action: 'inserted', warnings };
  }

  // 已存在：按 样品名||项目名 索引旧关联，合并到新结构
  const oldSamples: any[] = Array.isArray(existing.rows[0].payload?.samples) ? existing.rows[0].payload.samples : [];
  const oldLinks = new Map<string, number[]>();
  const oldKeys = new Set<string>();
  for (const os of oldSamples) {
    for (const ot of (os.test_infos || [])) {
      const k = `${os.name}||${ot.name}`;
      oldKeys.add(k);
      const ids = linkedIdsOf(ot);
      if (ids.length) oldLinks.set(k, ids);
    }
  }

  const newKeys = new Set<string>();
  const mergedSamples = order.samples.map((ns) => ({
    ...ns,
    test_infos: ns.test_infos.map((nt) => {
      const k = `${ns.name}||${nt.name}`;
      newKeys.add(k);
      const ids = oldLinks.get(k);
      return ids && ids.length ? { ...nt, linked_template_ids: ids } : nt;
    }),
  }));

  // 推送中消失的样品/项目（旧有新无）：可能有孤儿 record_data
  for (const k of oldKeys) {
    if (!newKeys.has(k)) warnings.push(`项目「${k.replace('||', ' · ')}」在本次推送中已不存在（旧录入数据保留在库，报告侧会标记需手动处理）`);
  }

  const payload = { samples: mergedSamples, ...(order.meta ? { meta: order.meta } : {}) };
  await pool.query(
    `UPDATE work_orders SET customer_name = COALESCE($2, customer_name), received_at = COALESCE($3, received_at),
            payload = $4::jsonb, source = 'external', updated_at = NOW()
     WHERE order_no = $1`,
    [order.order_no, order.customer_name || null, order.received_at || null, JSON.stringify(payload)]
  );
  return { action: 'updated', warnings };
}

/**
 * 接口 1.1 PushOrderInfos —— 接收外部推送的委托单（单条对象或数组）。
 * body = 《递归智能接口文档》1.1 节 PushOrderInfos 入参 JSON。
 */
router.post('/orders', async (req: Request, res: Response) => {
  // 解析阶段失败 = 请求体非法 → 400（客户端错误）
  let parsed: ReturnType<typeof parseOrderInfos>;
  try { parsed = parseOrderInfos(req.body); }
  catch (e: any) {
    console.warn('[external 1.1] 请求体解析失败：', e?.message || String(e));
    res.status(400).json({ ok: false, error: '请求体非法：' + (e?.message || String(e)) }); return;
  }
  const { orders, warnings } = parsed;
  if (!orders.length) { res.status(400).json({ ok: false, error: '没有可解析的委托单' }); return; }
  // 处理阶段失败 = 服务器内部异常（DB 等）→ 500（不泄露内部细节，详情进服务端日志）
  try {
    const results: any[] = [];
    for (const o of orders) {
      const r = await upsertOrder(o);
      results.push({ order_no: o.order_no, action: r.action, warnings: r.warnings });
      warnings.push(...r.warnings);
    }
    console.log('[external 1.1] 收到委托单 %d 条：%s', orders.length,
      results.map((r: any) => `${r.order_no}(${r.action})`).join('，') || '(空)');
    res.json({ ok: true, count: orders.length, results, warnings });
  } catch (e: any) {
    console.error('[external 1.1] 委托单接收失败（服务器内部错误）：', e?.message || String(e));
    res.status(500).json({ ok: false, error: '服务器内部错误：委托单接收失败' });
  }
});

/**
 * 取号单自动生成报告（接口 1.2 收到即生成的核心）。
 * 仅对【尚未生成 + 有 matched 且数据已审核(reviewed) 的样品×项目】生成；缺默认首页模板或无可用
 * assignment 则返回 null（跳过，不报错）。与 /requisitions/generate 同口径（复用 generateAndStoreReport
 * + 首页草稿 carry + buildReportMetaFromReq），生成后回填 requisition.report_id。
 * @returns 新报告 id 或 null（未生成）。
 */
async function autoGenerateRequisition(reqRow: any, actor: string | null): Promise<number | null> {
  if (reqRow.report_id) return null; // 已生成：幂等，不覆盖（避免冲掉文员已编辑的报告）
  const match: any[] = Array.isArray(reqRow.match_result) ? reqRow.match_result : [];
  // 已匹配且原始记录已审核通过的条目 → assignment（取首个有项目模板的已审核记录）
  const assignments = match
    .filter(m => m.status === 'matched')
    .map(m => (m.assignments || []).find((a: any) => a.record_data_status === 'reviewed' && a.project_template_id))
    .filter((a: any) => a && a.record_data_id && a.project_template_id)
    .map((a: any, i: number) => ({ record_data_id: a.record_data_id, project_template_id: a.project_template_id, enabled: true, page_break: true, _order: i }));
  if (!assignments.length) return null;

  const cov = await pool.query(
    `SELECT id FROM report_templates WHERE template_kind='cover' AND archived_at IS NULL ORDER BY id LIMIT 1`);
  if (!cov.rows.length) return null;
  const cover_template_id = cov.rows[0].id;

  const ord = await pool.query('SELECT customer_name, received_at FROM work_orders WHERE order_no=$1', [reqRow.order_no]);
  const customer_name = ord.rows[0]?.customer_name || '';
  const received_at = ord.rows[0]?.received_at || '';
  const draftRes = await pool.query(
    'SELECT content_doc FROM reports WHERE order_no=$1 AND is_cover_draft=true LIMIT 1', [reqRow.order_no]);
  const coverGroupsOverride = draftRes.rows[0]?.content_doc?.cover?.groups || null;
  // 首页原样照片（image 分区存于 ctx.record_raw_data，不随 groups 走）——单独 carry
  const coverCtxPhotos = draftRes.rows[0]?.content_doc?.cover?.ctx?.record_raw_data || null;

  const batch = await pool.query(
    `INSERT INTO report_batches (order_no, cover_template_id, split_mode, created_by)
     VALUES ($1,$2,'requisition',$3) RETURNING id`, [reqRow.order_no, cover_template_id, actor]);
  // 本报告编号自带的样品清单（接口 1.2 SampleList → requisition.scope.samples）——首页样品清单/样品信息表
  // 直接用它（见 buildReportTypst.report_samples），保证样品数量/名称/零件号严格等于该报告编号推送的样品。
  const scopeSamples: any[] = Array.isArray(reqRow.scope?.samples) ? reqRow.scope.samples : [];
  const report_samples = scopeSamples.map((smp: any, i: number) => ({
    no: (smp?.sort_no != null && String(smp.sort_no).trim()) || String(i + 1),
    name: smp?.name ?? '',
    sort_no: smp?.sort_no != null ? String(smp.sort_no) : '',
    model: smp?.model ?? '',
    barcode: smp?.barcode ?? '',
    id: smp?.id != null ? String(smp.id) : undefined,
  }));
  const result = await generateAndStoreReport({
    order_no: reqRow.order_no, cover_template_id, cover_page_template_id: null, batch_id: batch.rows[0].id,
    report_no: reqRow.report_number, sample_label: reqRow.sample_name || null,
    project_assignments: assignments,
    mock_context: { customer_name, received_at, sample_name: reqRow.sample_name || '' },
    report_meta: buildReportMetaFromReq(reqRow), cover_groups_override: coverGroupsOverride,
    cover_ctx_photos: coverCtxPhotos, report_samples, actor,
  });
  await pool.query(
    'UPDATE report_requisitions SET report_id=$2, status=$3, stale=false, updated_at=NOW() WHERE id=$1',
    [reqRow.id, result.report_id, 'generated']);
  return result.report_id;
}

/**
 * 接口 1.2 PushReportInfos —— 接收报告取号信息（整单的 ReportList[]）。
 * 每条 upsert 进 report_requisitions（按 sys_number 幂等），按 样品名+项目名 算匹配结果，
 * 并对【已匹配且数据已审核】的取号单**自动生成报告**——文员收到取号后直接可编辑/送审，
 * 无需在本系统再做"取号/逐格补齐"。数据若在取号之后才录入，则由报告工作台载入时兜底自动生成。
 */
router.post('/reports', async (req: Request, res: Response) => {
  // 解析阶段失败 = 请求体非法 → 400（客户端错误）
  let parsed: ReturnType<typeof parseReportInfos>;
  try { parsed = parseReportInfos(req.body); }
  catch (e: any) {
    console.warn('[external 1.2] 请求体解析失败：', e?.message || String(e));
    res.status(400).json({ ok: false, error: '请求体非法：' + (e?.message || String(e)) }); return;
  }
  const { requisitions, warnings } = parsed;
  // 处理阶段失败 = 服务器内部异常 → 500（不泄露内部细节，详情进服务端日志）
  try {
    const actor = readActor(req);
    const results: any[] = [];
    for (const rq of requisitions) {
      const match = await matchRequisitionScope(pool, rq.order_no, rq.scope);
      await pool.query(
        `INSERT INTO report_requisitions
           (order_no, sys_number, report_number, check_code, language, sample_name, issue_date, header_footer, scope, match_result, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,'pending')
         ON CONFLICT (sys_number) DO UPDATE SET
           order_no=EXCLUDED.order_no, report_number=EXCLUDED.report_number, check_code=EXCLUDED.check_code,
           language=EXCLUDED.language, sample_name=EXCLUDED.sample_name, issue_date=EXCLUDED.issue_date,
           header_footer=EXCLUDED.header_footer, scope=EXCLUDED.scope, match_result=EXCLUDED.match_result, updated_at=NOW()`,
        [rq.order_no, rq.sys_number, rq.report_number, rq.check_code || null, rq.language || null,
         rq.sample_name || null, rq.issue_date || null, JSON.stringify(rq.header_footer),
         JSON.stringify(rq.scope), JSON.stringify(match)],
      );
      // 收到即自动生成（仅未生成 + 已匹配已审核）。失败不阻断 1.2 接收。
      let auto_report_id: number | null = null;
      try {
        const cur = await pool.query('SELECT * FROM report_requisitions WHERE sys_number=$1', [rq.sys_number]);
        auto_report_id = await autoGenerateRequisition(cur.rows[0], actor);
      } catch (ge: any) {
        warnings.push(`取号单 ${rq.sys_number} 自动生成失败（不影响接收）：${ge?.message || String(ge)}`);
      }
      results.push({
        sys_number: rq.sys_number, report_number: rq.report_number,
        matched: match.filter(m => m.status === 'matched').length,
        unresolved: match.filter(m => m.status !== 'matched').length,
        auto_generated: !!auto_report_id, report_id: auto_report_id,
      });
    }
    console.log('[external 1.2] 收到报告取号 %d 条：%s', requisitions.length,
      results.map((r: any) => `${r.sys_number}→${r.report_number}(匹配${r.matched}/未决${r.unresolved}${r.auto_generated ? '·已自动生成' : ''})`).join('，') || '(空)');
    res.json({ ok: true, count: requisitions.length, results, warnings });
  } catch (e: any) {
    console.error('[external 1.2] 报告取号接收失败（服务器内部错误）：', e?.message || String(e));
    res.status(500).json({ ok: false, error: '服务器内部错误：报告取号接收失败' });
  }
});

/**
 * 接口 1.3 RefreshReportInfo（《递归智能接口文档》1.3 节）—— 报告改号 + 退回修改。
 * body 仅 6 个官方字段（单条对象或数组）：
 *   [{ SysNumber, ReportNumber, RecordState, SecondAuditDate, ModifyType, Remark }]
 *
 * 每条按 sys_number 定位取号单，先改号 + 写 1.3 元数据（SecondAuditDate→issue_date 去时分秒、
 * RecordState→record_state、Remark→last_modify_remark；已生成则同步 reports.report_no + stale），
 * 再按 ModifyType 触发退回（仅对已生成报告有效，Remark 作退回原因/reject_note）：
 *   - 缺省（无 ModifyType）：按外部审核结论 RecordState 推进报告状态机——
 *       `审核通过` → external_approved（签发完成，终态）；`审核不通过` → 等价 report_edit 退回文员改报告；
 *       其余（草稿/审核中/无报告）→ 纯改号 / 仅更新元数据。
 *   - 'report_edit'：退回给文员改报告 —— 报告置修改态 + 建 scope=report 返工工单（returnReportForEdit）。
 *                    文员改完报告（InstanceEditor）后重走 /requisitions/:id/deliver 回传。
 *   - 'data_entry' ：退回给实验室工程师重录 —— 把该报告用到的全部 record_data 置退回态 + 各建
 *                    scope=record/target=data_entry 工单（returnReportToDataEntry）。此时文员侧锁定
 *                    （hasOpenDataEntryRework→/requisitions/generate 跳过、/deliver 409）；重录→重审
 *                    通过自动 stale+关单（record-data.ts）→自动解锁→文员重新生成（抓新数据，旧报告留为
 *                    历史版本 superseded_by）→重走 1.4 回传，闭环复用既有流程。
 * 返回 regenerate_needed / modify_type / rejected_records / record_state / issue_date。
 */
router.post('/report-modify', async (req: Request, res: Response) => {
  const list = Array.isArray(req.body) ? req.body : [req.body];
  const actor = readActor(req) || '递归智能（外部）';
  const results: any[] = [];
  const client = await pool.connect();
  try {
    for (const item of list) {
      const sys = (item?.SysNumber || '').toString().trim();
      const rn = (item?.ReportNumber || '').toString().trim();
      const mtRaw = (item?.ModifyType || '').toString().trim().toLowerCase();
      const modifyType: 'data_entry' | 'report_edit' | null =
        mtRaw === 'data_entry' ? 'data_entry' : mtRaw === 'report_edit' ? 'report_edit' : null;
      // 接口 1.3 RefreshReportInfo 官方字段（仅这 6 个）：SysNumber/ReportNumber/RecordState/SecondAuditDate/ModifyType/Remark
      const remark = (item?.Remark ?? null) || null;             // 修改备注＝退回原因
      const issueDate = dateOnly(item?.SecondAuditDate) || null;  // 签发时间 → issue_date（去时分秒）
      const recordState = (item?.RecordState ?? null) || null;    // 外部审核状态（草稿/审核中/审核通过/审核不通过）
      if (!sys) { results.push({ sys_number: sys, ok: false, error: 'SysNumber 必填' }); continue; }
      try {
        await client.query('BEGIN');
        // 1) 改号 + 1.3 元数据：ReportNumber/SecondAuditDate/RecordState/Remark 给了才更新
        const r = await client.query(
          `UPDATE report_requisitions SET
             report_number=COALESCE(NULLIF($2,''), report_number),
             issue_date=COALESCE($3, issue_date),
             record_state=COALESCE($4, record_state),
             last_modify_remark=COALESCE($5, last_modify_remark),
             stale=(report_id IS NOT NULL), updated_at=NOW()
           WHERE sys_number=$1 RETURNING report_id, report_number, issue_date, record_state`,
          [sys, rn, issueDate, recordState, remark],
        );
        if (!r.rows.length) { await client.query('ROLLBACK'); results.push({ sys_number: sys, ok: false, error: '未找到该取号单' }); continue; }
        const reportId: number | null = r.rows[0].report_id;
        const newNo: string = r.rows[0].report_number;
        const newIssueDate: string | null = r.rows[0].issue_date;
        const newRecordState: string | null = r.rows[0].record_state;
        if (reportId && rn) await client.query('UPDATE reports SET report_no=$2, stale=true WHERE id=$1', [reportId, rn]);

        // 2) 退回环节（仅已生成报告可退回）
        if (modifyType && !reportId) {
          await client.query('COMMIT');
          results.push({ sys_number: sys, ok: true, report_number: newNo, issue_date: newIssueDate, record_state: newRecordState, regenerate_needed: false, warning: '该取号单尚未生成报告，仅记录改号/元数据，退回环节忽略' });
          continue;
        }
        if (modifyType && reportId) {
          const rep = await client.query('SELECT id, order_no, report_no, record_data_ids FROM reports WHERE id=$1', [reportId]);
          const report = rep.rows[0];
          if (modifyType === 'data_entry') {
            const out = await returnReportToDataEntry(client, report, {
              reason: remark || '外部退回-重录数据', suggestion: remark, actorName: actor, actorRole: 'external',
            });
            await client.query('COMMIT');
            results.push({ sys_number: sys, ok: true, report_number: newNo, issue_date: newIssueDate, record_state: newRecordState, modify_type: 'data_entry', regenerate_needed: true, rejected_records: out.rejected_record_ids.length });
          } else {
            await returnReportForEdit(client, report, {
              reason: remark || '外部退回-修改报告', suggestion: remark, raisedByName: actor, raisedByRole: 'external',
            });
            await client.query('COMMIT');
            results.push({ sys_number: sys, ok: true, report_number: newNo, issue_date: newIssueDate, record_state: newRecordState, modify_type: 'report_edit', regenerate_needed: true });
          }
          continue;
        }

        // 3) 无退回 ModifyType：按外部审核结论(RecordState)推进报告外部状态机（真实部署核心路径）。
        //    审核通过 → external_approved（签发完成，终态）；审核不通过（未显式给 ModifyType）→ 语义等价
        //    report_edit：退回文员改报告（external_revision + 建 scope=report 工单）。草稿/审核中/无报告 →
        //    仅记录元数据（record_state 已在上面的 UPDATE 落库）。
        if (reportId && (newRecordState === '审核通过' || newRecordState === '审核不通过')) {
          const rep = await client.query('SELECT id, order_no, report_no, record_data_ids FROM reports WHERE id=$1', [reportId]);
          const report = rep.rows[0];
          if (newRecordState === '审核通过') {
            await markReportApproved(client, reportId, { externalRef: null });
            // 审核通过＝终态：取号单不再是"待重新生成"（上面的 UPDATE 因 report_id 非空置了 stale=true，这里回退）
            await client.query('UPDATE report_requisitions SET stale=false, updated_at=NOW() WHERE sys_number=$1', [sys]);
            await client.query('COMMIT');
            results.push({ sys_number: sys, ok: true, report_number: newNo, issue_date: newIssueDate, record_state: newRecordState, external_status: 'external_approved', regenerate_needed: false });
            continue;
          }
          // 审核不通过
          await returnReportForEdit(client, report, {
            reason: remark || '外部审核不通过', suggestion: remark, raisedByName: actor, raisedByRole: 'external',
          });
          await client.query('COMMIT');
          results.push({ sys_number: sys, ok: true, report_number: newNo, issue_date: newIssueDate, record_state: newRecordState, modify_type: 'report_edit', external_status: 'external_revision', regenerate_needed: true });
          continue;
        }

        // 纯改号 / 仅元数据（草稿/审核中，或尚未生成报告）
        await client.query('COMMIT');
        results.push({ sys_number: sys, ok: true, report_number: newNo, issue_date: newIssueDate, record_state: newRecordState, regenerate_needed: !!reportId });
      } catch (e: any) {
        await client.query('ROLLBACK').catch(() => {});
        results.push({ sys_number: sys, ok: false, error: e?.message || String(e) });
      }
    }
    console.log('[external 1.3] 报告修改/退回 %d 条：%s', results.length,
      results.map((r: any) => `${r.sys_number}:${r.ok ? (r.modify_type || '改号') : 'ERR ' + r.error}`).join('，') || '(空)');
    res.json({ ok: true, results });
  } catch (e: any) {
    // 单条异常已在循环内逐条捕获（results[].ok=false）；此处兜底循环外的整体异常 → 500（不泄露内部细节）
    console.error('[external 1.3] 报告修改/退回失败（服务器内部错误）：', e?.message || String(e));
    if (!res.headersSent) res.status(500).json({ ok: false, error: '服务器内部错误：报告修改/退回失败' });
  } finally {
    client.release();
  }
});

/**
 * 各订单的取号报告聚合（委托单列表角标 + 状态 + KPI 用，轻量聚合不重算匹配）：
 *   total      取号报告数
 *   generated  已生成数
 *   delivered  已回传(送审)数（delivery_status='sent'）
 *   approved   外部审核通过数（reports.external_status='external_approved'，签发终态）
 *   revision   外部退回待改报告数（reports.external_status='external_revision'）
 *   data_rework 实验室数据退回中数（该报告有未关闭 data_entry 工单）
 */
router.get('/requisition-counts', async (_req: Request, res: Response) => {
  try {
    const r = await pool.query(
      `SELECT rq.order_no,
              COUNT(*)::int AS total,
              COUNT(rq.report_id)::int AS generated,
              COUNT(*) FILTER (WHERE rq.delivery_status='sent')::int AS delivered,
              COUNT(*) FILTER (WHERE r.external_status='external_approved')::int AS approved,
              COUNT(*) FILTER (WHERE r.external_status='external_revision')::int AS revision,
              COUNT(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM rework_tickets t
                WHERE t.report_id=rq.report_id AND t.target_stage='data_entry' AND t.status<>'resolved'
              ))::int AS data_rework
       FROM report_requisitions rq
       LEFT JOIN reports r ON r.id=rq.report_id
       GROUP BY rq.order_no`,
    );
    const map: Record<string, { total: number; generated: number; delivered: number; approved: number; revision: number; data_rework: number }> = {};
    for (const row of r.rows) map[row.order_no] = {
      total: row.total, generated: row.generated, delivered: row.delivered,
      approved: row.approved, revision: row.revision, data_rework: row.data_rework,
    };
    res.json(map);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

/** 列出某订单的取号报告（实时刷新匹配结果）。报告工作台「取号报告」面板用。 */
router.get('/requisitions', async (req: Request, res: Response) => {
  const order_no = (req.query.order_no || '').toString();
  if (!order_no) { res.status(400).json({ error: 'order_no 必填' }); return; }
  try {
    const r = await pool.query(
      `SELECT rq.*, rp.external_status
         FROM report_requisitions rq
         LEFT JOIN reports rp ON rp.id = rq.report_id
        WHERE rq.order_no=$1 ORDER BY rq.report_number`, [order_no]);
    const rows: any[] = [];
    for (const row of r.rows) {
      const match = await matchRequisitionScope(pool, order_no, row.scope);
      await pool.query('UPDATE report_requisitions SET match_result=$2::jsonb, updated_at=NOW() WHERE id=$1', [row.id, JSON.stringify(match)]);
      // 文员侧锁：该报告若有未关闭的 data_entry 返工工单，前端据此禁用重新生成/编辑/送审。
      const data_rework_open = row.report_id ? await hasOpenDataEntryRework(pool, row.report_id) : false;
      // 报告退回(scope=report)：在原报告上编辑修改（非重生成），退回意见展示在该条目下方。
      const report_rework = row.report_id ? await getOpenReportRework(pool, row.report_id) : null;
      rows.push({ ...row, match_result: match, data_rework_open, report_rework });
    }
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

/**
 * 按取号单生成报告（文员在工作台补齐 assignments 后调用）。
 * body：{ order_no, cover_template_id, cover_page_template_id?, items:[{requisition_id, assignments:[{record_data_id, project_template_id, title?, page_break?}]}] }
 * 复用 reports.ts 的 generateAndStoreReport（与手动拆分同口径），report_no=报告编号、页眉页脚用该取号单元数据。
 */
router.post('/requisitions/generate', async (req: Request, res: Response) => {
  const { order_no, cover_template_id, cover_page_template_id, items } = req.body || {};
  if (!order_no || !cover_template_id || !Array.isArray(items) || !items.length) {
    res.status(400).json({ error: 'order_no / cover_template_id / items 必填' });
    return;
  }
  const actor = readActor(req);
  try {
    const ord = await pool.query('SELECT customer_name, received_at FROM work_orders WHERE order_no=$1', [order_no]);
    const customer_name = ord.rows[0]?.customer_name || '';
    const received_at = ord.rows[0]?.received_at || '';
    // 首页草稿 carry-over：本订单若有文员编辑过的首页草稿，取其已编辑 cover groups，
    // 套用到每份取号报告的首页（结构/样式/手改值 carry，binding/结论按各报告 scope 重解析）。
    const draftRes = await pool.query(
      'SELECT content_doc FROM reports WHERE order_no=$1 AND is_cover_draft=true LIMIT 1', [order_no]);
    const coverGroupsOverride = draftRes.rows[0]?.content_doc?.cover?.groups || null;
    // 首页原样照片（image 分区存于 ctx.record_raw_data，不随 groups 走）——单独 carry
    const coverCtxPhotos = draftRes.rows[0]?.content_doc?.cover?.ctx?.record_raw_data || null;
    const batch = await pool.query(
      `INSERT INTO report_batches (order_no, cover_template_id, split_mode, created_by)
       VALUES ($1,$2,'requisition',$3) RETURNING id`,
      [order_no, cover_template_id, actor],
    );
    const batchId = batch.rows[0].id;
    const out: any[] = [];
    for (const it of items) {
      const rq = await pool.query('SELECT * FROM report_requisitions WHERE id=$1 AND order_no=$2', [it.requisition_id, order_no]);
      if (!rq.rows.length) { out.push({ requisition_id: it.requisition_id, ok: false, error: '取号单不存在' }); continue; }
      const row = rq.rows[0];
      const assignments = (Array.isArray(it.assignments) ? it.assignments : [])
        .filter((a: any) => a && a.record_data_id && a.project_template_id)
        .map((a: any, i: number) => ({
          record_data_id: a.record_data_id, project_template_id: a.project_template_id,
          enabled: true, title: a.title || undefined, page_break: a.page_break !== false, _order: i,
        }));
      if (!assignments.length) { out.push({ requisition_id: row.id, ok: false, error: '没有可生成的项目（请先补齐样品/项目/原始记录关联）' }); continue; }
      // 文员侧锁：实验室数据退回(data_entry)未重审通过前不能重新生成（待重审后自动解锁）。
      const prevReportId: number | null = row.report_id;
      if (prevReportId && await hasOpenDataEntryRework(pool, prevReportId)) {
        out.push({ requisition_id: row.id, ok: false, locked: true, error: '实验室数据退回修改中，待重新审核通过后才能重新生成' });
        continue;
      }
      // 本报告编号自带样品清单（scope.samples）→ report_samples，首页样品清单/样品信息表直接用它（同 autoGenerate）。
      const scopeSamples: any[] = Array.isArray(row.scope?.samples) ? row.scope.samples : [];
      const report_samples = scopeSamples.map((smp: any, i: number) => ({
        no: (smp?.sort_no != null && String(smp.sort_no).trim()) || String(i + 1),
        name: smp?.name ?? '',
        sort_no: smp?.sort_no != null ? String(smp.sort_no) : '',
        model: smp?.model ?? '',
        barcode: smp?.barcode ?? '',
        id: smp?.id != null ? String(smp.id) : undefined,
      }));
      const result = await generateAndStoreReport({
        order_no, cover_template_id, cover_page_template_id: cover_page_template_id || null, batch_id: batchId,
        report_no: row.report_number, sample_label: row.sample_name || null,
        project_assignments: assignments,
        mock_context: { customer_name, received_at, sample_name: row.sample_name || '' },
        report_meta: buildReportMetaFromReq(row), cover_groups_override: coverGroupsOverride,
        cover_ctx_photos: coverCtxPhotos, report_samples, actor,
      });
      // 历史版本：旧报告行保留，标记被新报告取代（superseded_by 指向新版），列表只显示当前版。
      if (prevReportId && prevReportId !== result.report_id) {
        await pool.query('UPDATE reports SET superseded_by=$2 WHERE id=$1', [prevReportId, result.report_id]);
      }
      await pool.query(
        'UPDATE report_requisitions SET report_id=$2, status=$3, stale=false, updated_at=NOW() WHERE id=$1',
        [row.id, result.report_id, 'generated'],
      );
      out.push({ requisition_id: row.id, ok: true, ...result });
    }
    res.json({ batch_id: batchId, reports: out });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

/**
 * 接口 1.4 AcceptReportFromDiGui —— 把已生成报告的 PDF 回传递归智能（出站）。
 * 取该取号单已生成报告的 final_typst → 编译 PDF → Base64 → submitReportToDiGui（mock 接缝）。
 * 更新 delivery_status / delivered_at / delivery_error 留痕。
 */
router.post('/requisitions/:id/deliver', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    const rq = await pool.query('SELECT * FROM report_requisitions WHERE id=$1', [id]);
    if (!rq.rows.length) { res.status(404).json({ error: '取号单不存在' }); return; }
    const row = rq.rows[0];
    if (!row.report_id) { res.status(400).json({ error: '该取号单尚未生成报告，不能回传' }); return; }
    // 文员侧锁：实验室数据退回修改中（data_entry 工单未关闭）不能回传，须等数据重审通过+重新生成。
    if (await hasOpenDataEntryRework(pool, row.report_id)) {
      res.status(409).json({ error: '实验室数据退回修改中，待重新审核通过并重新生成后才能回传' }); return;
    }

    const rep = await pool.query('SELECT final_typst FROM reports WHERE id=$1', [row.report_id]);
    if (!rep.rows.length || !rep.rows[0].final_typst) { res.status(400).json({ error: '报告内容缺失，无法编译 PDF' }); return; }

    const compiled = await compileTypst(rep.rows[0].final_typst);
    const pdfBase64 = Buffer.from(compiled.pdf).toString('base64');
    // 业务员工号 JobNo（接口1.4 第三参）：来自委托单（接口1.1 → work_orders.payload.meta.job_no）
    const woMeta = await pool.query(`SELECT payload->'meta'->>'job_no' AS job_no FROM work_orders WHERE order_no=$1`, [row.order_no]);
    const jobNo = woMeta.rows[0]?.job_no || '';
    const result = await submitReportToDiGui(row.sys_number, pdfBase64, jobNo);

    await pool.query(
      `UPDATE report_requisitions
         SET delivery_status=$2, delivered_at=CASE WHEN $2='sent' THEN NOW() ELSE delivered_at END,
             delivery_error=$3, updated_at=NOW()
       WHERE id=$1`,
      [id, result.ok ? 'sent' : 'failed', result.ok ? null : (result.error || '回传失败')],
    );
    if (!result.ok) { res.status(502).json({ ok: false, error: result.error || '回传失败' }); return; }
    // 回传成功 → 报告进入"已回传外部待审"态（P-Flow-2 状态机起点）
    await pool.query(`UPDATE reports SET external_status='submitted_external', stale=false WHERE id=$1`, [row.report_id]);
    // 若本报告处于"报告退回(scope=report)"修改态：送审即视为已处理，关闭工单 + 清取号单 stale → 回到终态。
    await pool.query(
      `UPDATE rework_tickets SET status='resolved', resolved_at=NOW(),
         resolution_note=COALESCE(resolution_note, '报告已修改并重新送审')
       WHERE report_id=$1 AND scope='report' AND status <> 'resolved'`,
      [row.report_id],
    );
    await pool.query('UPDATE report_requisitions SET stale=false, updated_at=NOW() WHERE id=$1', [id]);
    res.json({ ok: true, ref: result.ref });
  } catch (e: any) {
    await pool.query('UPDATE report_requisitions SET delivery_status=$2, delivery_error=$3, updated_at=NOW() WHERE id=$1',
      [id, 'failed', e?.message || String(e)]).catch(() => {});
    res.status(500).json({ error: e?.message || String(e) });
  }
});

/**
 * 外部报告回执（P-Flow-2 场景3）—— 外部审批结论入站（mock 可手动触发）。
 * body: { report_id? | report_no? | sys_number?, order_no?, decision:'approved'|'needs_revision', suggestions?/suggestion?, external_ref? }
 *   - approved       → markReportApproved（external_approved，签发完成）。
 *   - needs_revision → returnReportForEdit（external_revision + 建 scope=report 返工工单，文员处理）。
 * 与接口 1.3 report_edit 共用 rework-ops 同一套状态机原语（单一事实来源）；本端点等价于
 * ModifyType=report_edit 的"软触发"，文员可在工作台再升级到录入（POST /api/rework scope=record）。
 */
router.post('/report-feedback', async (req: Request, res: Response) => {
  let fb;
  try { fb = parseReportFeedback(req.body); }
  catch (e: any) { res.status(400).json({ error: e?.message || String(e) }); return; }

  const client = await pool.connect();
  try {
    // 定位报告：report_id > report_no > sys_number(经 requisition)
    let rep: any = null;
    if (fb.report_id) rep = (await client.query('SELECT id, order_no, report_no FROM reports WHERE id=$1', [fb.report_id])).rows[0];
    if (!rep && fb.report_no) rep = (await client.query('SELECT id, order_no, report_no FROM reports WHERE report_no=$1 ORDER BY id DESC LIMIT 1', [fb.report_no])).rows[0];
    if (!rep && fb.sys_number) {
      const rq = await client.query('SELECT report_id FROM report_requisitions WHERE sys_number=$1', [fb.sys_number]);
      const rid = rq.rows[0]?.report_id;
      if (rid) rep = (await client.query('SELECT id, order_no, report_no FROM reports WHERE id=$1', [rid])).rows[0];
    }
    if (!rep) { res.status(404).json({ error: '未找到对应报告（report_id/report_no/sys_number 都定位不到，或报告尚未生成）' }); return; }

    await client.query('BEGIN');
    if (fb.decision === 'approved') {
      await markReportApproved(client, rep.id, { externalRef: fb.external_ref });
      await client.query('COMMIT');
      res.json({ ok: true, report_id: rep.id, decision: 'approved' });
      return;
    }
    const ticket = await returnReportForEdit(client, rep, {
      reason: '外部要求修改报告', suggestion: fb.suggestion, externalRef: fb.external_ref,
      raisedByName: '递归智能（外部）', raisedByRole: 'external',
    });
    await client.query('COMMIT');
    res.json({ ok: true, report_id: rep.id, decision: 'needs_revision', ticket });
  } catch (e: any) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: e?.message || String(e) });
  } finally {
    client.release();
  }
});

export default router;
