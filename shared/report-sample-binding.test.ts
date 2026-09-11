import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { freeGridSourceBinding, sampleBandForCell } from './free-grid-binding.ts';
import { buildProjectGroupsFromRecord } from './report-inherit.ts';
import { validateReportBindings } from './binding-integrity.ts';
import { renderFreeGridTypst, resolveBinding } from './typst-generator.ts';
import type { FieldDefinition, RecordTemplate } from './types';

function fixture(axis: 'row' | 'col' = 'row') {
  const ft: NonNullable<FieldDefinition['free_table']> = {
    rows: [{ id: 'h' }, { id: 'a' }, { id: 'b' }],
    columns: [{ id: 'title', label: '' }, { id: 'x', label: '' }, { id: 'y', label: '' }],
    cells: { 'h::x': '备注', 'h::y': '编号', 'a::title': '平均值', 'b::title': '编号' },
    header_cells: { 'h::x': true, 'h::y': true, 'a::title': true, 'b::title': true },
    input_cells: { 'a::x': true, 'a::y': true, 'b::x': true, 'b::y': true },
    sample_bands: [{ id: 'samples', axis, refs: axis === 'row' ? ['a', 'b'] : ['x', 'y'], cross_refs: axis === 'row' ? ['x', 'y'] : ['a', 'b'] }],
  };
  const field = { id: 'f', code: 'f', label: '结果', type: 'free_grid', hide_label: true, free_table: ft } as FieldDefinition;
  const record = { groups: [{ id: 'g', label: 'G', fields: [field] }] } as RecordTemplate;
  const inherited = () => buildProjectGroupsFromRecord(record).groups.flatMap(g => g.fields).find(f => f.type === 'free_grid')!;
  const render = (raw: Record<string, any>, indices?: number[]) => {
    const target = inherited();
    if (indices) target.free_table!.sample_bands![0].sample_filter = { mode: 'indices', indices };
    return renderFreeGridTypst(target, target.free_table!, undefined, { linked_record_template: record, record_raw_data: { f: raw } });
  };
  return { ft, field, record, inherited, render };
}

for (const axis of ['row', 'col'] as const) {
  test(`${axis}: inherited multi-cell samples retain block order and source identity after filtering`, () => {
    const { render } = fixture(axis);
    const first = 'a::x', second = axis === 'row' ? 'b::x' : 'a::y';
    const raw = { '__sample_count__::samples': 3,
      [`${first}::s0`]: 'Aone', [`${second}::s0`]: 'Bone',
      [`${first}::s1`]: 'Atwo', [`${second}::s1`]: 'Btwo',
      [`${first}::s2`]: 'Athree', [`${second}::s2`]: 'Bthree' };
    const values = (pdf: string) => pdf.match(/Aone|Bone|Atwo|Btwo|Athree|Bthree/g) || [];
    assert.deepEqual(values(render(raw)), ['Aone', 'Bone', 'Atwo', 'Btwo', 'Athree', 'Bthree']);
    assert.deepEqual(values(render(raw, [1])), ['Atwo', 'Btwo']);
    assert.deepEqual(values(render(raw, [0, 2])), ['Aone', 'Bone', 'Athree', 'Bthree']);
    assert.deepEqual(values(render(raw, [])), []);
  });

  test(`${axis}: per-sample merge repeats without changing source table geometry`, () => {
    const { ft, inherited, render } = fixture(axis);
    ft.spans = { 'a::x': axis === 'row' ? { rowspan: 2, colspan: 1 } : { rowspan: 1, colspan: 2 } };
    const snapshot = JSON.stringify(ft);
    assert.equal(inherited().free_table!.cell_bindings!['a::x'].source, 'record_free_cell_sample');
    const pdf = render({ '__sample_count__::samples': 2, 'a::x::s0': 'FirstMerge', 'a::x::s1': 'SecondMerge' });
    assert.ok(pdf.includes('FirstMerge') && pdf.includes('SecondMerge'));
    assert.equal((pdf.match(axis === 'row' ? /rowspan: 2/g : /colspan: 2/g) || []).length, 2);
    assert.equal(JSON.stringify(ft), snapshot);
  });
}

test('labels never convert explicit sample data to shared values or generated serials', () => {
  const { ft, field, inherited } = fixture();
  assert.equal(freeGridSourceBinding(field, 'a::x').source, 'record_free_cell_sample');
  assert.equal(inherited().free_table!.cell_bindings!['a::y'].source, 'record_free_cell_sample');
  ft.sample_index_cells = { 'a::y': true };
  assert.equal(freeGridSourceBinding(field, 'a::y').source, 'record_sample_index');
  assert.equal(inherited().free_table!.cell_bindings!['a::y'].source, 'record_sample_index');
  assert.equal(freeGridSourceBinding(field, 'h::x').source, 'record_free_template_cell');
});

test('shared merges and covered cells are not independent per-sample sources', () => {
  const { ft } = fixture();
  ft.spans = { 'h::x': { rowspan: 3, colspan: 1 } };
  assert.equal(sampleBandForCell(ft, 'h::x'), undefined);
  assert.equal(sampleBandForCell(ft, 'a::x'), undefined);
  ft.spans = { 'a::title': { colspan: 2, rowspan: 1 } };
  assert.equal(sampleBandForCell(ft, 'a::title'), undefined);
  assert.equal(sampleBandForCell(ft, 'a::x'), undefined);
});

test('filtering preserves formula overrides and selected units from the original sample', () => {
  const { ft, render } = fixture();
  ft.cell_formulas = { 'a::x': { type: 'sum', sources: ['a::y'] } };
  ft.cell_unit_options = { 'a::x': ['UnitDefault', 'UnitOne', 'UnitTwo'] };
  const raw = { '__sample_count__::samples': 2,
    '__formula_override__::a::x::s0': { value: 'FirstOverride' },
    '__formula_override__::a::x::s1': { value: 'SecondOverride' },
    'a::x::s0::__unit__': 'UnitOne', 'a::x::s1::__unit__': 'UnitTwo' };
  const pdf = render(raw, [1]);
  assert.ok(pdf.includes('SecondOverride') && pdf.includes('UnitTwo'));
  assert.ok(!pdf.includes('FirstOverride') && !pdf.includes('UnitOne'));
});

test('fixed, header and sample bindings preserve explicit empty and zero values', () => {
  const { ft, record, render } = fixture();
  ft.cells!['a::x'] = 'DefaultValue';
  const raw = { 'a::x': '', 'h::x': '', 'a::y': 0 };
  const ctx = { linked_record_template: record, record_raw_data: { f: raw } };
  assert.equal(resolveBinding({ source: 'record_free_cell', field_code: 'f', cell_key: 'a::x' }, ctx), '');
  assert.equal(resolveBinding({ source: 'record_free_template_cell', field_code: 'f', cell_key: 'h::x' }, ctx), '');
  assert.equal(resolveBinding({ source: 'record_free_cell', field_code: 'f', cell_key: 'a::y' }, ctx), '0');
  assert.ok(!render({ 'a::x::s0': '' }).includes('DefaultValue'));
  assert.ok(render({}).includes('DefaultValue'));
});

test('legacy sample_band remains a valid direct source', () => {
  const { ft, field } = fixture();
  ft.sample_bands = undefined;
  ft.sample_band = { axis: 'row', ref: 'a' };
  assert.equal(freeGridSourceBinding(field, 'a::x').source, 'record_free_cell_sample');
  assert.equal(freeGridSourceBinding(field, 'b::x').source, 'record_free_cell');
});

test('mapping diagnostics include formula/unit series and removed source regions', () => {
  const { ft, record, inherited } = fixture();
  ft.cell_formulas = { 'a::x': { type: 'sum', sources: ['a::y'] } };
  ft.cell_units = { 'a::x': 'mm' };
  const target = inherited();
  const groups = [{ id: 'report', label: 'Report', layout: 'vertical' as const, fields: [target] }];
  assert.deepEqual(validateReportBindings(groups, record.groups), []);
  target.free_table!.cell_bindings!['h::x'] = target.free_table!.cell_bindings!['a::x'];
  target.free_table!.cell_unit_bindings!['h::x'] = target.free_table!.cell_unit_bindings!['a::x'];
  const issues = validateReportBindings(groups, record.groups);
  assert.ok(issues.some(issue => issue.source === 'record_free_formula_cell_sample' && issue.reason.includes('报告对应')));
  assert.ok(issues.some(issue => issue.source === 'record_free_cell_unit_sample' && issue.reason.includes('报告对应')));
  ft.sample_bands = [];
  assert.ok(validateReportBindings(groups, record.groups).some(issue => issue.reason === '原始记录的试样区域已变更'));
});

test('real Typst compilation accepts row/column samples, merges and empty filters', () => {
  const available = spawnSync('typst', ['--version'], { encoding: 'utf8' });
  assert.equal(available.status, 0, 'Typst is required for the PDF integration check');
  for (const axis of ['row', 'col'] as const) {
    const { ft, render } = fixture(axis);
    ft.spans = { 'a::x': axis === 'row' ? { rowspan: 2, colspan: 1 } : { rowspan: 1, colspan: 2 } };
    for (const indices of [undefined, [1], []]) {
      const source = render({ '__sample_count__::samples': 3, 'a::x::s0': 'First', 'a::x::s1': 'Second', 'a::x::s2': 'Third' }, indices);
      const pdf = spawnSync('typst', ['compile', '-', '-'], { input: source, maxBuffer: 5 * 1024 * 1024 });
      assert.equal(pdf.status, 0, pdf.stderr.toString());
      assert.equal(pdf.stdout.subarray(0, 5).toString(), '%PDF-');
    }
  }
});
