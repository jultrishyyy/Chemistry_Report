import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FieldDefinition, FieldGroup } from './types';
import { detachReportFigureNotes } from './report-detached-notes';
import { reportRichPlainText } from './report-rich-document';
import { makeReportManualImages, makeReportManualTable } from './report-document-editing';
import { renderContentDoc } from './typst-generator';
const text = (f: FieldDefinition) => reportRichPlainText((f.binding as any)?.text || '');
test('table caption becomes editable prose once, preserving content, style and literal symbols', () => {
  const field = makeReportManualTable('table'); field.caption = '注：值  #1\n第二行'; field.caption_style = { size: '11pt', weight: 'bold' }; field.caption_gap = '3';
  const source: FieldGroup[] = [{ id: 'g', label: '', layout: 'vertical', fields: [field] }], before = structuredClone(source);
  const result = detachReportFigureNotes(source);
  assert.deepEqual(source, before);
  assert.equal(result[0].fields.length, 2);
  assert.equal(result[0].fields[0].caption, undefined);
  assert.equal(text(result[0].fields[1]), '备注：值  #1\n第二行');
  assert.equal(result[0].fields[1].style?.size, '11pt');
  assert.equal(result[0].fields[1].style?.space_before, '3pt');
  assert.deepEqual(detachReportFigureNotes(result), result);
  const doc = { cover: { groups: result, ctx: {} }, projects: [] };
  assert.equal(renderContentDoc(JSON.parse(JSON.stringify(doc))), renderContentDoc(doc));
  assert.equal((renderContentDoc(doc).match(/第二行/g) || []).length, 1);
});
test('above notes carry the page break and do not duplicate the old caption', () => {
  const field = makeReportManualTable('table'); field.caption = '上方说明'; field.caption_position = 'above'; field.page_break_before = true;
  const result = detachReportFigureNotes([{ id: 'g', label: '', layout: 'vertical', fields: [field] }]);
  assert.equal(text(result[0].fields[0]), '备注：上方说明');
  assert.equal(result[0].fields[0].page_break_before, true);
  assert.equal(result[0].fields[1].page_break_before, undefined);
});
test('image notes are sibling prose without changing photo slots; composite layouts are protected', () => {
  const image = makeReportManualImages('image', { imageCount: 2 });
  const source: FieldGroup[] = [{ id: 'images', label: '', hide_title: true, layout: 'vertical', section_role: 'images', page_break_before: true,
    image_layout: { top_label: '上方', caption: '下方', cols: 2 }, fields: [image] }];
  const result = detachReportFigureNotes(source);
  assert.equal(result.length, 3);
  assert.equal(text(result[0].fields[0]), '上方');
  assert.equal(text(result[2].fields[0]), '备注：下方');
  assert.equal(result[0].page_break_before, true);
  assert.equal(result[1].page_break_before, undefined);
  assert.deepEqual(result[1].fields, source[0].fields);
  assert.deepEqual(detachReportFigureNotes(result), result);
  source[0].module_span = 2;
  assert.deepEqual(detachReportFigureNotes(source), source);
});
test('insertion dimensions and image count are validated and survive reopening', () => {
  const table = makeReportManualTable('t', { rows: 5, columns: 4 });
  assert.equal(table.free_table!.rows.length, 5);
  assert.equal(table.free_table!.columns.length, 4);
  const images = makeReportManualImages('i', { imageCount: 3 });
  assert.equal(JSON.parse(JSON.stringify(images)).image_photos.length, 3);
  assert.throws(() => makeReportManualTable('t', { rows: 0 }));
  assert.throws(() => makeReportManualImages('i', { imageCount: 1.5 }));
});
