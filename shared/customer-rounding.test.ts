import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyNumericRounding, validateRoundingIntervals } from './numeric-rounding.ts';
import { ROUNDING_PRESETS } from './rounding-presets.ts';
import { roundFreeGridValue, freeGridNumberText } from './free-grid-number.ts';
import { renderFreeGridTypst } from './typst-generator.ts';
import type { FieldDefinition } from './types';

test('customer half-even and ceiling examples, including tails and negative ceiling', () => {
  for (const [n, result] of [[1.24, 1.2], [1.26, 1.3], [1.25, 1.2], [1.35, 1.4], [1.2501, 1.3]])
    assert.equal(applyNumericRounding(n, { mode: 'half_even', digits: 1 }), result);
  for (const [n, result] of [[2.11, 2.2], [2.1001, 2.2], [2.19, 2.2], [2.10, 2.1], [-2.11, -2.1]])
    assert.equal(applyNumericRounding(n, { mode: 'ceil', digits: 1 }), result);
});
test('interval 2 and 5 use half-even quotient and format precision', () => {
  for (const [n, result] of [[13, 12], [15, 16], [14, 14], [11, 12], [-13, -12]])
    assert.equal(applyNumericRounding(n, { mode: 'multiple_2' }), result);
  // 22.5 -> 20 follows the document's stated rule; its 25 example is contradictory.
  for (const [n, result] of [[22, 20], [22.5, 20], [27.5, 30], [18, 20]])
    assert.equal(applyNumericRounding(n, { mode: 'multiple_5' }), result);
  assert.equal(applyNumericRounding('1.3', { mode: 'multiple_2', digits: 1 }), 1.2);
  assert.equal(applyNumericRounding('1.3000000000001', { mode: 'multiple_2', digits: 1 }), 1.4);
  assert.equal(applyNumericRounding('2.25', { mode: 'multiple_5', digits: 1 }), 2);
  assert.equal(applyNumericRounding(130, { mode: 'multiple_2', digits: -1 }), 120);
});
test('four customer interval presets honor exact endpoints and select before rounding', () => {
  const fixtures = [
    [[99.5, 100], [100, 100], [105, 100], [115, 120], [999, 1000], [1050, 1000], [1150, 1200]],
    [[7.9, 8], [8, 8], [8.25, 8], [8.75, 9], [75, 75], [75.5, 76]],
    [[9.95, 10], [10, 10], [10.5, 10], [11.5, 12], [1000, 1000], [1005, 1000]],
    [[7.9, 8], [8, 8], [8.25, 8], [49.75, 50], [50, 50], [50.5, 50]],
  ];
  ROUNDING_PRESETS.forEach((preset, index) => {
    assert.equal(validateRoundingIntervals(preset.intervals), undefined);
    fixtures[index].forEach(([n, result]) => assert.equal(applyNumericRounding(n, { mode: 'piecewise', intervals: preset.intervals }), result, `${index}: ${n}`));
  });
  assert.ok(validateRoundingIntervals([{ upper: 8, step: 1, mode: 'half_even' }, { upper: 5, step: 1, mode: 'ceil' }, { step: 1, mode: 'ceil' }]));
  assert.ok(validateRoundingIntervals([{ step: 0, mode: 'half_even' }]));
});
test('template preview and entry share intervals without overwriting input', () => {
  const ft: NonNullable<FieldDefinition['free_table']> = { rows: [{ id: 'r' }], columns: [{ id: 'c', label: '' }], cells: { 'r::c': '1.3' }, input_cells: { 'r::c': true }, default_number_fmt: { mode: 'decimals', digits: 1 }, default_rounding: { mode: 'multiple_2' } };
  assert.equal(freeGridNumberText('1.3', ft, 'r::c'), '1.2');
  const field: FieldDefinition = { id: 'f', code: 'f', label: 'F', type: 'free_grid', free_table: ft };
  assert.ok(renderFreeGridTypst(field, ft).includes('1.2'));
  ft.default_rounding = { mode: 'piecewise', intervals: ROUNDING_PRESETS[1].intervals };
  const raw = { 'r::c': 8.25 }, before = JSON.stringify(raw);
  assert.equal(roundFreeGridValue(raw['r::c'], ft, 'r::c'), 8);
  assert.ok(renderFreeGridTypst(field, ft, raw).includes('8.0'));
  assert.equal(JSON.stringify(raw), before);
});
