/**
 * 外部系统【接收端点】—— 递归智能"推送"接口的落点。
 *
 * 接口文档《递归智能接口文档》：
 *   - 1.1 PushOrderInfos     委托单信息   → POST /api/external/orders       ✅ 已实现
 *   - 1.2 PushReportInfos    报告取号信息 → POST /api/external/reports      ✅ 已实现
 *   - 1.3 RefreshReportInfo  报告改号+退回 → POST /api/external/report-modify ✅ 已实现（data_entry/report_edit + RecordState/SecondAuditDate/Remark）
 *   - 1.4 AcceptReportFromDiGui  回传报告 PDF → 出站 POST /api/external/requisitions/:id/deliver（SOAP）✅
 *   - 1.5 CancelFlowFromDiGui    撤销报告送审 → 出站 SOAP ✅
 *   - 1.6 UpdateMaterialTaskState 数据审核完工 → 出站 SOAP（由 record-data / record-batches 触发）✅
 *
 * 解析逻辑在 services/external-orders.ts（parseOrderInfos）。本路由只负责
 * HTTP 接收 + 入库 work_orders（与界面「新建订单」同构）。
 */
import { Router, Request, Response } from 'express';
import { parseOrderInfos, type ExternalOrder } from '../services/external-orders.js';
import { parseReportInfos, matchRequisitionScope, buildReportMetaFromReq, dateOnly } from '../services/external-report-info.js';
import { buildHeaderFooterConfig, generateAndStoreReport } from './reports.js';
import { compileTypst } from '../services/typst-compiler.js';
import { submitReportToDiGui, cancelReportFlowFromDiGui } from '../services/external-report-delivery.js';
import { parseReportFeedback } from '../services/external-report-feedback.js';
import { returnReportForEdit, returnReportToDataEntry, markReportApproved } from '../services/rework-ops.js';

import { pool } from '../db.js';
import { availableReportAssignments, splitReportMethodMatches } from '../../../shared/report-generation-selection';
import { pickReportImageData } from '../../../shared/report-image-state';
import { applyReportMetaSnapshot, reportMetaSnapshotMatches } from '../../../shared/report-meta-snapshot';
import { renderContentDoc } from '../../../shared/typst-generator';

const router = Router();

function readActor(req: Request): string | null {
  const raw = (req.header('X-Demo-User') || '').trim();
  if (!raw) return null;
  try { return decodeURIComponent(raw); } catch { return raw; }
}

/** 当前登录账号工号（前端 X-User-Job 头，与 auth.ts RBAC 鉴权同源）。 */
function readJobNo(req: Request): string {
  return (req.header('X-User-Job') || '').trim();
}

/**
 * Keep editable, not-yet-delivered reports aligned with their interface 1.2 row.
 * Submitted/approved PDFs are archival evidence and are deliberately left untouched.
 */
async function syncGeneratedReportMeta(row: any, actor: string | null = null): Promise<boolean> {
  if (!row?.report_id) return false;
  const found = await pool.query(
    'SELECT id, content_doc, content_doc_original, external_status FROM reports WHERE id=$1',
    [row.report_id],
  );
  const report = found.rows[0];
  if (!report?.content_doc || ['submitted_external', 'external_approved'].includes(report.external_status)) return false;
  if (row.delivery_status === 'sent' && report.external_status !== 'external_revision') return false;
  const meta = buildReportMetaFromReq(row);
  if (reportMetaSnapshotMatches(report.content_doc, meta)) return false;
  const headerFooter = buildHeaderFooterConfig(meta);
  const current = applyReportMetaSnapshot(report.content_doc, meta, headerFooter);
  const original = report.content_doc_original
    ? applyReportMetaSnapshot(report.content_doc_original, meta, headerFooter)
    : current;
  await pool.query(
    `UPDATE reports SET report_no=$2, content_doc=$3::jsonb, content_doc_original=$4::jsonb,
       final_typst=$5, stale=false, version=version+1 WHERE id=$1`,
    [report.id, row.report_number, JSON.stringify(current), JSON.stringify(original), renderContentDoc(current)],
  );
  await pool.query(
    `INSERT INTO report_audit_log (report_id, action, actor_name, diff, note)
     VALUES ($1,'edit',$2,'[]'::jsonb,$3)`,
    [report.id, actor, '同步接口 1.2 报告编号、校验码、签发日期及报告/资质备注'],
  );
  await pool.query('UPDATE report_requisitions SET stale=false, updated_at=NOW() WHERE id=$1', [row.id]);
  return true;
}

/**
 * 报告编号接口给出的 scope 是“默认范围”，而不是编辑上限。
 * 文员可在一份报告中改选本订单的任意样品/项目，因此匹配时展开订单的完整样品清单；
 * default_enabled 仅用于前端首开时保留接口下发的默认勾选。
 */
async function matchRequisitionWithOrderScope(row: any, selections = Array.isArray(row.template_selections) ? row.template_selections : []) {
  const wo = await pool.query('SELECT payload FROM work_orders WHERE order_no=$1', [row.order_no]);
  const orderSamples: any[] = Array.isArray(wo.rows[0]?.payload?.samples) ? wo.rows[0].payload.samples : [];
  const defaultPairs = new Set<string>();
  for (const sample of (Array.isArray(row.scope?.samples) ? row.scope.samples : [])) {
    for (const test of (Array.isArray(sample?.test_infos) ? sample.test_infos : [])) {
      defaultPairs.add(`${sample?.name || ''}||${test?.name || ''}`);
    }
  }
  const expandedScope = {
    samples: orderSamples.map((sample: any) => ({
      id: sample?.id != null ? String(sample.id) : undefined,
      name: sample?.name || '',
      test_infos: Array.isArray(sample?.test_infos) ? sample.test_infos.map((test: any) => ({ name: test?.name || '' })) : [],
    })),
  };
  const match = await matchRequisitionScope(
    pool, row.order_no, expandedScope,
    selections,
  );
  return splitReportMethodMatches(match.map((entry: any) => ({
    ...entry,
    default_enabled: defaultPairs.has(`${entry.sample_name || ''}||${entry.project_name || ''}`),
  })));
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
  const oldTaskIds = new Map<string, string>();
  const oldKeys = new Set<string>();
  for (const os of oldSamples) {
    for (const ot of (os.test_infos || [])) {
      const k = `${os.name}||${ot.name}`;
      oldKeys.add(k);
      const ids = linkedIdsOf(ot);
      if (ids.length) oldLinks.set(k, ids);
      const taskId = String(ot?.task_id ?? ot?.TaskId ?? '').trim();
      if (taskId) oldTaskIds.set(k, taskId);
    }
  }

  const newKeys = new Set<string>();
  const mergedSamples = order.samples.map((ns) => ({
    ...ns,
    test_infos: ns.test_infos.map((nt) => {
      const k = `${ns.name}||${nt.name}`;
      newKeys.add(k);
      const ids = oldLinks.get(k);
      const taskId = nt.task_id || oldTaskIds.get(k);
      return {
        ...nt,
        ...(taskId ? { task_id: taskId } : {}),
        ...(ids && ids.length ? { linked_template_ids: ids } : {}),
      };
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
 * 已停用自动生成：每份报告必须先由文员确认样品/项目范围与项目模板后，调用
 * /requisitions/generate 显式生成。保留函数仅兼容旧调用，始终返回 null。
 * @returns 新报告 id 或 null（未生成）。
 */
async function autoGenerateRequisition(reqRow: any, actor: string | null): Promise<number | null> {
  void reqRow; void actor;
  return null;
  /* legacy implementation retained below for migration reference */
  if (reqRow.report_id) return null; // 已生成：幂等，不覆盖（避免冲掉文员已编辑的报告）
  const match: any[] = Array.isArray(reqRow.match_result) ? reqRow.match_result : [];
  // 每个已匹配格子都必须有一个明确选择。唯一候选可自动确定；多候选必须等文员确认，
  // 不能再静默取第一份模板，也不能只生成报告范围中的一部分。
  const matched = match.filter(m => m.status === 'matched'
    && (m.assignments || []).some((a: any) => a.record_data_status === 'reviewed'));
  if (!matched.length) return null;
  const picked = matched.map(m => ({
    scope_key: m.scope_key,
    assignment: (m.assignments || []).find((a: any) =>
      a.record_data_status === 'reviewed' && a.project_template_id),
  }));
  if (picked.some(x => !x.assignment)) return null;
  const assignments = picked.map((x, i) => ({
    scope_key: x.scope_key,
    record_data_id: x.assignment.record_data_id,
    project_template_id: x.assignment.project_template_id,
    project_template_version_id: x.assignment.project_template_version_id,
    enabled: true, page_break: true, _order: i,
  }));
  if (!assignments.length) return null;

  const cov = await pool.query(
    `SELECT id FROM report_templates WHERE template_kind='cover' AND archived_at IS NULL ORDER BY id LIMIT 1`);
  if (!cov.rows.length) return null;
  const cover_template_id = cov.rows[0].id;

  const ord = await pool.query('SELECT customer_name, received_at FROM work_orders WHERE order_no=$1', [reqRow.order_no]);
  const customer_name = ord.rows[0]?.customer_name || '';
  const received_at = ord.rows[0]?.received_at || '';
  const draftRes = await pool.query(
    'SELECT content_doc FROM reports WHERE order_no=$1 AND cover_template_id=$2 AND is_cover_draft=true LIMIT 1', [reqRow.order_no, cover_template_id]);
  const coverGroupsOverride = draftRes.rows[0]?.content_doc?.cover?.groups || null;
  // 首页原样照片（image 分区存于 ctx.record_raw_data，不随 groups 走）——单独 carry
  const coverCtxPhotos = pickReportImageData(draftRes.rows[0]?.content_doc?.cover);

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
    cover_ctx_photos: coverCtxPhotos, report_samples,
    report_scope_samples: Array.isArray(reqRow.scope?.samples) ? reqRow.scope.samples : [], actor,
  });
  const frozenSelections = assignments.map((a: any) => ({
    scope_key: a.scope_key,
    record_data_id: a.record_data_id,
    project_template_id: a.project_template_id,
    project_template_version_id: a.project_template_version_id,
    selected_at: new Date().toISOString(),
    selected_by: actor,
  }));
  await pool.query(
    `UPDATE report_requisitions
        SET report_id=$2, status=$3, stale=false, template_selections=$4::jsonb, updated_at=NOW()
      WHERE id=$1`,
    [reqRow.id, result.report_id, 'generated', JSON.stringify(frozenSelections)]);
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
      // 外部重复推送同一取号单时保留文员已经确认过的模板选择；若候选关系已失效，
      // matchRequisitionScope 会自动丢弃该选择并重新标成“待选择”。
      const previous = await pool.query(
        'SELECT template_selections FROM report_requisitions WHERE sys_number=$1',
        [rq.sys_number],
      );
      const savedSelections = Array.isArray(previous.rows[0]?.template_selections)
        ? previous.rows[0].template_selections : [];
      const match = await matchRequisitionScope(pool, rq.order_no, rq.scope, savedSelections);
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
        const metadata_synced = await syncGeneratedReportMeta(cur.rows[0], actor);
        auto_report_id = await autoGenerateRequisition(cur.rows[0], actor);
        if (metadata_synced) warnings.push(`取号单 ${rq.sys_number} 的报告编号、校验码、签发日期及备注已同步到未送审报告`);
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
      const recordState = String(item?.RecordState ?? '').trim() || null;
      if (!sys) { results.push({ sys_number: sys, ok: false, error: 'SysNumber 必填' }); continue; }
      if (mtRaw && !modifyType) { results.push({ sys_number: sys, ok: false, error: 'ModifyType 仅支持 data_entry 或 report_edit' }); continue; }
      if (recordState && !['草稿', '审核中', '审核通过', '审核不通过'].includes(recordState)) {
        results.push({ sys_number: sys, ok: false, error: 'RecordState 必须为草稿、审核中、审核通过或审核不通过' }); continue;
      }
      try {
        await client.query('BEGIN');
        // 1) 改号 + 1.3 元数据：ReportNumber/SecondAuditDate/RecordState/Remark 给了才更新
        const r = await client.query(
          `UPDATE report_requisitions SET
             report_number=COALESCE(NULLIF($2,''), report_number),
             issue_date=COALESCE($3, issue_date),
             record_state=COALESCE($4, record_state),
             last_modify_remark=COALESCE($5, last_modify_remark),
             -- 1.3 的审核状态回执不是报告内容变更；只有确实改号时才需要重生成。
             -- 旧逻辑对每一条回执都置 stale=true，进一步放大了“未送审却被外部状态锁死”的影响。
             stale=CASE WHEN report_id IS NOT NULL AND NULLIF($2,'') IS NOT NULL AND report_number <> $2 THEN true ELSE stale END,
             updated_at=NOW()
           WHERE sys_number=$1 RETURNING report_id, report_number, issue_date, record_state, delivery_status`,
          [sys, rn, issueDate, recordState, remark],
        );
        if (!r.rows.length) { await client.query('ROLLBACK'); results.push({ sys_number: sys, ok: false, error: '未找到该取号单' }); continue; }
        const reportId: number | null = r.rows[0].report_id;
        const newNo: string = r.rows[0].report_number;
        const newIssueDate: string | null = r.rows[0].issue_date;
        const newRecordState: string | null = r.rows[0].record_state;
        const deliveryStatus: string = r.rows[0].delivery_status || 'none';
        if (reportId && rn) await client.query('UPDATE reports SET report_no=$2, stale=(stale OR report_no IS DISTINCT FROM $2) WHERE id=$1', [reportId, rn]);

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
        if (reportId && (recordState === '审核通过' || recordState === '审核不通过' || recordState === '草稿')) {
          const rep = await client.query('SELECT id, order_no, report_no, record_data_ids, external_status FROM reports WHERE id=$1', [reportId]);
          const report = rep.rows[0];
          // 外部结论只能作用于本系统已经成功送出的报告。没有经过 submitted_external
          // 状态的一律只记录外部元数据，不能反向把未送审报告锁成“审核通过”。
          if (report?.external_status !== 'submitted_external' && !(deliveryStatus === 'sent' && report?.external_status === 'none')) {
            await client.query('COMMIT');
            results.push({ sys_number: sys, ok: true, report_number: newNo, issue_date: newIssueDate, record_state: newRecordState, regenerate_needed: false, warning: '外部回执未对应本系统已送审状态，仅记录元数据' });
            continue;
          }
          if (recordState === '审核通过') {
            await markReportApproved(client, reportId, { externalRef: null });
            // 审核通过＝终态：取号单不再是"待重新生成"（上面的 UPDATE 因 report_id 非空置了 stale=true，这里回退）
            await client.query('UPDATE report_requisitions SET stale=false, updated_at=NOW() WHERE sys_number=$1', [sys]);
            await client.query('COMMIT');
            results.push({ sys_number: sys, ok: true, report_number: newNo, issue_date: newIssueDate, record_state: newRecordState, external_status: 'external_approved', regenerate_needed: false });
            continue;
          }
          // 审核不通过
          await returnReportForEdit(client, report, {
            reason: remark || (recordState === '草稿' ? '外部流程退回草稿' : '外部审核不通过'), suggestion: remark, raisedByName: actor, raisedByRole: 'external',
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
      `SELECT rq.*, rp.external_status, rp.scope AS report_scope
         FROM report_requisitions rq
         LEFT JOIN reports rp ON rp.id = rq.report_id
        WHERE rq.order_no=$1 ORDER BY rq.report_number`, [order_no]);
    const rows: any[] = [];
    for (const row of r.rows) {
      // 修复历史报告快照，并覆盖“接口 1.2 重复推送后报告仍显示旧校验码/备注”的情况。
      // 已送审、已批准报告由审签流程冻结，不在列表查询时改写。
      const metadata_synced = await syncGeneratedReportMeta(row);
      if (metadata_synced) row.stale = false;
      const match = await matchRequisitionWithOrderScope(
        row, Array.isArray(row.template_selections) ? row.template_selections : [],
      );
      await pool.query('UPDATE report_requisitions SET match_result=$2::jsonb WHERE id=$1', [row.id, JSON.stringify(match)]);
      // 文员侧锁：该报告若有未关闭的 data_entry 返工工单，前端据此禁用重新生成/编辑/送审。
      const data_rework_open = row.report_id ? await hasOpenDataEntryRework(pool, row.report_id) : false;
      // 报告退回(scope=report)：在原报告上编辑修改（非重生成），退回意见展示在该条目下方。
      const report_rework = row.report_id ? await getOpenReportRework(pool, row.report_id) : null;
      // 已生成报告以 reports.scope 为唯一事实来源。编辑器内调整范围后，工作台重新打开时
      // 用这一快照重建勾选状态，保证两个入口看到的是同一份样品/项目范围。
      const reportPairs = new Map<string, any>((Array.isArray(row.report_scope?.project_assignments)
        ? row.report_scope.project_assignments : [])
        .filter((a: any) => a?.record_data_id && a?.project_template_id)
        .map((a: any) => [`${Number(a.record_data_id)}:${Number(a.project_template_id)}`, a]));
      const reportSelectedRecordIds = new Set<number>(Array.isArray(row.report_scope?.selected_record_data_ids)
        ? row.report_scope.selected_record_data_ids.map(Number) : []);
      const displaySelections = row.report_id && (reportPairs.size || reportSelectedRecordIds.size)
        ? match.map((entry: any) => {
          const selected = entry.assignments?.find((a: any) =>
            reportSelectedRecordIds.has(Number(a.record_data_id))
            || [...reportPairs.keys()].some(pair => pair.startsWith(`${Number(a.record_data_id)}:`)));
          const pair = selected && [...reportPairs.entries()].find(([key]) => key.startsWith(`${Number(selected.record_data_id)}:`));
          return {
            scope_key: entry.scope_key,
            enabled: !!pair || !!selected,
            record_data_id: selected?.record_data_id,
            project_template_id: pair ? Number(String(pair[0]).split(':')[1]) : undefined,
            project_template_version_id: pair?.[1]?.project_template_version_id ?? null,
          };
        })
        : match.flatMap((entry: any) => {
          const choice = (row.template_selections || []).find((s: any) => s.scope_key === entry.scope_key)
            || (row.template_selections || []).find((s: any) => s.scope_key === entry.base_scope_key);
          return choice ? [{ ...choice, scope_key: entry.scope_key }] : [];
        });
      rows.push({ ...row, template_selections: displaySelections, match_result: match, data_rework_open, report_rework, metadata_synced });
    }
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

/**
 * 保存一条“报告范围格子 → 原始记录 → 项目模板”的人工选择。
 * 同一 record_data_id 可在不同 scope_key 下选择不同项目模板，避免一份原始记录对应多个报告模板时互相覆盖。
 */
router.put('/requisitions/:id/template-selection', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const scopeKey = String(req.body?.scope_key || '').trim();
  const recordDataId = Number(req.body?.record_data_id);
  const projectTemplateId = Number(req.body?.project_template_id);
  if (!Number.isFinite(id) || !scopeKey || !Number.isFinite(recordDataId) || !Number.isFinite(projectTemplateId)) {
    res.status(400).json({ error: 'scope_key / record_data_id / project_template_id 必填' });
    return;
  }
  try {
    const rqRes = await pool.query('SELECT * FROM report_requisitions WHERE id=$1', [id]);
    if (!rqRes.rows.length) { res.status(404).json({ error: '取号单不存在' }); return; }
    const row = rqRes.rows[0];
    const currentMatch = await matchRequisitionWithOrderScope(
      row, Array.isArray(row.template_selections) ? row.template_selections : [],
    );
    const entry = currentMatch.find(m => m.scope_key === scopeKey);
    const assignment = entry?.assignments?.find((a: any) => Number(a.record_data_id) === recordDataId);
    const candidate = assignment?.project_template_candidates?.find((c: any) => Number(c.id) === projectTemplateId);
    if (!entry || !assignment || !candidate) {
      res.status(409).json({ error: '所选项目模板与该报告范围或原始记录的关联关系不一致，请刷新后重选' });
      return;
    }
    const now = new Date().toISOString();
    const actor = readActor(req);
    const old = Array.isArray(row.template_selections) ? row.template_selections : [];
    const next = old.filter((x: any) =>
      !(String(x.scope_key) === scopeKey && Number(x.record_data_id) === recordDataId));
    next.push({
      scope_key: scopeKey,
      record_data_id: recordDataId,
      project_template_id: projectTemplateId,
      project_template_version_id: candidate.version_id,
      selected_at: now,
      selected_by: actor,
    });
    const match = await matchRequisitionWithOrderScope(row, next);
    await pool.query(
      `UPDATE report_requisitions
          SET template_selections=$2::jsonb, match_result=$3::jsonb,
              generation_configured_at=NULL, generation_configured_by=NULL, updated_at=NOW()
        WHERE id=$1`,
      [id, JSON.stringify(next), JSON.stringify(match)],
    );
    res.json({ ok: true, template_selections: next, match_result: match });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

/**
 * 确认本次报告配置。每个可用的“样品 × 项目”都必须明确选择「纳入」或「不纳入」；
 * 纳入时还必须选择一份与该原始记录关联且已生效的项目模板。
 */
router.put('/requisitions/:id/generation-config', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const requested = Array.isArray(req.body?.assignments) ? req.body.assignments : null;
  if (!Number.isFinite(id) || !requested) { res.status(400).json({ error: 'assignments 必填' }); return; }
  try {
    const found = await pool.query('SELECT * FROM report_requisitions WHERE id=$1', [id]);
    if (!found.rows.length) { res.status(404).json({ error: '取号单不存在' }); return; }
    const row = found.rows[0];
    if (row.report_id && !row.stale) { res.status(409).json({ error: '该报告已生成；如需调整范围或模板，请先发起重新生成' }); return; }
    const freshMatch = await matchRequisitionWithOrderScope(row, []);
    const configurable = freshMatch.filter((entry: any) => entry.status === 'matched'
      && entry.assignments.some((a: any) => a.record_data_status === 'reviewed'));
    const byScope = new Map(requested.map((a: any) => [String(a?.scope_key || ''), a]));
    if (byScope.size !== requested.length || configurable.some((entry: any) => !byScope.has(String(entry.scope_key)))) {
      res.status(400).json({ error: '请对每个已审核的样品和项目明确选择“纳入”或“不纳入”' }); return;
    }
    const selections: any[] = [];
    for (const entry of configurable) {
      const choice: any = byScope.get(String(entry.scope_key));
      const enabled = choice?.enabled !== false;
      if (!enabled) {
        selections.push({ scope_key: entry.scope_key, enabled: false });
        continue;
      }
      const recordDataId = Number(choice?.record_data_id);
      const projectTemplateId = Number(choice?.project_template_id);
      const assignment = entry.assignments.find((a: any) => Number(a.record_data_id) === recordDataId && a.record_data_status === 'reviewed');
      const candidate = assignment?.project_template_candidates?.find((c: any) => Number(c.id) === projectTemplateId);
      if (!assignment || !candidate) {
        res.status(400).json({ error: `“${entry.sample_name} · ${entry.project_name}”未选择有效的项目模板` }); return;
      }
      selections.push({
        scope_key: entry.scope_key, enabled: true, record_data_id: recordDataId,
        project_template_id: projectTemplateId, project_template_version_id: candidate.version_id,
      });
    }
    if (!selections.some(x => x.enabled)) { res.status(400).json({ error: '请至少纳入一个已审核项目后再生成报告' }); return; }
    const actor = readActor(req);
    const now = new Date().toISOString();
    selections.forEach(s => { s.selected_at = now; s.selected_by = actor; });
    const match = await matchRequisitionWithOrderScope(row, selections);
    await pool.query(
      `UPDATE report_requisitions
          SET template_selections=$2::jsonb, match_result=$3::jsonb,
              generation_configured_at=NOW(), generation_configured_by=$4, updated_at=NOW()
        WHERE id=$1`,
      [id, JSON.stringify(selections), JSON.stringify(match), actor],
    );
    res.json({ ok: true, template_selections: selections, match_result: match, generation_configured_at: now, generation_configured_by: actor });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

/**
 * 按取号单当前可用范围直接生成报告；assignments 可选，用于调整范围或覆盖默认模板。
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
    const ord = await pool.query('SELECT customer_name, received_at, payload FROM work_orders WHERE order_no=$1', [order_no]);
    const coverTemplate = await pool.query('SELECT host_manufacturer_id FROM report_templates WHERE id=$1', [cover_template_id]);
    const coverManufacturerId = coverTemplate.rows[0]?.host_manufacturer_id;
    const customer_name = ord.rows[0]?.customer_name || '';
    const received_at = ord.rows[0]?.received_at || '';
    // 首页草稿 carry-over：本订单若有文员编辑过的首页草稿，取其已编辑 cover groups，
    // 套用到每份取号报告的首页（结构/样式/手改值 carry，binding/结论按各报告 scope 重解析）。
    const draftRes = await pool.query(
      'SELECT content_doc FROM reports WHERE order_no=$1 AND cover_template_id=$2 AND is_cover_draft=true LIMIT 1', [order_no, cover_template_id]);
    const coverGroupsOverride = draftRes.rows[0]?.content_doc?.cover?.groups || null;
    // 首页原样照片（image 分区存于 ctx.record_raw_data，不随 groups 走）——单独 carry
    const coverCtxPhotos = pickReportImageData(draftRes.rows[0]?.content_doc?.cover);
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
      const savedSelections = Array.isArray(row.template_selections) ? row.template_selections : [];
      const requested = Array.isArray(it.assignments) ? it.assignments : [];
      const choices = new Map<string, any>(savedSelections.map((choice: any) => [String(choice.scope_key), choice]));
      for (const choice of requested) if (choice?.scope_key) {
        const key = String(choice.scope_key);
        choices.set(key, { ...choices.get(key), ...choice });
      }
      const freshMatch = await matchRequisitionWithOrderScope(row, [...choices.values()]);
      const assignments = availableReportAssignments(freshMatch, [...choices.values()], coverManufacturerId);
      if (!assignments.length) {
        out.push({ requisition_id: row.id, ok: false, error: '当前报告范围暂无可生成的已审核记录和生效项目模板' }); continue;
      }
      // Freeze only the assignments actually used; preserve explicit exclusions for later regeneration.
      const frozenSelections = [...choices.values()].filter((choice: any) => choice.enabled === false)
        .concat(assignments.map(assignment => ({ ...assignment, selected_by: actor, selected_at: new Date().toISOString() })));
      // 文员侧锁：实验室数据退回(data_entry)未重审通过前不能重新生成（待重审后自动解锁）。
      const prevReportId: number | null = row.report_id;
      if (prevReportId && await hasOpenDataEntryRework(pool, prevReportId)) {
        out.push({ requisition_id: row.id, ok: false, locked: true, error: '实验室数据退回修改中，待重新审核通过后才能重新生成' });
        continue;
      }
      // 报告编号接口下发的是默认范围；实际取用本订单完整样品清单，按本次已选项目收敛。
      const selectedScopes = new Set(assignments.map((a: any) => String(a.scope_key)));
      const selectedMatches = freshMatch.filter((m: any) => selectedScopes.has(String(m.scope_key)));
      const scopeSamples: any[] = (Array.isArray(ord.rows[0]?.payload?.samples) ? ord.rows[0].payload.samples : [])
        .filter((s: any) => selectedMatches.some((m: any) => m.sample_external_id != null
          ? String(m.sample_external_id) === String(s?.id) : m.sample_name === s?.name));
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
        cover_ctx_photos: coverCtxPhotos, report_samples,
        report_scope_samples: Array.isArray(row.scope?.samples) ? row.scope.samples : [], actor,
      });
      // 历史版本：旧报告行保留，标记被新报告取代（superseded_by 指向新版），列表只显示当前版。
      if (prevReportId && prevReportId !== result.report_id) {
        await pool.query('UPDATE reports SET superseded_by=$2 WHERE id=$1', [prevReportId, result.report_id]);
      }
      await pool.query(
        `UPDATE report_requisitions
            SET report_id=$2, status=$3, stale=false, template_selections=$4::jsonb, updated_at=NOW()
          WHERE id=$1`,
        [row.id, result.report_id, 'generated', JSON.stringify(frozenSelections)],
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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rq = await client.query('SELECT * FROM report_requisitions WHERE id=$1 FOR UPDATE', [id]);
    if (!rq.rows.length) { res.status(404).json({ error: '取号单不存在' }); return; }
    const row = rq.rows[0];
    if (!row.report_id) { res.status(400).json({ error: '该取号单尚未生成报告，不能回传' }); return; }
    // 文员侧锁：实验室数据退回修改中（data_entry 工单未关闭）不能回传，须等数据重审通过+重新生成。
    if (await hasOpenDataEntryRework(client, row.report_id)) {
      res.status(409).json({ error: '实验室数据退回修改中，待重新审核通过并重新生成后才能回传' }); return;
    }

    const rep = await client.query('SELECT final_typst, external_status FROM reports WHERE id=$1 FOR UPDATE', [row.report_id]);
    if (!rep.rows.length || !rep.rows[0].final_typst) { res.status(400).json({ error: '报告内容缺失，无法编译 PDF' }); return; }
    if (rep.rows[0].external_status === 'external_approved') {
      res.status(409).json({ error: '报告已外部审核通过，不能再次送审' }); return;
    }
    if (row.delivery_status === 'sent' && rep.rows[0].external_status === 'submitted_external') {
      res.status(409).json({ error: '报告已送审，请勿重复送审' }); return;
    }

    const compiled = await compileTypst(rep.rows[0].final_typst);
    const pdfBase64 = Buffer.from(compiled.pdf).toString('base64');
    // 操作人工号 JobNo（接口1.4 第三参）：取当前登录账号工号（X-User-Job 头，即谁点的回传）
    const jobNo = readJobNo(req);
    const result = await submitReportToDiGui(row.sys_number, pdfBase64, jobNo);

    await client.query(
      `UPDATE report_requisitions
         SET delivery_status=$2, delivered_at=CASE WHEN $2='sent' THEN NOW() ELSE delivered_at END,
             delivery_error=$3, updated_at=NOW()
       WHERE id=$1`,
      [id, result.ok ? 'sent' : 'failed', result.ok ? null : (result.error || '回传失败')],
    );
    if (!result.ok) { await client.query('COMMIT'); res.status(502).json({ ok: false, error: result.error || '回传失败' }); return; }
    // 回传成功 → 报告进入"已回传外部待审"态（P-Flow-2 状态机起点）
    await client.query(`UPDATE reports SET external_status='submitted_external', stale=false WHERE id=$1`, [row.report_id]);
    // 若本报告处于"报告退回(scope=report)"修改态：送审即视为已处理，关闭工单 + 清取号单 stale → 回到终态。
    await client.query(
      `UPDATE rework_tickets SET status='resolved', resolved_at=NOW(),
         resolution_note=COALESCE(resolution_note, '报告已修改并重新送审')
       WHERE report_id=$1 AND scope='report' AND status <> 'resolved'`,
      [row.report_id],
    );
    await client.query("UPDATE report_requisitions SET stale=false, record_state='审核中', updated_at=NOW() WHERE id=$1", [id]);
    await client.query('COMMIT');
    res.json({ ok: true, ref: result.ref });
  } catch (e: any) {
    await client.query('ROLLBACK').catch(() => {});
    await pool.query('UPDATE report_requisitions SET delivery_status=$2, delivery_error=$3, updated_at=NOW() WHERE id=$1',
      [id, 'failed', e?.message || String(e)]).catch(() => {});
    res.status(500).json({ error: e?.message || String(e) });
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
});

/**
 * 撤回送审：仅允许撤回“已回传、外部尚未审核通过”的报告。
 * 撤回后恢复为可编辑/可重新生成/可再次送审；已外部审核通过的报告是终态，不允许撤回。
 *
 * 先调用业务系统 CancelFlowFromDiGui(sysNumber, jobNo)。仅当其同步回执为
 * { Msg: 'OK', RecordState: '草稿' } 才更新本地；任何远端失败都保留“已送审”状态。
 */
router.post('/requisitions/:id/withdraw-delivery', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: '非法取号单 id' }); return; }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rq = await client.query(
      `SELECT rq.*, r.external_status
         FROM report_requisitions rq
         LEFT JOIN reports r ON r.id=rq.report_id
        WHERE rq.id=$1
        FOR UPDATE OF rq`,
      [id],
    );
    if (!rq.rows.length) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: '取号单不存在' });
      return;
    }
    const row = rq.rows[0];
    if (!row.report_id) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: '该取号单尚未生成报告' });
      return;
    }
    if (row.external_status === 'external_approved') {
      await client.query('ROLLBACK');
      res.status(409).json({ error: '报告已经外部审核通过，不能撤回送审' });
      return;
    }
    if (row.delivery_status !== 'sent') {
      await client.query('ROLLBACK');
      res.status(409).json({ error: '该报告当前不是已送审状态，无需撤回' });
      return;
    }
    if (row.external_status === 'external_revision') {
      await client.query('ROLLBACK');
      res.status(409).json({ error: '该报告已被外部退回，请完成修改后重新送审，无需撤回' });
      return;
    }
    // 远端撤回必须先成功。本事务持有该取号单行锁，避免用户在撤回响应返回前再次送审或并发撤回。
    const jobNo = readJobNo(req);
    const remote = await cancelReportFlowFromDiGui(row.sys_number, jobNo);
    if (!remote.ok) {
      await client.query('ROLLBACK');
      res.status(502).json({
        ok: false,
        error: remote.error || '业务系统撤回失败',
        record_state: remote.recordState || null,
      });
      return;
    }
    await client.query(
      `UPDATE report_requisitions
          SET delivery_status='none', delivered_at=NULL, delivery_error=NULL,
              record_state=$2, updated_at=NOW()
        WHERE id=$1`,
      [id, remote.recordState],
    );
    await client.query(
      `UPDATE reports
          SET external_status='none', external_ref=NULL, external_feedback_at=NULL, stale=false
        WHERE id=$1`,
      [row.report_id],
    );
    await client.query(
      `INSERT INTO report_audit_log (report_id, action, actor_name, diff, note)
       VALUES ($1,'edit',$2,'[]'::jsonb,$3)`,
      [row.report_id, readActor(req), `外部撤回送审成功，状态：${remote.recordState}${remote.receipt ? `；回执：${remote.receipt.slice(0, 500)}` : ''}`],
    );
    await client.query('COMMIT');
    res.json({
      ok: true,
      record_state: remote.recordState,
      receipt: remote.receipt,
    });
  } catch (e: any) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: e?.message || String(e) });
  } finally {
    client.release();
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
    // 定位报告：report_id > report_no > sys_number(经 requisition)。外部结论只能作用于
    // 已由本系统成功送审、当前正等待回执的报告，不能把任意历史报告直接“审核通过”。
    let rep: any = null;
    const reportSelect = `SELECT r.id, r.order_no, r.report_no, r.external_status, rq.delivery_status
      FROM reports r LEFT JOIN report_requisitions rq ON rq.report_id=r.id`;
    if (fb.report_id) rep = (await client.query(`${reportSelect} WHERE r.id=$1`, [fb.report_id])).rows[0];
    if (!rep && fb.report_no) rep = (await client.query(`${reportSelect} WHERE r.report_no=$1 ORDER BY r.id DESC LIMIT 1`, [fb.report_no])).rows[0];
    if (!rep && fb.sys_number) {
      const rq = await client.query('SELECT report_id FROM report_requisitions WHERE sys_number=$1', [fb.sys_number]);
      const rid = rq.rows[0]?.report_id;
      if (rid) rep = (await client.query(`${reportSelect} WHERE r.id=$1`, [rid])).rows[0];
    }
    if (!rep) { res.status(404).json({ error: '未找到对应报告（report_id/report_no/sys_number 都定位不到，或报告尚未生成）' }); return; }
    if (rep.delivery_status !== 'sent' || rep.external_status !== 'submitted_external') {
      res.status(409).json({ error: '该报告尚未由本系统送审，或当前不在等待外部回执状态；已忽略该外部结论' });
      return;
    }

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
