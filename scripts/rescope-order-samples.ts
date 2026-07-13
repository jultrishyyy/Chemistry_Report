/**
 * rescope-order-samples.ts — 修复【已生成报告】首页「样品信息表」列出整单全部样品的历史脏数据。
 *
 * 背景：早期版本 buildReportTypst 未按本报告 scope 收敛 ctx.order_samples，导致拆单报告首页列出整单所有样品。
 *   新版已修复（按各 assignment 原始记录 sample_external_id 过滤），但【已生成】报告的 content_doc 仍冻结着旧的
 *   全量 order_samples；且这些报告多为 edited=true，refresh-reports.ts 默认跳过、--force 又会丢项目段手改。
 *
 * 本脚本【只】重算 ctx.order_samples 并重渲染 final_typst，**不动** content_doc 的分组结构/字段值/手改字面量，
 *   因此首页图片、项目段手改全部保留——只把样品信息表收敛到本报告自己的样品。
 *
 * 重算口径与 buildReportTypst 一致：scope.record_data_ids → record_data.sample_external_id → 过滤 work_orders.payload.samples
 *   （按样品 id 或 name 匹配；匹配不到任何样品则保底不过滤，避免清空）。
 *
 * 用法：
 *   pnpm tsx scripts/rescope-order-samples.ts                 # 修全部脏数据报告
 *   pnpm tsx scripts/rescope-order-samples.ts <order_no>      # 只修某订单
 *   pnpm tsx scripts/rescope-order-samples.ts [order_no] --dry-run   # 只看会改哪些、不写库
 */
import { pool } from '../server/src/db.js';
import { renderContentDoc } from '../shared/typst-generator.js';

type Sample = { no: string; name: string; sort_no?: string; model?: string; barcode?: string; id?: string };

/** 重算本报告 scope 内的样品清单（与 buildReportTypst 同口径）。 */
async function scopedSamplesFor(orderNo: string, recIds: number[]): Promise<Sample[]> {
  const wo = await pool.query('SELECT payload FROM work_orders WHERE order_no = $1', [orderNo]);
  const payload = wo.rows[0]?.payload || {};
  const all: Sample[] = (Array.isArray(payload.samples) ? payload.samples : []).map((smp: any, i: number) => ({
    no: String(smp.sort_no ?? i + 1), name: smp.name ?? '',
    sort_no: smp.sort_no != null ? String(smp.sort_no) : '', model: smp.model ?? '', barcode: smp.barcode ?? '',
    id: smp.id != null ? String(smp.id) : undefined,
  }));
  if (!all.length) return all;

  const keys = new Set<string>();
  if (recIds.length) {
    const rd = await pool.query('SELECT id, sample_external_id FROM record_data WHERE id = ANY($1)', [recIds]);
    for (const row of rd.rows) {
      const sid = row.sample_external_id;
      if (sid != null && String(sid) !== '') keys.add(String(sid));
    }
  }
  if (!keys.size) return all; // 无法判定 → 保底不过滤
  const scoped = all.filter(s => keys.has(String(s.id ?? '')) || keys.has(String(s.name ?? '')));
  return scoped.length ? scoped : all; // 匹配不到 → 保底不过滤
}

function patchCtxOrderSamples(doc: any, samples: Sample[]): boolean {
  if (!doc) return false;
  let changed = false;
  const apply = (ctx: any) => {
    if (ctx && typeof ctx === 'object') {
      const before = JSON.stringify(ctx.order_samples ?? null);
      ctx.order_samples = samples;
      if (JSON.stringify(samples) !== before) changed = true;
    }
  };
  apply(doc.cover?.ctx);
  apply(doc.front_cover?.ctx);
  for (const p of (doc.projects || [])) apply(p?.ctx);
  return changed;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const orderNo = args.find(a => !a.startsWith('--')) || null;

  const where = ['is_cover_draft = false', 'content_doc IS NOT NULL'];
  const params: any[] = [];
  if (orderNo) { params.push(orderNo); where.push(`order_no = $${params.length}`); }
  const { rows } = await pool.query(
    `SELECT id, order_no, report_no, scope, content_doc, content_doc_original
       FROM reports WHERE ${where.join(' AND ')} ORDER BY id`, params);

  console.log(`[rescope] 命中 ${rows.length} 份报告${orderNo ? `（订单 ${orderNo}）` : ''}${dryRun ? '（dry-run，不写库）' : ''}`);
  let fixed = 0, skipped = 0, failed = 0;

  for (const r of rows) {
    const tag = r.report_no || `#${r.id}`;
    try {
      const recIds: number[] = r.scope?.record_data_ids || [];
      const samples = await scopedSamplesFor(r.order_no, recIds);
      const curLen = r.content_doc?.cover?.ctx?.order_samples?.length ?? 0;

      const doc = r.content_doc;
      const orig = r.content_doc_original;
      const c1 = patchCtxOrderSamples(doc, samples);
      const c2 = patchCtxOrderSamples(orig, samples);
      if (!c1 && !c2) { skipped++; continue; }

      const finalTypst = renderContentDoc(doc);
      console.log(`  ${dryRun ? '· 待修' : '✓ 修复'} ${tag}: order_samples ${curLen} → ${samples.length}（${samples.map(s => s.name).join('、')}）`);
      if (!dryRun) {
        await pool.query(
          `UPDATE reports SET content_doc = $1::jsonb, content_doc_original = $2::jsonb, final_typst = $3 WHERE id = $4`,
          [JSON.stringify(doc), JSON.stringify(orig), finalTypst, r.id]);
      }
      fixed++;
    } catch (e: any) {
      console.log(`  ✗ 失败 ${tag}：${e?.message || e}`); failed++;
    }
  }
  console.log(`[rescope] 完成：${dryRun ? '待修' : '已修'} ${fixed}，跳过(无需改) ${skipped}，失败 ${failed}`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
