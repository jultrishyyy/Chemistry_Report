import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFreeGridLayout } from './free-grid-layout.ts';
import { renderFreeGridTypst } from './typst-generator.ts';
import type { FieldDefinition } from './types';

const table = (): NonNullable<FieldDefinition['free_table']> => ({
  rows: [{ id: 'a' }, { id: 'b' }],
  columns: [{ id: 'x', label: '' }, { id: 'y', label: '' }],
  cells: {},
  sample_bands: [{ id: 'samples', axis: 'row', refs: ['a', 'b'] }],
  spans: { 'a::x': { rowspan: 2, colspan: 1 } },
});
const field = { code: 'grid', type: 'free_grid', hide_label: true } as FieldDefinition;

test('multi-row samples repeat as blocks with a separate merge for each sample', () => {
  const ft = table();
  const raw = { '__sample_count__::samples': 2, 'a::x::s0': 'first', 'a::x::s1': 'second' };
  const layout = buildFreeGridLayout(ft, raw);
  assert.deepEqual(layout.displayRows.map(r => [r.id, r.sample]), [['a', 0], ['b', 0], ['a', 1], ['b', 1]]);
  assert.deepEqual([...layout.spans], [['0,0', { rs: 2, cs: 1 }], ['2,0', { rs: 2, cs: 1 }]]);
  assert.deepEqual([...layout.covered], ['1,0', '3,0']);
  const pdf = renderFreeGridTypst(field, ft, raw);
  assert.equal((pdf.match(/rowspan: 2/g) || []).length, 2);
  assert.ok(pdf.includes('first') && pdf.includes('second'));
});

test('multi-column samples use the same block order and merges', () => {
  const ft = table();
  ft.sample_bands = [{ id: 'samples', axis: 'col', refs: ['x', 'y'] }];
  ft.spans = { 'a::x': { rowspan: 1, colspan: 2 } };
  const raw = { '__sample_count__::samples': 2 };
  const layout = buildFreeGridLayout(ft, raw);
  assert.deepEqual(layout.displayCols.map(c => [c.id, c.sample]), [['x', 0], ['y', 0], ['x', 1], ['y', 1]]);
  assert.deepEqual([...layout.covered], ['0,1', '0,3']);
  assert.equal((renderFreeGridTypst(field, ft, raw).match(/colspan: 2/g) || []).length, 2);
});

test('clearing a cell does not restore template text in PDF, including sample cells', () => {
  const ft = table();
  ft.cells = { 'a::x': 'TemplateDefault' };
  assert.ok(!renderFreeGridTypst(field, ft, { 'a::x::s0': '' }).includes('TemplateDefault'));
  ft.sample_bands = [];
  assert.ok(!renderFreeGridTypst(field, ft, { 'a::x': '' }).includes('TemplateDefault'));
  assert.ok(renderFreeGridTypst(field, ft, {}).includes('TemplateDefault'));
});

test('sample count is capped consistently and fixed cells retain base overrides', () => {
  const ft = table();
  const raw = { '__sample_count__::samples': 60, 'a::x': 'BaseOverride' };
  assert.equal(buildFreeGridLayout(ft, raw).displayRows.length, 100);
  assert.equal((renderFreeGridTypst(field, ft, raw).match(/BaseOverride/g) || []).length, 50);
});

test('merges crossing a sample band stretch across the expanded rows', () => {
  const ft = table();
  ft.rows.unshift({ id: 'heading' });
  ft.spans = { 'heading::x': { rowspan: 3, colspan: 1 } };
  const raw = { '__sample_count__::samples': 2 };
  const layout = buildFreeGridLayout(ft, raw);
  assert.deepEqual([...layout.spans], [['0,0', { rs: 5, cs: 1 }]]);
  assert.equal(layout.covered.size, 4);
  assert.ok(renderFreeGridTypst(field, ft, raw).includes('rowspan: 5'));
});

test('PDF uses the record instance structure without modifying the template', () => {
  const ft = table();
  const instance = { ...ft, rows: [...ft.rows, { id: 'extra' }], cells: { 'extra::x': 'InstanceOnly' } };
  assert.ok(renderFreeGridTypst(field, ft, { __free_table_structure__: instance }).includes('InstanceOnly'));
  assert.equal(ft.rows.length, 2);
  assert.ok(!renderFreeGridTypst(field, ft, {}).includes('InstanceOnly'));
});
