import type { FieldDefinition } from './types';
import type { FreeGridDisplayAxis } from './free-grid-layout';
import { recordSampleBands } from './free-grid-binding';
type Table = NonNullable<FieldDefinition['free_table']>;
export type EntryRange = { minR: number; maxR: number; minC: number; maxC: number };
export const ORIGINAL_STRUCTURE_MESSAGE = '原表格结构不可修改，仅能新增行/列并对新增内容进行修改。';
export function entryRangeOnly(table: Table, range: EntryRange): boolean {
  for (let r = range.minR; r <= range.maxR; r++) for (let c = range.minC; c <= range.maxC; c++) {
    if (!table.rows[r] || !table.columns[c] || (!table.rows[r].entry_added && !table.columns[c].entry_added)) return false;
  }
  return true;
}
export function entrySpanRanges(table: Table) {
  return Object.entries(table.spans || {}).flatMap(([key, span]) => {
    const [rid, cid] = key.split('::');
    const minR = table.rows.findIndex(row => row.id === rid), minC = table.columns.findIndex(col => col.id === cid);
    return minR < 0 || minC < 0 ? [] : [{ key, minR, minC,
      maxR: minR + Math.max(1, span.rowspan || 1) - 1, maxC: minC + Math.max(1, span.colspan || 1) - 1 }];
  });
}
export const rangesIntersect = (a: EntryRange, b: EntryRange) => a.minR <= b.maxR && a.maxR >= b.minR && a.minC <= b.maxC && a.maxC >= b.minC;
export function expandEntryRange(table: Table, range: EntryRange): EntryRange {
  let result = { ...range };
  let changed = true;
  while (changed) {
    changed = false;
    for (const span of entrySpanRanges(table)) {
      if (!rangesIntersect(result, span)) continue;
      const next = { minR: Math.min(result.minR, span.minR), maxR: Math.max(result.maxR, span.maxR),
        minC: Math.min(result.minC, span.minC), maxC: Math.max(result.maxC, span.maxC) };
      if (next.minR !== result.minR || next.maxR !== result.maxR || next.minC !== result.minC || next.maxC !== result.maxC) changed = true;
      result = next;
    }
  }
  return result;
}
/** Selection uses displayed coordinates; repeated samples may share the same prototype idx. */
export function resolveEntrySelection(table: Table, rows: FreeGridDisplayAxis[], cols: FreeGridDisplayAxis[], spans: Map<string, { rs: number; cs: number }>, range: EntryRange | null) {
  const none = { visual: null, source: null, sampleRows: [] as FreeGridDisplayAxis[], sampleCols: [] as FreeGridDisplayAxis[], canDeleteRow: false, canDeleteCol: false, canMerge: false, canSplit: false };
  if (!range || !rows[range.minR] || !rows[range.maxR] || !cols[range.minC] || !cols[range.maxC]) return none;
  const visualTable: Table = { cells: {}, rows: rows.map((_, i) => ({ id: String(i) })), columns: cols.map((_, i) => ({ id: String(i), label: '' })),
    spans: Object.fromEntries([...spans].map(([key, span]) => [key.replace(',', '::'), { rowspan: span.rs, colspan: span.cs }])) };
  const visual = expandEntryRange(visualTable, range);
  const selectedRows = rows.slice(visual.minR, visual.maxR + 1), selectedCols = cols.slice(visual.minC, visual.maxC + 1);
  const bands = recordSampleBands(table);
  const samplesOnly = (items: FreeGridDisplayAxis[], axis: 'row' | 'col') => items.every(item => item.sample != null
    && bands.some(band => band.axis === axis && band.refs.includes(item.id))) ? items : [];
  const sampleRows = samplesOnly(selectedRows, 'row'), sampleCols = samplesOnly(selectedCols, 'col');
  const source = { minR: Math.min(...selectedRows.map(r => r.idx)), maxR: Math.max(...selectedRows.map(r => r.idx)),
    minC: Math.min(...selectedCols.map(c => c.idx)), maxC: Math.max(...selectedCols.map(c => c.idx)) };
  const relevantSpans = entrySpanRanges(table).filter(span => rangesIntersect(span, source));
  const addedOnly = entryRangeOnly(table, source) && relevantSpans.every(span => entryRangeOnly(table, span));
  // Added parameter cells may be edited inside a repeated sample. Only reject a
  // selection containing multiple copies of the same prototype axis: that cannot
  // be represented as one template rectangle without merging different samples.
  const unique = new Set(selectedRows.map(row => row.idx)).size === selectedRows.length
    && new Set(selectedCols.map(col => col.idx)).size === selectedCols.length;
  const canDelete = (axis: 'row' | 'col') => {
    const selected = axis === 'row' ? selectedRows : selectedCols;
    const sourceAxes = axis === 'row' ? table.rows : table.columns;
    return selected.every(item => sourceAxes[item.idx]?.entry_added) && entrySpanRanges(table)
      .filter(span => selected.some(item => item.idx >= (axis === 'row' ? span.minR : span.minC) && item.idx <= (axis === 'row' ? span.maxR : span.maxC)))
      .every(span => entryRangeOnly(table, span));
  };
  const multi = visual.minR !== visual.maxR || visual.minC !== visual.maxC;
  const exactMerge = relevantSpans.length === 1 && ['minR', 'maxR', 'minC', 'maxC'].every(k => relevantSpans[0][k as keyof EntryRange] === source[k as keyof EntryRange]);
  return { visual, source, sampleRows, sampleCols, canDeleteRow: sampleRows.length > 0 || canDelete('row'), canDeleteCol: sampleCols.length > 0 || canDelete('col'),
    // Splitting removes an existing added-area merge; repeated display axes do
    // not make that operation ambiguous (unlike creating a new cross-sample merge).
    canMerge: unique && addedOnly && multi && !exactMerge, canSplit: addedOnly && relevantSpans.some(span => span.minR !== span.maxR || span.minC !== span.maxC) };
}
/** Insert after a merged cell, never through its interior. */
export function entryInsertionIndex(table: Table, axis: 'row' | 'col', after: number) {
  let at = after;
  let changed = true;
  while (changed) {
    changed = false;
    for (const span of entrySpanRanges(table)) {
      const start = axis === 'row' ? span.minR : span.minC, end = axis === 'row' ? span.maxR : span.maxC;
      if (start < at && end >= at) { at = end + 1; changed = true; }
    }
  }
  return at;
}
