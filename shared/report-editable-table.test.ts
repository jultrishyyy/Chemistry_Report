import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FieldDefinition } from './types';
import { reportEditableTable, editReportTable } from './report-editable-table';
import { resolveReportFreeGridValues, renderFreeGridTypst } from './typst-generator';
test('opening mapped table is read-only; first edit snapshots once and later edits preserve it', () => {
  const field: FieldDefinition = { id: 'f', code: 'f', label: '', type: 'free_grid', free_table: {
    rows: [{ id: 'r' }], columns: [{ id: 'c', label: '' }], cells: {},
    cell_bindings: { 'r::c': { source: 'literal', text: '来源内容' } },
  } };
  const original = structuredClone(field.free_table), before = JSON.stringify(field);
  const table = reportEditableTable(field, {});
  assert.equal(table.cells['r::c'], '来源内容');
  assert.equal(JSON.stringify(field), before);
  editReportTable(field, {}, f => { f.free_table!.cells['r::c'] = '第一次'; });
  assert.deepEqual(field.instance_auto_free_table, original);
  assert.equal(field.free_table!.cell_bindings, undefined);
  editReportTable(field, {}, f => { f.free_table!.rows.push({ id: 'r2' }); });
  assert.equal(reportEditableTable(field, {}).cells['r::c'], '第一次');
  assert.equal(field.free_table!.rows.length, 2);
  assert.deepEqual(field.instance_auto_free_table, original);
  const reopened = JSON.parse(JSON.stringify(field));
  assert.equal(JSON.stringify(reportEditableTable(reopened, {})), JSON.stringify(field.free_table));
});
test('shared numeric projection retains precision and does not mutate the table', () => {
  const field: FieldDefinition = { id: 'f', code: 'f', label: '', type: 'free_grid', free_table: {
    rows: [{ id: 'r' }], columns: [{ id: 'c', label: '' }], cells: { 'r::c': '1.23456789' },
  } };
  const before = JSON.stringify(field);
  assert.equal(resolveReportFreeGridValues(field, field.free_table!)['r::c'], '1.23456789');
  assert.equal(JSON.stringify(field), before);
});
test('snapshot conversion retains explicit table number-format semantics for resolved bindings', () => {
  const field: FieldDefinition = { id: 'f', code: 'f', label: '', type: 'free_grid', free_table: {
    rows: [{ id: 'r' }], columns: [{ id: 'c', label: '' }], cells: {}, default_number_fmt: { mode: 'decimals', digits: 2 },
    cell_bindings: { 'r::c': { source: 'literal', text: '1.23456789' } },
  } };
  const before = renderFreeGridTypst(field, field.free_table!, undefined, {});
  editReportTable(field, {}, () => {});
  assert.equal(renderFreeGridTypst(field, field.free_table!, undefined, {}), before);
  assert.equal(field.free_table!.cells['r::c'], '1.23456789');
});
