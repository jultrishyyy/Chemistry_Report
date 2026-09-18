import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFreeGridLayout, freeGridFormulaSample } from './free-grid-layout';
import { executeWithFullPrecision } from './formula-engine';
import { formulaAwaitingInput } from './formula-entry-display';
import { recordFreeGridSnapshot } from './typst-generator';
import type { FieldDefinition, Formula } from './types';

test('partial sample region: adjacent average reads entered sample values and agrees with PDF', () => {
  const formula: Formula = { type: 'custom', expression: 'AVERAGE(v1,v2,v3)', params: { expression_dialect: 'excel_v1' }, sources: ['r::a', 'r::b', 'r::c'] };
  const table: NonNullable<FieldDefinition['free_table']> = {
    rows: [{ id: 'r' }], columns: ['a', 'b', 'c', 'avg'].map(id => ({ id, label: '' })), cells: {},
    input_cells: { 'r::a': true, 'r::b': true, 'r::c': true },
    sample_bands: [{ id: 'samples', axis: 'row', refs: ['r'], cross_refs: ['a', 'b', 'c'] }],
    cell_formulas: { 'r::avg': formula }, default_number_fmt: { mode: 'decimals', digits: 2 },
  };
  for (const values of [['1', '1', '1'], ['1', '2', '3'], ['0', '0', '0'], ['', '', '']]) {
    const raw = Object.fromEntries(formula.sources!.map((key, i) => [`${key}::s0`, values[i]]));
    const layout = buildFreeGridLayout(table, raw);
    assert.equal(layout.sampleForCell('r', 'avg', 0, null), null, 'formula is outside selected rectangle');
    const sample = freeGridFormulaSample(layout, 'r::avg', null);
    assert.equal(sample, 0);
    const sourceData = Object.fromEntries(formula.sources!.map(key => [key, raw[`${key}::s${sample}`]]));
    const result = executeWithFullPrecision(formula, sourceData);
    assert.equal(formulaAwaitingInput(Object.values(sourceData), result), values[0] === '');
    if (values[0] !== '') {
      assert.equal(result, values.reduce((sum, v) => sum + Number(v), 0) / 3);
      const snapshot = recordFreeGridSnapshot({ code: 'grid', type: 'free_grid', free_table: table } as FieldDefinition, raw);
      assert.equal(snapshot?.cells['r#s0::avg'], Number(result).toFixed(2));
    }
  }
});

test('formula sample selection supports columns and nonzero sample identifiers', () => {
  const layout = { axisIsRow: false, displayRows: [{ id: 'r', idx: 0, sample: null }], displayCols: [{ id: 'c', idx: 0, sample: 4 }] };
  assert.equal(freeGridFormulaSample(layout, 'r::c', null), 4);
  assert.equal(freeGridFormulaSample(layout, 'r::c', 6), 6);
  assert.equal(freeGridFormulaSample(layout, 'r::fixed', null), null);
});
