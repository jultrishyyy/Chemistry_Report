import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickReportImageData } from './report-image-state.ts';
import { preferredReportTemplate } from './report-template-preference.ts';
import { resolveBinding } from './typst-generator.ts';
import { compileGridFormula } from './free-grid-excel-formula.ts';
import type { FieldDefinition, RecordTemplate } from './types';

test('cover images in ordinary sections and dynamic collections survive save/reopen transfer', () => {
  const section = { groups: [{ id: 'description', fields: [{ id: 'p', code: 'picture', type: 'image', image_source_code: 'original_photo' },
    { id: 't', code: 'photo_table', type: 'report_photo_table', photo_table: { photos: [{ server_path: '/photos/original.jpg' }] } }] }],
    ctx: { record_raw_data: { original_photo: [{ server_path: '/photos/test.jpg' }],
      '__image_collection__::old': { kind: 'image_collection', source_field_codes: ['original_photo'], items: [{ photo: { server_path: '/photos/after.jpg' } }] },
      unrelated_test: 123, customer_name: 'must not transfer' } } };
  const reopened = JSON.parse(JSON.stringify(section));
  const picked = pickReportImageData(reopened);
  assert.ok(picked.original_photo.length);
  assert.ok(picked['__image_collection__::old']);
  assert.equal(picked.unrelated_test, undefined);
  assert.equal(picked.customer_name, undefined);
  const report = JSON.parse(JSON.stringify({ groups: reopened.groups, ctx: { report_no: 'KEEP', record_raw_data: picked } }));
  assert.equal(report.groups[0].fields[1].photo_table.photos[0].server_path, '/photos/original.jpg');
  assert.equal(report.ctx.report_no, 'KEEP');
  assert.deepEqual(pickReportImageData({ ...section, ctx: { record_raw_data: { original_photo: [] } } }).original_photo, []);
});

test('ordinary cell binding follows formula conversion and runtime table structure', () => {
  const base = { rows: [{ id: 'r' }], columns: ['a', 'b'].map(id => ({ id, label: '' })), cells: {}, input_cells: { 'r::a': true as const } };
  const changed = { ...base, rows: [...base.rows, { id: 'added' }], cells: { 'added::a': '7' }, cell_formulas: { 'r::b': compileGridFormula(base, '=A1*2') } };
  const field: FieldDefinition = { id: 'f', code: 'f', label: 'F', type: 'free_grid', free_table: base };
  const template: RecordTemplate = { name: 'T', version: 1, groups: [{ id: 'g', label: 'G', layout: 'vertical', fields: [field] }] };
  const ctx = { linked_record_template: template, record_raw_data: { f: { 'r::a': 3, __free_table_structure__: changed } } };
  assert.equal(resolveBinding({ source: 'record_free_cell', field_code: 'f', cell_key: 'r::b' }, ctx), '6');
  assert.equal(resolveBinding({ source: 'record_free_cell', field_code: 'f', cell_key: 'added::a' }, ctx), '7');
  assert.equal(resolveBinding({ source: 'record_free_formula_cell', field_code: 'f', cell_key: 'r::b' }, ctx), '6');
});

test('OEM defaults follow cover changes without replacing a valid manual selection', () => {
  const candidates = [{ id: 1, host_manufacturer_id: 10 }, { id: 2, host_manufacturer_id: 20 }];
  assert.equal(preferredReportTemplate(candidates, 10)?.id, 1);
  assert.equal(preferredReportTemplate(candidates, 20)?.id, 2);
  assert.equal(preferredReportTemplate(candidates, 20, 1)?.id, 1);
  assert.equal(preferredReportTemplate(candidates, 20, 999)?.id, 2);
  assert.equal(preferredReportTemplate(candidates, 30), undefined);
  assert.equal(preferredReportTemplate(candidates, null), undefined);
});
