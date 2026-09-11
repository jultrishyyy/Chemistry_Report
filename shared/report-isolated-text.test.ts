import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FieldGroup } from './types';
import { reportTextRuns, reportTextRunValue, updateReportTextRun } from './report-text-runs.ts';
import { restoreContinuousSource } from './report-continuous-text.ts';
import { renderContentDoc } from './typst-generator.ts';
import { reportRichPlainText } from './report-rich-document.ts';

test('special text stays in independent prose blocks with layout and original snapshots preserved', () => {
  const group: FieldGroup = { id: 'g', label: '', layout: 'vertical', fields: [
    { id: 'before', code: 'before', type: 'text', label: '', default_value: '前文' },
    { id: 'special', code: 'special', type: 'text', label: '温度', unit: '℃', page_break_before: true,
      style: { font: 'Songti SC', tracking: '1pt', line_height: '0.8em', space_before: '12pt', space_after: '6pt' } },
    { id: 'after', code: 'after', type: 'text', label: '', default_value: '后文' },
  ] };
  const original = structuredClone(group), runs = reportTextRuns(group);
  assert.deepEqual(runs.map(r => r.ids), [['before'], ['special'], ['after']]);
  assert.equal(runs[1].isolated, true);
  const value = reportTextRunValue(runs[1], () => '22.2');
  assert.equal(reportRichPlainText(value), '温度：22.2 ℃');
  assert.deepEqual(group, original);
  updateReportTextRun(group, ['special'], value);
  assert.deepEqual(group.fields[1].style, original.fields[1].style);
  assert.equal(group.fields[1].page_break_before, true);
  const reopened = JSON.parse(JSON.stringify(group));
  const again = reportTextRuns(reopened)[1];
  assert.equal(again.isolated, true);
  assert.equal(reportTextRunValue(again, f => (f.binding as { text: string }).text), value);
  const source = renderContentDoc({ cover: { groups: [reopened], ctx: {} }, projects: [] });
  for (const part of ['#pagebreak()', 'tracking: 1pt', 'leading: 0.8em', '#v(12pt)', '#v(6pt)', '22.2']) assert.ok(source.includes(part), part);
  assert.deepEqual(restoreContinuousSource(reopened), original);
});

test('bare field gaps retain em units and unsupported layout is not silently stripped', () => {
  const group: FieldGroup = { id: 'g', label: '', layout: 'vertical', fields: [
    { id: 'f', code: 'f', type: 'text', label: '', field_gap: '2' },
  ] };
  const run = reportTextRuns(group)[0];
  assert.equal(run.group.style?.space_before, '2em');
  updateReportTextRun(group, ['f'], reportTextRunValue(run, () => '正文'));
  assert.equal(group.fields[0].style?.space_after, '2em');
  for (const style of [{ margin: { left: '1cm' } }, { tracking: 'invalid' }, { keep_together: true }]) {
    const candidate = { ...group, fields: [{ ...group.fields[0], style }] };
    assert.deepEqual(reportTextRuns(candidate), []);
  }
});
