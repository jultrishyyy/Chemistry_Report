import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleParameterKeys, sampleParameterBindings } from './free-grid-parameter-binding';
import { buildProjectGroupsFromRecord } from './report-inherit';
import type { FieldDefinition, RecordTemplate } from './types';
for (const axis of ['row', 'col'] as const) {
  test(`${axis}: parameter mapping preserves headers, geometry and per-sample formula/unit types`, () => {
    const key = (i: number, parameter = 'p') => axis === 'row' ? `s${i}::${parameter}` : `${parameter}::s${i}`;
    const header = axis === 'row' ? 'h::p' : 'p::h';
    const source: FieldDefinition = { id: 'f', code: 'source', label: '来源', type: 'free_grid', free_table: {
      rows: (axis === 'row' ? ['h', 's0', 's1'] : ['p', 'q']).map(id => ({ id })),
      columns: (axis === 'row' ? ['p', 'q'] : ['h', 's0', 's1']).map(id => ({ id, label: '' })),
      cells: { [header]: '参数' }, header_cells: { [header]: true },
      input_cells: { [key(0)]: true }, cell_formulas: { [key(1)]: { type: 'sum', sources: [key(1, 'q')] } },
      cell_units: { [key(0)]: 'mm' },
      sample_bands: [{ id: 'band', axis, refs: ['s0', 's1'], cross_refs: ['p'] }],
    } };
    const record = { groups: [{ id: 'g', fields: [source] }] } as RecordTemplate;
    const target = buildProjectGroupsFromRecord(record).groups[0].fields[0].free_table!;
    const band = target.sample_bands![0];
    const before = JSON.stringify(target);
    const keys = sampleParameterKeys(target, band, header);
    assert.deepEqual(keys, [key(0), key(1)]);
    assert.deepEqual(sampleParameterKeys(target, band, key(1)), keys);
    assert.deepEqual(sampleParameterKeys(target, band, key(0, 'q')), []);
    const mapped = sampleParameterBindings(band, keys, source, { source: 'record_free_cell_sample', field_code: 'source', cell_key: key(0) });
    assert.equal(mapped.bindings[key(0)].source, 'record_free_cell_sample');
    assert.equal(mapped.bindings[key(1)].source, 'record_free_formula_cell_sample');
    assert.equal(mapped.units[key(0)].source, 'record_free_cell_unit_sample');
    assert.equal(mapped.units[key(1)], undefined);
    assert.equal(JSON.stringify(target), before);
    assert.throws(() => sampleParameterBindings(band, keys, { ...source, code: 'other' }, mapped.bindings[key(0)]), /来源表格/);
    target.spans = { [key(0)]: axis === 'row' ? { rowspan: 2, colspan: 1 } : { rowspan: 1, colspan: 2 } };
    assert.deepEqual(sampleParameterKeys(target, band, header), []);
  });
}
