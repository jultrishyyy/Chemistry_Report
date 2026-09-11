import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloneTemplateField } from './clone-template-field.ts';
import { encodeFreeGridCellReference } from './free-grid-formula.ts';
import type { FieldDefinition, RecordTemplate } from './types';

test('table clone preserves configuration, remaps self formulas, retains external report bindings', () => {
  const self = encodeFreeGridCellReference('table', 'r::a');
  const source: FieldDefinition = { id: 'f', code: 'table', label: '表格', type: 'free_grid', free_table: {
    rows: [{ id: 'r' }], columns: [{ id: 'a', label: '' }, { id: 'b', label: '' }], cells: { 'r::a': '原文' },
    spans: { 'r::a': { colspan: 2 } }, default_number_fmt: { mode: 'decimals', digits: 4 },
    sample_bands: [{ id: 'samples', axis: 'row', refs: ['r'] }],
    cell_formulas: { 'r::b': { type: 'custom', sources: [self, 'r::a', 'outside'], expression: 'A1+v2+v3', params: { source_aliases: { [self]: 'A1' } } } },
    cell_bindings: { 'r::a': { source: 'record_field', field_code: 'table' } },
  } };
  const template = { name: 'T', version: 1, groups: [{ id: 'g', label: 'G', fields: [source] }] } as RecordTemplate;
  const snapshot = JSON.stringify(source);
  const copy = cloneTemplateField(source, template);
  assert.notEqual(copy.id, source.id); assert.notEqual(copy.code, source.code);
  assert.deepEqual(copy.free_table!.cells, source.free_table!.cells);
  assert.deepEqual(copy.free_table!.spans, source.free_table!.spans);
  assert.deepEqual(copy.free_table!.sample_bands, source.free_table!.sample_bands);
  assert.deepEqual(copy.free_table!.default_number_fmt, source.free_table!.default_number_fmt);
  assert.deepEqual(copy.free_table!.cell_bindings, source.free_table!.cell_bindings);
  const formula = copy.free_table!.cell_formulas!['r::b'];
  assert.deepEqual(formula.sources, [encodeFreeGridCellReference(copy.code, 'r::a'), 'r::a', 'outside']);
  assert.equal(formula.params!.source_aliases[formula.sources[0]], 'A1');
  template.groups[0].fields.push(copy);
  const again = cloneTemplateField(source, template);
  assert.notEqual(copy.id, again.id); assert.notEqual(copy.code, again.code);
  copy.free_table!.cells['r::a'] = '修改';
  assert.equal(JSON.stringify(source), snapshot);
});

test('nested fields and variants get fresh identifiers and sibling dependencies follow clone', () => {
  const source: FieldDefinition = { id: 'f', code: 'choices', type: 'variant_list', label: '选择', variants: [{ id: 'v', label: 'V', render: 'inline_fields', fields: [
    { id: 'n', code: 'n', type: 'number', label: '数值' },
    { id: 'sum', code: 'sum', type: 'computed', label: '合计', formula: { type: 'sum', sources: ['n', 'external'] } },
  ] }] };
  const template = { name: 'T', version: 1, groups: [{ id: 'g', label: 'G', fields: [source] }] } as RecordTemplate;
  const copy = cloneTemplateField(source, template), fields = copy.variants![0].fields!;
  assert.notEqual(copy.variants![0].id, 'v');
  assert.notEqual(fields[0].id, 'n');
  assert.deepEqual(fields[1].formula!.sources, [fields[0].code, 'external']);
});
