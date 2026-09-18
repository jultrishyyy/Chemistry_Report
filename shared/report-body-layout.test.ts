import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportBodyLayout, reportFontStack, reportLengthPt } from './report-body-layout.ts';
import { renderContentDoc } from './typst-generator.ts';
import { encodeReportRichDocument } from './report-rich-document.ts';
test('A4 body width follows theme margin presets, physical units and horizontal overrides', () => {
  const cm = 72 / 2.54;
  for (const [margin, width] of [['normal', 17], ['compact', 18], ['wide', 16], [1, 19], ['20mm', 17]] as const) {
    assert.ok(Math.abs(reportBodyLayout({ margin }).widthPt - width * cm) < 0.001);
  }
  assert.ok(Math.abs(reportBodyLayout({ margin: 'wide', margin_h: '1.5cm' }).widthPt - 18 * cm) < 0.001);
  assert.equal(reportBodyLayout({ margin: 'broken' }).widthPt, reportBodyLayout().widthPt);
  assert.ok(reportBodyLayout({ margin_h: 99 }).widthPt > 0);
  assert.equal(reportLengthPt('0pt', 'pt'), 0);
  assert.equal(reportLengthPt('0.5em', 'em', 12), 6);
  assert.equal(reportLengthPt('1cm);bad', 'pt'), undefined);
});
test('Latin font order and body size match theme conventions', () => {
  assert.equal(reportFontStack('Songti SC'), '"Arial", "Songti SC"');
  assert.equal(reportFontStack('Times New Roman', true), '"Times New Roman"');
  assert.equal(reportFontStack('Times New Roman'), '"Arial", "Times New Roman"');
  assert.equal(reportFontStack(['Arial', 'FangSong']), '"Arial", "FangSong"');
  assert.equal(reportBodyLayout({ body_size: '10.5pt' }).size, 10.5);
  assert.equal(reportBodyLayout({ body_size: 'bad' }).size, 10);
  assert.equal(reportBodyLayout({ line_gap: 0.75 }).fieldGap, '0.75em');
  assert.equal(reportBodyLayout({ line_gap: '7pt', paragraph_gap: '1.2em' }).fieldGap, '7pt');
  assert.equal(reportBodyLayout({ paragraph_gap: '1.2em' }).sectionGap, '1.2em');
  assert.equal(reportBodyLayout({ line_gap: 'calc(1px)' }).fieldGap, '0.6em');
});
test('structured report paragraphs use explicit shared spacing, legacy text is unchanged', () => {
  const doc = (value: string) => ({ cover: { ctx: {}, groups: [{ id: 'g', label: '', layout: 'vertical' as const, fields: [{
    id: 'f', code: 'f', type: 'text' as const, label: '', hide_label: true, rich: true, binding: { source: 'literal' as const, text: value },
  }] }] }, projects: [] });
  const value = encodeReportRichDocument({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '正文' }] }] });
  assert.ok(renderContentDoc(doc(value)).includes('#set par(spacing: 0.65em)'));
  assert.ok(!renderContentDoc(doc('旧正文')).includes('#set par(spacing: 0.65em)'));
});
