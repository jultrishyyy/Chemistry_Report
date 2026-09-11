import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderFreeGridTypst } from './typst-generator.ts';
import { freeGridAddress, freeGridFormulaLabel } from './free-grid-formula-label.ts';
import { encodeFreeGridCellReference } from './free-grid-formula.ts';
import type { FieldDefinition } from './types';

for (const axis of ['row', 'col'] as const) test(`${axis}: PDF sample expansion preserves custom formula aliases and manual values`, () => {
  const key = (part: string) => axis === 'row' ? `s::${part}` : `${part}::s`;
  const source = key('input'), target = key('result');
  const table: NonNullable<FieldDefinition['free_table']> = {
    rows: (axis === 'row' ? ['s'] : ['input', 'result']).map(id => ({ id })),
    columns: (axis === 'row' ? ['input', 'result'] : ['s']).map(id => ({ id, label: '' })), cells: {},
    input_cells: { [source]: true }, sample_bands: [{ id: 'samples', axis, refs: ['s'], cross_refs: ['input', 'result'] }],
    cell_formulas: { [target]: { type: 'custom', sources: [source], expression: 'A1 * 2', params: { source_aliases: { [source]: 'A1' } } } },
  };
  const field: FieldDefinition = { id: 'f', code: 'f', label: 'F', type: 'free_grid', free_table: table };
  const raw = { '__sample_count__::samples': 2, [`${source}::s0`]: 12.3456, [`${source}::s1`]: 23.4567 };
  const before = JSON.stringify({ table, raw });
  const pdf = renderFreeGridTypst(field, table, raw);
  assert.ok(pdf.includes('24.6912'), 'first sample result renders');
  assert.ok(pdf.includes('46.9134'), 'second sample result renders');
  assert.equal(JSON.stringify({ table, raw }), before);
  assert.ok(renderFreeGridTypst(field, table, { ...raw, [`__formula_override__::${target}::s1`]: { value: 99 } }).includes('99'));
  assert.equal(freeGridAddress(table, target), axis === 'row' ? 'B1' : 'A2');
  assert.equal(freeGridFormulaLabel(table.cell_formulas![target], 'f', () => table, () => 'F'), '=A1 * 2');
});
test('readable aliases use current coordinates in one pass, including cross-table sources', () => {
  const table: NonNullable<FieldDefinition['free_table']> = { rows: [{ id: 'r' }], columns: [{ id: 'b', label: '' }, { id: 'a', label: '' }], cells: {} };
  const cross = encodeFreeGridCellReference('g', 'r::a');
  const formula = { type: 'custom' as const, sources: ['r::a', 'r::b', cross], expression: 'A1 + B1 + T_g_B1', params: { source_aliases: { 'r::a': 'A1', 'r::b': 'B1', [cross]: 'T_g_B1' } } };
  assert.equal(freeGridFormulaLabel(formula, 'f', () => table, code => code === 'g' ? '另一张表' : '本表'), '=B1 + A1 + 另一张表!B1');
});
