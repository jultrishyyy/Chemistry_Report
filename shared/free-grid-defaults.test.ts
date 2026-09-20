import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFieldDefaults } from './matrix-flatten.ts';
import { editSampleAxes, readSampleAxes } from './free-grid-samples.ts';
import { freeGridNumberText } from './free-grid-number.ts';
import { generateMockData } from './mock-data.ts';
import { buildProjectGroupsFromRecord } from './report-inherit.ts';
import { renderFreeGridTypst, resolveReportFreeGridValues } from './typst-generator.ts';
import type { FieldDefinition, RecordTemplate } from './types';

function fixture() {
  const table: NonNullable<FieldDefinition['free_table']> = {
    rows: [{ id: 'r' }, { id: 's' }],
    columns: [{ id: 'a', label: '' }, { id: 'b', label: '' }],
    cells: { 'r::a': 'DefaultText\nSecondLine', 'r::b': '9', 's::a': '001.20' },
    input_cells: { 'r::a': true, 'r::b': true, 's::a': true, 's::b': true },
    cell_types: { 'r::a': 'text', 'r::b': 'number', 's::a': 'text', 's::b': 'text' },
    default_number_fmt: { mode: 'decimals', digits: 0 },
    default_rounding: { mode: 'truncate' },
  };
  const field: FieldDefinition = { id: 'f', code: 'grid', label: 'Grid', type: 'free_grid', free_table: table };
  const template: RecordTemplate = { name: 'Defaults', version: 1, groups: [{ id: 'g', label: 'G', layout: 'vertical', fields: [field] }] };
  return { table, field, template };
}

test('new records snapshot only editable text defaults without mutating the template', () => {
  const { table, template } = fixture();
  const before = JSON.stringify(template);
  assert.deepEqual(buildFieldDefaults(template).grid, { 'r::a': 'DefaultText\nSecondLine', 's::a': '001.20' });
  assert.equal(JSON.stringify(template), before);
  table.spans = { 'r::a': { rowspan: 2 } };
  assert.deepEqual(buildFieldDefaults(template).grid, { 'r::a': 'DefaultText\nSecondLine' }, 'covered cells have no independent default');
  table.sample_index_cells = { 'r::a': true };
  assert.equal(buildFieldDefaults(template).grid, undefined, 'automatic indexes are not text defaults');
});

for (const axis of ['row', 'col'] as const) {
  test(`${axis}: sample defaults use runtime addresses and additions retain existing edits`, () => {
    const { table, template } = fixture();
    if (axis === 'col') table.cells['s::b'] = 'AddedSampleDefault';
    const band = { id: 'samples', axis, refs: axis === 'row' ? ['r', 's'] : ['a', 'b'] };
    table.sample_bands = [band];
    const initial = buildFieldDefaults(template).grid;
    assert.equal(initial['r::a::s0'], 'DefaultText\nSecondLine');
    assert.equal(initial['s::a::s0'], '001.20');
    assert.equal(initial['r::a'], undefined);
    initial['r::a::s0'] = '';
    initial['s::a::s0'] = 'EngineerEdit';
    const entries = readSampleAxes(initial, band.id)!;
    const next = editSampleAxes(table, initial, band, entries);
    const last = entries.at(-1)!.ref;
    const textKey = axis === 'row' ? `${last}::a` : `s::${last}`;
    const expected = table.cells[textKey] ?? '';
    assert.equal(next[`${textKey}::s1`], expected);
    assert.equal(next['r::a::s0'], '');
    assert.equal(next['s::a::s0'], 'EngineerEdit');
    if (axis === 'row') assert.equal(next[`${last}::b::s1`], '', 'measurements start empty');
    const partial = { ...band, cross_refs: axis === 'row' ? ['b'] : ['s'] };
    table.sample_bands = [partial];
    assert.equal(buildFieldDefaults(template).grid['r::a'], 'DefaultText\nSecondLine', 'outside partial bands the default is shared');
  });
}

test('saved edits and explicit empty values override defaults in report resolution', () => {
  const { table, field, template } = fixture();
  const raw = JSON.parse(JSON.stringify(buildFieldDefaults(template).grid));
  raw['r::a'] = '';
  raw['s::a'] = 'EngineerEdit';
  const values = resolveReportFreeGridValues(field, table, raw);
  assert.equal(values['r::a'], '');
  assert.equal(values['s::a'], 'EngineerEdit');
  const source = renderFreeGridTypst(field, table, raw);
  assert.ok(source.includes('EngineerEdit'));
  assert.ok(!source.includes('DefaultText'));
});

test('numeric-looking text stays literal with whole-table number rules', () => {
  const { table, field } = fixture();
  assert.equal(freeGridNumberText('001.20', table, 's::a'), '001.20');
  assert.equal(resolveReportFreeGridValues(field, table)['s::a'], '001.20');
  assert.ok(renderFreeGridTypst(field, table).includes('001.20'));
});

test('template preview and inherited report show configured defaults and preserve clearing', () => {
  const { table, template } = fixture();
  const preview = generateMockData(template);
  assert.equal(preview.grid['r::a'], table.cells['r::a']);
  assert.equal(preview.grid['s::a'], '001.20');
  const report = buildProjectGroupsFromRecord(template).groups[0].fields[0];
  const raw = buildFieldDefaults(template);
  const context = { linked_record_template: template, record_raw_data: raw };
  assert.ok(renderFreeGridTypst(report, report.free_table!, undefined, context).includes('001.20'));
  raw.grid['r::a'] = '';
  const source = renderFreeGridTypst(report, report.free_table!, undefined, context);
  assert.ok(!source.includes('DefaultText'));
});

test('text cells converted to formulas retain numeric formatting in inherited reports', () => {
  const { table, field, template } = fixture();
  table.cell_formulas = { 's::a': { type: 'sum', sources: ['r::b'] } };
  table.default_number_fmt = { mode: 'decimals', digits: 2 };
  assert.ok(renderFreeGridTypst(field, table).includes('9.00'));
  const report = buildProjectGroupsFromRecord(template).groups[0].fields[0];
  const source = renderFreeGridTypst(report, report.free_table!, undefined, {
    linked_record_template: template, record_raw_data: { grid: { 'r::b': '9' } },
  });
  assert.ok(source.includes('9.00'));
  assert.equal(freeGridNumberText('9', report.free_table!, 's::a'), '9.00');
});
