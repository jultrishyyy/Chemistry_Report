import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FieldGroup } from './types';
import { canEditContinuousText, continuousTextValue, projectContinuousGroups, hasContinuousText, insertContinuousFigure, restoreContinuousSource } from './report-continuous-text.ts';
import { makeReportManualTable, insertIntoReportParagraph } from './report-document-editing.ts';
import { readReportRichDocument, reportRichPlainText, encodeReportRichDocument } from './report-rich-document.ts';
import { resolveReportFieldValue, renderContentDoc, diffContentDocValues } from './typst-generator.ts';

const fixture = (): FieldGroup => ({ id: 'basic', label: '基本信息', layout: 'vertical', fields: [
  { id: 'customer', code: 'customer', type: 'text', label: '单位名称', binding: { source: 'literal', text: '公司**原文**#1' }, label_style: { weight: 'bold' } },
  { id: 'gap', code: 'gap', type: 'spacer', label: '', spacer_height: '0.5cm' },
  { id: 'date', code: 'date', type: 'date', label: '生产日期', default_value: '2025-12-16' },
  { id: 'note', code: 'note', type: 'text', label: '', hide_label: true, default_value: '以下信息\n由委托方提供' },
] });
const resolve = (field: FieldGroup['fields'][number]) => resolveReportFieldValue(field, {});

test('cursor insertion preserves source bindings, module boundaries, text/table/text order and restore', () => {
  const group = { ...fixture(), parent_group_id: 'parent', module_span: 2 };
  const original = JSON.stringify(group);
  const rich = (text: string) => encodeReportRichDocument({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text, marks: [{ type: 'bold' }] }] }] });
  const mixed = insertContinuousFigure(group, makeReportManualTable('manual'), { before: rich('前文'), after: rich('后文') }, ['before', 'after']);
  assert.equal(JSON.stringify(group), original);
  assert.deepEqual(mixed.report_source_fields, group.fields);
  assert.equal(mixed.parent_group_id, 'parent'); assert.equal(mixed.module_span, 2);
  assert.deepEqual(mixed.fields.map(f => f.type), ['text', 'free_grid', 'text']);
  assert.equal(canEditContinuousText(mixed), false);
  assert.equal(hasContinuousText({ cover: { groups: [mixed] } }), true);
  const reopened = JSON.parse(JSON.stringify(mixed));
  const doc = { cover: { groups: [reopened], ctx: {} }, projects: [] };
  const pdf = renderContentDoc(doc);
  assert.ok(pdf.includes('#strong[前文]')); assert.ok(pdf.includes('#strong[后文]'));
  assert.ok(pdf.indexOf('前文') < pdf.indexOf('#table(columns:')); assert.ok(pdf.indexOf('#table(columns:') < pdf.indexOf('后文'));
  assert.deepEqual(restoreContinuousSource(reopened), group);
  assert.ok(!diffContentDocValues({ cover: { groups: [group], ctx: {} }, projects: [] }, doc).some(d => d.kind === 'removed'));
});

test('start/end insertion and repeated insertion retain editable empty paragraphs on both sides', () => {
  const empty = { before: '', after: '' };
  const mixed = insertContinuousFigure(fixture(), makeReportManualTable('table'), empty, ['before', 'after']);
  assert.equal(mixed.fields.length, 3);
  assert.equal(reportRichPlainText(resolve(mixed.fields[0])), '');
  assert.equal(reportRichPlainText(resolve(mixed.fields[2])), '');
  const more = insertIntoReportParagraph(mixed.fields[2], '', 0, makeReportManualTable('next'), 'tail', empty, true);
  assert.deepEqual(more.map(f => f.type), ['text', 'free_grid', 'text']);
  assert.throws(() => insertContinuousFigure(fixture(), makeReportManualTable('bad'), { before: '<script>', after: '' }, ['b', 'a']));
});

test('continuous conversion preserves labels, literal symbols, dates, line breaks and spacer dimensions without mutating sources', () => {
  const group = fixture(), snapshot = JSON.stringify(group);
  assert.ok(canEditContinuousText(group));
  const value = continuousTextValue(group, resolve);
  assert.equal(reportRichPlainText(value), '单位名称：公司**原文**#1\n\n生产日期：2025-12-16\n以下信息\n由委托方提供');
  const nodes = readReportRichDocument(value).content!;
  assert.deepEqual(nodes[0].content![0].marks, [{ type: 'bold' }]);
  assert.equal(nodes[0].content![1].marks, undefined);
  assert.deepEqual(nodes[1], { type: 'reportSpacer', attrs: { height: '0.5cm' } });
  assert.equal(JSON.stringify(group), snapshot);
  assert.strictEqual(projectContinuousGroups([group])[0], group);
});

test('save/reopen, render projection, readable audit, and restore all retain the bound source fields', () => {
  const group = fixture();
  const original = { cover: { groups: [group], ctx: {} }, projects: [] };
  const changed = JSON.parse(JSON.stringify(original));
  changed.cover.groups[0].report_document = { version: 1, value: encodeReportRichDocument({ type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: '修改后的完整正文' }] }, { type: 'paragraph' },
    { type: 'reportSpacer', attrs: { height: '12pt' } },
  ] }) };
  const reopened = JSON.parse(JSON.stringify(changed));
  assert.ok(hasContinuousText(reopened));
  assert.deepEqual(reopened.cover.groups[0].fields, original.cover.groups[0].fields);
  const source = renderContentDoc(reopened);
  assert.ok(source.includes('修改后的完整正文'));
  assert.ok(source.includes('#v(12pt)'));
  assert.ok(!source.includes('公司'));
  assert.ok(!source.includes('@report-rich:'));
  const diffs = diffContentDocValues(original, reopened);
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].kind, 'changed');
  assert.ok(diffs[0].from.includes('单位名称'));
  assert.ok(diffs[0].to.includes('修改后的完整正文'));
  delete reopened.cover.groups[0].report_document;
  assert.equal(renderContentDoc(reopened), renderContentDoc(original));
  assert.deepEqual(diffContentDocValues(original, reopened), []);
});

test('complex layouts, tables, signatures, nonrepresentable formatting and corrupted overrides fail safely', () => {
  for (const group of [
    { ...fixture(), layout: 'grid' as const },
    { ...fixture(), fields: [{ ...fixture().fields[0], signature_line: true }] },
    { ...fixture(), fields: [{ ...fixture().fields[0], type: 'image' as const }] },
    { ...fixture(), fields: [{ ...fixture().fields[0], style: { size: '1.2em' } }] },
    { ...fixture(), fields: [{ ...fixture().fields[1], spacer_height: '1fr' }] },
  ]) assert.equal(canEditContinuousText(group), false);
  assert.throws(() => projectContinuousGroups([{ ...fixture(), report_document: { version: 1, value: 'invalid' } }]));
  assert.throws(() => encodeReportRichDocument({ type: 'doc', content: [{ type: 'reportSpacer', attrs: { height: '1cm);#evil' } }] }));
});
