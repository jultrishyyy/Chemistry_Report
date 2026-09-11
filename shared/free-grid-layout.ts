import type { FieldDefinition } from './types';
import { readSampleAxes } from './free-grid-samples';

type Table = NonNullable<FieldDefinition['free_table']>;
export type FreeGridDisplayAxis = { id: string; idx: number; sample: number | null };

/** Recording, paste/import and PDF share the same sample order and merged cells. */
export function buildFreeGridLayout(ft: Table, raw: Record<string, any>, sampleIndices?: Record<string, number[]>) {
  const bands = (ft.sample_bands?.length ? ft.sample_bands
    : ft.sample_band?.ref ? [{ id: 'legacy', ...ft.sample_band, refs: [ft.sample_band.ref] }] : [])
    .filter(b => b?.refs?.length && !b.matrix_code && !b.source_field);
  const axisIsRow = bands[0]?.axis !== 'col';
  const countOf = (b: { id: string }) => Math.max(1, Math.min(50, Math.round(
    Number(raw[`__sample_count__::${b.id}`]) || (b.id === 'legacy' ? Number(raw.__sample_count__) : 0) || 1)));
  const bandOfAxis = new Map<string, typeof bands[number]>();
  const samplesOf = (b: { id: string }) => sampleIndices?.[b.id]
    ?? Array.from({ length: countOf(b) }, (_, i) => i);
  for (const band of bands) for (const id of band.refs) if (!bandOfAxis.has(id)) bandOfAxis.set(id, band);
  const expand = (items: { id: string }[], enabled: boolean): FreeGridDisplayAxis[] => {
    const out: FreeGridDisplayAxis[] = [];
    let p = 0;
    while (p < items.length) {
      const band = enabled ? bandOfAxis.get(items[p].id) : undefined;
      if (!band) { out.push({ id: items[p].id, idx: p++, sample: null }); continue; }
      const start = p;
      while (p < items.length && bandOfAxis.get(items[p].id)?.id === band.id) p++;
      const entries = readSampleAxes(raw, band.id);
      if (entries) {
        const blockIds = new Set(items.slice(start, p).map(item => item.id));
        for (const entry of entries) {
          if (!blockIds.has(entry.ref)) continue;
          out.push({ id: entry.ref, idx: items.findIndex(item => item.id === entry.ref), sample: entry.sample });
        }
        continue;
      }
      for (const sample of samplesOf(band)) {
        for (let idx = start; idx < p; idx++) out.push({ id: items[idx].id, idx, sample });
      }
    }
    return out;
  };
  const displayRows = expand(ft.rows, axisIsRow), displayCols = expand(ft.columns, !axisIsRow);
  const covered = new Set<string>();
  const spans = new Map<string, { rs: number; cs: number }>();
  for (const [key, span] of Object.entries(ft.spans || {})) {
    const [rid, cid] = key.split('::');
    const ri = ft.rows.findIndex(r => r.id === rid), ci = ft.columns.findIndex(c => c.id === cid);
    if (ri < 0 || ci < 0) continue;
    const rs = Math.min(Math.max(span.rowspan || 1, 1), ft.rows.length - ri);
    const cs = Math.min(Math.max(span.colspan || 1, 1), ft.columns.length - ci);
    const axis = axisIsRow ? ft.rows : ft.columns;
    const start = axisIsRow ? ri : ci, size = axisIsRow ? rs : cs;
    const band = bandOfAxis.get(axis[start].id);
    // A merge wholly inside one sample repeats for each sample. A merge crossing
    // the band boundary stretches over the expanded region only once.
    const perSample = band && axis.slice(start, start + size).every(it => bandOfAxis.get(it.id)?.id === band.id);
    const explicit = band && readSampleAxes(raw, band.id);
    // Cross-row merges in a formerly repeated block remain shared across the visible rows.
    const samples = perSample && !(explicit && size > 1)
      ? explicit ? [...new Set(explicit.filter(e => e.ref === axis[start].id).map(e => e.sample))] : samplesOf(band)
      : [null];
    for (const sample of samples) {
      const rr = displayRows.flatMap((r, i) => r.idx >= ri && r.idx < ri + rs && (!axisIsRow || sample == null || r.sample === sample) ? [i] : []);
      const cc = displayCols.flatMap((c, i) => c.idx >= ci && c.idx < ci + cs && (axisIsRow || sample == null || c.sample === sample) ? [i] : []);
      if (!rr.length || !cc.length) continue;
      spans.set(`${rr[0]},${cc[0]}`, { rs: rr.length, cs: cc.length });
      for (const r of rr) for (const c of cc) if (r !== rr[0] || c !== cc[0]) covered.add(`${r},${c}`);
    }
  }
  const sampleForCell = (rowId: string, colId: string, rowSample: number | null, colSample: number | null) => {
    const sample = rowSample ?? colSample;
    const band = bandOfAxis.get(axisIsRow ? rowId : colId);
    const key = `${rowId}::${colId}`;
    // A newly added sample's own header is editable even beside a partial data region.
    // Headers spanning multiple samples remain shared and must not get a private value.
    const headerSpan = axisIsRow ? ft.spans?.[key]?.rowspan : ft.spans?.[key]?.colspan;
    if (sample != null && sample > 0 && band && ft.header_cells?.[key] && (headerSpan || 1) === 1) return sample;
    return sample != null && band && (!band.cross_refs?.length || band.cross_refs.includes(axisIsRow ? colId : rowId)) ? sample : null;
  };
  return { displayRows, displayCols, covered, spans, sampleForCell, bands, axisIsRow, countOf, bandOfAxis };
}
