import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FieldGroup } from './types';
import { canEditContinuousText, continuousTextValue, restoreContinuousSource } from './report-continuous-text.ts';
import { readReportRichDocument } from './report-rich-document.ts';
import { renderContentDoc, resolveReportFieldValue } from './typst-generator.ts';

const fixture = (): FieldGroup => ({ id: 'g', label: '', layout: 'vertical', fields: [{
  id: 'f', code: 'f', type: 'text', label: '名称', default_value: '正文',
  style: { size: '12pt', color: '#112233', align: 'center' },
  label_style: { size: '14', weight: 'bold', color: '#CF1322' },
  value_style: { size: '10.5pt', italic: true },
}] });

test('conversion preserves label/value style cascade, alignment and source fields through save/reopen', () => {
  const group = fixture(), original = JSON.stringify(group);
  assert.ok(canEditContinuousText(group));
  const value = continuousTextValue(group, f => resolveReportFieldValue(f, {}));
  const paragraph = readReportRichDocument(value).content![0];
  assert.equal(paragraph.attrs?.textAlign, 'center');
  assert.deepEqual(paragraph.content![0].marks, [{ type: 'bold' }, { type: 'reportTextStyle', attrs: { fontSize: 14, color: '#cf1322' } }]);
  assert.deepEqual(paragraph.content![1].marks, [{ type: 'italic' }, { type: 'reportTextStyle', attrs: { fontSize: 10.5, color: '#112233' } }]);
  assert.equal(JSON.stringify(group), original, 'opening/conversion projection must not modify source');
  const reopened = JSON.parse(JSON.stringify({ ...group, report_document: { version: 1, value } }));
  const pdf = renderContentDoc({ cover: { groups: [reopened], ctx: {} }, projects: [] });
  for (const fragment of ['#align(center)', 'size: 14pt', 'size: 10.5pt', '#cf1322', '#112233', '名称', '正文']) assert.ok(pdf.includes(fragment), fragment);
  assert.deepEqual(restoreContinuousSource(reopened), group);
});

test('unsupported layout and styles are not silently flattened or discarded', () => {
  for (const patch of [
    { page_break_before: true }, { field_gap: '8pt' },
    { style: { space_before: '1cm' } }, { style: { space_after: '1cm' } },
    { style: { font: 'Custom Font' } }, { style: { line_height: '1em' } },
    { style: { tracking: '1pt' } }, { style: { keep_together: true } },
    { style: { size: '100pt' } }, { style: { size: '1em' } },
    { style: { color: 'red' } }, { label_style: { align: 'right' } },
    { rich: true, hide_label: true },
  ]) {
    const group = fixture(); Object.assign(group.fields[0], patch);
    const original = JSON.stringify(group);
    assert.equal(canEditContinuousText(group), false, JSON.stringify(patch));
    assert.equal(JSON.stringify(group), original);
    const oldPdf = renderContentDoc({ cover: { groups: [group], ctx: {} }, projects: [] });
    assert.ok(oldPdf.length > 0, 'ineligible groups retain the original renderer');
  }
});

test('previously saved body overrides remain renderable even if the retained source has a page break', () => {
  const group = fixture();
  const value = continuousTextValue(group, () => '已保存的正文');
  group.fields[0].page_break_before = true;
  assert.equal(canEditContinuousText(group), false);
  group.report_document = { version: 1, value };
  assert.ok(renderContentDoc({ cover: { groups: [group], ctx: {} }, projects: [] }).includes('已保存的正文'));
});
