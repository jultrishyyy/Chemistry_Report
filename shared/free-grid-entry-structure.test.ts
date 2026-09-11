import assert from 'node:assert/strict';
import { test } from 'node:test';
import { entryRangeOnly, entrySpanRanges, entryInsertionIndex, rangesIntersect, expandEntryRange, resolveEntrySelection } from './free-grid-entry-structure.ts';
import { buildFreeGridLayout } from './free-grid-layout.ts';
import type { FieldDefinition } from './types';
const table: NonNullable<FieldDefinition['free_table']> = {
  cells: {},
  rows: [{ id: 'r0' }, { id: 'r1' }, { id: 'added', entry_added: true }],
  columns: [{ id: 'c0', label: '' }, { id: 'c1', label: '' }, { id: 'new', label: '', entry_added: true }],
  spans: { 'r0::c0': { rowspan: 2, colspan: 2 } },
};
test('only added cells may change structure; mixed selections are rejected', () => {
  assert.equal(entryRangeOnly(table, { minR: 2, maxR: 2, minC: 0, maxC: 2 }), true);
  assert.equal(entryRangeOnly(table, { minR: 0, maxR: 2, minC: 2, maxC: 2 }), true);
  assert.equal(entryRangeOnly(table, { minR: 1, maxR: 2, minC: 0, maxC: 2 }), false);
  assert.equal(entryRangeOnly(table, { minR: 3, maxR: 3, minC: 0, maxC: 0 }), false);
});
test('insertion defaults after selection and cannot cut through an existing merge', () => {
  assert.equal(entryInsertionIndex(table, 'row', 1), 2);
  assert.equal(entryInsertionIndex(table, 'col', 1), 2);
  assert.equal(entryInsertionIndex(table, 'row', 3), 3);
  assert.equal(entryInsertionIndex({ ...table, spans: {} }, 'col', 1), 1);
});
test('covered cells locate the full original merge for atomic protection', () => {
  assert.deepEqual(expandEntryRange(table, { minR: 1, maxR: 1, minC: 1, maxC: 1 }), { minR: 0, maxR: 1, minC: 0, maxC: 1 });
  const spans = entrySpanRanges(table);
  assert.equal(spans.length, 1);
  assert.equal(rangesIntersect(spans[0], { minR: 1, maxR: 1, minC: 1, maxC: 1 }), true);
  assert.equal(entryRangeOnly(table, spans[0]), false);
  assert.equal(rangesIntersect(spans[0], { minR: 2, maxR: 2, minC: 0, maxC: 1 }), false);
});

for (const axis of ['row', 'col'] as const) {
  test(`${axis}: an added-axis merge spanning repeated samples remains splittable`, () => {
    const ft: NonNullable<FieldDefinition['free_table']> = { ...table,
      sample_bands: [{ id: 's', axis, refs: axis === 'row' ? ['r0', 'r1'] : ['c0', 'c1'] }],
      spans: axis === 'row' ? { 'r0::new': { rowspan: 2, colspan: 1 } } : { 'added::c0': { rowspan: 1, colspan: 2 } },
    };
    const raw = { '__sample_axes__::s': (axis === 'row' ? ['r0', 'r1', 'r1'] : ['c0', 'c1', 'c1']).map((ref, i) => ({ ref, sample: i === 2 ? 1 : 0 })) };
    const range = axis === 'row' ? { minR: 0, maxR: 0, minC: 2, maxC: 2 } : { minR: 2, maxR: 2, minC: 0, maxC: 0 };
    const layout = buildFreeGridLayout(ft, raw);
    const selected = resolveEntrySelection(ft, layout.displayRows, layout.displayCols, layout.spans, range);
    assert.equal(selected.canSplit, true, 'existing merges in added content may be removed despite duplicate prototype axes');
    assert.equal(axis === 'row' ? selected.visual!.maxR : selected.visual!.maxC, 2);
    const split = { ...ft, spans: {} };
    const splitLayout = buildFreeGridLayout(split, raw);
    assert.equal(splitLayout.covered.size, 0);
    assert.equal(resolveEntrySelection(split, splitLayout.displayRows, splitLayout.displayCols, splitLayout.spans, range).canSplit, false);
    assert.equal(table.rows.length, 3);
  });
  test(`${axis}: a repeated sample is selected by displayed position, not prototype index`, () => {
    const ft = { ...table, spans: {}, sample_bands: [{ id: 's', axis, refs: axis === 'row' ? ['r1'] : ['c1'] }] };
    const layout = buildFreeGridLayout(ft, { '__sample_axes__::s': [{ ref: axis === 'row' ? 'r1' : 'c1', sample: 0 }, { ref: axis === 'row' ? 'r1' : 'c1', sample: 1 }] });
    const range = axis === 'row' ? { minR: 2, maxR: 2, minC: 0, maxC: 0 } : { minR: 0, maxR: 0, minC: 2, maxC: 2 };
    const selected = resolveEntrySelection(ft, layout.displayRows, layout.displayCols, layout.spans, range);
    assert.deepEqual(selected.visual, range);
    assert.equal(axis === 'row' ? selected.source!.minR : selected.source!.minC, 1);
    assert.equal(selected.canSplit, false);
    assert.equal(axis === 'row' ? selected.canDeleteRow : selected.canDeleteCol, true);
    assert.equal(axis === 'row' ? selected.canDeleteCol : selected.canDeleteRow, false);
    assert.deepEqual((axis === 'row' ? selected.sampleRows : selected.sampleCols).map(item => item.sample), [1]);
    const mixed = resolveEntrySelection(ft, layout.displayRows, layout.displayCols, layout.spans,
      axis === 'row' ? { minR: 0, maxR: 2, minC: 0, maxC: 0 } : { minR: 0, maxR: 0, minC: 0, maxC: 2 });
    assert.equal(axis === 'row' ? mixed.canDeleteRow : mixed.canDeleteCol, false, 'selection containing fixed original axes stays protected');
    const multi = resolveEntrySelection(ft, layout.displayRows, layout.displayCols, layout.spans,
      axis === 'row' ? { minR: 1, maxR: 2, minC: 0, maxC: 0 } : { minR: 0, maxR: 0, minC: 1, maxC: 2 });
    assert.equal((axis === 'row' ? multi.sampleRows : multi.sampleCols).length, 2);
  });
}

test('toolbar enables only legal axis deletion and real editable merges', () => {
  const ft = { ...table, spans: {} };
  const layout = buildFreeGridLayout(ft, {});
  const select = (range: Parameters<typeof resolveEntrySelection>[4]) => resolveEntrySelection(ft, layout.displayRows, layout.displayCols, layout.spans, range);
  const newCol = select({ minR: 0, maxR: 0, minC: 2, maxC: 2 });
  assert.equal(newCol.canDeleteRow, false);
  assert.equal(newCol.canDeleteCol, true);
  assert.equal(newCol.canMerge, false);
  assert.equal(newCol.canSplit, false);
  const newRow = select({ minR: 2, maxR: 2, minC: 0, maxC: 1 });
  assert.equal(newRow.canDeleteRow, true);
  assert.equal(newRow.canDeleteCol, false);
  assert.equal(newRow.canMerge, true);
  const mixed = select({ minR: 1, maxR: 2, minC: 0, maxC: 1 });
  assert.equal(mixed.canMerge, false);
  const merged = { ...ft, spans: { 'added::c0': { rowspan: 1, colspan: 2 } } };
  const ml = buildFreeGridLayout(merged, {});
  const ms = resolveEntrySelection(merged, ml.displayRows, ml.displayCols, ml.spans, { minR: 2, maxR: 2, minC: 0, maxC: 0 });
  assert.equal(ms.canSplit, true);
  assert.equal(ms.canMerge, false);
});

test('retaining the displayed anchor supports row insertion followed by column insertion', () => {
  const ft = { ...table, spans: {} };
  const anchor = { minR: 0, maxR: 0, minC: 0, maxC: 0 };
  const rowAt = entryInsertionIndex(ft, 'row', anchor.maxR + 1);
  const updated = { ...ft, rows: [...ft.rows] };
  updated.rows.splice(rowAt, 0, { id: 'new-row', entry_added: true });
  const layout = buildFreeGridLayout(updated, {});
  const selection = resolveEntrySelection(updated, layout.displayRows, layout.displayCols, layout.spans, anchor);
  assert.equal(entryInsertionIndex(updated, 'col', selection.source!.maxC + 1), 1);
});

for (const axis of ['row', 'col'] as const) {
  test(`${axis}: added cells in a repeated sample can merge and the resulting merge can split`, () => {
    const ft: NonNullable<FieldDefinition['free_table']> = { ...table, spans: {},
      rows: [...table.rows, { id: 'added2', entry_added: true }],
      columns: [...table.columns, { id: 'new2', label: '', entry_added: true }],
      sample_bands: [{ id: 's', axis, refs: axis === 'row' ? ['r1'] : ['c1'] }] };
    const raw = { '__sample_axes__::s': [{ ref: axis === 'row' ? 'r1' : 'c1', sample: 0 }, { ref: axis === 'row' ? 'r1' : 'c1', sample: 1 }] };
    const range = axis === 'row' ? { minR: 2, maxR: 2, minC: 2, maxC: 3 } : { minR: 2, maxR: 3, minC: 2, maxC: 2 };
    let layout = buildFreeGridLayout(ft, raw);
    let selected = resolveEntrySelection(ft, layout.displayRows, layout.displayCols, layout.spans, range);
    assert.equal(selected.canMerge, true);
    assert.equal(selected.canSplit, false);
    ft.spans = axis === 'row' ? { 'r1::new': { rowspan: 1, colspan: 2 } } : { 'added::c1': { rowspan: 2, colspan: 1 } };
    layout = buildFreeGridLayout(ft, raw);
    selected = resolveEntrySelection(ft, layout.displayRows, layout.displayCols, layout.spans, range);
    assert.equal(selected.canSplit, true);
    assert.equal(selected.canMerge, false);
  });
}
