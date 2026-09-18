import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { continueCoverFigure, insertCoverBlockAtText, deleteCoverBlankParagraph } from './cover-text-boundaries.ts';
import { encodeReportRichDocument, reportRichPlainText, type ReportRichNode } from './report-rich-document.ts';
import { insertCoverLayoutBlock } from './cover-template-editing.ts';
import { renderContentDoc, resolveReportFieldValue } from './typst-generator.ts';
import type { RecordTemplate } from './types';

const prefix: ReportRichNode = { type: 'text', text: '前文  ', marks: [{ type: 'bold' }] };
const ref: ReportRichNode = { type: 'templateField', attrs: { reference: { id: 'customer', label: '客户', binding: { source: 'order', key: 'customer_name' } } } };
const suffix: ReportRichNode = { type: 'text', text: '后文' };
const doc = (content: ReportRichNode[]) => encodeReportRichDocument({ type: 'doc', content: [{ type: 'paragraph', content }] });
const value = doc([prefix, ref, suffix]);
const original: RecordTemplate = { name: '首页', version: 1, groups: [{ id: 'g', label: '', layout: 'vertical', fields: [
  { id: 'text', code: 'text', type: 'text', label: '', hide_label: true, rich: true, binding: { source: 'literal', text: value } },
  { id: 'space', code: 'space', type: 'spacer', label: '', spacer_height: '2cm' },
] }] };

test('native mapped fields support adjacent blank prose without losing field configuration', () => {
  const template = structuredClone(original);
  const mapped = { id: 'mapped', code: 'mapped', type: 'date' as const, label: '日期', cover_configured_field: true, binding: { source: 'order' as const, key: 'received_at' as const } };
  template.groups[0].fields = [mapped];
  const added = continueCoverFigure(template, 'g', 'mapped', 1, 'blank');
  assert.equal(added.fieldId, 'blank');
  assert.deepEqual(added.template.groups[0].fields[0], mapped);
  const removed = deleteCoverBlankParagraph(added.template, 'g', 'blank', 0, -1);
  assert.ok(removed);
  assert.equal(removed.figureId, 'mapped');
  assert.equal(removed.edge, 1);
  assert.deepEqual(removed.template, template);
  assert.equal(continueCoverFigure(added.template, 'g', 'mapped', 1, 'unused').template, added.template);
  const configuredBlank = structuredClone(added.template);
  configuredBlank.groups[0].fields[1].cover_configured_field = true;
  assert.equal(deleteCoverBlankParagraph(configuredBlank, 'g', 'blank', 0, -1), null, 'a configured field must not be removed as blank prose');
});

test('caret insertion retains text, marks and dynamic source once, and compiles as text/table/text', () => {
  const snapshot = JSON.stringify(original);
  const next = insertCoverBlockAtText(original, 'g', 'text', { value, before: doc([prefix]), after: doc([ref, suffix]) }, 'table', 'table', 'tail', { rows: 2, columns: 3 });
  assert.deepEqual(next.groups[0].fields.map(f => f.id), ['text', 'table', 'tail', 'space']);
  assert.equal(JSON.stringify(original), snapshot);
  assert.equal((JSON.stringify(next).match(/templateField/g) || []).length, 1);
  const ctx = { order: { customer_name: '客户甲' } };
  assert.equal(reportRichPlainText(resolveReportFieldValue(next.groups[0].fields[0], ctx)), '前文  ');
  assert.equal(reportRichPlainText(resolveReportFieldValue(next.groups[0].fields[2], ctx)), '客户甲后文');
  const source = renderContentDoc({ cover: { groups: JSON.parse(JSON.stringify(next.groups)), ctx }, projects: [] });
  assert.ok(source.includes('前文')); assert.ok(source.includes('客户甲')); assert.ok(source.includes('#v(2cm)'));
  const compiled = spawnSync('typst', ['compile', '--font-path', 'fonts', '--package-path', 'typst-packages', '-', '-'], { input: source });
  assert.equal(compiled.status, 0, compiled.stderr.toString());
});

test('configured native field inserted at caret retains date configuration and adjacent inline mappings', () => {
  const field = { id: 'date_new', code: 'date_new', label: '接收日期', type: 'date' as const, date_precision: 'day' as const, date_separator: '/' as const, binding: { source: 'order' as const, key: 'received_at' as const } };
  const next = insertCoverBlockAtText(original, 'g', 'text', { value, before: doc([prefix]), after: doc([ref, suffix]) }, 'table', field.id, 'tail', undefined, field);
  assert.deepEqual(next.groups[0].fields.map(f => f.id), ['text', field.id, 'tail', 'space']);
  assert.deepEqual(next.groups[0].fields[1], { ...field, cover_configured_field: true });
  assert.equal((JSON.stringify(next).match(/templateField/g) || []).length, 1);
  assert.equal(original.groups[0].fields.length, 2);
  const source = renderContentDoc({ cover: { groups: JSON.parse(JSON.stringify(next.groups)), ctx: { order: { received_at: '2026-09-13', customer_name: '客户甲' } } }, projects: [] });
  assert.ok(source.includes('2026/09/13'));
  const compiled = spawnSync('typst', ['compile', '--font-path', 'fonts', '--package-path', 'typst-packages', '-', '-'], { input: source });
  assert.equal(compiled.status, 0, compiled.stderr.toString());
});

test('stale selections, lost references and special positioning cannot be split', () => {
  const split = { value, before: doc([prefix]), after: doc([ref, suffix]) };
  assert.throws(() => insertCoverBlockAtText(original, 'g', 'text', { ...split, value: doc([suffix]) }, 'table', 'new', 'tail'));
  assert.throws(() => insertCoverBlockAtText(original, 'g', 'text', { ...split, after: doc([suffix]) }, 'table', 'new', 'tail'));
  const paged = structuredClone(original); paged.groups[0].fields[0].page_break_before = true;
  assert.throws(() => insertCoverBlockAtText(paged, 'g', 'text', split, 'table', 'new', 'tail'));
  assert.throws(() => insertCoverBlockAtText(original, 'g', 'text', split, 'table', 'new', 'space'));
});

test('splitting inside a single text node retains both halves', () => {
  const template = structuredClone(original);
  const full = doc([{ type: 'text', text: '前后' }]);
  template.groups[0].fields[0].binding = { source: 'literal', text: full };
  const next = insertCoverBlockAtText(template, 'g', 'text', { value: full, before: doc([{ type: 'text', text: '前' }]), after: doc([{ type: 'text', text: '后' }]) }, 'table', 'table', 'tail');
  assert.equal(reportRichPlainText(resolveReportFieldValue(next.groups[0].fields[0], {})), '前');
  assert.equal(reportRichPlainText(resolveReportFieldValue(next.groups[0].fields[2], {})), '后');
});

test('figure edges reuse adjacent prose without writes; explicit new prose never removes spacers', () => {
  const inserted = insertCoverLayoutBlock(original, 'g', 'text', 'logo', 'logo');
  const before = continueCoverFigure(inserted, 'g', 'logo', -1, 'unused');
  assert.equal(before.template, inserted); assert.equal(before.fieldId, 'text');
  const after = continueCoverFigure(inserted, 'g', 'logo', 1, 'after');
  assert.deepEqual(after.template.groups[0].fields.map(f => f.id), ['text', 'logo', 'after', 'space']);
  assert.equal(after.template.groups[0].fields[3].spacer_height, '2cm');
  assert.equal(continueCoverFigure(after.template, 'g', 'logo', 1, 'unused').template, after.template);
  assert.throws(() => continueCoverFigure(inserted, 'g', 'space', 1, 'x'));
});

test('insertion at prose boundaries does not invent a blank before or after the block', () => {
  const start = insertCoverBlockAtText(original, 'g', 'text', { value, before: '', after: value }, 'table', 'table', 'tail');
  assert.deepEqual(start.groups[0].fields.map(f => f.id), ['table', 'text', 'space']);
  const end = insertCoverBlockAtText(original, 'g', 'text', { value, before: value, after: '' }, 'table', 'table', 'tail');
  assert.deepEqual(end.groups[0].fields.map(f => f.id), ['text', 'table', 'space']);
});

test('Backspace and Delete remove the first blank after a figure while preserving following remarks', () => {
  const template = insertCoverLayoutBlock(original, 'g', 'text', 'table', 'figure');
  const note = { id: 'note', code: 'note', label: '', hide_label: true, type: 'text' as const, rich: true, binding: { source: 'literal' as const, text: encodeReportRichDocument({ type: 'doc', content: [{ type: 'paragraph' }, { type: 'paragraph', content: [{ type: 'text', text: '不能删除的备注', marks: [{ type: 'bold' }] }] }] }) } };
  template.groups[0].fields.splice(2, 0, note);
  const snapshot = JSON.stringify(template);
  for (const keyDirection of [-1, 1] as const) {
    const result = deleteCoverBlankParagraph(template, 'g', 'note', 0, keyDirection)!;
    assert.equal(result.figureId, 'figure'); assert.equal(result.edge, 1);
    assert.equal(reportRichPlainText(resolveReportFieldValue(result.template.groups[0].fields[2], {})), '不能删除的备注');
    assert.deepEqual(result.template.groups[0].fields[1], template.groups[0].fields[1]);
    assert.equal(result.template.groups[0].fields[3].spacer_height, '2cm');
  }
  assert.equal(JSON.stringify(template), snapshot);
});

test('whole blank field is removable on either side; positioning, references and spacer nodes are protected', () => {
  const template = insertCoverLayoutBlock(original, 'g', 'text', 'logo', 'figure');
  const blank = { id: 'blank', code: 'blank', label: '', hide_label: true, type: 'text' as const, rich: true, binding: { source: 'literal' as const, text: doc([]) } };
  template.groups[0].fields.splice(1, 0, blank);
  const result = deleteCoverBlankParagraph(template, 'g', 'blank', 0, 1)!;
  assert.equal(result.edge, -1); assert.deepEqual(result.template.groups[0].fields.map(f => f.id), ['text', 'figure', 'space']);
  for (const patch of [
    { page_break_before: true }, { style: { space_before: '12pt' } },
    { binding: { source: 'literal' as const, text: doc([ref]) } },
    { binding: { source: 'literal' as const, text: encodeReportRichDocument({ type: 'doc', content: [{ type: 'reportSpacer', attrs: { height: '2cm' } }] }) } },
  ]) {
    const protectedTemplate = structuredClone(template); Object.assign(protectedTemplate.groups[0].fields[1], patch);
    assert.equal(deleteCoverBlankParagraph(protectedTemplate, 'g', 'blank', 0, 1), null);
  }
  assert.equal(deleteCoverBlankParagraph(template, 'g', 'space', 0, -1), null);
  assert.equal(deleteCoverBlankParagraph(template, 'g', 'text', 0, 1), null);
});
