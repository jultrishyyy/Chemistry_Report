import type { CellBinding, FieldDefinition } from './types';
import { recordSampleBands, sampleBandForCell } from './free-grid-binding';
type Table = NonNullable<FieldDefinition['free_table']>;
type Band = NonNullable<Table['sample_bands']>[number];

function sampleTargetIssue(table: Table, key: string, binding: CellBinding | undefined): string | undefined {
  if (!binding || !['record_free_cell_sample', 'record_free_formula_cell_sample', 'record_free_cell_unit_sample', 'record_sample_index'].includes(binding.source)) return;
  const bands = table.sample_bands || [];
  if (!bands.length) return '尚未设置报告试样区，请先框选数据格并设置试样区';
  const matching = bands.filter(band => binding.source === 'record_sample_index'
    ? !!band.source_field || band.matrix_code === binding.matrix_code
    : 'field_code' in binding && band.source_field === binding.field_code);
  if (!matching.length) return '旧映射的来源表与当前试样区不一致，请重新选择对应来源';
  if (!matching.some(band => !!sampleBandForCell({ ...table, sample_band: undefined,
    sample_bands: [{ ...band, source_field: undefined, matrix_code: undefined }] }, key))) {
    return '该格或其合并范围不在当前试样区内，请扩大区域，或把该格改为固定来源';
  }
}

export function assertReportSampleTargets(table: Table, keys: string[], binding: CellBinding | undefined) {
  for (const key of keys) {
    const issue = sampleTargetIssue(table, key, binding);
    if (issue) throw new Error(issue);
  }
}

/** Existing mappings are reviewable conflicts, not prerequisites for creating a region. */
export function reportSampleRegionIssues(table: Table): Array<{ key: string; part: 'content' | 'unit'; reason: string }> {
  const issues: Array<{ key: string; part: 'content' | 'unit'; reason: string }> = [];
  for (const [part, bindings] of [['content', table.cell_bindings], ['unit', table.cell_unit_bindings]] as const) {
    for (const [key, binding] of Object.entries(bindings || {})) {
      const reason = sampleTargetIssue(table, key, binding);
      if (reason) issues.push({ key, part, reason });
    }
  }
  return issues;
}

export function createReportSampleRegion(table: Table, source: FieldDefinition, refs: string[], crossRefs: string[]): Band {
  const sourceBands = source.free_table ? recordSampleBands(source.free_table) : [];
  if (sourceBands.length !== 1) throw new Error('请选择已设置一个试样区域的原始记录表格');
  const sourceBand = sourceBands[0];
  if (!refs.length || !crossRefs.length) throw new Error('请先框选报告试样数据格');
  const axis = sourceBand.axis === 'row' ? table.rows : table.columns;
  const cross = sourceBand.axis === 'row' ? table.columns : table.rows;
  if (!refs.every(ref => axis.some(item => item.id === ref)) || !crossRefs.every(ref => cross.some(item => item.id === ref))) {
    throw new Error('试样区方向与当前选区不匹配，请重新框选数据格');
  }
  const existing = table.sample_bands?.find(band => band.source_field === source.code && band.source_band_id === sourceBand.id && band.axis === sourceBand.axis);
  return { ...(existing || {}), id: existing?.id || 'report_samples', axis: sourceBand.axis,
    refs: [...refs], cross_refs: [...crossRefs], source_field: source.code, source_band_id: sourceBand.id };
}
