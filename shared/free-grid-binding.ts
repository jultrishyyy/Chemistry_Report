import type { CellBinding, FieldDefinition } from './types';

type Table = NonNullable<FieldDefinition['free_table']>;

export function recordSampleBands(ft: Table) {
  return (ft.sample_bands?.length ? ft.sample_bands
    : ft.sample_band?.ref ? [{ id: 'legacy', ...ft.sample_band, refs: [ft.sample_band.ref] }] : [])
    .filter(b => b?.refs?.length && !b.matrix_code && !b.source_field);
}

/** A merge inside one sample is repeatable; a merge crossing its boundary is shared. */
export function sampleBandForCell(ft: Table, key: string) {
  const [rid, cid] = key.split('::');
  const ri = ft.rows.findIndex(r => r.id === rid), ci = ft.columns.findIndex(c => c.id === cid);
  if (ri < 0 || ci < 0) return undefined;
  let rowspan = 1, colspan = 1;
  for (const [anchor, span] of Object.entries(ft.spans || {})) {
    const [ar, ac] = anchor.split('::');
    const r = ft.rows.findIndex(item => item.id === ar), c = ft.columns.findIndex(item => item.id === ac);
    if (r < 0 || c < 0) continue;
    const rs = Math.min(Math.max(span.rowspan || 1, 1), ft.rows.length - r);
    const cs = Math.min(Math.max(span.colspan || 1, 1), ft.columns.length - c);
    if (ri < r || ri >= r + rs || ci < c || ci >= c + cs) continue;
    if (anchor !== key) return undefined;
    rowspan = rs; colspan = cs;
  }
  return recordSampleBands(ft).find(b => {
    const axis = b.axis === 'row' ? ft.rows.slice(ri, ri + rowspan) : ft.columns.slice(ci, ci + colspan);
    const cross = b.axis === 'row' ? ft.columns.slice(ci, ci + colspan) : ft.rows.slice(ri, ri + rowspan);
    return axis.every(item => b.refs.includes(item.id))
      && (!b.cross_refs?.length || cross.every(item => b.cross_refs!.includes(item.id)));
  });
}

export function freeGridSourceBinding(field: FieldDefinition, key: string, perSample = true): CellBinding {
  const ft = field.free_table!;
  if (ft.header_cells?.[key]) return { source: 'record_free_template_cell', field_code: field.code, cell_key: key };
  const sample = perSample && !!sampleBandForCell(ft, key);
  if (sample && ft.sample_index_cells?.[key]) return { source: 'record_sample_index', matrix_code: '' };
  return {
    source: ft.cell_formulas?.[key]
      ? sample ? 'record_free_formula_cell_sample' : 'record_free_formula_cell'
      : sample ? 'record_free_cell_sample' : 'record_free_cell',
    field_code: field.code, cell_key: key,
  };
}
