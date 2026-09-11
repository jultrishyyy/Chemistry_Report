import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findRecordHeaderChanges } from './record-header-changes.ts';
import type { RecordTemplate } from './types';
function fixture(axis: 'row' | 'col' = 'row') {
  return { name: 'Header test', version: 1, groups: [{ id: 'g', label: 'Group', layout: 'vertical', fields: [{ id: 'f', code: 'f', label: 'Results', type: 'free_grid', free_table: {
    rows: [{ id: 'r' }], columns: [{ id: 'c', label: '' }], cells: { 'r::c': 'Original' }, header_cells: { 'r::c': true },
    sample_bands: [{ id: 's', axis, refs: [axis === 'row' ? 'r' : 'c'] }],
  } }] }] } as RecordTemplate;
}
test('unchanged, restored and style-only headers do not warn; renaming and clearing do', () => {
  const tpl = fixture();
  assert.deepEqual(findRecordHeaderChanges(tpl, {}), []);
  assert.deepEqual(findRecordHeaderChanges(tpl, { f: { 'r::c': 'Original' } }), []);
  const table = tpl.groups[0].fields[0].free_table!;
  assert.deepEqual(findRecordHeaderChanges(tpl, { f: { __free_table_structure__: { ...table, cell_styles: { 'r::c': { weight: 'bold' } } } } }), []);
  for (const value of ['Changed', '']) {
    const result = findRecordHeaderChanges(tpl, { f: { 'r::c': value } });
    assert.equal(result.length, 1);
    assert.equal(result[0].before, 'Original');
    assert.equal(result[0].after, value);
  }
});
for (const axis of ['row', 'col'] as const) {
  test(`${axis}: changed added sample headers warn; deleted sample values do not`, () => {
    const tpl = fixture(axis);
    const ref = axis === 'row' ? 'r' : 'c';
    const raw = { f: { '__sample_axes__::s': [{ ref, sample: 0 }, { ref, sample: 2 }], 'r::c::s2': 'New sample name', 'r::c::s1': 'Deleted name' } };
    const before = JSON.stringify({ tpl, raw });
    const changes = findRecordHeaderChanges(tpl, raw);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].sample, 2);
    assert.equal(changes[0].after, 'New sample name');
    assert.equal(JSON.stringify({ tpl, raw }), before);
    raw.f['__sample_axes__::s'] = [{ ref, sample: 0 }];
    assert.deepEqual(findRecordHeaderChanges(tpl, raw), []);
  });
}
test('instance header text is compared with the locked original table', () => {
  const tpl = fixture();
  const table = tpl.groups[0].fields[0].free_table!;
  const changes = findRecordHeaderChanges(tpl, { f: { __free_table_structure__: { ...table, cells: { 'r::c': 'Instance title' } } } });
  assert.equal(changes[0].before, 'Original');
  assert.equal(changes[0].after, 'Instance title');
});
