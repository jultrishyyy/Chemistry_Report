import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freeGridRoundingOptions, setFreeGridTableNumberFormat } from './free-grid-number-settings.ts';
import { generateMockData } from './mock-data.ts';
import { generateTypstWithData } from './typst-generator.ts';
import { freeGridNumberText } from './free-grid-number.ts';
import type { FieldDefinition, RecordTemplate } from './types';

test('rounding selectors remove retired choices while saved legacy rules retain their values', () => {
  const modes = ['none', 'half_even', 'truncate', 'ceil', 'multiple_2', 'multiple_5', 'piecewise'];
  assert.deepEqual(freeGridRoundingOptions().map(option => option.value), modes);
  for (const mode of ['half_up', 'floor'] as const) {
    const options = freeGridRoundingOptions(mode);
    assert.deepEqual(options.filter(option => !option.disabled).map(option => option.value), modes);
    assert.ok(options.find(option => option.value === mode)?.disabled);
    const table: NonNullable<FieldDefinition['free_table']> = {
      rows: [], columns: [], cells: {}, input_cells: { value: true },
      default_number_fmt: { mode: 'decimals', digits: 1 }, default_rounding: { mode },
    };
    assert.equal(freeGridNumberText('1.25', table, 'value'), mode === 'half_up' ? '1.3' : '1.2');
  }
});

test('whole-table decimal changes replace stale per-cell precision in mock and live PDF', () => {
  const table: NonNullable<FieldDefinition['free_table']> = {
    rows: Array.from({ length: 5 }, (_, i) => ({ id: `s${i}` })),
    columns: Array.from({ length: 4 }, (_, i) => ({ id: `col_${i + 1}`, label: '' })), cells: {},
    input_cells: {}, cell_types: {}, cell_number_fmt: {},
    default_number_fmt: { mode: 'decimals', digits: 4 }, default_rounding: { mode: 'truncate' },
  };
  for (const r of table.rows) for (const c of table.columns) {
    const key = `${r.id}::${c.id}`;
    table.input_cells![key] = true;
    table.cell_types![key] = 'number';
    table.cell_number_fmt![key] = { mode: 'decimals', digits: 2 };
  }
  const field: FieldDefinition = { id: 'f', code: 'grid', label: '试验数据', type: 'free_grid', free_table: table };
  const template: RecordTemplate = { name: '小数位复现', version: 1, groups: [{ id: 'g', label: '试验结果', layout: 'vertical', fields: [field] }] };
  const mock = generateMockData(template), snapshot = JSON.stringify(template), rawSnapshot = JSON.stringify(mock);
  assert.equal(freeGridNumberText('10.12500', table, 's0::col_1'), '10.12');
  assert.ok(generateTypstWithData(template, mock).includes('10.12'));
  const updated = setFreeGridTableNumberFormat(table, { mode: 'decimals', digits: 4 });
  assert.deepEqual(updated.cell_number_fmt, {});
  assert.equal(freeGridNumberText('10.12500', updated, 's0::col_1'), '10.1250');
  const next = { ...template, groups: [{ ...template.groups[0], fields: [{ ...field, free_table: updated }] }] };
  assert.ok(generateTypstWithData(next, mock).includes('10.1250'));
  assert.ok(generateTypstWithData(next, generateMockData(next)).includes('10.1250'));
  assert.equal(JSON.stringify(template), snapshot);
  assert.equal(JSON.stringify(mock), rawSnapshot);
  assert.equal(updated.default_rounding, table.default_rounding);
  assert.equal(updated.rows, table.rows);
  assert.equal(updated.input_cells, table.input_cells);
  const cleared = setFreeGridTableNumberFormat(updated, undefined);
  assert.equal(freeGridNumberText('10.12500', cleared, 's0::col_1'), '10.12500');
});

test('whole numeric format does not erase header, text, choice or sample-label overrides', () => {
  const table: NonNullable<FieldDefinition['free_table']> = {
    rows: [{ id: 'r' }], columns: [], cells: {}, input_cells: { header: true, text: true, choice: true, sample: true, data: true },
    header_cells: { header: true }, sample_index_cells: { sample: true }, cell_types: { text: 'text', choice: 'choice', data: 'number' },
    cell_number_fmt: Object.fromEntries(['header', 'text', 'choice', 'sample', 'data'].map(key => [key, { mode: 'none', digits: 0 }])),
  };
  const next = setFreeGridTableNumberFormat(table, { mode: 'decimals', digits: 3 });
  assert.deepEqual(Object.keys(next.cell_number_fmt!), ['header', 'text', 'choice', 'sample']);
  next.cell_number_fmt!.data = { mode: 'decimals', digits: 1 };
  assert.equal(freeGridNumberText('1.23456', next, 'data'), '1.2', 'subsequent individual settings remain supported');
});
