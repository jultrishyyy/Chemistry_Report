/**
 * 退回 / 返工工单 + 全订单时间线（P-Flow-1）
 *
 * 统一三类"发现错误 → 退回上游修改"为一张 rework_tickets 表（见 migration 020）。
 * 本期落地场景 1：报告生成时文员发现原始记录有错 → 退回录入主检。
 *
 * 工单只记"退到哪、为什么"；"具体改了什么"复用 record_audit_log / report_audit_log，
 * 时间线把三者按 order_no + 时间合并成一条"自始至终谁改了哪里、为什么"的链。
 *
 * 挂载点：app.use('/api', reworkRouter) —— 提供 /api/rework* 与 /api/orders/:order_no/timeline。
 */
import { Router, Request, Response } from 'express';
import { readActor } from '../services/template-versions.js';
import { rejectRecordForRework } from '../services/rework-ops.js';
import { requirePermission } from './auth.js';

import { pool } from '../db.js';

const router = Router();

/** 列工单：?order_no= &target_stage= &status= &scope= 任意组合过滤 */
router.get('/rework', async (req: Request, res: Response) => {
  const { order_no, target_stage, status, scope } = req.query as Record<string, string>;
  const where: string[] = [];
  const params: any[] = [];
  for (const [col, val] of [['order_no', order_no], ['target_stage', target_stage], ['status', status], ['scope', scope]] as const) {
    if (val) { params.push(val); where.push(`${col} = $${params.length}`); }
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const r = await pool.query(`SELECT * FROM rework_tickets ${whereSql} ORDER BY created_at DESC`, params);
  res.json(r.rows);
});

/**
 * 建工单（场景 1：报告 → 录入退回）。
 * body: { order_no, scope='record', record_data_id, origin_stage='report_gen',
 *         target_stage='data_entry', reason, suggestion?, report_id? }
 *
 * scope=record + target=data_entry 时连带把该 record_data 置为退回态（复用现有 rejected 流），
 * 并写一条 record_audit_log，使其同时出现在主检的「待返工」与全订单时间线里。
 */
router.post('/rework', requirePermission('report.generate'), async (req: Request, res: Response) => {
  const actor = readActor(req as any);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  const {
    order_no, scope = 'record', record_data_id, report_id,
    origin_stage = 'report_gen', target_stage = 'data_entry',
    reason, suggestion, external_ref, parent_ticket_id,
  } = req.body || {};
  if (!order_no) { res.status(400).json({ error: 'order_no 必填' }); return; }
  if (scope === 'record' && !record_data_id) { res.status(400).json({ error: 'scope=record 时 record_data_id 必填' }); return; }
  if (!reason || !String(reason).trim()) { res.status(400).json({ error: '退回必须填写原因' }); return; }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO rework_tickets
         (order_no, scope, record_data_id, report_id, origin_stage, target_stage,
          raised_by_name, raised_by_role, reason, suggestion, external_ref, parent_ticket_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [order_no, scope, record_data_id || null, report_id || null, origin_stage, target_stage,
       actor.name, actor.role || null, reason, suggestion || null, external_ref || null, parent_ticket_id || null]
    );

    // scope=record + 退回录入：把记录置退回态 + 留痕，主检在 /lab 看到待返工（与外部 1.3 data_entry 共用原语）
    if (scope === 'record' && target_stage === 'data_entry' && record_data_id) {
      await rejectRecordForRework(client, record_data_id, {
        reason, actorName: actor.name, actorRole: actor.role || 'report_clerk', notePrefix: '[报告退回]',
      });
    }
    await client.query('COMMIT');
    res.status(201).json(ins.rows[0]);
  } catch (e: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

/** 解决工单 */
router.post('/rework/:id/resolve', requirePermission('record.entry'), async (req: Request, res: Response) => {
  const actor = readActor(req as any);
  if (!actor.name) { res.status(401).json({ error: '未登录' }); return; }
  const { resolution_note } = req.body || {};
  const r = await pool.query(
    `UPDATE rework_tickets SET status = 'resolved', resolved_by_name = $1, resolved_at = NOW(),
       resolution_note = $2 WHERE id = $3 AND status <> 'resolved' RETURNING *`,
    [actor.name, resolution_note || null, Number(req.params.id)]
  );
  if (!r.rows.length) { res.status(404).json({ error: '工单不存在或已解决' }); return; }
  res.json(r.rows[0]);
});

/**
 * 全订单时间线：把 rework_tickets + record_audit_log + report_audit_log
 * 按时间合并成一条统一链路（谁在哪阶段、因为什么、改了哪里）。
 */
router.get('/orders/:order_no/timeline', async (req: Request, res: Response) => {
  const order_no = req.params.order_no;
  const [ticketsR, recAuditR, repAuditR] = await Promise.all([
    pool.query(`SELECT * FROM rework_tickets WHERE order_no = $1`, [order_no]),
    pool.query(`SELECT * FROM record_audit_log WHERE order_no = $1`, [order_no]),
    pool.query(
      `SELECT ra.*, r.report_no FROM report_audit_log ra
         JOIN reports r ON r.id = ra.report_id
        WHERE r.order_no = $1`, [order_no]
    ),
  ]);
  const events = [
    ...ticketsR.rows.map(t => ({
      type: 'rework' as const, ts: t.created_at, actor: t.raised_by_name, role: t.raised_by_role,
      title: `返工工单 #${t.id}：${t.origin_stage} → ${t.target_stage}`,
      detail: t.reason || t.suggestion || '', status: t.status, ref: t,
    })),
    ...recAuditR.rows.map(a => ({
      type: 'record_audit' as const, ts: a.created_at, actor: a.actor_name, role: a.actor_role,
      title: `录入数据·${a.action}（v${a.version_no} → ${a.status_after}）`,
      detail: a.note || '', record_id: a.record_id, ref: a,
    })),
    ...repAuditR.rows.map(a => ({
      type: 'report_audit' as const, ts: a.created_at, actor: a.actor_name, role: null,
      title: `报告·${a.action}${a.report_no ? `（${a.report_no}）` : ''}`,
      detail: a.note || (Array.isArray(a.diff) ? `${a.diff.length} 处改动` : ''), report_id: a.report_id, ref: a,
    })),
  ].sort((x, y) => new Date(x.ts).getTime() - new Date(y.ts).getTime());
  res.json({ order_no, events });
});

export default router;
