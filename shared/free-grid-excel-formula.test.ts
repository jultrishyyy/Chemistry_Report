import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileGridFormula, displayGridFormula } from './free-grid-excel-formula.ts';
import { evalArithmetic, validateArithmetic } from './expr-eval.ts';

const table = { rows: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }], columns: [{ id: 'c1', label: '' }, { id: 'c2', label: '' }], cells: {} };
test('address ranges compile to stable IDs and reopen at current coordinates', () => {
  const f = compileGridFormula(table, '=SUM(A1:A3)+B2');
  assert.deepEqual(f.sources, ['r1::c1', 'r2::c1', 'r3::c1', 'r2::c2']);
  assert.equal(f.expression, 'SUM(v1,v2,v3)+v4');
  assert.equal(evalArithmetic(f.expression!, { v1: 1, v2: 2, v3: 3, v4: 4 }), 10);
  assert.equal(displayGridFormula({ ...table, rows: [table.rows[2], table.rows[1], table.rows[0]] }, f), '=SUM(A3,A2,A1)+B2');
});
test('invalid references/functions/syntax and unsupported array operations rejected', () => {
  for (const text of ['=A4', '=A1:A3+1', '=SUM(A1:A3+1)', '=IFERROR(FAKE(A1),0)', '=SUM(', '=IFERROR(A1)']) {
    assert.throws(() => compileGridFormula(table, text), text);
  }
});
test('IFERROR handles numeric errors without truncating the remaining expression', () => {
  assert.equal(evalArithmetic('IFERROR(1/0*2+3,42)', {}), 42);
  assert.equal(evalArithmetic('IFERROR(4/2,99)', {}), 2);
  assert.equal(evalArithmetic('IFERROR(SQRT(-1),7)', {}), 7);
  assert.equal(evalArithmetic('IFERROR(1/0,1/0)', {}), null);
  assert.equal(evalArithmetic('TRUNC(-1.239,2)', {}), -1.23);
  assert.throws(() => validateArithmetic('IFERROR(BAD(1),0)'));
});
test('repeated references, multiple ranges and function names containing numbers', () => {
  const f = compileGridFormula(table, '=SUM(A1:A2,B1:B2)+A1+LOG10(100)');
  assert.deepEqual(f.sources, ['r1::c1', 'r2::c1', 'r1::c2', 'r2::c2']);
  assert.equal(f.expression, 'SUM(v1,v2,v3,v4)+v1+LOG10(100)');
});
