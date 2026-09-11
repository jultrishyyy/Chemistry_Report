import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formulaAddressKeys, formulaRangeKeys, formulaRangeLabel } from './formula-grid-selection.ts';
import { resolveBinding, renderFreeGridTypst } from './typst-generator.ts';
import type { FieldDefinition, RecordTemplate } from './types';

const ft: NonNullable<FieldDefinition['free_table']> = {
  rows: [{ id: 'h' }, { id: 'a' }, { id: 'b' }, { id: 'total' }],
  columns: [{ id: 'label', label: '' }, { id: 'x', label: '' }, { id: 'y', label: '' }],
  cells: {}, header_cells: { 'h::x': true, 'h::y': true, 'a::label': true, 'b::label': true },
};
test('rectangular references work in both directions and exclude headers', () => {
  const keys = ['a::x', 'a::y', 'b::x', 'b::y'];
  assert.deepEqual(formulaRangeKeys(ft, { r: 0, c: 1 }, { r: 2, c: 2 }), keys);
  assert.deepEqual(formulaRangeKeys(ft, { r: 2, c: 2 }, { r: 0, c: 1 }), keys);
  assert.equal(formulaRangeLabel(ft, keys), 'B2:C3');
  assert.equal(formulaRangeLabel(ft, ['a::x', 'b::y']), undefined);
  assert.equal(formulaRangeLabel(ft, ['a::x']), 'B2');
});
test('merged covered cells are not counted twice and shrinking removes old cells', () => {
  const merged = { ...ft, spans: { 'a::x': { rowspan: 2, colspan: 2 } } };
  assert.deepEqual(formulaRangeKeys(merged, { r: 1, c: 1 }, { r: 2, c: 2 }), ['a::x']);
  assert.deepEqual(formulaRangeKeys(ft, { r: 1, c: 1 }, { r: 1, c: 1 }), ['a::x']);
});
test('compact source address entry validates bounds and resolves stable keys', () => {
  assert.deepEqual(formulaAddressKeys(ft, 'b2:C3'), ['a::x', 'a::y', 'b::x', 'b::y']);
  assert.deepEqual(formulaAddressKeys(ft, '$C$3:$B$2'), ['a::x', 'a::y', 'b::x', 'b::y']);
  assert.deepEqual(formulaAddressKeys(ft, 'B1'), [], 'header is not a source');
  for (const invalid of ['B0', 'Z2', 'B2:B99', 'B2+B3', 'B2:B']) assert.throws(() => formulaAddressKeys(ft, invalid));
});
test('hidden dependency UI does not change full-precision nested evaluation', () => {
  const table = structuredClone(ft);
  table.input_cells = { 'a::x': true, 'b::y': true };
  table.cell_formulas = { 'b::x': { type: 'sum', sources: ['a::x'], decimals: 2 }, 'total::x': { type: 'sum', sources: ['b::x', 'b::y'] } };
  table.cell_number_fmt = { 'b::x': { mode: 'decimals', digits: 2 } };
  const field: FieldDefinition = { id: 'f', code: 'f', label: 'F', type: 'free_grid', free_table: table };
  const ctx = { linked_record_template: { groups: [{ id: 'g', label: 'G', fields: [field] }] } as RecordTemplate, record_raw_data: { f: { 'a::x': 1.23456, 'b::y': 2.34567 } } };
  const binding = { source: 'record_free_formula_cell' as const, field_code: 'f', cell_key: 'total::x' };
  assert.ok(Math.abs(Number(resolveBinding(binding, ctx)) - 3.58023) < 1e-12, 'display decimals do not round intermediate operands');
  table.cell_rounding = { 'b::x': { mode: 'half_up', digits: 2 } };
  assert.ok(Math.abs(Number(resolveBinding(binding, ctx)) - 3.57567) < 1e-12, 'explicit rounding remains intentional calculation semantics');
});
test('fixed and dynamic sample aggregates agree in report and record PDF', () => {
  const table = structuredClone(ft);
  table.sample_bands = [{ id: 's', axis: 'row', refs: ['a', 'b'], cross_refs: ['x', 'y'] }];
  table.cell_formulas = { 'total::x': { type: 'sum', sources: ['a::x', 'b::x'], sample_scope: 'selected' } };
  table.cell_number_fmt = { 'total::x': { mode: 'decimals', digits: 3 } };
  const field: FieldDefinition = { id: 'f', code: 'f', label: 'F', type: 'free_grid', free_table: table };
  const template = { groups: [{ id: 'g', label: 'G', fields: [field] }] } as RecordTemplate;
  const raw = { '__sample_axes__::s': [{ ref: 'a', sample: 0 }, { ref: 'b', sample: 0 }, { ref: 'b', sample: 1 }], 'a::x::s0': 11, 'b::x::s0': 12, 'b::x::s1': 100 };
  const ctx = { linked_record_template: template, record_raw_data: { f: raw } };
  const binding = { source: 'record_free_formula_cell' as const, field_code: 'f', cell_key: 'total::x' };
  assert.equal(resolveBinding(binding, ctx), '23');
  assert.ok(renderFreeGridTypst(field, table, raw).includes('23.000'));
  table.cell_formulas['total::x'].sample_scope = 'all';
  assert.equal(resolveBinding(binding, ctx), '123');
  assert.ok(renderFreeGridTypst(field, table, raw).includes('123.000'));
  table.cell_formulas['total::x'].sample_scope = 'selected';
  raw['__sample_axes__::s'].splice(1, 1);
  assert.equal(resolveBinding(binding, ctx), '11');
});
