import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FieldGroup } from './types';
import { continueImageSection } from './report-image-continuation.ts';
import { continuousTextValue } from './report-continuous-text.ts';
import { reportRichPlainText } from './report-rich-document.ts';
import { renderContentDoc, resolveReportFieldValue } from './typst-generator.ts';
const image = (): FieldGroup => ({ id: 'images', label: '照片分区', section_role: 'images', layout: 'vertical',
  image_layout: { cols: 2, title_mode: 'shared', shared_title: '保留图题' }, fields: [
    { id: 'photo1', code: 'photo1', type: 'image', label: '图一', image_photos: [] },
    { id: 'photo2', code: 'photo2', type: 'image', label: '图二', image_photos: [] },
  ] });
const resolve = (f: FieldGroup['fields'][number]) => resolveReportFieldValue(f, {});

test('continuation creates sibling prose, never changes the photo collection, and repeated clicks reuse it', () => {
  const groups = [image()], original = structuredClone(groups[0]);
  const after = continueImageSection(groups, 'images', 1, { group: 'after', field: 'after_text' }, resolve);
  assert.deepEqual(after, { groupId: 'after', id: 'after_text', position: 1 });
  assert.equal(groups.length, 2); assert.deepEqual(groups[0], original);
  const snapshot = JSON.stringify(groups);
  assert.deepEqual(continueImageSection(groups, 'images', 1, { group: 'unused', field: 'unused' }, resolve), after);
  assert.equal(JSON.stringify(groups), snapshot);
  const before = continueImageSection(groups, 'images', -1, { group: 'before', field: 'before_text' }, resolve);
  assert.equal(before?.groupId, 'before');
  assert.deepEqual(groups.map(g => g.id), ['before', 'images', 'after']);
  assert.deepEqual(groups[1], original);
  groups[2].fields[0].binding = { source: 'literal', text: '图片下方新增说明' };
  const reopened = JSON.parse(JSON.stringify(groups));
  const source = renderContentDoc({ cover: { groups: [], ctx: {} }, projects: [{ name: '项目', groups: reopened, ctx: {} }] });
  assert.ok(source.indexOf('保留图题') < source.indexOf('图片下方新增说明'));
});

test('existing prose is retained and gains only one empty edge paragraph', () => {
  const note: FieldGroup = { id: 'note', label: '', layout: 'vertical', fields: [{ id: 'text', code: 'text', type: 'text', label: '说明', default_value: '已有说明' }] };
  const groups = [image(), note], originalFields = structuredClone(note.fields);
  continueImageSection(groups, 'images', 1, { group: 'unused', field: 'unused' }, resolve);
  assert.equal(groups.length, 2); assert.deepEqual(note.fields, originalFields);
  assert.equal(reportRichPlainText(continuousTextValue(note, resolve)), '\n说明：已有说明');
  const snapshot = JSON.stringify(groups);
  continueImageSection(groups, 'images', 1, { group: 'unused2', field: 'unused2' }, resolve);
  assert.equal(JSON.stringify(groups), snapshot);
});

test('locked/composite collections are not rewritten, and sibling insertion keeps parent identity', () => {
  for (const patch of [{ module_span: 2 }, { fields: [{ ...image().fields[0], signature_line: true }] }]) {
    const groups = [{ ...image(), ...patch }], snapshot = JSON.stringify(groups);
    assert.equal(continueImageSection(groups, 'images', 1, { group: 'new', field: 'new' }, resolve), null);
    assert.equal(JSON.stringify(groups), snapshot);
  }
  const groups = [{ ...image(), parent_group_id: 'parent' }];
  continueImageSection(groups, 'images', 1, { group: 'new', field: 'new' }, resolve);
  assert.equal(groups[1].parent_group_id, 'parent');
});
