import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { encodeReportRichDocument, readReportRichDocument, reportRichPlainText, richDocumentToTypst } from './report-rich-document.ts';
import { renderContentDoc, diffContentDocValues } from './typst-generator.ts';

test('font size, color and paragraph alignment survive saving and render through the report path', () => {
  const value = encodeReportRichDocument({ type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: 'center' }, content: [
    { type: 'text', text: '带格式正文', marks: [{ type: 'bold' }, { type: 'italic' }, { type: 'reportTextStyle', attrs: { fontSize: 10.5, color: '#CF1322' } }] },
  ] }] });
  const reopened = JSON.parse(JSON.stringify({ value })).value;
  assert.equal(encodeReportRichDocument(readReportRichDocument(reopened)), value);
  const source = richDocumentToTypst(readReportRichDocument(value));
  assert.ok(source.includes('#align(center)'));
  assert.ok(source.includes('size: 10.5pt')); assert.ok(source.includes('rgb("#cf1322")'));
  assert.equal(reportRichPlainText(value), '带格式正文');
  const document = (text: string) => ({ cover: { groups: [{ id: 'g', label: '', layout: 'vertical' as const, fields: [
    { id: 'p', code: 'p', type: 'text' as const, label: '', rich: true, hide_label: true, binding: { source: 'literal' as const, text } },
  ] }], ctx: {} }, projects: [] });
  assert.ok(renderContentDoc(document(value)).includes(source));
  assert.ok(diffContentDocValues(document('带格式正文'), document(value)).length > 0, 'format-only changes remain auditable');
});
test('invalid style values cannot inject CSS or Typst and do not discard the text', () => {
  const value = encodeReportRichDocument({ type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: 'center);#evil' as any }, content: [
    { type: 'text', text: '保留', marks: [{ type: 'reportTextStyle', attrs: { color: '#fff);#evil', fontSize: Infinity } }] },
  ] }] });
  assert.equal(reportRichPlainText(value), '保留');
  assert.equal(richDocumentToTypst(readReportRichDocument(value)), '保留');
});

test('partial font overrides survive saving and actual Typst rendering without replacing inherited font elsewhere', () => {
  const value = encodeReportRichDocument({ type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'OVERRIDDEN', marks: [{ type: 'reportTextStyle', attrs: { font: 'Times New Roman', fontSize: 14 } }] },
    { type: 'text', text: 'INHERITED' },
  ] }] });
  assert.equal(encodeReportRichDocument(readReportRichDocument(JSON.parse(JSON.stringify(value)))), value);
  const source = '#set text(font: "Arial")\n#show text: it => context [#metadata((value: it.text, font: text.font, size: text.size))<font_probe>#it]\n' + richDocumentToTypst(readReportRichDocument(value));
  const result = spawnSync('typst', ['query', '--font-path', 'fonts', '-', '<font_probe>', '--field', 'value'], { input: source, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const nodes = JSON.parse(result.stdout);
  assert.equal(nodes.find((n: any) => n.value === 'OVERRIDDEN').font[0].toLowerCase(), 'times new roman');
  assert.equal(nodes.find((n: any) => n.value === 'OVERRIDDEN').size, '14pt');
  assert.equal(nodes.find((n: any) => n.value === 'INHERITED').font.toLowerCase(), 'arial');
});
