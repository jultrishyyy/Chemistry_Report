import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completeGridFormula, gridOutputText } from './grid-missing-display';
import { FormulaError, isFormulaError } from './formula-error';
import { recordFreeGridSnapshot, renderFreeGridTypst } from './typst-generator';
import type { FieldDefinition } from './types';

test('missing/error display preserves zero, fixed labels and calculation error objects', () => {
  assert.equal(gridOutputText('', true), '/');
  assert.equal(gridOutputText('   ', true), '/');
  assert.equal(gridOutputText(0, true), '0');
  assert.equal(gridOutputText('', false), '');
  assert.equal(gridOutputText(new FormulaError('#DIV/0!', '除零'), true, true), '/');
  assert.equal(gridOutputText('#REF!', true, true), '/');
  const partial = completeGridFormula(3, [3, '']);
  assert.ok(isFormulaError(partial));
  assert.equal(completeGridFormula(0, [0, 0]), 0);
});

test('PDF and snapshot show slash for partial formulas and empty input cells without modifying data', () => {
  const table: NonNullable<FieldDefinition['free_table']> = {
    rows: [{ id: 'r' }], columns: ['a', 'b', 'sum', 'fixed'].map(id => ({ id, label: '' })),
    cells: {}, input_cells: { 'r::a': true, 'r::b': true }, cell_units: { 'r::b': 'MPa' },
    cell_formulas: { 'r::sum': { type: 'sum', sources: ['r::a', 'r::b'] } },
  };
  const field = { code: 'grid', type: 'free_grid', free_table: table } as FieldDefinition;
  const raw = { 'r::a': '3', 'r::b': '' };
  const before = JSON.stringify(raw);
  const snapshot = recordFreeGridSnapshot(field, raw)!;
  assert.equal(snapshot.cells['r::a'], '3');
  assert.equal(snapshot.cells['r::b'], '/');
  assert.equal(snapshot.cells['r::sum'], '/');
  assert.equal(snapshot.cells['r::fixed'], '');
  const pdf = renderFreeGridTypst(field, table, raw);
  assert.doesNotMatch(pdf, /#VALUE!|#DIV\/0!|MPa/);
  assert.match(pdf, /\//);
  assert.equal(JSON.stringify(raw), before);
  assert.equal(recordFreeGridSnapshot(field, { ...raw, 'r::b': '2' })!.cells['r::sum'], '5');
});
