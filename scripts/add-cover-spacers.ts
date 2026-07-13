/**
 * 非破坏性：给现有【首页模板(cover)】当前生效版本注入可编辑的 spacer（空行）。
 *
 * 背景：首页模板原本靠隐式块间距留白，没有 spacer 对象，所以编辑器里看不到可编辑的"空行"。
 * 本脚本在自然空行位（每个分区的开头，跳过第一个分区）插入一个 1em 的 spacer，
 * 让文员在模板编辑器 / 编辑首页里能直接看到、调高度、删除、拖动。
 *
 * 运行：pnpm tsx scripts/add-cover-spacers.ts
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
    let touched = false;
    groups.forEach((g, gi) => {
      const fields: any[] = Array.isArray(g.fields) ? g.fields : [];
      const hasSpacer = fields.some(f => f.type === 'spacer');
      // 第一个分区开头不加（页首不需要空行）；其余分区开头各加一个，且该分区原本没有空行才加。
      if (gi > 0 && !hasSpacer) {
        fields.unshift({
          id: `cf_sp_${row.id}_${gi}`, code: `cover_spacer_${gi}`,
          label: '空行', type: 'spacer', hide_label: true, spacer_height: '1em',
        });
        g.fields = fields;
        touched = true;
      }
    });
    if (touched) {
      await pool.query(
        'UPDATE report_template_versions SET field_definitions = $1::jsonb WHERE id = $2',
        [JSON.stringify(groups), row.current_version_id]
      );
      changed++;
      const spacerTotal = groups.reduce((n, g) => n + (g.fields || []).filter((f: any) => f.type === 'spacer').length, 0);
      console.log(`[add] 首页模板 #${row.id}「${row.name}」已注入空行（当前共 ${spacerTotal} 个 spacer，版本 ${row.current_version_id}）`);
    } else {
      console.log(`[skip] 首页模板 #${row.id}「${row.name}」已有空行或无需改动`);
    }
  }
  console.log(`[done] 共更新 ${changed} / ${covers.rows.length} 个首页模板。`);
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
