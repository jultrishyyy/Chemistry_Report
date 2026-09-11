import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeReportRichDocument, readReportRichDocument, reportRichPlainText, richDocumentToTypst } from './report-rich-document.ts';
import { renderContentDoc } from './typst-generator.ts';

test('spaces survive storage and the report rendering path without changing literal values', () => {
  const text = '    中文 A     B\u3000\u3000C\u00a0D';
  const value = encodeReportRichDocument({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  const restored = JSON.parse(JSON.stringify({ value })).value;
  assert.equal(reportRichPlainText(restored), text);
  const source = richDocumentToTypst(readReportRichDocument(restored));
  assert.ok(source.startsWith('#text("    ")'));
  assert.ok(source.includes('#text("     ")'));
  assert.ok(source.includes('#text("\u3000\u3000")'));
  const doc = { cover: { groups: [{ id: 'g', label: '', layout: 'vertical' as const, fields: [
    { id: 'p', code: 'p', type: 'text' as const, label: '', hide_label: true, rich: true, binding: { source: 'literal' as const, text: restored } },
  ] }], ctx: {} }, projects: [] };
  const snapshot = JSON.stringify(doc);
  assert.ok(renderContentDoc(doc).includes(source));
  assert.equal(JSON.stringify(doc), snapshot);
});

test('spaces stay inside their format runs and literal Typst syntax remains escaped', () => {
  const source = richDocumentToTypst({ type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'A  ', marks: [{ type: 'bold' }] },
    { type: 'text', text: '  B', marks: [{ type: 'reportTextStyle', attrs: { fontSize: 18 } }] },
    { type: 'hardBreak' }, { type: 'text', text: '  #evil["x"]' },
  ] }] });
  assert.ok(source.includes('#strong[A#text("  ")]'));
  assert.ok(source.includes('#text(size: 18pt)[#text("  ")B]'));
  assert.ok(source.includes('#linebreak()#text("  ")\\#evil\\["x"\\]'));
});
