/**
 * 非破坏性：按参考样张（报告首页）的实测间距，修正首页模板「签字栏」分区版式：
 *   - 编制(签字行) ↔ 签发日期：实测基线间距 64.8pt → 中间插 5em(≈52pt) 空行。
 *   - 签发日期 ↔ 报告备注：实测 45.2pt → 中间插 3em(≈32pt) 空行。
 *   - 报告备注/资质备注（report_notes_body 一个字段两行）：字号设 6pt（实测两行仅 7.7pt 间距=6pt 小字紧贴）。
 *   - 签发日期保持右对齐。
 * 量取自 ref_files/报告/「3.1 报告首页 纺织 CN.pdf」（与化学首页同模板；化学版只有 jpg 无精确 pt）。
 *
 * 运行：pnpm tsx scripts/fix-signature-spacing.ts
 */
import pg from 'pg';
import { dbConfig } from '../config/index.js';

const { Pool } = pg;
const pool = new Pool({
  host: dbConfig.host, port: Number(dbConfig.port), database: dbConfig.database,
  user: dbConfig.user, password: dbConfig.password || undefined,
});

const SP = (id: string, h: string) => ({ id, code: id, label: '空行', type: 'spacer', hide_label: true, spacer_height: h });

async function main() {
  const covers = await pool.query(
    `SELECT t.id, t.name, t.current_version_id, cv.field_definitions
     FROM report_templates t JOIN report_template_versions cv ON cv.id = t.current_version_id
     WHERE t.template_kind = 'cover' AND t.archived_at IS NULL`
  );
  let changed = 0;
  for (const row of covers.rows) {
    const groups: any[] = Array.isArray(row.field_definitions) ? row.field_definitions : [];
    let touched = false;
    for (const g of groups) {
      const hasSig = (g.fields || []).some((f: any) => f.code === 'issue_date_body');
      if (!hasSig) continue;
      // 清掉本分区旧空行，按字段 code 重新组装
      const base = (g.fields || []).filter((f: any) => f.type !== 'spacer');
      const out: any[] = [];
      for (const f of base) {
        if (f.code === 'issue_date_body') {
          out.push(SP(`sp_${row.id}_before_issue`, '5em'));   // 编制行 ↔ 签发日期
          f.style = { align: 'right' };                        // 保持右对齐
        }
        if (f.code === 'report_notes_body') {
          out.push(SP(`sp_${row.id}_before_notes`, '3em'));    // 签发日期 ↔ 报告备注
          f.style = { size: '6pt' };                           // 报告备注/资质备注 → 6pt
        }
        out.push(f);
      }
      g.fields = out;
      touched = true;
    }
    if (touched) {
      await pool.query(
        'UPDATE report_template_versions SET field_definitions = $1::jsonb WHERE id = $2',
        [JSON.stringify(groups), row.current_version_id]
      );
      changed++;
      console.log(`[fix] 首页模板 #${row.id}「${row.name}」：签字栏插入 2 空行(5em/3em) + 报告备注 6pt + 签发日期右对齐`);
    }
  }
  console.log(`[done] 共更新 ${changed} / ${covers.rows.length} 个首页模板。`);
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
