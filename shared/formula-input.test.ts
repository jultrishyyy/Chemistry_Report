import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formulaCompletion, formulaInsertionRange, formulaParameterHint } from './formula-input.ts';

test('complete function at caret without eating surrounding expression', () => {
  assert.deepEqual(formulaCompletion('=SU+2', 3), { start: 1, end: 3, options: ['SUM'] });
  assert.equal(formulaCompletion('=A12', 4), null);
  assert.equal(formulaCompletion('=SUM(', 5), null);
  assert.ok(formulaCompletion('=IFER', 5)?.options.includes('IFERROR'));
  assert.ok(formulaCompletion('=average', 8)?.options.includes('AVERAGE'));
  assert.ok(formulaCompletion('=verage', 7)?.options.includes('AVERAGE'));
  assert.ok(formulaCompletion('=log10', 6)?.options.includes('LOG10'));
});
test('replace address/range at caret or explicit selection, never a function', () => {
  assert.deepEqual(formulaInsertionRange('=SUM(A1:B3)+2', 8, 8), { start: 5, end: 10 });
  assert.deepEqual(formulaInsertionRange('=SUM(A1)+2', 8, 8), { start: 8, end: 8 });
  assert.deepEqual(formulaInsertionRange('=LOG10(2)', 6, 6), { start: 6, end: 6 });
  assert.deepEqual(formulaInsertionRange('=1+2', 1, 4), { start: 1, end: 4 });
});
test('parameter hints track nested parentheses and argument numbers', () => {
  const outer = '=IFERROR(SUM(A1,A2),';
  const inner = '=IFERROR(SUM(A1,';
  assert.match(formulaParameterHint(outer, outer.length), /IFERROR.*第 2 个参数/);
  assert.match(formulaParameterHint(inner, inner.length), /SUM.*第 2 个参数/);
  assert.equal(formulaParameterHint('=SUM(A1)', 8), '');
});
