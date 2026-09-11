import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FieldDefinition } from './types';
import { insertReportTableAxis, deleteReportTableAxis, resizeReportTableMerge, mergeReportTableRange, deleteReportTableRange, resizeReportTable } from './report-table-structure';
const table = (): NonNullable<FieldDefinition['free_table']> => ({
  rows: ['r0', 'r1', 'r2', 'r3'].map(id => ({ id })), columns: ['c0', 'c1', 'c2', 'c3'].map(id => ({ id, label: id })),
  cells: { 'r0::c0': '合并内容', 'r1::c1': '隐藏值', 'r3::c3': '末格' }, spans: { 'r0::c0': { rowspan: 3, colspan: 3 } },
});
test('table dimensions preserve existing IDs and cells; shrinking trims from bottom/right', () => {
  const t = table(); let id = 0;
  assert.equal(resizeReportTable(t, 6, 5, () => `new${id++}`), null);
  assert.equal(t.rows.length, 6); assert.equal(t.columns.length, 5);
  assert.equal(t.cells['r3::c3'], '末格');
  assert.equal(resizeReportTable(t, 2, 2, () => `new${id++}`), null);
  assert.deepEqual(t.rows.map(r => r.id), ['r0', 'r1']);
  assert.equal(t.cells['r3::c3'], undefined);
  assert.equal(t.cells['r0::c0'], '合并内容');
  assert.deepEqual(t.spans?.['r0::c0'], { rowspan: 2, colspan: 2 });
  const before = JSON.stringify(t);
  assert.ok(resizeReportTable(t, 0, 3, () => 'bad'));
  assert.equal(JSON.stringify(t), before);
});
for (const axis of ['row', 'col'] as const) {
  test(`${axis}: interior insert grows merge and delete shrinks it without changing values`, () => {
    const t = table(), values = { ...t.cells };
    assert.equal(insertReportTableAxis(t, axis, 1, 'new'), null);
    assert.equal(t.spans!['r0::c0'][axis === 'row' ? 'rowspan' : 'colspan'], 4);
    assert.deepEqual(t.cells, values);
    assert.equal(deleteReportTableAxis(t, axis, 'new'), null);
    assert.deepEqual(t, table());
    assert.equal(deleteReportTableAxis(t, axis, axis === 'row' ? 'r1' : 'c1'), null);
    assert.equal(t.spans!['r0::c0'][axis === 'row' ? 'rowspan' : 'colspan'], 2);
    assert.equal(t.cells['r0::c0'], '合并内容');
    assert.equal(t.cells['r3::c3'], '末格');
    assert.equal(t.cells['r1::c1'], undefined);
  });
  test(`${axis}: insertion at start/end does not absorb outside cells`, () => {
    for (const at of [0, 3, 4]) {
      const t = table();
      assert.equal(insertReportTableAxis(t, axis, at, 'new'), null);
      assert.deepEqual(t.spans, table().spans);
    }
  });
  test(`${axis}: anchor deletion and invalid requests leave all data untouched`, () => {
    const t = table(), before = JSON.stringify(t);
    assert.ok(deleteReportTableAxis(t, axis, axis === 'row' ? 'r0' : 'c0'));
    assert.equal(JSON.stringify(t), before);
    assert.ok(insertReportTableAxis(t, axis, 9, 'new'));
    assert.ok(insertReportTableAxis(t, axis, 1, 'r0'));
    assert.ok(deleteReportTableAxis(t, axis, 'missing'));
    assert.equal(JSON.stringify(t), before);
  });
}
test('overlapping and out-of-bounds merges are rejected atomically; splitting retains hidden values', () => {
  const t = table(), before = JSON.stringify(t);
  assert.ok(resizeReportTableMerge(t, 'r1', 'c1', 'colspan', 2));
  assert.ok(resizeReportTableMerge(t, 'r0', 'c0', 'rowspan', 5));
  assert.equal(JSON.stringify(t), before);
  assert.equal(resizeReportTableMerge(t, 'r0', 'c0', 'rowspan', 1), null);
  assert.equal(resizeReportTableMerge(t, 'r0', 'c0', 'colspan', 1), null);
  assert.deepEqual(t.spans, {});
  assert.equal(t.cells['r1::c1'], '隐藏值');
  assert.deepEqual(JSON.parse(JSON.stringify(t)), t);
});
test('expanding across another merge is rejected, adjacent merges remain allowed', () => {
  const t = table(); t.spans = { 'r0::c0': { rowspan: 2 }, 'r0::c2': { rowspan: 2 } };
  const before = JSON.stringify(t);
  assert.ok(resizeReportTableMerge(t, 'r0', 'c0', 'colspan', 3));
  assert.equal(JSON.stringify(t), before);
  assert.equal(resizeReportTableMerge(t, 'r0', 'c0', 'colspan', 2), null);
});
test('rectangle merge absorbs fully selected merges but rejects partial overlaps without data loss', () => {
  const t = table(), original = JSON.stringify(t), values = { ...t.cells };
  assert.ok(mergeReportTableRange(t, 1, 1, 3, 3));
  assert.equal(JSON.stringify(t), original);
  assert.equal(mergeReportTableRange(t, 0, 0, 3, 3), null);
  assert.deepEqual(t.spans, { 'r0::c0': { rowspan: 4, colspan: 4 } });
  assert.deepEqual(t.cells, values);
  assert.ok(mergeReportTableRange(t, 0, 0, 9, 3));
});
test('multi-axis deletion is atomic and permits removing a complete merged area', () => {
  for (const axis of ['row', 'col'] as const) {
    const t = table(), before = JSON.stringify(t);
    assert.ok(deleteReportTableRange(t, axis, 0, 1));
    assert.equal(JSON.stringify(t), before);
    assert.equal(deleteReportTableRange(t, axis, 0, 2), null);
    assert.equal((axis === 'row' ? t.rows : t.columns).length, 1);
    assert.equal(t.cells['r3::c3'], '末格');
    assert.deepEqual(t.spans, {});
    assert.ok(deleteReportTableRange(t, axis, 0, 0));
  }
});
