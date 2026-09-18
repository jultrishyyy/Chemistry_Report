import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceSelectionData } from './report-source-selection';
import { makeReportManualTable } from './report-document-editing';
import type { FieldDefinition } from './types';
const table: NonNullable<FieldDefinition['free_table']> = {
  rows: [{ id: 'r' }, { id: 's', entry_added: true }], columns: [{ id: 'a', label: '' }, { id: 'b', label: '' }],
  cells: { 'r::a': '1.20', 'r::b': 'hidden', 's::a': 'line\nnext', 's::b': '2.00' }, spans: { 'r::a': { colspan: 2 } },
  cell_formulas: { 'r::a': { type: 'custom', sources: [], expression: '1.2' } }, default_number_fmt: { mode: 'decimals', digits: 5 },
};
test('source insertion expands merges and copies display strings without source semantics', () => {
  const before = JSON.stringify(table);
  const data = sourceSelectionData(table, { minR: 0, maxR: 0, minC: 1, maxC: 1 });
  const field = makeReportManualTable('inserted', { tableData: data });
  assert.equal(field.free_table!.columns.length, 2);
  assert.equal(field.free_table!.cells['r1::c1'], '1.20');
  assert.equal(field.free_table!.cells['r1::c2'], '');
  assert.deepEqual(field.free_table!.spans, { 'r1::c1': { rowspan: 1, colspan: 2 } });
  assert.equal(field.free_table!.cell_formulas, undefined);
  assert.equal(field.free_table!.default_number_fmt, undefined);
  assert.equal(JSON.stringify(table), before);
  field.free_table!.cells['r1::c1'] = 'modified';
  assert.equal(table.cells['r::a'], '1.20');
});
test('invalid or oversized insertions reject without truncation', () => {
  assert.throws(() => sourceSelectionData(table, { minR: -1, maxR: 0, minC: 0, maxC: 0 }));
  assert.throws(() => makeReportManualTable('x', { tableData: { cells: [['a'], ['b', 'c']] } }));
  assert.throws(() => makeReportManualTable('x', { tableData: { cells: Array.from({ length: 101 }, () => ['a']) } }));
  assert.throws(() => makeReportManualTable('x', { tableData: { cells: [['a']], spans: [{ row: 0, col: 0, rowspan: 2, colspan: 1 }] } }));
});
