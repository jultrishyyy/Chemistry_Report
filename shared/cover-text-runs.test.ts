import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { coverTextRuns, commitCoverTextRun, coverTextInsertionBase } from './cover-text-runs.ts';
import { insertCoverBlockAtText } from './cover-text-boundaries.ts';
import { storedReportRichDocument, encodeReportRichDocument, reportRichPlainText } from './report-rich-document.ts';
import { generateTypst, injectReportFieldsIntoTypst } from './typst-generator.ts';
import type { RecordTemplate } from './types';

const template: RecordTemplate = { name: '首页', version: 1, groups: [{ id: 'g', label: '', layout: 'vertical', fields: [
  { id: 'a', code: 'a', type: 'text', label: '', hide_label: true, binding: { source: 'literal', text: '  说明\n\n原样  ' } },
  { id: 'b', code: 'b', type: 'text', label: '单位', label_width: 'none', binding: { source: 'order', key: 'customer_name' } },
  { id: 's', code: 's', type: 'spacer', label: '', spacer_height: '2cm' },
] }] };

test('read-only text runs preserve source and retain inline mapping, spaces and paragraph boundaries', () => {
  const before = structuredClone(template), [run] = coverTextRuns(template);
  assert.deepEqual(run.ids, ['a', 'b']);
  assert.equal(storedReportRichDocument(run.value)!.content!.length, 3, 'double newline follows the legacy PDF paragraph rule');
  assert.ok(reportRichPlainText(run.value).startsWith('  说明\n原样  '));
  assert.ok(run.value.includes('templateField'));
  assert.equal(commitCoverTextRun(template, 'g', run.ids, run.value, run.value), template);
  assert.deepEqual(template, before);
});

test('editing multiple paragraphs commits one run, retains source and compiles dynamic values', () => {
  const [run] = coverTextRuns(template), doc = storedReportRichDocument(run.value)!;
  doc.content!.push({ type: 'paragraph', content: [{ type: 'text', text: '新备注  ', marks: [{ type: 'bold' }] }] });
  const next = commitCoverTextRun(template, 'g', run.ids, run.value, encodeReportRichDocument(doc));
  assert.deepEqual(next.groups[0].fields.map(f => f.id), ['a', 's']);
  assert.deepEqual(next.groups[0].fields[0].cover_source_fields, template.groups[0].fields.slice(0, 2));
  assert.deepEqual(next.groups[0].fields[1], template.groups[0].fields[2]);
  const typst = injectReportFieldsIntoTypst(generateTypst(next), next, { order: { customer_name: '单位甲' } });
  assert.ok(typst.includes('单位甲'));
  assert.ok(typst.includes('2cm'));
  const compile = spawnSync('typst', ['compile', '--font-path', 'fonts', '--package-path', 'typst-packages', '-', '-'], { input: typst });
  assert.equal(compile.status, 0, compile.stderr.toString());
  assert.deepEqual(template.groups[0].fields.map(f => f.id), ['a', 'b', 's']);
});

test('different styles, fixed gaps, default bindings and stale run edits are protected', () => {
  for (const patch of [{ style: { align: 'center' } }, { field_gap: '3pt' }, { default_value: 'fallback' }]) {
    const next = structuredClone(template);
    Object.assign(next.groups[0].fields[1], patch);
    assert.equal(coverTextRuns(next).length, 0);
  }
  const [run] = coverTextRuns(template);
  assert.throws(() => commitCoverTextRun(template, 'g', ['b', 'a'], run.value, run.value), /正文已变化/);
  assert.throws(() => commitCoverTextRun(template, 'g', run.ids, 'stale', run.value), /正文已变化/);
});

test('caret insertion materializes and splits a run without losing a dynamic reference', () => {
  const [run] = coverTextRuns(template), doc = storedReportRichDocument(run.value)!;
  const base = coverTextInsertionBase(template, 'g', 'a', run.value);
  const next = insertCoverBlockAtText(base, 'g', 'a', {
    value: run.value,
    before: encodeReportRichDocument({ type: 'doc', content: [doc.content![0]] }),
    after: encodeReportRichDocument({ type: 'doc', content: doc.content!.slice(1) }),
  }, 'table', 'inserted', 'tail', { rows: 3, columns: 3 });
  assert.deepEqual(next.groups[0].fields.map(f => f.id), ['a', 'inserted', 'tail', 's']);
  assert.ok(next.groups[0].fields[2].binding?.source === 'literal' && next.groups[0].fields[2].binding.text.includes('templateField'));
  assert.equal(template.groups[0].fields.length, 3);
});
