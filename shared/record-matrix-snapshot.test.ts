import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FieldDefinition, RecordTemplate } from './types';
import { recordMatrixSnapshot } from './record-matrix-snapshot';
import { sourceSelectionData } from './report-source-selection';

export const legacySourceField: FieldDefinition = { id: 'f', code: 'result_matrix', type: 'data_matrix', label: '试验数据', matrix: {
  allow_add_remove_samples: true, allow_add_remove_parameters: true,
  cell_type: 'number', default_sample_count: 6, parameters: [{ id: 'p1', code: 'col_1', label: '透光率', unit: '%' }, { id: 'p2', code: 'col_2', label: '雾度', unit: '%' }],
  default_sample_labels: ['1', '2', '3', '4', '5', '平均值'],
  cell_formulas: { s5__col_1: { type: 'average', sources: [0, 1, 3, 2, 4].map(i => `result_matrix__s${i}__col_1`), decimals: 2 } },
} };
const template: RecordTemplate = { name: '透光率雾度试验原始记录', version: 1, groups: [{ id: 'g', label: '', layout: 'vertical', fields: [legacySourceField] }] };
const raw = { result_matrix: { parameters: legacySourceField.matrix!.parameters, sample_ids: ['s0', 's1', 's2', 's5'], sample_labels: { s0: '1', s1: '2', s2: '3', s5: '平均值' }, cells: { s0__col_1: '90.78', s1__col_1: '90.75', s2__col_1: '90.78' } } };
test('MOCK-EXT-002-2# legacy snapshot exposes actual sample rows, blanks and calculated mean without mutation', () => {
  const before = JSON.stringify({ template, raw });
  const table = recordMatrixSnapshot(legacySourceField, template, raw)!;
  assert.equal(table.rows.length, 5);
  assert.equal(table.columns.length, 3);
  assert.equal(table.cells['r0::c1'], '透光率 (%)');
  assert.equal(table.cells['r1::c1'], '90.78');
  assert.equal(table.cells['r4::c0'], '平均值');
  assert.equal(table.cells['r4::c1'], '90.77');
  assert.equal(table.cells['r4::c2'], '');
  assert.equal(sourceSelectionData(table, { minR: 1, maxR: 4, minC: 0, maxC: 2 }).cells.length, 4);
  assert.equal(JSON.stringify({ template, raw }), before);
});
test('legacy column orientation preserves data coordinates and summary merges', () => {
  const field = structuredClone(legacySourceField);
  field.matrix!.sample_axis = 'col';
  field.matrix!.summary_rows = [{ id: 'note', label: '要求', source_type: 'literal', literal: '合格' }];
  const tpl = { ...template, groups: [{ ...template.groups[0], fields: [field] }] };
  const table = recordMatrixSnapshot(field, tpl, raw)!;
  assert.equal(table.rows.length, 3);
  assert.equal(table.cells['r0::c4'], '平均值');
  assert.equal(table.cells['r1::c4'], '90.77');
  assert.equal(table.cells['r1::c5'], '合格');
  assert.deepEqual(table.spans!['r1::c5'], { rowspan: 2, colspan: 1 });
});
