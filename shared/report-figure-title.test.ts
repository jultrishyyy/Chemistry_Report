import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportFigureTitle, setReportFigureTitle, TABLE_TITLE_TYPES } from './report-figure-title.ts';
import { renderContentDoc } from './typst-generator.ts';
import { makeReportManualTable } from './report-document-editing.ts';
import type { FieldDefinition } from './types';

for (const type of TABLE_TITLE_TYPES) test(`${type}: edited title, clearing and caption placement agree with report PDF`, () => {
  const field = makeReportManualTable('f');
  field.type = type as FieldDefinition['type'];
  field.label = '内部名称不修改'; field.hide_label = true;
  field.free_table!.cells['r1::c1'] = '表内内容';
  field.caption = '图表备注'; field.caption_position = 'above';
  field.label_gap = '0.6em'; field.caption_gap = '0.2cm';
  setReportFigureTitle(field, '报告中的标题');
  assert.equal(reportFigureTitle(field), '报告中的标题');
  assert.equal(field.label, '内部名称不修改');
  const render = () => renderContentDoc({ cover: { groups: [{ id: 'g', label: '', layout: 'vertical', fields: [field] }], ctx: {} }, projects: [] });
  let source = render();
  assert.ok(source.includes('报告中的标题'));
  assert.ok(source.includes('0.6em'));
  assert.ok(source.includes('0.2cm'));
  assert.ok(source.indexOf('图表备注') < source.indexOf('表内内容'));
  field.caption_position = 'below'; source = render();
  assert.ok(source.indexOf('图表备注') > source.indexOf('表内内容'));
  setReportFigureTitle(field, '');
  assert.equal(reportFigureTitle(field), '');
  assert.ok(!render().includes('报告中的标题'));
});

test('image title retains label/show semantics; legacy matrix uses independent title', () => {
  const image: FieldDefinition = { id: 'i', code: 'i', type: 'image', label: '图片', hide_label: true };
  setReportFigureTitle(image, '图1');
  assert.equal(reportFigureTitle(image), '图1'); assert.equal(image.hide_label, false);
  const matrix: FieldDefinition = { id: 'm', code: 'm', type: 'data_matrix', label: '内部表名' };
  setReportFigureTitle(matrix, '结果');
  assert.equal(matrix.table_title, '结果'); assert.equal(matrix.label, '内部表名');
});
