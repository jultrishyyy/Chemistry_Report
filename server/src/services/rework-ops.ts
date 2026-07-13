/**
 * 退回 / 返工的写操作原语（均在调用方已 BEGIN 的事务内执行）。
 *
 * 把"退回到录入"与"退回报告修改"的状态机收敛到一处，供三个入口复用、避免拷贝漂移：
 *   - routes/rework.ts        场景1：文员在报告生成时退回原始记录（report_gen → data_entry）
 *   - routes/external.ts 1.3  外部审核退回（SyncReportModifyInfo，ModifyType=data_entry / report_edit）
 *   - routes/external.ts 回执  外部报告回执（report-feedback：approved / needs_revision）
 *
 * 闭环依赖既有机制（不在此重复实现）：
 *   - record_data 的 rejected 流：重录→提交→重审 approve 时，record-data.ts 自动把
 *     引用该记录的报告置 stale + 自动 resolve 对应 data_entry 工单。
 *   - 报告重新生成（external/requisitions/generate）会回填新 report_id 并清 requisition.stale。
 */
import type { PoolClient } from 'pg';

/** 退回涉及的报告最小信息。data_entry 退回需要 record_data_ids。 */
export interface ReportRef {
  id: number;
  order_no: string;
  report_no?: string | null;
  record_data_ids?: number[] | null;
}

/**
 * 把一条 record_data 置退回态（rejected，可重录）+ 写一条 reject 审计快照。
 * 复用 record_data 既有 rejected 流：版本+1、清审核人、报告侧重审通过后自动 stale + 自动关单。
 * @param notePrefix 标明退回来源（如 `[报告退回]` / `[外部退回]`），拼到 reject_note 前。
 * @returns 是否命中记录。
 */
export async function rejectRecordForRework(
  client: PoolClient,
  recordId: number,
  opts: { reason: string; actorName: string; actorRole?: string | null; notePrefix?: string },
): Promise<boolean> {
  const rd = await client.query(
    'SELECT id, order_no, raw_data, derived_data, current_version FROM record_data WHERE id = $1',
    [recordId],
  );
  if (!rd.rows.length) return false;
  const row = rd.rows[0];
  const nextVersion = (row.current_version || 1) + 1;
  const prefix = opts.notePrefix ? `${opts.notePrefix} ` : '';
  await client.query(
    `UPDATE record_data SET audit_status = 'rejected', reject_note = $1,
       reviewer_name = NULL, reviewed_at = NULL, current_version = $2, updated_at = NOW()
     WHERE id = $3`,
    [`${prefix}${opts.reason}`, nextVersion, recordId],
  );
  await client.query(
    `INSERT INTO record_audit_log
       (record_id, order_no, action, actor_name, actor_role, note, version_no, data_snapshot, status_after)
     VALUES ($1,$2,'reject',$3,$4,$5,$6,$7::jsonb,'rejected')`,
    [row.id, row.order_no, opts.actorName, opts.actorRole || 'report_clerk', opts.reason, nextVersion,
     JSON.stringify({ ...(row.raw_data || {}), ...(row.derived_data || {}) })],
  );
  return true;
}

/** 报告置"外部退回-待修改"态：external_status=external_revision + stale，并把其取号单也置 stale。 */
async function markReportRevision(
  client: PoolClient,
  report: ReportRef,
  opts: { suggestion?: string | null; externalRef?: string | null },
): Promise<void> {
  await client.query(
    `UPDATE reports SET external_status='external_revision', stale=true,
       external_ref=$2, external_suggestion=$3, external_feedback_at=NOW() WHERE id=$1`,
    [report.id, opts.externalRef || null, opts.suggestion || null],
  );
  await client.query('UPDATE report_requisitions SET stale=true, updated_at=NOW() WHERE report_id=$1', [report.id]);
}

/**
 * 退回给文员修改报告（接口1.3 ModifyType=report_edit / 外部回执 needs_revision）。
 * 报告置修改态 + 建 scope=report 返工工单。文员在工作台处理（改报告 / 升级到录入 / 驳回），
 * 处理完手动关单（POST /api/rework/:id/resolve），改完重走 1.4 回传。
 * @returns 新建的返工工单行。
 */
export async function returnReportForEdit(
  client: PoolClient,
  report: ReportRef,
  opts: { reason: string; suggestion?: string | null; externalRef?: string | null; raisedByName: string; raisedByRole?: string | null },
): Promise<any> {
  await markReportRevision(client, report, opts);
  const t = await client.query(
    `INSERT INTO rework_tickets
       (order_no, scope, report_id, origin_stage, target_stage, raised_by_name, raised_by_role, reason, suggestion, external_ref, status)
     VALUES ($1,'report',$2,'external','report_gen',$3,$4,$5,$6,$7,'open') RETURNING *`,
    [report.order_no, report.id, opts.raisedByName, opts.raisedByRole || 'external',
     opts.reason, opts.suggestion || null, opts.externalRef || null],
  );
  return t.rows[0];
}

/**
 * 退回给实验室工程师重录数据（接口1.3 ModifyType=data_entry）。
 * 因 1.3 只给 SysNumber（整份报告），故把该报告用到的【全部】record_data 一起置退回态，
 * 各建一张 scope=record / target=data_entry 工单（重审通过自动关单 + 自动把报告 stale）。
 * 报告同时置修改态。后续：重录→重审→报告 stale→文员重新生成→重回传，闭环复用既有流程。
 * @returns { rejected_record_ids, tickets }
 */
export async function returnReportToDataEntry(
  client: PoolClient,
  report: ReportRef,
  opts: { reason: string; suggestion?: string | null; externalRef?: string | null; actorName: string; actorRole?: string | null },
): Promise<{ rejected_record_ids: number[]; tickets: any[] }> {
  const ids = Array.isArray(report.record_data_ids)
    ? report.record_data_ids.filter((n): n is number => typeof n === 'number')
    : [];
  const rejected: number[] = [];
  const tickets: any[] = [];
  for (const rid of ids) {
    const ok = await rejectRecordForRework(client, rid, {
      reason: opts.reason, actorName: opts.actorName, actorRole: opts.actorRole, notePrefix: '[外部退回]',
    });
    if (!ok) continue;
    rejected.push(rid);
    const t = await client.query(
      `INSERT INTO rework_tickets
         (order_no, scope, record_data_id, report_id, origin_stage, target_stage, raised_by_name, raised_by_role, reason, suggestion, external_ref, status)
       VALUES ($1,'record',$2,$3,'external','data_entry',$4,$5,$6,$7,$8,'open') RETURNING *`,
      [report.order_no, rid, report.id, opts.actorName, opts.actorRole || 'external',
       opts.reason, opts.suggestion || null, opts.externalRef || null],
    );
    tickets.push(t.rows[0]);
  }
  await markReportRevision(client, report, opts);
  return { rejected_record_ids: rejected, tickets };
}

/**
 * 外部审批通过：报告置 external_approved（签发完成，终态）。
 * 终态含义：① 不再是"待重新生成"（stale=false）；② 关闭该报告仍未关闭的报告级返工工单
 * （若曾退回过、外部又直接放通过，工单一并收尾，避免挂死）。
 * 供接口 1.3（RecordState=审核通过）与外部回执 report-feedback 共用（单一事实来源）。
 */
export async function markReportApproved(
  client: PoolClient,
  reportId: number,
  opts: { externalRef?: string | null },
): Promise<void> {
  await client.query(
    `UPDATE reports SET external_status='external_approved', external_ref=$2,
       external_feedback_at=NOW(), external_suggestion=NULL, stale=false WHERE id=$1`,
    [reportId, opts.externalRef || null],
  );
  await client.query(
    `UPDATE rework_tickets SET status='resolved', resolved_at=NOW(),
       resolution_note=COALESCE(resolution_note, '外部审核通过')
     WHERE report_id=$1 AND scope='report' AND status <> 'resolved'`,
    [reportId],
  );
}
