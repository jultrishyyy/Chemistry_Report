/**
 * 非破坏性迁移（6.7）：把存量【原始记录模板】上标的「检测结论」(conclusion_field)
 * 迁移到对应【项目报告模板】的 layout_options.conclusions[]。
 *
 * 背景：结论模型重构——声明从原始记录移到项目报告模板（项目名 + 子项目 + 每个结论的来源绑定），
 * 取值仍生成时从原始记录按 binding 解析。本脚本把旧标记转成新声明：
 *   - 原始记录字段标了 conclusion_field        → { sub_name, binding: record_field(field_code) }
 *   - 原始记录矩阵汇总行标了 conclusion_field   → { sub_name, binding: record_summary(matrix_code,row_id) }
 * 然后写入【linked_record_template_id 指向该原始记录】的项目报告模板当前版本。
 *
 * 幂等：项目模板已有非空 conclusions 则跳过；只读旧 JSON、不删原始记录里的 conclusion_field（非破坏性）。
 * 运行：pnpm tsx scripts/migrate-conclusions-to-project.ts
 */
import pg from 'pg';
import { dbConfig } from '../config/index.js';

const { Pool } = pg;
const pool = new Pool({
  host: dbConfig.host, port: Number(dbConfig.port), database: dbConfig.database,
  user: dbConfig.user, password: dbConfig.password || undefined,
});

type Decl = { sub_name?: string; binding: any };

async function main() {
  // 1. 扫描原始记录模板当前版本，收集 conclusion_field 标记
  const recs = await pool.query(
    `SELECT t.id, t.name, t.current_version_id, cv.field_definitions, cv.layout_options
     FROM record_templates t JOIN record_template_versions cv ON cv.id = t.current_version_id`
  );
  const byRec = new Map<number, { decls: Decl[]; project_name?: string }>();
  for (const r of recs.rows) {
    const groups: any[] = Array.isArray(r.field_definitions) ? r.field_definitions : [];
    const decls: Decl[] = [];
    for (const g of groups) {
      for (const f of (g.fields || [])) {
        if (f.conclusion_field) {
          decls.push({ sub_name: f.conclusion_field.sub_name, binding: { source: 'record_field', field_code: f.code } });
        }
        if (f.type === 'data_matrix' && f.matrix?.summary_rows) {
          for (const sr of f.matrix.summary_rows) {
            if (sr.conclusion_field) {
              decls.push({ sub_name: sr.conclusion_field.sub_name, binding: { source: 'record_summary', matrix_code: f.code, row_id: sr.id } });
            }
          }
        }
      }
    }
    if (decls.length) byRec.set(r.id, { decls, project_name: (r.layout_options || {}).project_name });
  }
  console.log(`[scan] ${byRec.size} 个原始记录模板带 conclusion_field 标记`);
  if (byRec.size === 0) { console.log('[done] 无可迁移标记，结束。'); await pool.end(); return; }

  // 2. 找到 linked_record_template_id 指向这些原始记录的项目报告模板（当前版本）
  const projs = await pool.query(
    `SELECT t.id, t.name, t.linked_record_template_id, t.current_version_id, cv.layout_options
     FROM report_templates t JOIN report_template_versions cv ON cv.id = t.current_version_id
     WHERE t.template_kind = 'project' AND t.linked_record_template_id = ANY($1)`,
    [Array.from(byRec.keys())]
  );
  let changed = 0;
  for (const p of projs.rows) {
    const src = byRec.get(p.linked_record_template_id)!;
    const lo = p.layout_options || {};
    if (Array.isArray(lo.conclusions) && lo.conclusions.length) {
      console.log(`[skip]  项目模板 #${p.id}「${p.name}」已有 conclusions，跳过`);
      continue;
    }
    const conclusions = src.decls.map((d, i) => ({ id: `concl_mig_${p.id}_${i}`, sub_name: d.sub_name, binding: d.binding }));
    const nextLo = { ...lo, conclusions };
    if (!nextLo.project_name && src.project_name) nextLo.project_name = src.project_name;
    await pool.query(
      'UPDATE report_template_versions SET layout_options = $1::jsonb WHERE id = $2',
      [JSON.stringify(nextLo), p.current_version_id]
    );
    changed++;
    console.log(`[migrate] 项目模板 #${p.id}「${p.name}」← 记录#${p.linked_record_template_id}：${conclusions.length} 条结论`);
  }
  console.log(`[done] 迁移 ${changed} / ${projs.rows.length} 个项目模板（${byRec.size} 个原始记录有标记）。`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
