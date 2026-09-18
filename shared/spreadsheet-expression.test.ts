import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evalSpreadsheet, spreadsheetIdentifiers } from './spreadsheet-expression.ts';
import { compileGridFormula, displayGridFormula } from './free-grid-excel-formula.ts';
import { executeWithFullPrecision } from './formula-engine.ts';
import { renderFreeGridTypst } from './typst-generator.ts';
import { formulaCompletion, formulaParameterHint } from './formula-input.ts';
import type { FieldDefinition } from './types';

test('IF, IFERROR, comparisons, booleans and lazy branches', () => {
  assert.equal(evalSpreadsheet('IF(2>=1,"符合","不符合")', {}), '符合');
  assert.equal(evalSpreadsheet('IF(TRUE,5,1/0)', {}), 5);
  assert.equal(evalSpreadsheet('IF(FALSE,1/0,7)', {}), 7);
  assert.equal(evalSpreadsheet('IFERROR(1/0,"")', {}), '');
  assert.equal(evalSpreadsheet('IFERROR(2,1/0)', {}), 2);
  assert.equal(evalSpreadsheet('IF(AND(v1>=2,v1<4),"通过","失败")', { v1: '3' }), '通过');
  assert.equal(evalSpreadsheet('OR(NOT(TRUE),3<>4)', {}), true);
  assert.equal(evalSpreadsheet('"A1"&" "&"他说""好"""', {}), 'A1 他说"好"');
  assert.equal(evalSpreadsheet('1e-3+2^3*2', {}), 16.001);
  assert.equal(evalSpreadsheet('IF(v1="","未填写",v1)', { v1: '' }), '未填写');
  assert.equal(evalSpreadsheet('IF(v1=3,"相等","不同")', { v1: '3' }), '相等');
  assert.equal(evalSpreadsheet('""=0', {}), false);
});
test('unknown functions in inactive branches rejected and syntax bounded', () => {
  assert.throws(() => spreadsheetIdentifiers('IF(TRUE,1,BAD(2))'));
  assert.throws(() => spreadsheetIdentifiers('IF(TRUE,1)'));
  assert.throws(() => spreadsheetIdentifiers('"未结束'));
  assert.throws(() => spreadsheetIdentifiers('('.repeat(150) + '1' + ')'.repeat(150)));
  assert.equal(evalSpreadsheet('IFERROR(BAD(2),9)', {}), null);
});
test('quoted addresses stay literal through compile, display, completion and parameter hints', () => {
  const table = { rows: [{ id: 'r' }], columns: [{ id: 'a', label: '' }, { id: 'b', label: '' }], cells: {} };
  const f = compileGridFormula(table, '=IF(A1>0,"A1:B99 v1","SUM(A9)")');
  assert.deepEqual(f.sources, ['r::a']);
  assert.equal(executeWithFullPrecision(f, { 'r::a': 2 }), 'A1:B99 v1');
  assert.equal(displayGridFormula(table, f), '=IF(A1>0,"A1:B99 v1","SUM(A9)")');
  assert.equal(formulaCompletion('="SU', 4), null);
  const text = '=IF(TRUE,"a,b)",';
  assert.match(formulaParameterHint(text, text.length), /第 3 个参数/);
});
test('text results reach PDF and legacy numeric semantics stay unchanged', () => {
  const table: NonNullable<FieldDefinition['free_table']> = {
    rows: [{ id: 'r' }], columns: [{ id: 'a', label: '' }, { id: 'b', label: '' }], cells: {},
    input_cells: { 'r::a': true },
  };
  table.cell_formulas = { 'r::b': compileGridFormula(table, '=IF(A1>=90,"符合","不符合")') };
  const field: FieldDefinition = { id: 'f', code: 'f', label: '测试', type: 'free_grid', free_table: table };
  assert.ok(renderFreeGridTypst(field, table, { 'r::a': 95 }).includes('符合'));
  assert.ok(renderFreeGridTypst(field, table, { 'r::a': 85 }).includes('不符合'));
  assert.equal(executeWithFullPrecision({ type: 'custom', sources: ['a'], expression: 'v1+1' }, { a: '' }), null);
  assert.equal(executeWithFullPrecision(compileGridFormula(table, '=IFERROR(A1/0,"")'), { 'r::a': 5 }), '');
});
