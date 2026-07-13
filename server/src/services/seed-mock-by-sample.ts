import pg from 'pg';
import { matchRequisitionScope } from './external-report-info.js';

const SRC = 'MOCK-EXT-001';   // 现有"整单出一份"的演示订单
const DST = 'MOCK-EXT-002';   // 新增"按样品出"的演示订单

/**
 * 演示用 seed：把"整单出一份"的 MOCK-EXT-001 复制成"按样品出"的 MOCK-EXT-002。
 *  - 委托单 / 原始记录 / 样品 / 测试项目【完全一样】（只把 id 里的 MOCK-EXT-001 → MOCK-EXT-002）；
 *  - 取号报告（report_requisitions）改为【每个样品一份】（scope 只含该样品），status=pending；
 *    文员在「生成报告」详情页可对每份单独补齐 / 生成 / 编辑 / 送审。
 * 幂等：DST 已存在则跳过；源单 SRC 不存在（如全新库未跑过演示）则跳过、不报错。
 * 仅供演示——只让这个订单出现在「生成报告」流程里。
 */
export async function seedMockBySample(pool: pg.Pool): Promise<void> {
  const exists = await pool.query('SELECT 1 FROM work_orders WHERE order_no = $1', [DST]);
  if (exists.rows.length) { console.log(`[seed] skip ${DST} (exists)`); return; }
  const src = await pool.query('SELECT 1 FROM work_orders WHERE order_no = $1', [SRC]);
  if (!src.rows.length) { console.log(`[seed] skip ${DST} (source ${SRC} not present)`); return; }

  // 1) 复制委托单：order_no 换新；payload 里的样品 id/barcode 整体把 SRC → DST
  await pool.query(
    `INSERT INTO work_orders (order_no, customer_name, received_at, payload, source)
     SELECT $1, customer_name, received_at, replace(payload::text, $2, $1)::jsonb, source
     FROM work_orders WHERE order_no = $2`,
    [DST, SRC],
  );

  // 2) 复制原始记录：order_no + sample_external_id 同样替换；保留 reviewed 等全部内容（不含自增 id）
  await pool.query(
    `INSERT INTO record_data
       (template_id, template_version, raw_data, derived_data, ad_hoc_fields, submitted_by, submitted_at,
        attachments, order_no, sample_external_id, test_item_name, tester_name, tested_at,
        reviewer_name, reviewed_at, audit_status, current_version, reject_note, template_version_id)
     SELECT template_id, template_version, raw_data, derived_data, ad_hoc_fields, submitted_by, submitted_at,
        attachments, $1, replace(sample_external_id, $2, $1), test_item_name, tester_name, tested_at,
        reviewer_name, reviewed_at, audit_status, current_version, reject_note, template_version_id
     FROM record_data WHERE order_no = $2`,
    [DST, SRC],
  );

  // 3) 按样品出：每个样品一份取号报告（pending + 匹配结果），文员去生成/编辑
  const wo = await pool.query('SELECT payload FROM work_orders WHERE order_no = $1', [DST]);
  const samples: any[] = Array.isArray(wo.rows[0]?.payload?.samples) ? wo.rows[0].payload.samples : [];
  let i = 0;
  for (const sample of samples) {
    i++;
    const scope = { samples: [sample] };
    const match = await matchRequisitionScope(pool, DST, scope);
    await pool.query(
      `INSERT INTO report_requisitions
         (order_no, sys_number, report_number, check_code, sample_name, scope, match_result, status)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,'pending')
       ON CONFLICT (sys_number) DO NOTHING`,
      [DST, `${DST}-S${i}`, `${DST}-${sample.sort_no || `S${i}`}`, String(900010 + i),
       sample.name || null, JSON.stringify(scope), JSON.stringify(match)],
    );
  }
  console.log(`[seed] created ${DST} (by-sample, ${samples.length} reports)`);
}
