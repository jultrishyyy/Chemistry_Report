import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FormulaError, isFormulaError } from './formula-error.ts';
import { evalSpreadsheetResult } from './spreadsheet-expression.ts';
import { executeWithFullPrecision } from './formula-engine.ts';
import { compileGridFormula } from './free-grid-excel-formula.ts';
import { resolveReportFreeGridValues, renderFreeGridTypst } from './typst-generator.ts';
import type { FieldDefinition } from './types';
import { encodeFreeGridCellReference } from './free-grid-formula.ts';

test('typed errors propagate across expressions and legacy aggregations, not through literals', () => {
  const error = evalSpreadsheetResult('1/0', {});
  assert.ok(isFormulaError(error)); assert.equal(error.code, '#DIV/0!');
  assert.equal(evalSpreadsheetResult('IFERROR(v1,"待检查")', { v1: error }), '待检查');
  assert.equal(evalSpreadsheetResult('IFERROR(v1,"待检查")', { v1: '' }), '');
  assert.equal(evalSpreadsheetResult('IFERROR(v1,"待检查")', { v1: '#DIV/0!' }), '#DIV/0!');
  assert.equal(evalSpreadsheetResult('IF(TRUE,1,v1)', { v1: error }), 1);
  assert.ok(isFormulaError(executeWithFullPrecision({ type: 'sum', sources: ['bad', 'good'] }, { bad: error, good: 5 })));
  assert.equal(evalSpreadsheetResult('IFERROR(v1,0)', { v1: JSON.parse(JSON.stringify(error)) }), 0);
  assert.ok(isFormulaError(evalSpreadsheetResult('v1+1', { v1: new FormulaError('#REF!', 'deleted') })));
});

test('PDF chain distinguishes error, blank, literal and override without mutating data', () => {
  const table: NonNullable<FieldDefinition['free_table']> = {
    rows: [{ id: 'r' }], columns: ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, label: '' })), cells: {}, input_cells: { 'r::a': true },
  };
  table.cell_formulas = {
    'r::b': compileGridFormula(table, '=A1/0'),
    'r::c': compileGridFormula(table, '=IFERROR(B1,"待检查")'),
    'r::d': compileGridFormula(table, '=IFERROR(A1,"不应出现")'),
    'r::e': compileGridFormula(table, '=IFERROR("#DIV/0!","不应出现")'),
  };
  const field: FieldDefinition = { id: 'f', code: 'f', label: 'F', type: 'free_grid', free_table: table };
  const raw = { 'r::a': 4 }, before = JSON.stringify({ field, raw });
  assert.equal(resolveReportFreeGridValues(field, table, raw)['r::b'], '#DIV/0!');
  assert.equal(resolveReportFreeGridValues(field, table, raw)['r::c'], '待检查');
  assert.equal(resolveReportFreeGridValues(field, table, { 'r::a': '' })['r::d'], '');
  assert.equal(resolveReportFreeGridValues(field, table, raw)['r::e'], '#DIV/0!');
  assert.equal(resolveReportFreeGridValues(field, table, { ...raw, '__formula_override__::r::b': { value: 42 } })['r::c'], '42');
  assert.ok(renderFreeGridTypst(field, table, raw).includes('待检查'));
  assert.equal(JSON.stringify({ field, raw }), before);
});

test('cross-table PDF dependencies retain typed errors until IFERROR finishes', () => {
  const sourceTable = { rows: [{ id: 'r' }], columns: [{ id: 'a', label: '' }], cells: {}, cell_formulas: {
    'r::a': { type: 'custom' as const, sources: [], expression: '1/0', params: { expression_dialect: 'excel_v1' } },
  } };
  const source: FieldDefinition = { id: 's', code: 's', label: 'Source', type: 'free_grid', free_table: sourceTable };
  const table = { ...sourceTable, cell_formulas: { 'r::a': {
    type: 'custom' as const, sources: [encodeFreeGridCellReference('s', 'r::a')], expression: 'IFERROR(v1,"跨表兜底")', params: { expression_dialect: 'excel_v1' },
  } } };
  const target: FieldDefinition = { id: 't', code: 't', label: 'Target', type: 'free_grid', free_table: table };
  const ctx = { linked_record_template: { name: 'T', version: 1, groups: [{ id: 'g', label: 'G', layout: 'vertical' as const, fields: [source] }] }, record_raw_data: {} };
  assert.equal(resolveReportFreeGridValues(target, table, {}, ctx)['r::a'], '跨表兜底');
});
