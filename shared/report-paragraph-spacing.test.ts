import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { encodeReportRichDocument, readReportRichDocument, richDocumentToTypst, reportParagraphCSS } from './report-rich-document';

test('paragraph spacing roundtrips independently, preserves zero and leaves legacy paragraphs unchanged', () => {
  const value = encodeReportRichDocument({ type: 'doc', content: [
    { type: 'paragraph', attrs: { spaceBefore: 0, spaceAfter: 12, lineGap: 0.8 }, content: [{ type: 'text', text: 'First' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Unchanged' }] },
  ] });
  const doc = readReportRichDocument(value);
  assert.deepEqual(doc.content![0].attrs, { spaceBefore: 0, spaceAfter: 12, lineGap: 0.8 });
  assert.equal(doc.content![1].attrs, undefined);
  assert.equal(encodeReportRichDocument(doc), value);
  assert.deepEqual(reportParagraphCSS(doc.content![0].attrs), { marginTop: '0pt', marginBottom: '12pt', lineHeight: '1.8' });
  assert.equal(richDocumentToTypst(readReportRichDocument('Legacy')), 'Legacy');
  const source = richDocumentToTypst(doc);
  assert.match(source, /above: 0pt, below: 12pt/);
  assert.match(source, /leading: 0.8em/);
  const result = spawnSync('typst', ['compile', '-', '-'], { input: source });
  assert.equal(result.status, 0, result.stderr?.toString());
  assert.equal(result.stdout.subarray(0, 5).toString(), '%PDF-');
});
test('invalid paragraph attributes cannot enter CSS or Typst', () => {
  const value = encodeReportRichDocument({ type: 'doc', content: [{ type: 'paragraph', attrs: { spaceBefore: -1, spaceAfter: Infinity, lineGap: '1);evil' as any }, content: [{ type: 'text', text: 'Safe' }] }] });
  assert.equal(richDocumentToTypst(readReportRichDocument(value)), 'Safe');
});
