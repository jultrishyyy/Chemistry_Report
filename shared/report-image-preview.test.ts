import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportImagePreview, reportCollectionPreview, reportPreviewPhotoSrc } from './report-image-preview.ts';
import { renderReportImageGalleryTypst, renderPhotoTableTypst, renderContentDoc } from './typst-generator.ts';
import type { FieldDefinition, FieldGroup } from './types';
import { reportImageTitleStyle } from './report-image-title-style';
const photo = (name: string) => ({ url: `/api/images/file?p=${name}.png`, server_path: `/uploads/${name}.png` });
const imageField: FieldDefinition = { id: 'source', code: 'source', type: 'image', label: '来源图片' };
const ctx: any = { linked_record_template: { groups: [{ id: 'g', fields: [imageField] }] }, record_raw_data: { source: [photo('first'), photo('second')] } };

test('direct image captions follow above/below placement without duplicate titles or mutating saved fields', () => {
    for (const caption_position of [undefined, 'above', 'below'] as const) {
      const field: FieldDefinition = { ...imageField, image_photos: [photo('placement')],
        caption: '唯一图片备注', caption_position, hide_label: false };
      const group: FieldGroup = { id: 'g', label: '', layout: 'vertical', fields: [field] };
      const snapshot = JSON.stringify(group);
      const output = renderContentDoc({ cover: { groups: [group], ctx: {} }, projects: [] });
      assert.equal((output.match(/唯一图片备注/g) || []).length, 1);
      assert.equal((output.match(/来源图片/g) || []).length, 1);
      assert.ok(output.includes('placement.png'));
      assert.equal(output.indexOf('唯一图片备注') < output.indexOf('placement.png'), caption_position === 'above');
      assert.equal(JSON.stringify(group), snapshot);
    }
});

test('invalid legacy image column counts always produce a usable preview grid', () => {
  for (const cols of [0, -1, 0.5, NaN, Infinity, 100]) {
    const model = reportImagePreview({ ...imageField, image_cols: cols });
    assert.ok(Number.isInteger(model.cols) && model.cols >= 1 && model.cols <= 12);
  }
});

test('automatic galleries include every source photo, manual slots match PDF first-photo semantics', () => {
  const snapshot = JSON.stringify(ctx);
  const field: FieldDefinition = { id: 'gallery', code: 'gallery', type: 'report_image_gallery', label: '', image_gallery: {} };
  const auto = reportImagePreview(field, ctx);
  assert.equal(auto.items.length, 2); assert.equal(auto.items[1].title, '来源图片 2');
  assert.ok(renderReportImageGalleryTypst(field, ctx).includes('second.png'));
  field.image_gallery = { title_mode: 'shared', shared_title: '共用标题', items: [{ id: 'slot', source_field_code: 'source' }] };
  const manual = reportImagePreview(field, ctx);
  assert.equal(manual.title, '共用标题'); assert.equal(manual.items.length, 1);
  assert.equal(manual.items[0].photo.url, photo('first').url);
  assert.ok(!renderReportImageGalleryTypst(field, ctx).includes('second.png'));
  assert.equal(JSON.stringify(ctx), snapshot);
});
test('direct pictures and photo tables preserve shared/per titles, photos, captions and empty slots', () => {
  const field: FieldDefinition = { id: 'photos', code: 'photos', type: 'report_photo_table', label: '', photo_table: {
    caption_label: '说明', caption_text: '样品原貌', header: '原样照片', photos: [photo('first'), photo('second')], cols: 2,
  } };
  assert.equal(reportImagePreview(field).items.length, 2);
  assert.equal(reportImagePreview(field).caption, '样品原貌');
  assert.ok(renderPhotoTableTypst(field, {}).includes('second.png'));
  field.photo_table = { title_mode: 'per', items: [{ id: 'one', label: '照片一', photos: [photo('first'), photo('second')] }, { id: 'empty', label: '待补照片', photos: [] }] };
  assert.deepEqual(reportImagePreview(field).items.map(i => i.title), ['照片一', '待补照片']);
  assert.equal(reportImagePreview(field).items[1].photo, undefined);
  assert.ok(!renderPhotoTableTypst(field, {}).includes('second.png'));
  const direct: FieldDefinition = { ...imageField, image_photos: [photo('direct')], hide_label: true };
  assert.equal(reportImagePreview(direct).title, '');
  assert.ok(renderContentDoc({ cover: { groups: [{ id: 'direct', label: '', layout: 'vertical', fields: [direct] }], ctx: {} }, projects: [] }).includes('direct.png'));
  const paragraph = (code: string, text: string): FieldDefinition => ({ id: code, code, label: '', type: 'text', rich: true, hide_label: true, binding: { source: 'literal', text } });
  const source = renderContentDoc({ cover: { groups: [{ id: 'mixed', label: '', layout: 'vertical', fields: [paragraph('before', '前面的正文'), direct, paragraph('after', '后面的正文')] }], ctx: {} }, projects: [] });
  assert.ok(source.indexOf('前面的正文') < source.indexOf('direct.png'));
  assert.ok(source.indexOf('direct.png') < source.indexOf('后面的正文'));
  assert.ok(!source.includes('data.source'));
});
test('modern image collections retain images but omit legacy implicit captions without modifying their source', () => {
  const group: FieldGroup = { id: 'g', label: '', layout: 'vertical', fields: [imageField], image_layout: { title_mode: 'shared', shared_title: '图片集合', top_label: '检测前', caption: '下方说明' } };
  const collection: any = { kind: 'image_collection', version: 1, items: [{ id: 'a', title: 'A', photo: photo('first') }, { id: 'b', title: 'B', photo: photo('second') }] };
  const before = JSON.stringify(collection);
  const model = reportCollectionPreview(group, collection);
  assert.equal(model.items.length, 2); assert.equal(model.aboveText, '检测前'); assert.equal(model.belowText, undefined);
  assert.equal(JSON.stringify(collection), before);
  assert.equal(reportPreviewPhotoSrc({ rel_path: '图片/a.png' }), '/api/images/file?p=%E5%9B%BE%E7%89%87%2Fa.png');
  assert.equal(reportPreviewPhotoSrc({ rel_path: '../private' }), undefined);
});

test('image toolbar title style and explicit zero insets reach the paper preview', () => {
  const field: FieldDefinition = { ...imageField, image_title_mode: 'shared', image_inset_x: 0, image_inset_y: 12,
    image_title_inset_y: 0, label_style: { font: 'Arial', size: '14pt', weight: 'regular', color: '#ff0000' } };
  const before = JSON.stringify(field);
  const preview = reportImagePreview(field);
  assert.deepEqual(preview.titleStyle, field.label_style);
  assert.equal(preview.insetX, 0); assert.equal(preview.insetY, 12); assert.equal(preview.titleInsetY, 0);
  assert.equal(JSON.stringify(field), before);
  const group: FieldGroup = { id: 'g', label: '', layout: 'vertical', fields: [field],
    image_layout: { label_style: field.label_style, inset_x: 0, inset_y: 8, title_inset_y: 0 } };
  const model = reportCollectionPreview(group, { kind: 'image_collection', version: 1, items: [] } as any);
  assert.deepEqual(model.titleStyle, field.label_style);
  assert.equal(model.insetX, 0); assert.equal(model.insetY, 8); assert.equal(model.titleInsetY, 0);
});

for (const type of ['image', 'report_photo_table', 'report_image_gallery'] as const) {
  for (const mode of ['shared', 'per'] as const) {
    test(`report image title font reaches preview and PDF: ${type}/${mode}`, () => {
      const style = { font: 'KaiTi', size: '17pt', weight: 'regular' as const, color: '#123456' };
      const field: FieldDefinition = { ...imageField, type, hide_label: false, label: '图片标题', report_image_title_style: style,
        image_title_mode: mode, image_photos: [photo('a')], image_items: [{ id: 'i', label: '图片标题', photos: [photo('a')] }],
        photo_table: { title_mode: mode, header: '图片标题', photos: [photo('a')], items: [{ id: 'i', label: '图片标题', photos: [photo('a')] }] },
        image_gallery: { title_mode: mode, shared_title: '图片标题', items: [{ id: 'i', label: '图片标题', source_field_code: 'source' }] } };
      const before = JSON.stringify(field);
      const model = reportImagePreview(field, ctx);
      assert.equal(model.titleStyle?.font, 'KaiTi');
      const source = type === 'report_image_gallery' ? renderReportImageGalleryTypst(field, ctx)
        : type === 'report_photo_table' ? renderPhotoTableTypst(field, {})
        : renderContentDoc({ cover: { groups: [{ id: 'g', label: '', layout: 'vertical', fields: [field] }], ctx: {} }, projects: [] });
      assert.ok(source.includes('KaiTi'), source);
      assert.ok(source.includes('17pt'), source);
      assert.equal(JSON.stringify(field), before);
      assert.deepEqual(reportImageTitleStyle({ ...field, report_image_title_style: { font: 'Arial' } }, { weight: 'regular', color: '#ff0000' }),
        { weight: 'regular', color: '#ff0000', font: 'Arial' });
    });
  }
}
