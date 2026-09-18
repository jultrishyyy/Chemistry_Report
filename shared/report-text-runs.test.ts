import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FieldDefinition, FieldGroup } from './types';
import { reportTextRuns, reportTextRunValue, updateReportTextRun } from './report-text-runs.ts';
import { makeReportManualTable, insertIntoReportParagraph } from './report-document-editing.ts';
import { restoreContinuousSource } from './report-continuous-text.ts';
import { encodeReportRichDocument, reportRichPlainText } from './report-rich-document.ts';
import { diffContentDocValues, renderContentDoc, resolveReportFieldValue } from './typst-generator.ts';

const field = (id: string): FieldDefinition => ({ id, code: id, type: 'text', label: id, default_value: `内容${id}` });
const fixture = (): FieldGroup => ({ id: 'mixed', label: '项目', layout: 'vertical', fields: [field('a'), field('b'),
  makeReportManualTable('table'), field('c'), { id: 'image', code: 'image', label: '', type: 'image', image_photos: [] }, field('d')] });
const resolve = (f: FieldDefinition) => resolveReportFieldValue(f, {});
const rich = (text: string) => encodeReportRichDocument({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const doc = (g: FieldGroup) => ({ cover: { groups: [], ctx: {} }, projects: [{ name: '项目', groups: [g], ctx: {} }] });

test('mixed project text is grouped without converting tables/images or writing source data on open', () => {
  const group = fixture(), snapshot = JSON.stringify(group);
  const runs = reportTextRuns(group);
  assert.deepEqual(runs.map(r => r.ids), [['a', 'b'], ['c'], ['d']]);
  assert.equal(reportRichPlainText(reportTextRunValue(runs[0], resolve)), 'a：内容a\nb：内容b');
  assert.equal(JSON.stringify(group), snapshot);
});

test('editing one run preserves figures, other bindings, stable identity, PDF order, audit and restore', () => {
  const group = fixture(), original = structuredClone(group);
  assert.equal(updateReportTextRun(group, ['a', 'b'], rich('修改前文'))?.id, 'a');
  assert.deepEqual(group.report_source_fields, original.fields);
  assert.deepEqual(group.fields.slice(1), original.fields.slice(2));
  const snapshot = structuredClone(group.report_source_fields);
  updateReportTextRun(group, ['a'], rich('再次修改'));
  updateReportTextRun(group, ['c'], rich('表后说明'));
  assert.deepEqual(group.report_source_fields, snapshot, 'later edits must not replace source snapshot');
  const reopened = JSON.parse(JSON.stringify(group));
  const pdf = renderContentDoc(doc(reopened));
  assert.ok(pdf.indexOf('再次修改') < pdf.indexOf('#table(columns:'));
  assert.ok(pdf.indexOf('#table(columns:') < pdf.indexOf('表后说明'));
  assert.ok(!diffContentDocValues(doc(original), doc(reopened)).some(change => change.kind === 'removed'));
  assert.deepEqual(restoreContinuousSource(reopened), original);
});

test('invalid/stale targets and unsupported styles or layouts cannot discard content', () => {
  const group = fixture(), snapshot = JSON.stringify(group);
  for (const ids of [['b', 'a'], ['a'], ['missing']]) assert.equal(updateReportTextRun(group, ids, rich('错误')), null);
  assert.equal(updateReportTextRun(group, ['a', 'b'], 'invalid'), null);
  assert.equal(JSON.stringify(group), snapshot);
  group.fields[1].style = { tracking: 'invalid' };
  assert.deepEqual(reportTextRuns(group).map(r => r.ids), [['a'], ['c'], ['d']]);
  group.fields[0].page_break_before = true;
  assert.deepEqual(reportTextRuns(group).map(r => r.ids), [['a'], ['c'], ['d']]);
  assert.equal(reportTextRuns(group)[0].isolated, true);
  for (const layout of ['grid', 'inline', 'table', 'two-col'] as const) assert.deepEqual(reportTextRuns({ ...group, layout }), []);
  const imageSection = { ...group, section_role: 'images' as const, image_layout: { cols: 2 } };
  assert.deepEqual(reportTextRuns(imageSection).map(run => run.ids), [['a'], ['c'], ['d']],
    'ordinary text around an image grid remains editable prose');
});

test('inserting a figure in a previously bound run preserves both prose edges and other tables', () => {
  const group = fixture();
  const value = reportTextRunValue(reportTextRuns(group)[0], resolve);
  const converted = updateReportTextRun(group, ['a', 'b'], value)!;
  group.fields.splice(0, 1, ...insertIntoReportParagraph(converted, value, 0, makeReportManualTable('added'), 'tail',
    { before: rich('前'), after: rich('后') }, true));
  assert.deepEqual(group.fields.slice(0, 4).map(f => f.id), ['a', 'added', 'tail', 'table']);
  assert.ok(renderContentDoc(doc(group)).includes('后'));
  assert.equal(restoreContinuousSource(group).fields.length, fixture().fields.length);
});
