import type { CellBinding, FieldDefinition } from './types';
import { freeGridSourceBinding, recordSampleBands, sampleBandForCell } from './free-grid-binding';
type Table = NonNullable<FieldDefinition['free_table']>;

/** Build the repeat region and its mappings together; cancelling the picker changes nothing. */
export function bindSelectedSampleRange(table: Table, keys: string[], source: FieldDefinition, binding: CellBinding): Partial<Table> {
  if (!source.free_table || !('field_code' in binding) || !('cell_key' in binding) || binding.field_code !== source.code
    || !['record_free_cell_sample', 'record_free_formula_cell_sample'].includes(binding.source)) throw new Error('请点击来源表的试样列号／行号');
  const sourceBand = recordSampleBands(source.free_table).find(band => band.id === sampleBandForCell(source.free_table!, binding.cell_key)?.id);
  if (!sourceBand) throw new Error('请选择来源试样区域内的参数');
  if (!keys.length) throw new Error('请先框选要绑定的数据格');
  const selected = new Set(keys);
  const rows = table.rows.filter(row => keys.some(key => key.split('::')[0] === row.id));
  const cols = table.columns.filter(col => keys.some(key => key.split('::')[1] === col.id));
  if (rows.length * cols.length !== selected.size || rows.some(row => cols.some(col => !selected.has(`${row.id}::${col.id}`)))) throw new Error('请选择连续矩形数据格，不包含表头或合并覆盖格');
  const contiguous = (all: { id: string }[], chosen: { id: string }[]) => chosen.every((item, i) => all[all.findIndex(v => v.id === chosen[0].id) + i]?.id === item.id);
  if (!contiguous(table.rows, rows) || !contiguous(table.columns, cols)) throw new Error('请选择连续的试样数据格');
  for (const key of keys) if (table.header_cells?.[key] || (table.spans?.[key]?.rowspan || 1) > 1 || (table.spans?.[key]?.colspan || 1) > 1) throw new Error('试样选区请避开固定表头和合并格');
  const axis = sourceBand.axis;
  const refs = (axis === 'row' ? rows : cols).map(item => item.id);
  const cross = (axis === 'row' ? cols : rows).map(item => item.id);
  const existing = table.sample_bands?.find(band => band.source_field === source.code && band.source_band_id === sourceBand.id && band.axis === axis && refs.every(ref => band.refs.includes(ref)));
  const band = existing ? { ...existing, cross_refs: existing.cross_refs?.length ? [...new Set([...existing.cross_refs, ...cross])] : undefined }
    : { id: 'report_samples', axis, refs, cross_refs: cross, source_field: source.code, source_band_id: sourceBand.id, source_axis_mapping: 'ordinal' as const };
  const [sr, sc] = binding.cell_key.split('::');
  const parameters = axis === 'row' ? source.free_table.columns : source.free_table.rows;
  const start = parameters.findIndex(item => item.id === (axis === 'row' ? sc : sr));
  const bindings = { ...table.cell_bindings }, units = { ...table.cell_unit_bindings };
  rows.forEach((row, ri) => cols.forEach((col, ci) => {
    const key = `${row.id}::${col.id}`;
    const parameter = parameters[start + (axis === 'row' ? ci : ri)]?.id;
    const ref = sourceBand.refs[(axis === 'row' ? ri : ci) % sourceBand.refs.length];
    const sourceKey = axis === 'row' ? `${ref}::${parameter}` : `${parameter}::${ref}`;
    if (!parameter || sampleBandForCell(source.free_table!, sourceKey)?.id !== sourceBand.id || source.free_table!.header_cells?.[sourceKey]) throw new Error('来源试样参数范围不足或包含合并格，请缩小目标选区或重新选择来源');
    bindings[key] = freeGridSourceBinding(source, sourceKey);
    if (source.free_table!.cell_units?.[sourceKey] || source.free_table!.cell_unit_options?.[sourceKey]?.length) units[key] = { source: 'record_free_cell_unit_sample', field_code: source.code, cell_key: sourceKey };
    else delete units[key];
  }));
  return { sample_bands: [band], sample_band: undefined, cell_bindings: bindings, cell_unit_bindings: units };
}
