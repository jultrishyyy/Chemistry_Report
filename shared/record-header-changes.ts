import type { RecordTemplate } from './types';
import { buildFreeGridLayout } from './free-grid-layout';

export type RecordHeaderChange = {
  field_code: string; table: string; cell_key: string; sample: number | null; before: string; after: string;
};
/** Compare active headers against the record's locked template, not the latest template. */
export function findRecordHeaderChanges(template: RecordTemplate, raw: Record<string, any>): RecordHeaderChange[] {
  const changes: RecordHeaderChange[] = [];
  for (const field of template.groups.flatMap(group => group.fields || [])) {
    if (field.type !== 'free_grid' || !field.free_table) continue;
    const value = raw[field.code];
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const base = field.free_table;
    const instance = value.__free_table_structure__;
    const table = instance && Array.isArray(instance.rows) && Array.isArray(instance.columns) ? instance : base;
    const layout = buildFreeGridLayout(table, value);
    const seen = new Set<string>();
    layout.displayRows.forEach((row, ri) => layout.displayCols.forEach((col, ci) => {
      if (layout.covered.has(`${ri},${ci}`)) return;
      const key = `${row.id}::${col.id}`;
      if (!base.header_cells?.[key] && !table.header_cells?.[key]) return;
      const sample = layout.sampleForCell(row.id, col.id, row.sample, col.sample);
      const valueKey = sample == null ? key : `${key}::s${sample}`;
      if (seen.has(valueKey)) return;
      seen.add(valueKey);
      const before = String(base.cells?.[key] ?? '');
      const after = String(value[valueKey] ?? value[key] ?? table.cells?.[key] ?? '');
      if (before === after) return;
      changes.push({ field_code: field.code, table: field.label || field.code, cell_key: key, sample, before, after });
    }));
  }
  return changes;
}
