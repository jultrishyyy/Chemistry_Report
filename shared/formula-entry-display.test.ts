import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formulaAwaitingInput } from './formula-entry-display';
import { FormulaError } from './formula-error';

test('empty source cells show a formula placeholder without altering results', () => {
  const result = new FormulaError('#VALUE!', '空值不能参与数值运算');
  assert.equal(formulaAwaitingInput(['', null, undefined, '  '], result), true);
  assert.equal(formulaAwaitingInput(['', ''], null), true);
  assert.equal(formulaAwaitingInput(['', ''], 0), true);
  assert.equal(result.code, '#VALUE!');
});
test('zero, partially entered values, constants and genuine errors are not hidden', () => {
  assert.equal(formulaAwaitingInput([0, ''], 0), false);
  assert.equal(formulaAwaitingInput(['0'], 0), false);
  assert.equal(formulaAwaitingInput([1, ''], new FormulaError('#VALUE!', '空值不能参与数值运算')), false);
  assert.equal(formulaAwaitingInput([], 42), false);
  for (const code of ['#REF!', '#CYCLE!', '#DIV/0!', '#ERROR!'] as const) {
    assert.equal(formulaAwaitingInput([''], new FormulaError(code, '错误')), false);
  }
  assert.equal(formulaAwaitingInput(['错误文本'], new FormulaError('#VALUE!', '不是有效数值')), false);
});
