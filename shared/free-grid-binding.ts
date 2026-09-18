import type { CellBinding, FieldDefinition } from './types';

type Table = NonNullable<FieldDefinition['free_table']>;

export function recordSampleBands(ft: Table) {
  return (ft.sample_bands?.length ? ft.sample_bands
    : ft.sample_band?.ref ? [{ id: 'legacy', ...ft.sample_band, refs: [ft.sample_band.ref] }] : [])
    .filter(b => b?.refs?.length && !b.matrix_code && !b.source_field);
}

/** Only entered sample values keep a report row; labels, units and computed defaults do not. */
export function sampleHasEnteredData(ft: Table, raw: Record<string, any>, bandId: string,
  sample: number, ref?: string): boolean {
  const band = recordSampleBands(ft).find(b => b.id === bandId);
  if (!band) return true; // Missing source metadata is handled by binding validation.
  const hasValue = (value: unknown): boolean => value !== null && value !== undefined
    && (typeof value !== 'string' || value.trim() !== '')
    && (!Array.isArray(value) || value.some(hasValue));
  const refs = ref ? [ref] : band.refs;
  const cross = band.axis === 'row' ? ft.columns : ft.rows;
  for (const axisRef of refs) for (const item of cross) {
    const key = band.axis === 'row' ? `${axisRef}::${item.id}` : `${item.id}::${axisRef}`;
    if (ft.header_cells?.[key] || ft.fixed_text_cells?.[key] || ft.sample_index_cells?.[key]
      || sampleBandForCell(ft, key)?.id !== bandId) continue;
    const span = ft.spans?.[key];
    if (ref && (band.axis === 'row' ? span?.rowspan || 1 : span?.colspan || 1) > 1) continue;
    const runtimeKey = `${key}::s${sample}`;
    if (ft.cell_formulas?.[key]) {
      if (hasValue(raw[`__formula_override__::${runtimeKey}`]?.value)) return true;
    } else {
      const value = Object.hasOwn(raw, runtimeKey) ? raw[runtimeKey] : raw[key];
      if (hasValue(value)) return true;
    }
  }
  return false;
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
