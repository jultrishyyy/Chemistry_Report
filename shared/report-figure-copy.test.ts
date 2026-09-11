import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FieldDefinition, FieldGroup } from './types';
import { snapshotReportFigure, instantiateReportFigure } from './report-figure-copy';
import { renderFreeGridTypst } from './typst-generator';
import { reportImagePreview } from './report-image-preview';
const group = (field: FieldDefinition): FieldGroup => ({ id: 'g', label: '', layout: 'vertical', fields: [field] });
test('figure clipboard freezes mapped values, precision, styles and merges; repeated paste is independent', () => {
  const field: FieldDefinition = { id: 'f', code: 'f', type: 'free_grid', label: '', page_break_before: true, free_table: {
    rows: [{ id: 'r' }], columns: [{ id: 'c', label: '' }], cells: {},
    cell_bindings: { 'r::c': { source: 'literal', text: '1.23456789' } }, cell_styles: { 'r::c': { line_height: '0.8em' } },
  } };
  const before = JSON.stringify(field), copy = snapshotReportFigure(field, group(field), {})!;
  assert.equal(copy.free_table?.cells['r::c'], '1.23456789');
  assert.equal(copy.free_table?.cell_bindings, undefined);
  assert.equal(copy.free_table?.cell_formulas, undefined);
  assert.equal(renderFreeGridTypst(copy, copy.free_table!, undefined, {}), renderFreeGridTypst(field, field.free_table!, undefined, {}));
  const a = instantiateReportFigure(copy, 'a'), b = instantiateReportFigure(copy, 'b');
  a.free_table!.cells['r::c'] = 'changed';
  assert.equal(b.free_table?.cells['r::c'], '1.23456789');
  assert.equal(a.page_break_before, undefined);
  assert.equal(JSON.stringify(field), before);
});
test('copy image collections resolves their photos, titles and slots before pasting elsewhere', () => {
  const field: FieldDefinition = { id: 'photo', code: 'photo', image_source_code: 'source', type: 'image', label: '照片' };
  const images = group(field); images.section_role = 'images'; images.image_layout = { cols: 2, title_mode: 'per', width_cm: 6, height_cm: 4 };
  const ctx = { record_raw_data: { source: [{ rel_path: 'first.png' }, { rel_path: 'second.png' }] } };
  const before = JSON.stringify({ images, ctx }), copy = snapshotReportFigure(field, images, ctx)!;
  const pasted = instantiateReportFigure(copy, 'pasted');
  const model = reportImagePreview(pasted, {});
  assert.equal(model.items.length, 2);
  assert.deepEqual(model.items.map(item => item.photo.rel_path), ['first.png', 'second.png']);
  assert.equal(model.cols, 2); assert.equal(model.width, 6);
  assert.notEqual(pasted.image_items?.[0].id, copy.image_items?.[0].id);
  assert.equal(JSON.stringify({ images, ctx }), before);
});
