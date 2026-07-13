import pg from 'pg';
import { fetchExternalOrders } from './external-orders.js';

/**
 * 把【外部订单接口】(services/external-orders.ts) 返回的委托单同步到 work_orders 表。
 *
 * 现在是启动时跑一次的 seed；真实接入外部系统后，这里就是"同步作业"的落点
 * （可改为定时轮询 / 订阅回调，逻辑不变）。
 *
 * 幂等：已存在的单【跳过】，不覆盖——保护工程师已设置的 test_infos[].linked_template_id
 * 关联状态和已录入的数据。需要重置 mock 数据时走专门脚本，不在启动时清。
 */
export async function seedWorkOrders(pool: pg.Pool): Promise<void> {
  const orders = await fetchExternalOrders();
  for (const o of orders) {
    const existing = await pool.query('SELECT order_no FROM work_orders WHERE order_no = $1', [o.order_no]);
    if (existing.rows.length) {
      console.log(`[seed] skip work_order "${o.order_no}" (exists)`);
      continue;
    }
    const payload = { samples: o.samples, ...(o.meta ? { meta: o.meta } : {}) };
    await pool.query(
      `INSERT INTO work_orders (order_no, customer_name, received_at, payload, source)
       VALUES ($1, $2, $3, $4::jsonb, 'external')`,
      [o.order_no, o.customer_name, o.received_at, JSON.stringify(payload)]
    );
    console.log(`[seed] inserted work_order "${o.order_no}"`);
  }
}
