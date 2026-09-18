import { test } from 'node:test';
import assert from 'node:assert/strict';
import { equipmentSearchTerms, equipmentLikePattern, equipmentCodes } from './equipment-search';
test('search splits device name and model, ignores surrounding whitespace', () => {
  assert.deepEqual(equipmentSearchTerms('  拉力机　 ABC-123  '), ['拉力机', 'ABC-123']);
});
test('literal equipment code wildcard characters are escaped', () => {
  assert.equal(equipmentLikePattern('HX_10%\\A'), '%HX\\_10\\%\\\\A%');
});
test('invalid and empty keywords do not throw', () => {
  assert.deepEqual(equipmentSearchTerms({}), []);
  assert.deepEqual(equipmentSearchTerms('  '), []);
});
test('legacy malformed values cannot become React object children or break array methods', () => {
  assert.deepEqual(equipmentCodes('not-an-array'), []);
  assert.deepEqual(equipmentCodes([null, {}, 'A', 'A', '', 'B']), ['A', 'B']);
});
