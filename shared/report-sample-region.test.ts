import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertReportSampleTargets, createReportSampleRegion, reportSampleRegionIssues } from './report-sample-region';
import { sampleParameterBindings } from './free-grid-parameter-binding';
import { validateReportBindings } from './binding-integrity';
import { renderFreeGridTypst } from './typst-generator';
import type { CellBinding, FieldDefinition, RecordTemplate } from './types';
for (const axis of ['row', 'col'] as const) {
  test(`${axis}: a manually created report region repairs missing context and expands actual sample values`, () => {
    const sourceKey = 'sr::sc', targetKey = 'tr::tc';
    const source: FieldDefinition = { id: 's', code: 's', label: '来源', type: 'free_grid', free_table: {
      rows: [{ id: 'sr' }], columns: [{ id: 'sc', label: '' }], cells: {}, input_cells: { [sourceKey]: true }, cell_units: { [sourceKey]: 'mm' },
      sample_bands: [{ id: 'samples', axis, refs: axis === 'row' ? ['sr'] : ['sc'] }],
    } };
    const binding: CellBinding = { source: 'record_free_cell_sample', field_code: 's', cell_key: sourceKey };
    const target: FieldDefinition = { id: 't', code: 't', label: '新建结果表', type: 'free_grid', free_table: {
      rows: [{ id: 'tr' }, { id: 'outside' }], columns: [{ id: 'tc', label: '' }, { id: 'other', label: '' }], cells: {},
      cell_bindings: { [targetKey]: binding },
    } };
    const table = target.free_table!;
    const record = { groups: [{ id: 'g', fields: [source] }] } as RecordTemplate;
    const groups = [{ id: 'g', label: 'G', fields: [target] }] as RecordTemplate['groups'];
    assert.ok(validateReportBindings(groups, record.groups).some(issue => issue.reason.includes('不在报告对应')));
    assert.throws(() => assertReportSampleTargets(table, [targetKey], binding), /设置试样区/);
    assert.doesNotThrow(() => assertReportSampleTargets(table, [targetKey], { source: 'record_free_cell', field_code: 's', cell_key: sourceKey }));
    const band = createReportSampleRegion(table, source, axis === 'row' ? ['tr'] : ['tc'], axis === 'row' ? ['tc'] : ['tr']);
    table.sample_bands = [band];
    assert.deepEqual(validateReportBindings(groups, record.groups), []);
    const mapped = sampleParameterBindings(band, [targetKey], source, binding);
    table.cell_bindings = mapped.bindings;
    table.cell_unit_bindings = mapped.units;
    const typst = renderFreeGridTypst(target, table, undefined, { linked_record_template: record,
      record_raw_data: { s: { '__sample_count__::samples': 2, [`${sourceKey}::s0`]: 'FirstValue', [`${sourceKey}::s1`]: 'SecondValue' } } });
    assert.ok(typst.includes('FirstValue') && typst.includes('SecondValue'));
    assert.throws(() => assertReportSampleTargets(table, ['outside::other'], binding), /不在当前试样区/);
    assert.throws(() => assertReportSampleTargets(table, [targetKey], { ...binding, field_code: 'other' }), /对应/);
    const refs = axis === 'row' ? ['outside'] : ['other'];
    const cross = axis === 'row' ? ['other'] : ['outside'];
    const snapshot = JSON.stringify(table);
    const replacement = createReportSampleRegion(table, source, refs, cross);
    const issues = reportSampleRegionIssues({ ...table, sample_bands: [replacement] });
    assert.equal(issues.length, 2, 'old content and unit mappings are reported independently');
    assert.ok(issues.every(issue => issue.key === targetKey && issue.reason.includes('不在当前试样区')));
    assert.equal(JSON.stringify(table), snapshot, 'setting a new region preserves all old mappings');
    assert.throws(() => assertReportSampleTargets({ ...table, sample_bands: [replacement] }, [targetKey], binding), /不在当前试样区/);
  });
}

test('region creation distinguishes mismatched source, unit-only and crossing-merge conflicts without deleting bindings', () => {
  const source: FieldDefinition = { id: 's', code: 's', type: 'free_grid', label: 'Source', free_table: {
    rows: [{ id: 'a' }], columns: [{ id: 'x', label: '' }], cells: {}, sample_bands: [{ id: 's', axis: 'row', refs: ['a'] }],
  } };
  const table: NonNullable<FieldDefinition['free_table']> = {
    rows: [{ id: 'r1' }, { id: 'r2' }], columns: [{ id: 'c1', label: '' }, { id: 'c2', label: '' }], cells: {},
    spans: { 'r1::c1': { rowspan: 2, colspan: 1 } },
    cell_bindings: {
      'r1::c1': { source: 'record_free_cell_sample', field_code: 's', cell_key: 'a::x' },
      'r1::c2': { source: 'record_free_cell_sample', field_code: 'other', cell_key: 'a::x' },
    },
    cell_unit_bindings: { 'r2::c2': { source: 'record_free_cell_unit_sample', field_code: 's', cell_key: 'a::x' } },
    sample_bands: [{ id: 'kept', axis: 'row', refs: ['r1', 'r2'], source_field: 's', source_band_id: 's', sample_filter: { mode: 'indices', indices: [1] } }],
  };
  const before = JSON.stringify(table);
  const band = createReportSampleRegion(table, source, ['r1'], ['c1', 'c2']);
  assert.equal(band.id, 'kept');
  assert.deepEqual(band.sample_filter, { mode: 'indices', indices: [1] });
  const issues = reportSampleRegionIssues({ ...table, sample_bands: [band] });
  assert.equal(issues.length, 3);
  assert.match(issues.find(issue => issue.key === 'r1::c1')!.reason, /合并范围/);
  assert.match(issues.find(issue => issue.key === 'r1::c2')!.reason, /来源表/);
  assert.equal(issues.find(issue => issue.key === 'r2::c2')!.part, 'unit');
  assert.equal(JSON.stringify(table), before);
  assert.throws(() => createReportSampleRegion(table, source, ['missing'], ['c1']), /选区不匹配/);
});
