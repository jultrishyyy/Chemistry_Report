import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readReportRichDocument, encodeReportRichDocument, storedReportRichDocument, reportRichPlainText, REPORT_RICH_PREFIX } from './report-rich-document.ts';
import { renderContentDoc, richTextToTypst, diffContentDocValues } from './typst-generator.ts';
import type { FieldDefinition } from './types';

test('old reports retain supported formatting without being rewritten on open', () => {
  const legacy = '**粗体**及*斜体*\n换行\n\n- 项目一\n- 项目二';
  const doc = readReportRichDocument(legacy);
  assert.equal(doc.content![0].content![0].marks![0].type, 'bold');
  assert.equal(doc.content![1].type, 'bulletList');
  const saved = encodeReportRichDocument(doc);
  assert.deepEqual(readReportRichDocument(saved), readReportRichDocument(encodeReportRichDocument(doc)));
  assert.equal(reportRichPlainText(saved), '粗体及斜体\n换行\n项目一\n项目二');
  assert.equal(legacy, '**粗体**及*斜体*\n换行\n\n- 项目一\n- 项目二');
});
test('structured content survives JSON save/reopen and renders safely in reports', () => {
  const saved = encodeReportRichDocument({ type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: '文字**#evil[1]<img>', marks: [{ type: 'bold' }, { type: 'italic' }] }, { type: 'hardBreak' }, { type: 'text', text: '下一行' }] },
    { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '列表内容' }] }] }] },
  ] });
  const field: FieldDefinition = { id: 'p', code: 'p', type: 'text', label: '', rich: true, binding: { source: 'literal', text: saved } };
  const document = { cover: { groups: [{ id: 'g', label: '', layout: 'vertical' as const, fields: [field] }], ctx: {} }, projects: [] };
  const reopened = JSON.parse(JSON.stringify(document));
  const output = renderContentDoc(reopened);
  assert.ok(output.includes('#strong[')); assert.ok(output.includes('#emph['));
  assert.ok(output.includes('#enum(start: 3,')); assert.ok(output.includes('#linebreak()'));
  assert.ok(output.includes('\\#evil\\[1\\]'));
  assert.ok(!output.includes(REPORT_RICH_PREFIX), 'storage envelope never appears in the report');
  const empty = JSON.parse(JSON.stringify(document)); empty.cover.groups[0].fields[0].binding.text = '';
  assert.ok(!diffContentDocValues(empty, document)[0].to.includes(REPORT_RICH_PREFIX));
});

test('report ending section is removed from the cover flow and appended after the last project', () => {
  const ending = {
    id: 'ending',
    label: '报告结束区',
    hide_title: true,
    layout: 'vertical' as const,
    section_role: 'report_ending' as const,
    fields: [
      { id: 'rule', code: 'report_ending_rule', type: 'textarea' as const, label: '', hide_label: true, binding: { source: 'literal' as const, text: '自定义判定规则' } },
      { id: 'label', code: 'report_ending_label', type: 'text' as const, label: '', hide_label: true, binding: { source: 'literal' as const, text: '——自定义结束——' } },
    ],
  };
  const base = {
    cover: { groups: [ending], layout_options: {}, ctx: {} },
    projects: [{ groups: [{ id: 'project', label: '', layout: 'vertical' as const, fields: [
      { id: 'body', code: 'body', type: 'text' as const, label: '', hide_label: true, binding: { source: 'literal' as const, text: '项目正文' } },
    ] }], layout_options: {}, ctx: {}, name: '项目一' }],
  };
  const output = renderContentDoc(base);
  assert.equal((output.match(/自定义判定规则/g) || []).length, 1);
  assert.ok(output.indexOf('自定义判定规则') > output.indexOf('项目正文'));
});

test('legacy report ending setting remains compatible when no ending section exists', () => {
  const output = renderContentDoc({
    cover: {
      groups: [],
      layout_options: {
        report_ending: {
          enabled: true,
          rule: '自定义 #规则\n第二行',
          label: '—自定义[结束]—',
        },
      },
      ctx: {},
    },
    projects: [],
  });
  assert.match(output, /自定义 \\#规则#linebreak\(\)第二行/);
  assert.match(output, /自定义\\\[结束\\\]/);
});
test('malformed or unknown documents fall back to literal legacy text, never execute', () => {
  assert.equal(storedReportRichDocument(REPORT_RICH_PREFIX + '{bad'), null);
  assert.equal(storedReportRichDocument(REPORT_RICH_PREFIX + JSON.stringify({ type: 'script', text: 'evil()' })), null);
  assert.ok(richTextToTypst(REPORT_RICH_PREFIX + '{bad').includes('report-rich'));
});
