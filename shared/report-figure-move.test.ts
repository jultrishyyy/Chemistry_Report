import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FieldDefinition, FieldGroup } from './types';
import { moveReportFigure } from './report-figure-move';
const table = (id: string): FieldDefinition => ({ id, code: id, label: '', type: 'report_result_table', free_table: { columns: [{ id: 'c', label: '参数' }], rows: [{ id: 'r' }], cells: { 'r::c': '1.234567' } } });
const group = (id: string, fields: FieldDefinition[]): FieldGroup => ({ id, label: '', hide_title: true, layout: 'vertical', fields });
test('drag reorders figures across single-field groups and retains values and IDs', () => {
  const a = table('a'), b = table('b'), snapshot = JSON.stringify(a);
  const groups = [group('ga', [a]), group('gb', [b])];
  assert.equal(moveReportFigure(groups, 'a', 'gb', 'b', true, 'new'), true);
  assert.deepEqual(groups.flatMap(g => g.fields.map(f => f.id)), ['b', 'a']);
  assert.equal(JSON.stringify(groups[0].fields[1]), snapshot);
});
test('dropping beside continuous prose creates a sibling without changing its document', () => {
  const prose = group('prose', [{ id: 'p', code: 'p', label: '', type: 'text', default_value: '正文' }]);
  prose.report_document = { version: 1, value: '保留编辑内容' };
  const before = JSON.stringify(prose), groups = [group('fig', [table('a')]), prose];
  assert.equal(moveReportFigure(groups, 'a', 'prose', undefined, true, 'new'), true);
  assert.equal(JSON.stringify(groups[0]), before);
  assert.equal(groups[1].fields[0].id, 'a');
});
test('image sections move as a unit; composite/parent boundary moves are refused without mutation', () => {
  const images = group('images', [{ id: 'im', code: 'im', type: 'image', label: '' }]); images.section_role = 'images';
  const groups = [images, group('target', [table('a')])];
  assert.equal(moveReportFigure(groups, 'im', 'target', 'a', true, 'new'), true);
  assert.equal(groups[1], images);
  groups[0].module_span = 2;
  const before = JSON.stringify(groups);
  assert.equal(moveReportFigure(groups, 'im', 'target', 'a', false, 'new'), false);
  assert.equal(JSON.stringify(groups), before);
});
