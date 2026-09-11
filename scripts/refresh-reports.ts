/**
 * refresh-reports.ts — 按各报告已存的 scope 重算其实例文档（content_doc / final_typst）。
 *
 * 用途：修复【已经生成】的报告里冻结的过期内容——尤其首页「样品信息」之前会列出整单所有样品，
 * 本脚本用各报告自己的 scope 重跑 buildReportTypst（首页结构/图片沿用其 content_doc.cover.groups），
 * 让 ctx.order_samples 收敛到本报告样品、首页检测结论表按本报告项目重算。
 *
 * ⚠️ 与「调整样品/项目」一样是【重算】：会丢弃该报告【项目段】的手动逐字编辑。
 *    缺省【跳过】edited=true 的报告以保护手改；加 --force 一并刷新。
 *
 * 用法：
 *   pnpm tsx scripts/refresh-reports.ts                 # 刷新全部未手改的报告
 *   pnpm tsx scripts/refresh-reports.ts <order_no>      # 只刷新某订单
 *   pnpm tsx scripts/refresh-reports.ts <order_no> --force   # 连手改过的也刷新
 */
import { pool } from '../server/src/db.js';
import { buildReportTypst } from '../server/src/routes/reports.js';

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const orderNo = args.find(a => !a.startsWith('--')) || null;

  const where = ['is_cover_draft = false', 'content_doc IS NOT NULL'];
  const params: any[] = [];
  if (orderNo) { params.push(orderNo); where.push(`order_no = $${params.length}`); }
  const { rows } = await pool.query(
    `SELECT id, order_no, cover_template_id, scope, content_doc, edited, report_no
       FROM reports WHERE ${where.join(' AND ')} ORDER BY id`, params);

  console.log(`[refresh] 命中 ${rows.length} 份报告${orderNo ? `（订单 ${orderNo}）` : ''}${force ? '（含手改）' : '（跳过手改）'}`);
  let ok = 0, skipped = 0, failed = 0;

  for (const r of rows) {
    const tag = r.report_no || `#${r.id}`;
    if (r.edited && !force) { console.log(`  - 跳过 ${tag}：已手动编辑（--force 可强制刷新）`); skipped++; continue; }

    const recIds: number[] = r.scope?.record_data_ids || [];
    const tplIds: number[] = r.scope?.project_template_ids || [];
    if (!recIds.length || recIds.length !== tplIds.length) {
      console.log(`  - 跳过 ${tag}：scope 缺失或不完整（rec=${recIds.length} tpl=${tplIds.length}）`); skipped++; continue;
    }
    const assignments = recIds.map((rid, i) => ({ record_data_id: rid, project_template_id: tplIds[i], enabled: true }));
    const prevOrder = r.content_doc?.cover?.ctx?.order || {};
    const mockContext = { customer_name: prevOrder.customer_name, sample_name: prevOrder.sample_name, received_at: prevOrder.received_at };
    const coverGroups = r.content_doc?.cover?.groups || null;

    try {
      const built = await buildReportTypst({
        order_no: r.order_no,
        cover_template_id: r.cover_template_id,
        project_assignments: assignments,
        mock_context: mockContext,
        // 保留生成时由接口 1.2 冻结的页眉页脚；生产环境绝不能在刷新时改用示例值。
        report_meta: r.content_doc?.cover?.ctx?.report_meta || null,
        cover_groups_override: coverGroups,
      });
      const docJson = built.contentDoc ? JSON.stringify(built.contentDoc) : null;
      const scope = { sample_label: r.scope?.sample_label ?? null, record_data_ids: built.assignmentRecIds, project_template_ids: built.assignmentTplIds };
      await pool.query(
        `UPDATE reports SET content_doc = $1::jsonb, content_doc_original = $1::jsonb, final_typst = $2, scope = $3::jsonb
           WHERE id = $4`,
        [docJson, built.finalTypst, JSON.stringify(scope), r.id]);
      console.log(`  ✓ 刷新 ${tag}（${built.assignmentRecIds.length} 个项目）`);
      ok++;
    } catch (e: any) {
      console.log(`  ✗ 失败 ${tag}：${e?.message || e}`); failed++;
    }
  }

  console.log(`[refresh] 完成：刷新 ${ok}，跳过 ${skipped}，失败 ${failed}`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
