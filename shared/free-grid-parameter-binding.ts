import type { CellBinding, FieldDefinition } from './types';
import { freeGridSourceBinding, recordSampleBands, sampleBandForCell } from './free-grid-binding';
type Table = NonNullable<FieldDefinition['free_table']>;
type Band = NonNullable<Table['sample_bands']>[number];

/** A parameter action only includes visible, unmerged sample cells on one axis. */
export function sampleParameterKeys(table: Table, band: Band, anchor: string): string[] {
  const [row, col] = anchor.split('::');
  const cross = band.axis === 'row' ? col : row;
  if (band.cross_refs?.length && !band.cross_refs.includes(cross)) return [];
  const normalized = { ...table, sample_band: undefined, sample_bands: [{ ...band, source_field: undefined, matrix_code: undefined }] };
  const span = table.spans?.[anchor];
  if (((band.axis === 'row' ? span?.colspan : span?.rowspan) || 1) > 1) return [];
  return band.refs.map(ref => band.axis === 'row' ? `${ref}::${col}` : `${row}::${ref}`)
    .filter(key => !table.header_cells?.[key] && !!sampleBandForCell(normalized, key)
      && (table.spans?.[key]?.rowspan || 1) === 1 && (table.spans?.[key]?.colspan || 1) === 1);
}

export function sampleParameterBindings(band: Band, keys: string[], source: FieldDefinition, binding: CellBinding) {
  const bindings: Record<string, CellBinding> = {}, units: Record<string, CellBinding> = {};
  if (!source.free_table || source.code !== band.source_field) throw new Error('请选择当前试样区域关联的来源表格');
  const sourceBand = recordSampleBands(source.free_table).find(item => item.id === band.source_band_id);
  if (!sourceBand || sourceBand.axis !== band.axis) throw new Error('试样区域方向已变更，请重新拉取表格');
  if (binding.source === 'record_sample_index') {
    for (const key of keys) bindings[key] = { source: 'record_sample_index', matrix_code: '' };
    return { bindings, units };
  }
  if (!('cell_key' in binding) || !('field_code' in binding) || binding.field_code !== source.code
    || !sampleBandForCell(source.free_table, binding.cell_key)) throw new Error('请选择试样参数表头或试样数据格');
  const [sr, sc] = binding.cell_key.split('::');
  for (const key of keys) {
    const [r, c] = key.split('::');
    const index = band.refs.indexOf(band.axis === 'row' ? r : c);
    const ref: string | undefined = sourceBand.refs[index];
    const sourceKey = band.axis === 'row' ? `${ref}::${sc}` : `${sr}::${ref}`;
    if (!ref || !sampleBandForCell(source.free_table, sourceKey) || source.free_table.header_cells?.[sourceKey]) {
      throw new Error('来源参数包含合并格或试样范围不匹配，请使用单格绑定');
    }
    bindings[key] = freeGridSourceBinding(source, sourceKey);
    if (source.free_table.cell_units?.[sourceKey] || source.free_table.cell_unit_options?.[sourceKey]?.length) {
      units[key] = { source: 'record_free_cell_unit_sample', field_code: source.code, cell_key: sourceKey };
    }
  }
  return { bindings, units };
}

/** Resolve a selected parameter header, complete column/row, or sample range. */
export function selectedSampleBindingKeys(table: Table, band: Band, selected: string[]): string[] {
  const normalized = { ...table, sample_band: undefined, sample_bands: [{ ...band, source_field: undefined, matrix_code: undefined }] };
  return selected.filter(key => !table.header_cells?.[key] && !!sampleBandForCell(normalized, key));
}

export function selectedParameterKeys(table: Table, band: Band, selected: string[]): string[] {
  const coordinates = new Set(selected.map(key => key.split('::')[band.axis === 'row' ? 1 : 0]));
  if (coordinates.size !== 1 || !selected.length) return [];
  return sampleParameterKeys(table, band, selected[0]);
}
