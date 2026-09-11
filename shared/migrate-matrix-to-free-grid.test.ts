import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateMatrixField, migrateMatrixGroups } from './migrate-matrix-to-free-grid.ts';
import { projectLegacyMatrices } from './legacy-matrix-bridge.ts';
import { buildFieldDefaults, flattenMatrixValuesToFlatData, applyMatrixSummaryFormulas, createEmptyMatrixValue } from './matrix-flatten.ts';
import { resolveBinding, renderReportResultTableTypst, renderFreeGridTypst, buildFreeTableFromField } from './typst-generator.ts';
import { editSampleAxes, readSampleAxes } from './free-grid-samples.ts';
import { buildRecordFieldIndex } from './binding-integrity.ts';
import type { FieldDefinition, RecordTemplate } from './types';

const fixture = (axis: 'row' | 'col' = 'row') => {
  const f: FieldDefinition = { id: 'm', code: 'm', type: 'data_matrix', label: 'Test', caption: '保留备注', matrix: {
    sample_axis: axis, default_sample_count: 3, default_sample_labels: ['A', 'B', 'C'], cell_type: 'number',
    allow_add_remove_samples: true, allow_add_remove_parameters: false,
    parameters: [{ id: 'p', code: 'p', label: '长度', unit: 'mm', default_value: '2' }, { id: 'q', code: 'q', label: '宽度', unit_options: ['mm', 'cm'] }],
    cell_defaults: { 's0__p': '0' },
    cell_formulas: { 's0__q': { type: 'average', sources: ['m__s1__p', 'm__s2__p'], decimals: 2 } },
    summary_rows: [{ id: 'avg', label: '平均值', source_type: 'per_column_aggregate', decimals: 2 },
      { id: 'choice', label: '结论', source_type: 'input_choice', choices: ['符合', '不符合'], allow_custom: true, default_value: '符合' }],
    summary_cols: [{ id: 'note', label: '备注', source_type: 'input_text' }],
    excel_import: { enabled: true, sheet_name: 'Results', data_start_col: 1 },
  } };
  const old = { groups: [{ id: 'g', label: 'G', fields: [f] }] } as RecordTemplate;
  const converted = migrateMatrixGroups(old.groups);
  const template = { ...old, groups: converted.groups };
  const field = template.groups[0].fields[0];
  return { old, f, template, field, ft: field.free_table!, raw: buildFieldDefaults(template) };
};

for (const axis of ['row', 'col'] as const) {
  test(`${axis}: contents, units, choices, spans, formulas and import options survive; source is immutable`, () => {
    const { old, f, template, field, ft, raw } = fixture(axis);
    assert.equal(field.type, 'free_grid'); assert.equal(field.matrix, undefined); assert.equal(field.caption, f.caption);
    assert.equal(old.groups[0].fields[0].type, 'data_matrix');
    assert.deepEqual(ft.excel_import, f.matrix!.excel_import);
    const meta = field.legacy_matrix!;
    assert.equal(ft.cells[meta.parameter_headers.p], '长度');
    assert.deepEqual(ft.cell_unit_options![meta.parameter_headers.q], ['mm', 'cm']);
    const ck = meta.keys.summary__choice;
    assert.deepEqual(ft.cell_options![ck], ['符合', '不符合']); assert.equal(ft.cell_option_allow_custom![ck], true);
    assert.equal(axis === 'row' ? ft.spans![ck].colspan : ft.spans![ck].rowspan, 2);
    const oldRaw = { m: createEmptyMatrixValue(f.matrix!) };
    const oldFlat = applyMatrixSummaryFormulas(old, flattenMatrixValuesToFlatData(old, oldRaw));
    const actual = projectLegacyMatrices(template, raw).flat;
    for (const k of Object.keys(actual)) {
      if (actual[k] === '' && oldFlat[k] == null) continue;
      if (actual[k] === '' && oldFlat[k] === '') continue;
      if (Number.isFinite(Number(actual[k])) && Number.isFinite(Number(oldFlat[k]))) assert.equal(Number(actual[k]), Number(oldFlat[k]), k);
      else assert.deepEqual(actual[k], oldFlat[k], k);
    }
    const index = buildRecordFieldIndex(template.groups);
    assert.ok(index.freeGrids.has('m') && index.matrices.has('m'));
    assert.deepEqual(migrateMatrixGroups(template.groups), { groups: template.groups, count: 0 });
  });

  test(`${axis}: old fixed/dynamic report mappings follow added/deleted samples without touching raw data`, () => {
    const { template, field, ft, raw } = fixture(axis);
    const band = ft.sample_bands![0], meta = field.legacy_matrix!;
    let value = raw.m;
    value = editSampleAxes(ft, value, band, readSampleAxes(value, band.id)!);
    value[`${meta.keys.s2__p}::s1`] = 99;
    value[`${meta.sample_headers.s2}::s1`] = '新增 D';
    value = editSampleAxes(ft, value, band, readSampleAxes(value, band.id)!, { ref: 's1', sample: 0 });
    const snapshot = JSON.stringify(value);
    const ctx = { linked_record_template: template, record_raw_data: { m: value }, record_flat_data: { m__s1__p: 'STALE' } };
    const projected = projectLegacyMatrices(template, ctx.record_raw_data, ctx.record_flat_data);
    assert.equal(projected.flat.m__s1__p, undefined);
    assert.deepEqual(projected.raw.m.sample_ids, ['s0', 's2', 's2_added_1']);
    assert.equal(projected.flat.m__s2_added_1__p, 99);
    assert.equal(resolveBinding({ source: 'record_cell', matrix_code: 'm', sample_idx: 0, param_code: 'p' }, ctx), '0');
    assert.equal(resolveBinding({ source: 'record_cell', matrix_code: 'm', sample_idx: 1, param_code: 'p' }, ctx), '—');
    assert.equal(resolveBinding({ source: 'record_header', matrix_code: 'm', param_code: 'q' }, ctx), 'mm');
    const report: FieldDefinition = { id: 'r', code: 'r', label: 'Report', type: 'report_result_table', result_table: {
      columns: [{ id: 'label', label: '试样' }, { id: 'p', label: '结果' }], rows: [{ id: 'r', label: '' }],
      cells: [{ rowId: 'r', colId: 'label', binding: { source: 'record_sample_label', matrix_code: 'm' } },
        { rowId: 'r', colId: 'p', binding: { source: 'record_cell_sample', matrix_code: 'm', param_code: 'p' } }],
      band: { axis: 'row', ref_id: 'r', matrix_code: 'm' },
    } };
    const pdf = renderReportResultTableTypst(report, ctx);
    assert.ok(pdf.includes('99') && pdf.includes('新增 D')); assert.ok(!pdf.includes('STALE'));
    assert.ok(Object.values(buildFreeTableFromField(report, ctx).cells).includes('99'));
    assert.ok(renderFreeGridTypst(field, ft, value).includes('99'));
    assert.equal(JSON.stringify(value), snapshot);
  });
}

test('unsupported layout fails closed and stats tables keep fixed rows', () => {
  const { f } = fixture();
  f.matrix!.parameters[0].group = 'G'; assert.throws(() => migrateMatrixField(f), /禁止自动转换/);
  delete f.matrix!.parameters[0].group; f.matrix!.kind = 'stats';
  assert.equal(migrateMatrixField(f).free_table!.sample_bands, undefined);
});

test('formula precision and custom choices remain compatible with old report bindings', () => {
  const { template, field, raw } = fixture();
  const meta = field.legacy_matrix!;
  raw.m[meta.keys.s1__p] = 1.234; raw.m[meta.keys.s2__p] = 2.345;
  raw.m[meta.keys.summary__choice] = { custom: '待确认' };
  const view = projectLegacyMatrices(template, raw);
  assert.equal(Number(view.flat.m__s0__q), 1.79);
  assert.equal(view.flat.m__summary__choice, '待确认');
  raw.m[`__formula_override__::${meta.keys.s0__q}::s0`] = { value: 8.25 };
  assert.equal(projectLegacyMatrices(template, raw).flat.m__s0__q, 8.25);
});
