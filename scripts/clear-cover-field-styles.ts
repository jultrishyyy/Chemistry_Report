/**
 * 非破坏性：清空现有【首页模板(cover)】当前生效版本所有【字段级】样式，让行距完全统一。
 *
 * 背景：多个字段残留 space_before（15/24/43pt）/ line_height / size 等，叠在空行(spacer)之上 →
 * 有的行比别的高、行距不均。约定：行距统一、空白只由 spacer 产生。
 * 处理：删掉每个字段的 style；唯独保留 签发日期(issue_date_body) 的 align:right（上次明确要求，且不影响行距）。
 * 分区级 style（如签字栏钉底）保留——那是版面定位，不是字段行距。spacer 不动。
 *
 * 运行：pnpm tsx scripts/clear-cover-field-styles.ts
 */
import pg from 'pg';
import { dbConfig } from '../config/index.js';

const { Pool } = pg;
const pool = new Pool({
  host: dbConfig.host, port: Number(dbConfig.port), database: dbConfig.database,
  user: dbConfig.user, password: dbConfig.password || undefined,
});

async function main() {
  const covers = await pool.query(
    `SELECT t.id, t.name, t.current_version_id, cv.field_definitions
     FROM report_templates t JOIN report_template_versions cv ON cv.id = t.current_version_id
     WHERE t.template_kind = 'cover' AND t.archived_at IS NULL`
  );
  let changed = 0;
  for (const row of covers.rows) {
    const groups: any[] = Array.isArray(row.field_definitions) ? row.field_definitions : [];
    let cleared = 0, kept = 0;
    for (const g of groups) {
      for (const f of (g.fields || [])) {
        if (!f.style) continue;
        if (f.code === 'issue_date_body') {
          f.style = { align: 'right' };  // 仅保留右对齐（不影响行距）
          kept++;
        } else {
          delete f.style;
          cleared++;
        }
      }
    }
    await pool.query(
      'UPDATE report_template_versions SET field_definitions = $1::jsonb WHERE id = $2',
      [JSON.stringify(groups), row.current_version_id]
    );
    changed++;
    console.log(`[clear] 首页模板 #${row.id}「${row.name}」：清空 ${cleared} 个字段样式，保留 ${kept} 个（签发日期右对齐）`);
  }
  console.log(`[done] 共更新 ${changed} / ${covers.rows.length} 个首页模板。`);
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
