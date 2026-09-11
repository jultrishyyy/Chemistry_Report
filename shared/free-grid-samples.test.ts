import assert from 'node:assert/strict';
import { test } from 'node:test';
import { editSampleAxes, readSampleAxes, sampleAxisErrors } from './free-grid-samples.ts';
import { buildFreeGridLayout } from './free-grid-layout.ts';
import { buildFieldDefaults } from './matrix-flatten.ts';
import { buildProjectGroupsFromRecord } from './report-inherit.ts';
import { renderFreeGridTypst, resolveBinding } from './typst-generator.ts';
import type { RecordTemplate, FieldDefinition } from './types';
import { spawnSync } from 'node:child_process';

function setup(axis: 'row' | 'col') {
  const ft: NonNullable<FieldDefinition['free_table']> = {
    rows: [{ id: 'a' }, { id: 'b' }], columns: [{ id: 'x', label: '' }, { id: 'y', label: '' }],
    cells: {}, input_cells: { 'a::x': true, 'a::y': true, 'b::x': true, 'b::y': true },
    sample_bands: [{ id: 'band', axis, refs: axis === 'row' ? ['a', 'b'] : ['x', 'y'] }],
  };
  const field = { id: 'f', code: 'f', type: 'free_grid', hide_label: true, label: 'Grid', free_table: ft } as FieldDefinition;
  const template = { groups: [{ id: 'g', label: 'G', layout: 'vertical', fields: [field] }] } as RecordTemplate;
  const raw = buildFieldDefaults(template).f;
  const band = ft.sample_bands![0];
  const entries = (value: Record<string, any>) => {
    const layout = buildFreeGridLayout(ft, value);
    return (axis === 'row' ? layout.displayRows : layout.displayCols).filter(item => item.sample != null)
      .map(item => ({ ref: item.id, sample: item.sample! }));
  };
  const source = (value: Record<string, any>) => renderFreeGridTypst(field, ft, value);
  const report = (value: Record<string, any>, indices?: number[]) => {
    const target = buildProjectGroupsFromRecord(template).groups[0].fields[0];
    if (indices) target.free_table!.sample_bands![0].sample_filter = { mode: 'indices', indices };
    return renderFreeGridTypst(target, target.free_table!, undefined, { linked_record_template: template, record_raw_data: { f: value } });
  };
  return { ft, raw, entries, source, report, band, template };
}

for (const axis of ['row', 'col'] as const) {
  test(`${axis}: a new sample header has its own value even outside a partial data region`, () => {
    const { ft, raw, entries, source, band } = setup(axis);
    const key = axis === 'row' ? 'b::x' : 'a::y';
    ft.header_cells = { [key]: true };
    ft.cells[key] = 'OriginalHeader';
    band.cross_refs = axis === 'row' ? ['y'] : ['b'];
    const added = editSampleAxes(ft, raw, band, entries(raw));
    const extra = entries(added).at(-1)!;
    const layout = buildFreeGridLayout(ft, added);
    assert.equal(layout.sampleForCell(...(axis === 'row' ? ['b', 'x', extra.sample, null] : ['a', 'y', null, extra.sample]) as [string, string, number | null, number | null]), extra.sample);
    added[`${key}::s${extra.sample}`] = 'NewHeader';
    const saved = JSON.parse(JSON.stringify(added));
    assert.ok(source(saved).includes('NewHeader'));
    assert.ok(source(saved).includes('OriginalHeader'));
    assert.equal(ft.cells[key], 'OriginalHeader');
  });
  test(`${axis}: add one axis, delete a middle sample, save/reload and report without shifting values`, () => {
    const { ft, raw, entries, source, report, band } = setup(axis);
    const first = 'a::x', second = axis === 'row' ? 'b::x' : 'a::y';
    raw[`${first}::s0`] = 'First'; raw[`${second}::s0`] = 'Second';
    assert.equal(entries(raw).length, 2);
    const added = editSampleAxes(ft, raw, band, entries(raw));
    assert.equal(entries(added).length, 3, 'must add one axis, not a two-axis block');
    const entry = entries(added)[2];
    assert.equal(added[`${second}::s${entry.sample}`], '', 'new measurements start empty');
    added[`${second}::s${entry.sample}`] = 'Third';
    assert.deepEqual(report(added).match(/First|Second|Third/g), ['First', 'Second', 'Third']);
    const deleted = editSampleAxes(ft, added, band, entries(added), entries(added)[1]);
    assert.equal(entries(deleted).length, 2);
    assert.equal(deleted[`${second}::s0`], 'Second', 'removed values retained for traceability');
    const restored = JSON.parse(JSON.stringify(deleted));
    assert.deepEqual(source(restored).match(/First|Second|Third/g), ['First', 'Third']);
    assert.deepEqual(report(restored).match(/First|Second|Third/g), ['First', 'Third']);
    assert.deepEqual(report(restored, [1]).match(/First|Second|Third/g), ['Third']);
    const again = editSampleAxes(ft, restored, band, entries(restored));
    assert.ok(entries(again).at(-1)!.sample > entry.sample, 'new sample must not reuse a removed address');
    assert.equal(ft.rows.length, 2); assert.equal(ft.columns.length, 2);
    for (const typst of [source(restored), report(restored)]) {
      const pdf = spawnSync('typst', ['compile', '-', '-'], { input: typst, maxBuffer: 5 * 1024 * 1024 });
      assert.equal(pdf.status, 0, pdf.stderr.toString());
    }
  });

  test(`${axis}: all samples can be removed and a single empty axis added back`, () => {
    const { ft, raw, entries, source, report, band } = setup(axis);
    let value = raw;
    for (const entry of entries(raw)) value = editSampleAxes(ft, value, band, entries(value), entry);
    assert.deepEqual(readSampleAxes(value, band.id), []);
    assert.equal(entries(value).length, 0);
    assert.equal(sampleAxisErrors(ft, value).length, 1, 'empty drafts must not pass submission validation');
    assert.ok(source(value).includes('空网格'));
    assert.ok(report(value).includes('空网格'));
    value = editSampleAxes(ft, value, band, entries(value));
    assert.equal(entries(value).length, 1);
    assert.deepEqual(sampleAxisErrors(ft, value), []);
  });

  test(`${axis}: legacy block counts are preserved until an explicit single-axis edit`, () => {
    const { ft, entries, band } = setup(axis);
    const legacy = { '__sample_count__::band': 2 };
    assert.equal(entries(legacy).length, 4);
    const added = editSampleAxes(ft, legacy, band, entries(legacy));
    assert.equal(entries(added).length, 5);
  });
}

test('removing a sample excludes retained values from report aggregation; selected units match recording PDF', () => {
  const { ft, raw, entries, band, template, source, report } = setup('row');
  ft.rows.push({ id: 'total' });
  ft.cell_formulas = { 'total::x': { type: 'sum', sources: ['a::x', 'b::x'] } };
  ft.cell_unit_options = { 'b::x': ['UnitDefault', 'UnitOther'] };
  raw['a::x::s0'] = 10; raw['b::x::s0'] = 20;
  let value = editSampleAxes(ft, raw, band, entries(raw));
  const extra = entries(value).at(-1)!;
  value[`b::x::s${extra.sample}`] = 30;
  value[`b::x::s${extra.sample}::__unit__`] = 'UnitOther';
  value = editSampleAxes(ft, value, band, entries(value), entries(value)[1]);
  assert.equal(resolveBinding({ source: 'record_free_formula_cell', field_code: 'f', cell_key: 'total::x' }, {
    linked_record_template: template, record_raw_data: { f: value },
  }), '40');
  assert.ok(source(value).includes('UnitOther'));
  assert.ok(report(value).includes('UnitOther'));
});
