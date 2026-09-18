import { freeGridSourceBinding, sampleBandForCell } from './free-grid-binding';
import type { CellBinding, FieldDefinition } from './types';
type Table = NonNullable<FieldDefinition['free_table']>;

/** 选区与来源按行列偏移对应；普通字段和固定文字统一应用。 */
export function rangeCellBindings(keys: string[], target: Table, binding: CellBinding | undefined, sourceTable: (code: string) => Table | undefined): Record<string, CellBinding> {
  if (!binding) return {};
  if (!('cell_key' in binding) || !('field_code' in binding) || keys.length < 2) return Object.fromEntries(keys.map(key => [key, structuredClone(binding)]));
  const source = sourceTable(binding.field_code);
  if (!source) throw new Error('来源表格不存在，请重新选择');
  const positions = keys.map(key => {
    const [r, c] = key.split('::');
    return { key, r: target.rows.findIndex(row => row.id === r), c: target.columns.findIndex(col => col.id === c) };
  });
  const minR = Math.min(...positions.map(p => p.r)), minC = Math.min(...positions.map(p => p.c));
  const [sr, sc] = binding.cell_key.split('::');
  const row = source.rows.findIndex(r => r.id === sr), col = source.columns.findIndex(c => c.id === sc);
  if (row < 0 || col < 0) throw new Error('请选择来源表格中的起始单元格');
  return Object.fromEntries(positions.map(p => {
    const r = source.rows[row + p.r - minR], c = source.columns[col + p.c - minC];
    if (!r || !c) throw new Error('来源区域尺寸不足，请缩小选区或重新选择起始格');
    const sourceKey = `${r.id}::${c.id}`;
    if (binding.source === 'record_free_cell_sample' || binding.source === 'record_free_formula_cell_sample') {
      // A range can include both inputs and formulas. Resolve each source's own role.
      const sourceBand = sampleBandForCell(source, binding.cell_key);
      if (sourceBand) {
        if (sampleBandForCell(source, sourceKey)?.id !== sourceBand.id || source.header_cells?.[sourceKey]) {
          throw new Error('来源选区超出试样数据区域，请重新选择起始格');
        }
        return [p.key, freeGridSourceBinding({ code: binding.field_code, free_table: source } as FieldDefinition, sourceKey)];
      }
    }
    return [p.key, { ...binding, cell_key: sourceKey }];
  }));
}
