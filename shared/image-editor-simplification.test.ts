import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findImageCollection, imageCollectionKey } from './image-collection';
import { buildProjectGroupsFromRecord } from './report-inherit';
import { generateTypst } from './typst-generator';
import { categoriesForGroup } from '../client/src/components/FieldEditor/field-types';

test('record image sections permit ordinary text before and after pictures in PDF', () => {
  assert.ok(categoriesForGroup('record', 'images').some(item => item.key === 'text'));
  const source = generateTypst({ id: 1, name: '图片记录', version: 1, groups: [{
    id: 'images', label: '图片', layout: 'vertical', section_role: 'images', fields: [
      { id: 'before', code: 'before', type: 'text', label: '上方说明' },
      { id: 'photo', code: 'photo', type: 'image', label: '测试照片' },
      { id: 'after', code: 'after', type: 'text', label: '下方说明' },
    ],
  }] } as any);
  assert.ok(source.includes('上方说明')); assert.ok(source.includes('下方说明'));
  assert.ok(source.indexOf('上方说明') < source.indexOf('下方说明'));
});

test('entry has no built-in photo caption input; record settings use normal formatting', () => {
  const form = readFileSync(new URL('../client/src/components/FormRenderer/index.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(form, /captionEditor|figureCaptionGroupKey|figureCaptionFieldKey/);
  assert.match(form, /field.type !== 'image'.*renderField\(field, group\)/);
  const editor = readFileSync(new URL('../client/src/components/FieldEditor/index.tsx', import.meta.url), 'utf8');
  assert.match(editor, /group.section_role === 'images' && editorMode === 'report-cover'/);
});

test('image sections omit legacy field and group captions while preserving independent text', () => {
  const source = generateTypst({ id: 1, name: '图片记录', version: 1, groups: [{
    id: 'images', label: '图片', layout: 'vertical', section_role: 'images', image_layout: { caption: '不应输出的旧备注' }, fields: [
      { id: 'photo', code: 'photo', type: 'image', label: '测试照片', caption: '旧单图备注' },
      { id: 'after', code: 'after', type: 'text', label: '独立说明' },
    ],
  }] } as any);
  assert.doesNotMatch(source, /不应输出的旧备注|旧单图备注/);
  assert.match(source, /独立说明/);
});

test('image layout uses its parent popover scroll instead of a competing inner scroller', () => {
  const panel = readFileSync(new URL('../client/src/components/FieldEditor/ImageSectionPanel.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(panel, /overflowY|maxHeight|overscrollBehavior/);
  const css = readFileSync(new URL('../client/src/index.css', import.meta.url), 'utf8');
  assert.match(css, /\.fe-section-format-card--image \.fe-section-format-column\s*\{\s*overflow: visible/);
});


test('pulling source images initializes joined report frames while preserving the source layout', () => {
  for (const seamless of [undefined, false, true]) {
    const record: any = { groups: [{ id: 'images', label: 'Photos', layout: 'vertical', section_role: 'images',
      image_layout: { seamless, width_cm: 8, title_mode: 'shared', shared_title: 'Photo title' },
      fields: [{ id: 'photo', code: 'photo', type: 'image', label: 'Before', image_seamless: seamless }],
    }] };
    const before = JSON.stringify(record);
    const group = buildProjectGroupsFromRecord(record).groups[0];
    assert.equal(group.image_layout?.seamless, true);
    assert.equal(group.image_source_group_id, 'images');
    const photos = { kind: 'image_collection', version: 1, source_group_id: 'images', source_field_codes: [], items: [] };
    assert.equal(findImageCollection({ [imageCollectionKey('images')]: photos }, { ...group, id: 'new-report-section' }), photos);
    assert.equal(group.fields[0].image_seamless, true);
    assert.equal(group.fields[0].image_source_code, 'photo');
    assert.equal(group.image_layout?.width_cm, 8);
    assert.equal(group.image_layout?.shared_title, 'Photo title');
    assert.equal(JSON.stringify(record), before);
  }
});
