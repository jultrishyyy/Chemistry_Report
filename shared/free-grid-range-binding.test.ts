import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rangeCellBindings } from './free-grid-range-binding';
import type { FieldDefinition } from './types';
type Table = NonNullable<FieldDefinition['free_table']>;
const target: Table = { rows: [{ id: 'r1' }, { id: 'r2' }], columns: [{ id: 'c1', label: '' }, { id: 'c2', label: '' }], cells: {} };
const source: Table = { rows: [{ id: 's1' }, { id: 's2' }], columns: [{ id: 'a', label: '' }, { id: 'b', label: '' }], cells: {} };
test('row and column mappings use corresponding source cells, preserving sample mode', () => {
  const binding = { source: 'record_free_cell_sample' as const, field_code: 'grid', cell_key: 's1::a' };
  assert.deepEqual(rangeCellBindings(['r1::c1', 'r2::c1'], target, binding, () => source), {
    'r1::c1': binding, 'r2::c1': { ...binding, cell_key: 's2::a' },
  });
  assert.deepEqual(rangeCellBindings(['r1::c1', 'r1::c2'], target, binding, () => source)['r1::c2'], { ...binding, cell_key: 's1::b' });
  assert.throws(() => rangeCellBindings(['r1::c1', 'r2::c1'], target, { ...binding, cell_key: 's2::a' }, () => source), /尺寸不足/);
});
test('fixed text can be applied to a whole selection without shared mutable objects', () => {
  const binding = { source: 'literal' as const, text: '说明' };
  const mapped = rangeCellBindings(['r1::c1', 'r2::c1'], target, binding, () => source);
  assert.deepEqual(mapped['r1::c1'], binding);
  assert.notEqual(mapped['r1::c1'], mapped['r2::c1']);
});
test('a sample row maps input and formula results using each source role', () => {
  const table: Table = { ...source, input_cells: { 's1::a': true }, cell_formulas: { 's1::b': { type: 'sum', sources: ['s1::a'] } },
    sample_bands: [{ id: 'samples', axis: 'row', refs: ['s1'], cross_refs: ['a', 'b'] }] };
  const mapped = rangeCellBindings(['r1::c1', 'r1::c2'], target, { source: 'record_free_cell_sample', field_code: 'grid', cell_key: 's1::a' }, () => table);
  assert.equal(mapped['r1::c1'].source, 'record_free_cell_sample');
  assert.equal(mapped['r1::c2'].source, 'record_free_formula_cell_sample');
  assert.throws(() => rangeCellBindings(['r1::c1', 'r2::c1'], target, { source: 'record_free_cell_sample', field_code: 'grid', cell_key: 's1::a' }, () => table), /超出试样/);
});
