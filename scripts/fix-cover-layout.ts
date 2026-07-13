/**
 * 非破坏性：修正现有【首页模板(cover)】当前生效版本的版式：
 *  1. 空行(spacer)放到正确位置——基本信息分区里，在这些字段【之后】各插一个 1em 空行：
 *     单位地址(unit_addr) / 供应商(supplier) / 检测周期(test_cycle) / 检测要求(test_req) / 检测结果(test_res)。
 *     （效果：单位地址|声明、供应商|接收日期，以及检测周期/要求/结果/结论之间各有空行。）先清掉旧的乱放空行。
 *  2. 签发日期(issue_date_body) 改成真正的右对齐(align:right)，去掉原来的 margin.left:12.6cm 硬撑（那样不贴右边）。
 *
 * 运行：pnpm tsx scripts/fix-cover-layout.ts
 */
import pg from 'pg';
import { dbConfig } from '../config/index.js';

const { Pool } = pg;
const pool = new Pool({
  host: dbConfig.host, port: Number(dbConfig.port), database: dbConfig.database,
  user: dbConfig.user, password: dbConfig.password || undefined,
});

/** 在这些字段之后各插一个空行（按 code）。 */
const SPACER_AFTER = ['unit_addr', 'supplier', 'test_cycle', 'test_req', 'test_res'];

async function main() {
  const covers = await pool.query(
    `SELECT t.id, t.name, t.current_version_id, cv.field_definitions
     FROM report_templates t JOIN report_template_versions cv ON cv.id = t.current_version_id
     WHERE t.template_kind = 'cover' AND t.archived_at IS NULL`
  );
  let changed = 0;
  for (const row of covers.rows) {
    const groups: any[] = Array.isArray(row.field_definitions) ? row.field_definitions : [];
    let n = 0;
    for (const g of groups) {
      // 1) 清掉本分区已有 spacer（旧的乱放）
      let fields: any[] = (g.fields || []).filter((f: any) => f.type !== 'spacer');
      // 2) 在目标字段之后插入空行
      const out: any[] = [];
      for (const f of fields) {
        out.push(f);
        if (SPACER_AFTER.includes(f.code)) {
          out.push({ id: `cf_sp_${row.id}_${f.code}`, code: `cover_spacer_${f.code}`, label: '空行', type: 'spacer', hide_label: true, spacer_height: '1em' });
          n++;
        }
        // 3) 签发日期 → 真右对齐
        if (f.code === 'issue_date_body') {
          const sb = (f.style && f.style.space_before) || '43pt';
          f.style = { align: 'right', space_before: sb };
        }
      }
      g.fields = out;
    }
    await pool.query(
      'UPDATE report_template_versions SET field_definitions = $1::jsonb WHERE id = $2',
      [JSON.stringify(groups), row.current_version_id]
    );
    changed++;
    console.log(`[fix] 首页模板 #${row.id}「${row.name}」：插入 ${n} 个空行 + 签发日期右对齐（版本 ${row.current_version_id}）`);
  }
  console.log(`[done] 共更新 ${changed} / ${covers.rows.length} 个首页模板。`);
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
