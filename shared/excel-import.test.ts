import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chooseImportSheet, describeImportTarget, findImportRegions, normalizeImportLabel, planExcelImport, rangesOverlap, reviewImportAssignments, sourceParameterLabels, suggestImportMapping, type ImportSheet } from './excel-import.ts';
import { buildFieldDefaults } from './matrix-flatten.ts';
import { editSampleAxes } from './free-grid-samples.ts';
import { buildFreeGridLayout } from './free-grid-layout.ts';
import type { FieldDefinition, RecordTemplate } from './types';
const sheet = (grid: ImportSheet['grid'], name = 'Data'): ImportSheet => ({ name, grid, merges: [], blocked: [], notices: [] });
function fixture(axis: 'row' | 'col' = 'row') {
  const ft: NonNullable<FieldDefinition['free_table']> = {
    rows: [{ id: 'h' }, { id: 'a' }, { id: 'b' }], columns: [{ id: 'x', label: '' }, { id: 'y', label: '' }, { id: 'f', label: '' }],
    cells: { 'h::x': '长度', 'h::y': '宽度', 'h::f': '合计' }, header_cells: { 'h::x': true, 'h::y': true, 'h::f': true },
    input_cells: { 'a::x': true, 'b::x': true, 'a::y': true, 'b::y': true, 'a::f': true, 'b::f': true },
    cell_formulas: { 'a::f': { type: 'sum', sources: ['a::x', 'a::y'] }, 'b::f': { type: 'sum', sources: ['b::x', 'b::y'] } },
    sample_bands: [{ id: 's', axis, refs: ['a', 'b'], cross_refs: ['x', 'y', 'f'] }], excel_import: { enabled: true, sheet_name: '', mode: 'auto' },
  };
  if (axis === 'col') {
    const rows = ft.rows; ft.rows = ft.columns.map(c => ({ id: c.id })); ft.columns = rows.map(r => ({ id: r.id, label: '' }));
    for (const name of ['cells', 'header_cells', 'input_cells', 'cell_formulas'] as const) (ft as any)[name] = Object.fromEntries(Object.entries(ft[name] || {}).map(([key, value]) => [key.split('::').reverse().join('::'), value]));
  }
  const field: FieldDefinition = { id: 'f', code: 'f', label: 'Results', type: 'free_grid', free_table: ft };
  const template = { name: 'Test', version: 1, groups: [{ id: 'g', label: 'G', layout: 'vertical', fields: [field] }] } as RecordTemplate;
  return { field, raw: buildFieldDefaults(template).f };
}
test('sheet assignment requires explicit choice for missing names and multiple sheets', () => {
  const a = sheet([[1]], 'A'), b = sheet([[2]], 'B');
  assert.equal(chooseImportSheet('', [a]), 'A');
  assert.equal(chooseImportSheet('', [a, b]), undefined);
  assert.equal(chooseImportSheet('B', [a, b]), 'B');
  assert.equal(chooseImportSheet('Missing', [a]), undefined);
});
test('multi-row merged headings are combined and reordered parameters are matched', () => {
  const s = sheet([['尺寸', ''], ['宽度', '长度'], ['mm', 'mm'], [2, 1], [4, 3]]);
  s.merges = [{ r0: 0, c0: 0, r1: 0, c1: 1 }];
  const range = findImportRegions(s, 'row')[0];
  assert.deepEqual(range, { r0: 3, c0: 0, r1: 4, c1: 1 });
  const labels = sourceParameterLabels(s, range, 'row');
  assert.deepEqual(labels, ['尺寸 / 宽度 / mm', '尺寸 / 长度 / mm']);
  assert.deepEqual(suggestImportMapping([{ id: 'x', label: '长度' }, { id: 'y', label: '宽度' }], labels).indexes, [1, 0]);
  assert.equal(normalizeImportLabel(' ＡＢ\nＣ '), 'abc');
  assert.deepEqual(suggestImportMapping([{ id: 'x', label: '长度' }, { id: 'y', label: '宽度' }], ['宽度（mm）', '长度/mm']).indexes, [1, 0]);
});
test('multi-table confirmation is all-or-nothing; overlapping source needs explicit reuse approval', () => {
  const range = { r0: 0, r1: 1, c0: 0, c1: 1 };
  const first = { code: 'a', sheet: 'S', range, skip: false, reviewed: true, valid: true };
  const missing = { code: 'b', skip: false, reviewed: false, valid: false };
  assert.equal(reviewImportAssignments([first, missing], false).ready, false);
  assert.equal(reviewImportAssignments([first, { ...missing, skip: true }], false).ready, true);
  assert.equal(reviewImportAssignments([{ ...first, skip: true }], false).ready, false);
  const second = { ...first, code: 'b' };
  assert.equal(reviewImportAssignments([first, second], false).ready, false);
  assert.equal(reviewImportAssignments([first, second], true).ready, true);
  assert.equal(reviewImportAssignments([first, { ...second, valid: false }], true).ready, false);
  assert.equal(reviewImportAssignments([first, { ...second, sheet: 'Other' }], false).ready, true);
});
test('row-based parameter labels support automatic and manually reordered mappings', () => {
  const { field, raw } = fixture('col');
  const source = sheet([['宽度', 'mm', 2, 4], ['长度', 'mm', 1, 3]]);
  const range = { r0: 0, r1: 1, c0: 2, c1: 3 };
  const labels = sourceParameterLabels(source, range, 'col');
  assert.deepEqual(labels, ['宽度 / mm', '长度 / mm']);
  const mapping = suggestImportMapping(describeImportTarget(field, raw).params, labels).indexes;
  assert.deepEqual(mapping, [1, 0]);
  const plan = planExcelImport(field, raw, source, range, 'col', mapping);
  assert.deepEqual(plan.issues, []);
  assert.deepEqual(plan.changes.map(change => change.after), [1, 2, 3, 4]);
  const manual = planExcelImport(field, raw, source, range, 'col', [0, 1]);
  assert.deepEqual(manual.changes.map(change => change.after), [2, 1, 4, 3]);
  assert.ok(planExcelImport(field, raw, source, range, 'col', [0, 0]).issues.length, 'duplicate manual mapping is still rejected');
});
test('ambiguous labels remain marked for review, duplicate mappings are not invented', () => {
  const match = suggestImportMapping([{ id: 'a', label: '强度' }, { id: 'b', label: '强度' }], ['强度', '强度']);
  assert.ok(match.reasons.every(reason => reason.includes('核对')));
  assert.deepEqual(match.indexes, [-1, -1], 'ambiguous duplicate names must not be guessed by position');
  assert.equal(rangesOverlap({ r0: 0, r1: 2, c0: 0, c1: 1 }, { r0: 2, r1: 3, c0: 1, c1: 2 }), true);
});
test('same-sheet candidates are ranked using each target parameter rather than only area size', () => {
  const s = sheet([['长度'], [1], [2], [3], [''], ['强度'], [4]]);
  assert.equal(findImportRegions(s, 'row', [{ id: 's', label: '强度' }])[0].r0, 6);
  assert.equal(findImportRegions(s, 'row', [{ id: 's', label: '长度' }])[0].r0, 1);
});
test('partial bending selection reserves named matches without shifting absent parameters', () => {
  const params = ['弯曲强度', '弯曲模量', '试样厚度', '试样宽度'].map(label => ({ id: label, label }));
  const source = sheet([['', ...params.map(p => p.label)], ['', 'MPa', 'MPa', 'mm', 'mm'], ['试样1', 75.61, 2140.33, 4.13, 9.96], ['试样2', 75.46, 2180.63, 4.13, 9.95]]);
  const range = { r0: 2, r1: 3, c0: 2, c1: 4 };
  assert.deepEqual(suggestImportMapping(params, sourceParameterLabels(source, range, 'row')).indexes, [-1, 0, 1, 2]);
  assert.deepEqual(suggestImportMapping(params, sourceParameterLabels(source, { ...range, r0: 3 }, 'row')).indexes, [-1, 0, 1, 2], 'selection starting below first sample still finds headers');
  const transposed = sheet(source.grid[0].map((_, c) => source.grid.map(row => row[c])));
  assert.deepEqual(suggestImportMapping(params, sourceParameterLabels(transposed, { r0: 2, r1: 4, c0: 2, c1: 3 }, 'col')).indexes, [-1, 0, 1, 2]);
  const { field, raw } = fixture();
  raw['a::x::s0'] = 99;
  const narrower = sheet([['宽度'], [2], [4]]);
  const selected = { r0: 1, r1: 2, c0: 0, c1: 0 };
  const mapping = suggestImportMapping(describeImportTarget(field, raw).params, sourceParameterLabels(narrower, selected, 'row')).indexes;
  assert.deepEqual(mapping, [-1, 0]);
  const plan = planExcelImport(field, raw, narrower, selected, 'row', mapping);
  assert.deepEqual(plan.issues, []);
  assert.equal(plan.value['a::x::s0'], 99, 'unselected parameter retains existing value');
  assert.equal(plan.value['a::y::s0'], 2);
});
test('global matching handles fuzzy headers and refuses named positional fallback', () => {
  const params = ['弯曲强度', '弯曲弹性模量', '厚度', '宽度'].map(label => ({ id: label, label }));
  assert.deepEqual(suggestImportMapping(params, ['弯曲模量 / MPa', '试样厚度 / mm', '试样宽度 / mm']).indexes, [-1, 0, 1, 2]);
  assert.deepEqual(suggestImportMapping([{ id: 'a', label: '强度' }, { id: 'b', label: '弯曲强度' }], ['弯曲强度 / MPa']).indexes, [-1, 0]);
  assert.deepEqual(suggestImportMapping(params, ['温度', '时间', '密度', '速度']).indexes, [-1, -1, -1, -1]);
  assert.deepEqual(suggestImportMapping(params.slice(0, 2), ['Excel列 B', 'Excel列 C']).indexes, [0, 1]);
  assert.deepEqual(suggestImportMapping(params, ['Excel列 B', 'Excel列 C']).indexes, [-1, -1, -1, -1]);
});
for (const axis of ['row', 'col'] as const) {
  test(`${axis}: import grows stable samples, preserves original data and protects formulas/headers`, () => {
    const { field, raw } = fixture(axis);
    const before = JSON.stringify({ field, raw });
    const source = axis === 'row' ? sheet([[2, 1], [4, 3], [6, 5]]) : sheet([[2, 4, 6], [1, 3, 5]]);
    const plan = planExcelImport(field, raw, source, { r0: 0, c0: 0, r1: source.grid.length - 1, c1: source.grid[0].length - 1 }, axis, [1, 0]);
    assert.deepEqual(plan.issues, []);
    assert.equal(plan.added, 1); assert.equal(plan.changes.length, 6);
    assert.deepEqual(plan.changes.map(c => c.after), [1, 2, 3, 4, 5, 6]);
    assert.equal(JSON.stringify({ field, raw }), before);
    assert.equal(describeImportTarget(field, plan.value).cells.length, 3);
    assert.ok(!plan.changes.some(c => c.parameter.includes('合计')));
    const shorter = planExcelImport(field, plan.value, sheet([[8, 9]]), { r0: 0, r1: 0, c0: 0, c1: 1 }, 'row', [0, 1]);
    assert.equal(describeImportTarget(field, shorter.value).cells.length, 3);
    assert.equal(shorter.overwritten, 2);
  });
}
test('blank positions stay aligned, zero and qualified/text values are preserved, empty does not erase', () => {
  const { field, raw } = fixture(); raw['a::x::s0'] = 12; raw['b::y::s0'] = 99;
  const plan = planExcelImport(field, raw, sheet([['', 0], ['<0.01', ''], ['未检出', '合格']]), { r0: 0, r1: 2, c0: 0, c1: 1 }, 'row', [0, 1]);
  assert.equal(plan.value['a::x::s0'], 12); assert.equal(plan.value['b::y::s0'], 99);
  assert.equal(plan.value['a::y::s0'], 0); assert.equal(plan.value['b::x::s0'], '<0.01');
  assert.ok(plan.changes.some(c => c.after === '未检出'));
});
test('deleted sample storage is not reused; live order survives import', () => {
  const { field, raw } = fixture(); const ft = field.free_table!, band = ft.sample_bands![0];
  raw['a::x::s0'] = 'deleted';
  const value = editSampleAxes(ft, raw, band, [{ ref: 'a', sample: 0 }, { ref: 'b', sample: 0 }], { ref: 'a', sample: 0 });
  const plan = planExcelImport(field, value, sheet([[1, 2], [3, 4]]), { r0: 0, r1: 1, c0: 0, c1: 1 }, 'row', [0, 1]);
  assert.equal(plan.value['a::x::s0'], 'deleted'); assert.equal(plan.value['b::x::s0'], 1);
  assert.equal(plan.added, 1); assert.equal(buildFreeGridLayout(ft, plan.value).displayRows.filter(r => r.sample != null).length, 2);
});
test('invalid ranges, over-limit samples and duplicate mappings block the plan', () => {
  const { field, raw } = fixture();
  assert.ok(planExcelImport(field, raw, sheet([[1, 2]]), { r0: 0, r1: 0, c0: 0, c1: 1 }, 'row', [0, 0]).issues.length);
  assert.ok(planExcelImport(field, raw, sheet([[1]]), { r0: -1, r1: 0, c0: 0, c1: 0 }, 'row', [0]).issues.length);
  assert.ok(planExcelImport(field, raw, sheet(Array.from({ length: 51 }, () => [1, 2])), { r0: 0, r1: 50, c0: 0, c1: 1 }, 'row', [0, 1]).issues.length);
});
test('choice constraints, blocked source errors and instance-only input columns are respected', () => {
  const { field, raw } = fixture();
  raw.__free_table_structure__ = { ...field.free_table, cell_options: { 'a::x': ['合格'] } };
  const source = sheet([['不合格', 2], [3, 4]]); source.blocked = ['1,1'];
  const plan = planExcelImport(field, raw, source, { r0: 0, r1: 1, c0: 0, c1: 1 }, 'row', [0, 1]);
  assert.equal(plan.skipped, 2); assert.equal(plan.changes.length, 2);
});
test('legacy target starting cell remains a preview target until config switches to auto', () => {
  const { field, raw } = fixture();
  field.free_table!.excel_import = { enabled: true, sheet_name: '', target_cell: 'b::y', data_start_row: 2, data_start_col: 1 };
  const target = describeImportTarget(field, raw);
  assert.equal(target.params.length, 1); assert.equal(target.cells.length, 1); assert.equal(target.cells[0][0].key, 'b::y::s0');
});
test('matrix import preserves parameter codes, expands only samples, respects formulas and rounding', () => {
  const field: FieldDefinition = { id: 'm', code: 'm', label: 'Matrix', type: 'data_matrix', matrix: {
    default_sample_count: 1, parameters: [{ id: 'p', code: 'p', label: 'Length', decimals: 2 }, { id: 'q', code: 'q', label: 'Formula', cell_formula: 'p * 2' }],
    cell_type: 'number', allow_add_remove_samples: true, allow_add_remove_parameters: true,
  } };
  const plan = planExcelImport(field, undefined, sheet([[1.234, 999, 123], [2.345, 999, 123]]), { r0: 0, r1: 1, c0: 0, c1: 2 }, 'row', [0, 1]);
  assert.equal(plan.added, 1); assert.equal(plan.value.parameters.length, 2);
  assert.equal(plan.skipped, 2); assert.deepEqual(plan.changes.map(c => c.after), ['1.23', '2.35']);
  field.matrix!.allow_add_remove_samples = false;
  assert.ok(planExcelImport(field, undefined, sheet([[1, 2], [3, 4]]), { r0: 0, r1: 1, c0: 0, c1: 1 }, 'row', [0, 1]).issues.length);
});
