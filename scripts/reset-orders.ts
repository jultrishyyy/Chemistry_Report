/**
 * 一次性清理委托单及其关联数据（清掉演示期的伪造订单）。
 *
 * 用法：
 *   pnpm tsx scripts/reset-orders.ts                  # 清掉【全部】订单 + 关联数据
 *   pnpm tsx scripts/reset-orders.ts C202512086592    # 只清指定单号（可多个）
 *
 * 清理范围（按外键依赖顺序，单事务）：
 *   report_audit_log → rework_tickets → reports → report_batches →
 *   record_data（级联清 record_audit_log）→ work_orders
 *
 * ⚠️ 不可逆。record_data 永不物理删除是针对「正常业务」的约定；本脚本是
 * 演示数据重置工具，明确用于清掉 mock 单，请在确认无真实数据后手动运行。
 */
import pg from 'pg';
import { dbConfig } from '../config/index.js';

const { Pool } = pg;
const pool = new Pool({
  host: dbConfig.host,
  port: Number(dbConfig.port),
  database: dbConfig.database,
  user: dbConfig.user,
  password: dbConfig.password || undefined,
});

async function run() {
  const argOrders = process.argv.slice(2).map((s) => s.trim()).filter(Boolean);
  const client = await pool.connect();
  try {
    // 决定要清的单号
    const list = argOrders.length
      ? argOrders
      : (await client.query('SELECT order_no FROM work_orders ORDER BY order_no')).rows.map((r) => r.order_no);

    if (!list.length) {
      console.log('[reset] 没有订单需要清理。');
      return;
    }
    console.log(`[reset] 将清理 ${list.length} 张订单及其关联数据：`);
    for (const o of list) console.log(`         - ${o}`);

    await client.query('BEGIN');
    for (const orderNo of list) {
      await client.query(`DELETE FROM report_audit_log WHERE report_id IN (SELECT id FROM reports WHERE order_no = $1)`, [orderNo]);
      await client.query(`DELETE FROM rework_tickets WHERE order_no = $1`, [orderNo]);
      await client.query(`DELETE FROM reports WHERE order_no = $1`, [orderNo]);
      await client.query(`DELETE FROM report_batches WHERE order_no = $1`, [orderNo]);
      await client.query(`DELETE FROM record_data WHERE order_no = $1`, [orderNo]);
      const del = await client.query(`DELETE FROM work_orders WHERE order_no = $1`, [orderNo]);
      console.log(`[reset] ${orderNo} ✓ ${del.rowCount ? '已删除' : '（订单表无此单，仅清关联数据）'}`);
    }
    await client.query('COMMIT');
    console.log('[reset] 完成。');
  } catch (e: any) {
    await client.query('ROLLBACK');
    console.error('[reset] 失败，已回滚：', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
