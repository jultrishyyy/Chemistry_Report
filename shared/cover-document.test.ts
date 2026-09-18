import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectCoverDocument, applyCoverDocument } from './cover-document.ts';
import { encodeReportRichDocument, storedReportRichDocument, reportRichPlainText } from './report-rich-document.ts';
import { resolveReportFieldValue, generateTypst, injectReportFieldsIntoTypst } from './typst-generator.ts';
import type { RecordTemplate } from './types';

const template: RecordTemplate = { name: '首页', version: 1, groups: [
  { id: 'body', label: '', layout: 'vertical', fields: [
    { id: 'p', code: 'p', type: 'text', label: '', hide_label: true, style: { align: 'center', size: '12pt' }, binding: { source: 'literal', text: '  标题　\n\n*原样*  ' } },
    { id: 'ref', code: 'customer', type: 'text', label: '委托单位', label_width: 'none', unit: '单位', binding: { source: 'order', key: 'customer_name' } },
    { id: 's', code: 's', type: 'spacer', label: '', spacer_height: '2cm' },
    { id: 'logo', code: 'logo', type: 'static_content', label: '', static_kind: 'images', static_images: [{ id: 'asset', rel_path: 'logo.png' }] },
    { id: 'table', code: 'table', type: 'static_content', label: '', static_kind: 'table' },
  ] },
  { id: 'signature', label: '', layout: 'vertical', fields: [
    { id: 'sign', code: 'sign', type: 'text', label: '编制', signature_line: true },
  ] },
] };

test('document opening and JSON roundtrip preserve source, whitespace, assets, layout and PDF exactly', () => {
  const before = structuredClone(template), doc = projectCoverDocument(template);
  assert.deepEqual(doc.sections[0].blocks.map(b => b.kind), ['text', 'text', 'spacer', 'image', 'table']);
  assert.equal(doc.sections[1].blocks[0].kind, 'compatibility');
  assert.equal(reportRichPlainText(doc.sections[0].blocks[0].value!), '  标题　\n\n*原样*  ');
  const restored = applyCoverDocument(template, JSON.parse(JSON.stringify(doc)));
  assert.equal(restored, template, 'opening must not create a save or history change');
  assert.deepEqual(template, before);
  assert.equal(generateTypst(restored), generateTypst(before));
  doc.source.groups[0].fields[0].label = 'isolated';
  assert.deepEqual(template, before, 'projection owns an isolated source snapshot');
});

test('multiple text edits preserve ownership, style, references and resolve per order', () => {
  const doc = projectCoverDocument(template);
  doc.sections[0].blocks[0].value = encodeReportRichDocument({ type: 'doc', content: [{ type: 'paragraph', attrs: { spaceAfter: 8 }, content: [{ type: 'text', text: ' 新文字  ', marks: [{ type: 'bold' }] }] }] });
  const dynamic = storedReportRichDocument(doc.sections[0].blocks[1].value!)!;
  dynamic.content![0].content!.push({ type: 'text', text: '  备注' });
  doc.sections[0].blocks[1].value = encodeReportRichDocument(dynamic);
  const result = applyCoverDocument(template, doc);
  assert.equal(result.groups[0].fields[1].code, 'customer');
  assert.deepEqual(result.groups[0].fields[0].style, template.groups[0].fields[0].style);
  assert.deepEqual(result.groups[0].fields.slice(2), template.groups[0].fields.slice(2));
  assert.deepEqual(result.groups[1], template.groups[1]);
  for (const name of ['单位甲', '单位乙']) {
    assert.ok(reportRichPlainText(resolveReportFieldValue(result.groups[0].fields[1], { order: { customer_name: name } })).includes(name));
    assert.ok(injectReportFieldsIntoTypst(generateTypst(result), result, { order: { customer_name: name } }).includes(name));
  }
  assert.equal(template.groups[0].fields[1].binding?.source, 'order');
});

test('special fallback, fixed label width and legacy rich grammar stay compatible', () => {
  const t = structuredClone(template);
  t.groups[0].fields[1].default_value = '未提供';
  t.groups[0].fields[0].rich = true;
  const d = projectCoverDocument(t);
  assert.equal(d.sections[0].blocks[0].kind, 'compatibility');
  assert.equal(d.sections[0].blocks[1].kind, 'compatibility');
  assert.equal(applyCoverDocument(t, d), t);
  delete t.groups[0].fields[1].default_value;
  t.groups[0].fields[1].label_width = '6em';
  assert.equal(projectCoverDocument(t).sections[0].blocks[1].kind, 'compatibility');
});

test('stale source, unsupported versions, duplicate identities and implicit block deletion reject safely', () => {
  const d = projectCoverDocument(template), changed = structuredClone(template);
  changed.groups[0].fields[0].label = 'changed';
  assert.throws(() => applyCoverDocument(changed, d), /模板已变化/);
  assert.throws(() => applyCoverDocument(template, { ...d, version: 2 } as any), /版本/);
  d.sections[0].blocks.splice(2, 1);
  assert.throws(() => applyCoverDocument(template, d), /结构/);
  changed.groups[0].fields[1].id = 'p';
  assert.throws(() => projectCoverDocument(changed), /编号/);
  const invalid = projectCoverDocument(template);
  invalid.sections[0].blocks[0].value = '@report-rich:v1:{"type":"doc","content":[{"type":"unknown"}]}';
  assert.throws(() => applyCoverDocument(template, invalid), /格式/);
  assert.equal(template.groups[0].fields[0].rich, undefined);
});
