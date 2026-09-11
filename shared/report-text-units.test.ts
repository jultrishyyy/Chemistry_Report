import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REPORT_SEED_SNAPSHOTS } from './seed-report-templates.data.ts';
import { canEditContinuousText, continuousTextValue, restoreContinuousSource } from './report-continuous-text.ts';
import { reportTextRuns, reportTextRunValue, updateReportTextRun } from './report-text-runs.ts';
import { readReportRichDocument, reportRichPlainText } from './report-rich-document.ts';
import { renderContentDoc } from './typst-generator.ts';
import type { FieldGroup } from './types';

test('actual density method section including immersion temperature forms continuous prose', () => {
  const template = REPORT_SEED_SNAPSHOTS.find(t => t.name === '密度试验项目报告')!;
  const group = structuredClone(template.field_definitions.find(g => g.id === 'pg_method')!);
  const before = JSON.stringify(group);
  assert.ok(group.fields.some(f => f.label === '浸渍液温度' && f.unit === '℃'));
  assert.ok(canEditContinuousText(group));
  const value = continuousTextValue(group, f => f.unit === '℃' ? '22.2' : f.label === '检测方法' ? 'GB 8410-2006' : '去离子水');
  assert.ok(reportRichPlainText(value).includes('浸渍液温度：22.2 ℃'));
  assert.equal(JSON.stringify(group), before);
  const saved = JSON.parse(JSON.stringify({ ...group, report_document: { version: 1, value } }));
  const pdf = renderContentDoc({ cover: { groups: [saved], ctx: {} }, projects: [] });
  assert.ok(pdf.includes('22.2')); assert.equal((pdf.match(/℃/g) || []).length, 1);
  assert.deepEqual(restoreContinuousSource(saved), group);
});

test('unit uses field style rather than value override and is not duplicated after mixed-run edits', () => {
  const group: FieldGroup = { id: 'g', label: '', layout: 'vertical', fields: [{
    id: 'temp', code: 'temp', type: 'text', label: '温度', unit: '℃',
    style: { size: '12pt', color: '#112233' }, value_style: { size: '18pt', color: '#cc0000' },
    binding: { source: 'literal', text: '22.2' },
  }] };
  const value = continuousTextValue(group, () => '22.2');
  const content = readReportRichDocument(value).content![0].content!;
  assert.deepEqual(content.at(-1)!.marks, [{ type: 'reportTextStyle', attrs: { fontSize: 12, color: '#112233' } }]);
  assert.equal(content.at(-1)!.text, ' ℃');
  const original = structuredClone(group);
  updateReportTextRun(group, ['temp'], value);
  assert.equal(group.fields[0].unit, undefined, 'unit is materialized in prose, not retained as a second suffix');
  const reopened = JSON.parse(JSON.stringify(group));
  const again = reportTextRunValue(reportTextRuns(reopened)[0], f => (f.binding as { text: string }).text);
  assert.equal(reportRichPlainText(again), '温度：22.2 ℃');
  assert.deepEqual(restoreContinuousSource(reopened), original);
});

test('previously edited prose and remaining unit fields can merge without losing edits or the original snapshot', () => {
  const original: FieldGroup = { id: 'g', label: '', layout: 'vertical', fields: [
    { id: 'note', code: 'note', type: 'text', label: '说明' },
    { id: 'temp', code: 'temp', type: 'number', label: '温度', unit: '℃' },
  ] };
  const group = structuredClone(original);
  const prior = continuousTextValue({ ...group, fields: [group.fields[0]] }, () => '已修改的说明');
  group.report_source_fields = structuredClone(original.fields);
  group.fields[0] = { id: 'note', code: 'note', type: 'text', label: '', rich: true, hide_label: true, binding: { source: 'literal', text: prior } };
  const run = reportTextRuns(group)[0];
  assert.deepEqual(run.ids, ['note', 'temp']);
  const value = reportTextRunValue(run, f => f.rich ? prior : '22.2');
  assert.ok(reportRichPlainText(value).includes('已修改的说明'));
  updateReportTextRun(group, run.ids, value);
  assert.deepEqual(group.report_source_fields, original.fields);
  assert.equal((reportRichPlainText(value).match(/℃/g) || []).length, 1);
});
