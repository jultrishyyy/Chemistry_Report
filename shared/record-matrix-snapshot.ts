import type { FieldDefinition, RecordTemplate } from './types';
import { normalizeMatrixValue, createEmptyMatrixValue } from './matrix-flatten';
import { flattenDataForDisplay } from './typst-generator';

/** Read-only legacy matrix view. Uses the same calculated display values as the record PDF.
 * Group names are included in labels; this is a copyable data view, not a layout migration.
 */
export function recordMatrixSnapshot(field: FieldDefinition, template: RecordTemplate, raw: Record<string, any>): NonNullable<FieldDefinition['free_table']> | null {
  const cfg = field.matrix;
  if (!cfg) return null;
  const value = normalizeMatrixValue(cfg, raw[field.code]);
  const params = value.parameters.length ? value.parameters : cfg.parameters;
  const sids = value.sample_ids.length ? value.sample_ids : createEmptyMatrixValue(cfg).sample_ids;
  if (!params.length) return null;
  const flat = flattenDataForDisplay(template, raw);
  const text = (v: any) => v == null ? '' : typeof v === 'object' && 'custom' in v ? String(v.custom ?? '') : String(v);
  const label = (name: string, unit?: string) => name + (unit ? ` (${unit})` : '');
  const summaries = cfg.summary_rows || [], sumcols = cfg.summary_cols || [];
  const cells = Array.from({ length: 1 + sids.length + summaries.length }, () => Array<string>(1 + params.length + sumcols.length).fill(''));
  const spans: Array<{ r: number; c: number; rs: number; cs: number }> = [];
  cells[0][0] = cfg.axis_header ?? '试样';
  params.forEach((p, c) => { cells[0][c + 1] = label((p.group ? `${p.group} / ` : '') + p.label, value.parameter_unit_overrides?.[p.code] ?? p.unit); });
  sumcols.forEach((sc, c) => { cells[0][1 + params.length + c] = label(sc.label, value.sumcol_unit_overrides?.[sc.id] ?? sc.unit); });
  sids.forEach((sid, r) => {
    const name = value.sample_labels?.[sid] ?? cfg.default_sample_labels?.[r] ?? `${cfg.row_header_prefix || '试样'} ${r + 1}`;
    cells[r + 1][0] = label((cfg.sample_groups?.[r] ? `${cfg.sample_groups[r]} / ` : '') + name, value.sample_note_overrides?.[sid] ?? cfg.sample_notes?.[r]?.note);
    params.forEach((p, c) => { cells[r + 1][c + 1] = text(flat[`${field.code}__${sid}__${p.code}`]); });
    sumcols.forEach((sc, c) => {
      if (sc.per_row === false && r > 0) return;
      cells[r + 1][1 + params.length + c] = text(sc.source_type === 'literal' ? sc.literal : flat[`${field.code}__sumcol__${sc.id}${sc.per_row === false ? '' : `__${sid}`}`]);
      if (sc.per_row === false && sids.length > 1) spans.push({ r: 1, c: 1 + params.length + c, rs: sids.length, cs: 1 });
    });
  });
  summaries.forEach((sr, i) => {
    const r = sids.length + 1 + i;
    cells[r][0] = label(sr.label, value.summary_note_overrides?.[sr.id] ?? sr.note);
    if (sr.per_column || sr.source_type === 'per_column_aggregate') {
      params.forEach((p, c) => { cells[r][c + 1] = text(flat[`${field.code}__summary__${sr.id}__${p.code}`]); });
    } else {
      const val = sr.source_type === 'literal' ? sr.literal : sr.source_type === 'computed_field' && sr.field_code ? flat[sr.field_code] : flat[`${field.code}__summary__${sr.id}`];
      cells[r][1] = text(val) + (val != null && val !== '' && ['input_text', 'input_number'].includes(sr.source_type) && sr.unit ? ` ${sr.unit}` : '');
      const cs = Math.min(params.length, Math.max(1, sr.value_colspan ?? params.length));
      if (cs > 1) spans.push({ r, c: 1, rs: 1, cs });
    }
  });
  // Match the legacy renderer's column orientation, including its grouped-header fallback.
  const transpose = cfg.sample_axis === 'col' && !params.some(p => p.group?.trim()) && !cfg.sample_groups?.some(g => g?.trim());
  const matrix = transpose ? cells[0].map((_, c) => cells.map(row => row[c])) : cells;
  const key = (r: number, c: number) => `r${r}::c${c}`;
  return {
    rows: matrix.map((_, r) => ({ id: `r${r}` })), columns: matrix[0].map((_, c) => ({ id: `c${c}`, label: '' })),
    cells: Object.fromEntries(matrix.flatMap((row, r) => row.map((v, c) => [key(r, c), v]))),
    spans: Object.fromEntries(spans.map(s => [transpose ? key(s.c, s.r) : key(s.r, s.c), { rowspan: transpose ? s.cs : s.rs, colspan: transpose ? s.rs : s.cs }])),
  };
}
