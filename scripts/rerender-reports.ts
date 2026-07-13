/**
 * rerender-reports.ts — 用【当前渲染器】把已生成报告的 content_doc 重新渲成 final_typst。
 *
 * 用途：渲染器（typst-generator / 主题）升级后，让【已生成】报告也用上新效果——
 *   只重渲 final_typst，**不动** content_doc（分组/字段/手改字面量/图片全部保留），不改 edited 标记。
 *   与报告实例编辑保存共用 renderContentDoc，口径一致。
 *
 * 用法：
 *   pnpm tsx scripts/rerender-reports.ts                 # 重渲全部已生成报告
 *   pnpm tsx scripts/rerender-reports.ts <order_no>      # 只重渲某订单
 */
import { pool } from '../server/src/db.js';
import { renderContentDoc } from '../shared/typst-generator.js';
import { compileTypst } from '../server/src/services/typst-compiler.js';

async function main() {
  const orderNo = process.argv.slice(2).find(a => !a.startsWith('--')) || null;
  const where = ['is_cover_draft = false', 'content_doc IS NOT NULL'];
  const params: any[] = [];
  if (orderNo) { params.push(orderNo); where.push(`order_no = $${params.length}`); }
  const { rows } = await pool.query(
    `SELECT id, report_no, content_doc FROM reports WHERE ${where.join(' AND ')} ORDER BY id`, params);

  console.log(`[rerender] 命中 ${rows.length} 份报告${orderNo ? `（订单 ${orderNo}）` : ''}`);
  let ok = 0, failed = 0;
  for (const r of rows) {
    const tag = r.report_no || `#${r.id}`;
    try {
      const finalTypst = renderContentDoc(r.content_doc);
      await compileTypst(finalTypst); // 编译校验：渲染产物必须能出 PDF
      await pool.query('UPDATE reports SET final_typst = $1 WHERE id = $2', [finalTypst, r.id]);
      console.log(`  ✓ 重渲 ${tag}`);
      ok++;
    } catch (e: any) {
      console.log(`  ✗ 失败 ${tag}：${(e?.message || e).toString().split('\n')[0]}`); failed++;
    }
  }
  console.log(`[rerender] 完成：成功 ${ok}，失败 ${failed}`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
