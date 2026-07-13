/**
 * 报告映射体检：把每个【未归档】报告模板当前版本的每条 binding，拿去和它关联的原始记录模板
 * 当前版本的真实字段 code / 矩阵参数 / 汇总行 / 试样数核对，列出"绑到不存在对象 / 绑错类型"的映射。
 *
 * 用法：pnpm tsx scripts/audit-report-mappings.ts
 * 只读，不改库。覆盖：字段 binding、结果表 cells/列头/行头/汇总行/汇总列、layout_options.conclusions[]。
 */
import { pool } from '../server/src/db.js';

function recInfo(groups: any[]) {
  const fieldCodes = new Set<string>();
  const matrices = new Map<string, { params: Set<string>; summaryRows: Map<string, any>; sampleCount: number }>();
  for (const g of groups || []) for (const f of g.fields || []) {
    fieldCodes.add(f.code);
    if (f.type === 'data_matrix' && f.matrix) {
      matrices.set(f.code, {
        params: new Set((f.matrix.parameters || []).map((p: any) => p.code)),
        summaryRows: new Map((f.matrix.summary_rows || []).map((s: any) => [s.id, s])),
        sampleCount: f.matrix.default_sample_count ?? 0,
      });
    }
  }
  return { fieldCodes, matrices };
}

const problems: { rep: string; where: string; msg: string; fix?: string }[] = [];
function P(rep: string, where: string, msg: string, fix?: string) { problems.push({ rep, where, msg, fix }); }

function check(rep: string, where: string, b: any, info: ReturnType<typeof recInfo>, recName: string) {
  if (!b || !b.source) return;
  const m = (mc: string) => { const x = info.matrices.get(mc); if (!x) P(rep, where, `matrix_code "${mc}" 不存在于「${recName}」`); return x; };
  switch (b.source) {
    case 'record_field':
      if (!info.fieldCodes.has(b.field_code)) P(rep, where, `record_field "${b.field_code}" 不存在`);
      break;
    case 'record_cell': {
      const mm = m(b.matrix_code); if (!mm) break;
      if (!mm.params.has(b.param_code)) P(rep, where, `record_cell param_code "${b.param_code}" 不在矩阵参数`);
      if (typeof b.sample_idx === 'number' && b.sample_idx >= mm.sampleCount)
        P(rep, where, `record_cell sample_idx=${b.sample_idx} 超出试样数(${mm.sampleCount}) ⇒ 取空`, '应改绑到对应汇总行或有效试样');
      break;
    }
    case 'record_cell_sample': {
      const mm = m(b.matrix_code); if (!mm) break;
      if (!mm.params.has(b.param_code)) P(rep, where, `record_cell_sample param_code "${b.param_code}" 不在矩阵参数`);
      break;
    }
    case 'record_summary': {
      const mm = m(b.matrix_code); if (!mm) break;
      const row = mm.summaryRows.get(b.row_id);
      if (!row) { P(rep, where, `record_summary row_id "${b.row_id}" 不在矩阵汇总行`); break; }
      const perCol = !!row.per_column;
      if (perCol && !b.param_code) P(rep, where, `record_summary 行"${row.label}"是 per_column 但缺 param_code ⇒ 取空`, `补 param_code（如结果列对应的参数 code）`);
      if (perCol && b.param_code && !mm.params.has(b.param_code)) P(rep, where, `record_summary param_code "${b.param_code}" 不在矩阵参数`);
      if (!perCol && b.param_code) P(rep, where, `record_summary 行"${row.label}"是跨列但多了 param_code "${b.param_code}" ⇒ 取空`, '删掉 param_code');
      break;
    }
    case 'record_header': case 'record_sample_index':
      if (b.matrix_code) m(b.matrix_code);
      break;
  }
}

function walk(rep: any, recGroups: any[] | null, recName: string) {
  if (rep.template_kind === 'project' && !recGroups) { P(rep.name, '(模板)', `关联原始记录「${recName || '?'}」缺失`); return; }
  if (!recGroups) return;
  const info = recInfo(recGroups);
  for (const g of rep.field_definitions || []) for (const f of g.fields || []) {
    if (f.binding) check(rep.name, `字段"${f.label || f.code}"`, f.binding, info, recName);
    const rt = f.result_table;
    if (rt) {
      for (const c of rt.columns || []) { if (c.label_binding) check(rep.name, `结果列"${c.label}".label`, c.label_binding, info, recName); if (c.note_binding) check(rep.name, `结果列"${c.label}".note`, c.note_binding, info, recName); }
      for (const r of rt.rows || []) { if (r.label_binding) check(rep.name, `结果行.label`, r.label_binding, info, recName); if (r.note_binding) check(rep.name, `结果行.note`, r.note_binding, info, recName); }
      for (const c of rt.cells || []) check(rep.name, `结果格[${c.rowId}/${c.colId}]`, c.binding, info, recName);
      for (const sr of rt.summary_rows || []) { if (sr.binding) check(rep.name, `结果汇总行"${sr.label}"`, sr.binding, info, recName); for (const cc of sr.cells || []) check(rep.name, `结果汇总行"${sr.label}"[${cc.colId}]`, cc.binding, info, recName); if (sr.label_binding) check(rep.name, `结果汇总行"${sr.label}".label`, sr.label_binding, info, recName); if (sr.note_binding) check(rep.name, `结果汇总行"${sr.label}".note`, sr.note_binding, info, recName); }
      for (const sc of rt.summary_cols || []) { if (sc.binding) check(rep.name, `结果汇总列"${sc.label}"`, sc.binding, info, recName); for (const cc of sc.cells || []) check(rep.name, `结果汇总列"${sc.label}"[${cc.rowId}]`, cc.binding, info, recName); if (sc.label_binding) check(rep.name, `结果汇总列"${sc.label}".label`, sc.label_binding, info, recName); if (sc.note_binding) check(rep.name, `结果汇总列"${sc.label}".note`, sc.note_binding, info, recName); }
    }
  }
  const concl = (rep.layout_options || {}).conclusions;
  if (Array.isArray(concl)) for (const d of concl) if (d?.binding) check(rep.name, `结论声明"${d.sub_name || ''}"`, d.binding, info, recName);
}

async function main() {
  const reps = await pool.query(
    `SELECT t.id, t.name, t.template_kind, t.linked_record_template_id,
            cv.field_definitions, cv.layout_options,
            r.name AS rec_name, rcv.field_definitions AS rec_groups
       FROM report_templates t
       JOIN report_template_versions cv ON cv.id = t.current_version_id
       LEFT JOIN record_templates r ON r.id = t.linked_record_template_id
       LEFT JOIN record_template_versions rcv ON rcv.id = r.current_version_id
      WHERE t.archived_at IS NULL
      ORDER BY t.template_kind, t.id`);
  for (const row of reps.rows) {
    walk({ name: row.name, template_kind: row.template_kind, field_definitions: row.field_definitions, layout_options: row.layout_options },
      row.rec_groups || null, row.rec_name || '');
  }
  console.log(`===== 报告映射体检：${reps.rows.length} 个报告模板，发现 ${problems.length} 个问题 =====`);
  for (const p of problems) console.log(`  ✗ [${p.rep}] ${p.where}: ${p.msg}${p.fix ? `  〔建议：${p.fix}〕` : ''}`);
  if (!problems.length) console.log('  ✅ 无问题');
  await pool.end();
  process.exit(problems.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
