import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { applyNumericRounding } from './numeric-rounding.ts';
import { freeGridNumberText, roundFreeGridValue } from './free-grid-number.ts';
import { generateTypstWithData, resolveReportFreeGridValues } from './typst-generator.ts';
import { generateMockData } from './mock-data.ts';
import type { FieldDefinition, NumericRoundingRule, RecordTemplate } from './types';
const key = 'r::c';
const table = (): NonNullable<FieldDefinition['free_table']> => ({ columns: [{ id: 'c', label: '' }], rows: [{ id: 'r' }], cells: {}, input_cells: { [key]: true }, cell_types: { [key]: 'number' }, default_number_fmt: { mode: 'decimals', digits: 2 } });
test('decimal rounding handles ties, signs, exact boundaries and near ties', () => {
  const cases: Array<[string, NumericRoundingRule['mode'], number]> = [
    ['1.005', 'half_up', 1.01], ['-1.005', 'half_up', -1.01], ['2.675', 'half_up', 2.68],
    ['1.005', 'half_even', 1], ['1.015', 'half_even', 1.02], ['-1.015', 'half_even', -1.02],
    ['1.0049999999999999', 'half_up', 1], ['1.0050000000000001', 'half_even', 1.01],
    ['1.15', 'truncate', 1.15], ['-1.159', 'truncate', -1.15], ['1.159', 'truncate', 1.15],
    ['1.15', 'floor', 1.15], ['-1.151', 'floor', -1.16], ['1.151', 'ceil', 1.16], ['-1.151', 'ceil', -1.15],
    ['1.005e0', 'half_up', 1.01], ['0.0001', 'truncate', 0],
  ];
  for (const [value, mode, expected] of cases) assert.equal(applyNumericRounding(value, { mode, digits: 2 }), expected, `${value}: ${mode}`);
});
test('format is sole active precision, cell overrides win, source stays unchanged', () => {
  const ft = table(); ft.default_rounding = { mode: 'truncate', digits: 1 };
  assert.equal(freeGridNumberText('1.1599', ft, key), '1.15');
  ft.default_rounding = { mode: 'half_up', digits: 8 };
  assert.equal(freeGridNumberText('1.155', ft, key), '1.16');
  ft.cell_number_fmt = { [key]: { mode: 'decimals', digits: 3 } };
  assert.equal(freeGridNumberText('1.1555', ft, key), '1.156');
  ft.cell_rounding = { [key]: { mode: 'truncate' } };
  assert.equal(freeGridNumberText('1.1555', ft, key), '1.155');
  ft.cell_number_fmt[key] = { mode: 'none', digits: 2 };
  assert.equal(freeGridNumberText('1.1555', ft, key), '1.1555');
  assert.equal(freeGridNumberText('1.1555', ft, 'header::c'), '1.1555');
  assert.equal(freeGridNumberText('', ft, key), '');
  assert.equal(freeGridNumberText('text', ft, key), 'text');
});
test('format-only rounding does not reduce formula input precision', () => {
  const ft = table();
  assert.equal(roundFreeGridValue('1.005', ft, key), '1.005');
  assert.equal(freeGridNumberText('1.005', ft, key), '1.01');
  ft.default_number_fmt = undefined;
  assert.equal(freeGridNumberText('1.00500', ft, key), '1.00500');
  ft.default_rounding = { mode: 'truncate' };
  assert.equal(freeGridNumberText('1.00500', ft, key), '1.00500');
});
test('scientific and significant precision respect selected rounding', () => {
  const ft = table(); ft.default_rounding = { mode: 'truncate' };
  ft.default_number_fmt = { mode: 'scientific', digits: 2 };
  assert.equal(freeGridNumberText('1239.9', ft, key), '1.23e+3');
  ft.default_number_fmt = { mode: 'significant', digits: 3 };
  assert.equal(freeGridNumberText('0.0012399', ft, key), '0.00123');
});
test('template mock and live PDF update rules without overwriting original values', () => {
  const ft = table(); ft.default_rounding = { mode: 'truncate', digits: 1 };
  const field: FieldDefinition = { id: 'f', code: 'grid', type: 'free_grid', label: '数据', free_table: ft };
  const tpl: RecordTemplate = { name: '数字验证', version: 1, groups: [{ id: 'g', label: '数据', layout: 'vertical', fields: [field] }] };
  const raw = { grid: { [key]: '10.12500' } }, before = JSON.stringify(raw);
  const mock = generateMockData(tpl);
  assert.equal(resolveReportFreeGridValues(field, ft, raw.grid)[key], '10.12');
  assert.ok(generateTypstWithData(tpl, mock).includes('10.12'));
  assert.ok(generateTypstWithData(tpl, raw).includes('10.12'));
  ft.default_rounding = { mode: 'half_up' };
  assert.ok(generateTypstWithData(tpl, generateMockData(tpl)).includes('10.13'));
  assert.ok(generateTypstWithData(tpl, raw).includes('10.13'));
  ft.default_number_fmt = { mode: 'decimals', digits: 3 };
  assert.ok(generateTypstWithData(tpl, raw).includes('10.125'));
  assert.equal(JSON.stringify(raw), before);
});
for (const axis of ['row', 'col'] as const) test(`${axis}: expanded template samples update cell rules and compile PDF`, () => {
  const ft = table();
  ft.sample_bands = [{ id: 'band', axis, refs: [axis === 'row' ? 'r' : 'c'] }];
  ft.cell_number_fmt = { [key]: { mode: 'decimals', digits: 2 } };
  ft.cell_rounding = { [key]: { mode: 'truncate', digits: 0 } };
  const f: FieldDefinition = { id: 'f', code: 'grid', label: '数据', type: 'free_grid', free_table: ft };
  const tpl: RecordTemplate = { name: '试样数字验证', version: 1, groups: [{ id: 'g', label: '数据', layout: 'vertical', fields: [f] }] };
  const original = generateMockData(tpl);
  const truncated = generateTypstWithData(tpl, original);
  assert.ok(truncated.includes('10.12'));
  ft.cell_rounding[key] = { mode: 'half_up' };
  const rounded = generateTypstWithData(tpl, original);
  assert.ok(rounded.includes('10.13'));
  assert.notEqual(rounded, truncated);
  const result = spawnSync('typst', ['compile', '--package-path', 'typst-packages', '-', '-'], { input: rounded, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString());
});
