import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportTextRuns, updateReportTextRun } from './report-text-runs';
import { encodeReportRichDocument } from './report-rich-document';
import { renderContentDoc } from './typst-generator';
import type { FieldGroup } from './types';
import { spawnSync } from 'node:child_process';
import { continuousTextValue, projectContinuousGroups } from './report-continuous-text';

test('new prose and spacing override retained mixed-field history, including PDF projection', () => {
  const value = encodeReportRichDocument({ type: 'doc', content: [{ type: 'paragraph', attrs: { spaceBefore: 6, spaceAfter: 12, lineGap: 0.9 }, content: [{ type: 'text', text: 'NEW_NOTE' }] }] });
  const field = { id: 'old', code: 'old', type: 'text' as const, label: '', hide_label: true, default_value: 'OLD_NOTE' };
  const group: FieldGroup = { id: 'g', label: '', layout: 'vertical', fields: [field], report_source_fields: [field], report_document: { version: 1, value } };
  assert.equal(continuousTextValue(group, () => 'OLD_NOTE'), value);
  assert.equal((projectContinuousGroups([group])[0].fields[0].binding as any).text, value);
  const output = renderContentDoc({ cover: { groups: [group], ctx: {} }, projects: [] } as any);
  assert.ok(output.includes('NEW\\_NOTE')); assert.ok(!output.includes('OLD\\_NOTE'));
  assert.match(output, /leading: 0.9em/);
});

test('actual PDF layout retains first/last paragraph spacing at rich block boundaries', () => {
  const measure = (before: number, after: number) => {
    const note = encodeReportRichDocument({ type: 'doc', content: [{ type: 'paragraph', attrs: { spaceBefore: before, spaceAfter: after }, content: [{ type: 'text', text: 'Note' }] }] });
    const field = { id: 'n', code: 'n', label: '', type: 'text', hide_label: true, rich: true, binding: { source: 'literal', text: note } };
    const tail = { id: 'tail', code: 'tail', type: 'text', label: '', hide_label: true, default_value: 'Following text' };
    const source = renderContentDoc({ cover: { groups: [{ id: 'g', label: '', layout: 'vertical', fields: [field, tail] }], ctx: {} }, projects: [] } as any);
    const result = spawnSync('typst', ['query', '--package-path', 'typst-packages', '-', '<__fepos__>', '--field', 'value'], { input: source, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout).find((marker: any) => marker.code === 'cover::tail').y as number;
  };
  const base = measure(0, 0);
  const beforeDelta = measure(20, 0) - base, afterDelta = measure(0, 20) - base;
  assert.ok(Math.abs(beforeDelta - 20) < 0.1, `first paragraph before spacing: ${beforeDelta}`);
  assert.ok(Math.abs(afterDelta - 20) < 0.1, `last paragraph after spacing: ${afterDelta}`);
});
test('explicit note paragraph spacing replaces legacy wrapper gaps without losing fonts or content', () => {
  const value = encodeReportRichDocument({ type: 'doc', content: [{ type: 'paragraph', attrs: { spaceBefore: 0, spaceAfter: 3, lineGap: 0.8 }, content: [{ type: 'text', text: '备注：保留' }] }] });
  const group: FieldGroup = { id: 'g', label: '', layout: 'vertical', fields: [{ id: 'note', code: 'note', label: '', type: 'text', rich: true, hide_label: true,
    style: { size: '9pt', space_before: '27pt', space_after: '28pt' }, binding: { source: 'literal', text: value } }] };
  const run = reportTextRuns(group)[0];
  const result = updateReportTextRun(group, run.ids, value)!;
  assert.equal(result.style?.space_before, undefined); assert.equal(result.style?.space_after, undefined);
  assert.equal(result.style?.size, '9pt');
  const source = renderContentDoc({ cover: { groups: [group], ctx: {} }, projects: [] } as any);
  assert.ok(!source.includes('#v(27pt)')); assert.ok(!source.includes('#v(28pt)'));
  assert.match(source, /below: 3pt/); assert.match(source, /leading: 0.8em/);
});
