import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindSelectedSampleRange } from './free-grid-direct-binding';
import { validateReportBindings } from './binding-integrity';
import { renderFreeGridTypst } from './typst-generator';
import type { FieldDefinition, RecordTemplate } from './types';
for (const axis of ['row', 'col'] as const) {
  test(`${axis}: select a rectangle and bind sample parameters atomically, expanding each actual sample once`, () => {
    const key = (s: string, p: string) => axis === 'row' ? `${s}::${p}` : `${p}::${s}`;
    const table = (samples: string[], parameters: string[]) => ({
      rows: (axis === 'row' ? samples : parameters).map(id => ({ id })),
      columns: (axis === 'row' ? parameters : samples).map(id => ({ id, label: '' })), cells: {},
    });
    const source: FieldDefinition = { id: 's', code: 's', label: 'Source', type: 'free_grid', free_table: {
      ...table(['s0', 's1'], ['p0', 'p1']), sample_bands: [{ id: 'samples', axis, refs: ['s0', 's1'] }],
      input_cells: { [key('s0', 'p0')]: true, [key('s1', 'p0')]: true },
      cell_formulas: { [key('s0', 'p1')]: { type: 'sum', sources: [] }, [key('s1', 'p1')]: { type: 'sum', sources: [] } },
      cell_units: { [key('s0', 'p0')]: 'mm' },
    } };
    const target: FieldDefinition = { id: 't', code: 't', label: 'Target', type: 'free_grid', free_table: table(['t0', 't1', 't2'], ['q0', 'q1']) };
    const keys = ['t0', 't1', 't2'].flatMap(s => ['q0', 'q1'].map(p => key(s, p)));
    const before = JSON.stringify(target);
    const patch = bindSelectedSampleRange(target.free_table!, keys, source, { source: 'record_free_cell_sample', field_code: 's', cell_key: key('s0', 'p0') });
    assert.equal(JSON.stringify(target), before);
    Object.assign(target.free_table!, patch);
    assert.equal(patch.sample_bands![0].source_axis_mapping, 'ordinal');
    assert.equal(patch.cell_bindings![key('t1', 'q1')].source, 'record_free_formula_cell_sample');
    assert.equal(patch.cell_unit_bindings![key('t0', 'q0')].source, 'record_free_cell_unit_sample');
    const record = { groups: [{ id: 'g', fields: [source] }] } as RecordTemplate;
    assert.deepEqual(validateReportBindings([{ id: 'g', label: 'G', layout: 'vertical', fields: [target] }], record.groups), []);
    const raw = { '__sample_count__::samples': 4, [key('s0', 'p0') + '::s0']: 'FirstSample', [key('s1', 'p0') + '::s1']: 'SecondSample',
      [key('s0', 'p0') + '::s2']: 'ThirdSample', [key('s1', 'p0') + '::s3']: 'FourthSample' };
    for (const explicit of [false, true]) {
      const data = explicit ? { ...raw, '__sample_axes__::samples': Array.from({ length: 4 }, (_, sample) => ({ ref: sample % 2 ? 's1' : 's0', sample })) } : raw;
      const output = renderFreeGridTypst(target, target.free_table!, undefined, { linked_record_template: record, record_raw_data: { s: data } });
      assert.deepEqual(output.match(/FirstSample|SecondSample|ThirdSample|FourthSample/g), ['FirstSample', 'SecondSample', 'ThirdSample', 'FourthSample']);
    }
    target.free_table!.sample_bands![0].sample_filter = { mode: 'indices', indices: [1] };
    const filtered = renderFreeGridTypst(target, target.free_table!, undefined, { linked_record_template: record, record_raw_data: { s: raw } });
    assert.deepEqual(filtered.match(/FirstSample|SecondSample|ThirdSample|FourthSample/g), ['SecondSample']);
    assert.throws(() => bindSelectedSampleRange(target.free_table!, keys, source, { source: 'record_free_cell_sample', field_code: 's', cell_key: key('s0', 'p1') }), /来源试样参数范围不足/);
    assert.throws(() => bindSelectedSampleRange(target.free_table!, keys.slice(1), source, { source: 'record_free_cell_sample', field_code: 's', cell_key: key('s0', 'p0') }), /矩形/);
  });
}
