import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordFreeGridSnapshot } from './typst-generator';
import type { FieldDefinition } from './types';
test('source snapshot retains instance structure, precision, formatting, formulas and does not mutate input', () => {
  const field: FieldDefinition = { id: 'f', code: 'f', label: '', type: 'free_grid', free_table: { rows: [{ id: 'r' }], columns: [{ id: 'a', label: '' }], cells: {} } };
  const raw = { __free_table_structure__: { rows: [{ id: 'r' }, { id: 'new', entry_added: true }], columns: [{ id: 'a' }, { id: 'b' }], cells: {}, input_cells: { 'r::a': true }, cell_number_fmt: { 'r::a': { mode: 'decimal', digits: 2 } }, cell_formulas: { 'r::b': { type: 'custom', sources: ['r::a'], expression: 'A1 * 2', params: { source_aliases: { 'r::a': 'A1' } } } } }, 'r::a': 1.234567, 'new::a': 9.87654321 };
  const before = JSON.stringify({ field, raw });
  const table = recordFreeGridSnapshot(field, raw)!;
  assert.equal(table.rows.length, 2);
  assert.equal(table.rows[1].entry_added, true);
  assert.equal(table.cells['r::a'], '1.23');
  assert.equal(table.cells['r::b'], '2.469134', 'formulas use unformatted precision');
  assert.equal(table.cells['new::a'], '9.87654321');
  assert.equal(JSON.stringify({ field, raw }), before);
});
