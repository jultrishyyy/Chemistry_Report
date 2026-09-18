import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { updateCoverField } from './cover-template-editing.ts';
import { coverLegacyFormatState, coverLegacyPartCss, coverLegacyBlockSpacing } from './cover-legacy-format.ts';
import { generateTypst, injectReportFieldsIntoTypst, renderContentDoc } from './typst-generator.ts';
import type { RecordTemplate } from './types';

const template: RecordTemplate = { name: '', version: 1, layout_options: { theme_config: { body_size: '10.5pt', font: 'FangSong', label_weight: 'regular' } }, groups: [{ id: 'g', label: '', layout: 'vertical', fields: [
  { id: 'f', code: 'f', type: 'text', label: '单位名称', label_width: '10em', binding: { source: 'order', key: 'customer_name' } },
  { id: 's', code: 's', type: 'spacer', label: '', spacer_height: '2cm' },
] }] };

test('visible legacy text and toolbar share relative size, explicit regular and independent unit cascade', () => {
  const group = structuredClone(template.groups[0]);
  group.style = { font: 'Arial', size: '2em', color: '#123456', weight: 'bold', italic: true };
  const field = group.fields[0];
  field.style = { size: '0.5em', weight: 'regular', italic: false };
  field.value_style = { size: '2em', color: '#ff0000', weight: 'bold', italic: true };
  const theme = template.layout_options!.theme_config!;
  assert.deepEqual(coverLegacyPartCss(field, group, theme, 'paragraph'), {
    fontFamily: '"Arial"', fontSize: '10.5pt', color: '#123456', fontWeight: 'normal', fontStyle: 'normal',
  });
  const value = coverLegacyPartCss(field, group, theme, 'value');
  assert.equal(value.fontSize, '21pt');
  assert.equal(value.color, '#ff0000');
  assert.equal(value.fontWeight, 'bold');
  assert.equal(coverLegacyPartCss(field, group, theme, 'label').fontWeight, 'normal');
  assert.equal(parseFloat(value.fontSize), coverLegacyFormatState(field, group, theme, 'value').size);
});

test('legacy format cascade and independent label/value changes preserve binding and positioning', () => {
  assert.equal(coverLegacyFormatState(template.groups[0].fields[0], template.groups[0], template.layout_options!.theme_config, 'label').size, 10.5);
  const next = updateCoverField(template, 'g', 'f', { legacyFormat: { part: 'label', patch: { font: 'Arial', size: '15pt', weight: 'bold', color: '#cf1322' } } });
  const value = updateCoverField(next, 'g', 'f', { legacyFormat: { part: 'value', patch: { font: 'Times New Roman', size: '12pt', italic: false } } });
  const aligned = updateCoverField(value, 'g', 'f', { legacyFormat: { part: 'paragraph', patch: { align: 'right' } } });
  assert.deepEqual(aligned.groups[0].fields[0].binding, template.groups[0].fields[0].binding);
  assert.equal(aligned.groups[0].fields[0].label_width, '10em');
  assert.deepEqual(aligned.groups[0].fields[1], template.groups[0].fields[1]);
  assert.equal(aligned.groups[0].fields[0].label_style?.size, '15pt');
  assert.equal(aligned.groups[0].fields[0].value_style?.size, '12pt');
  assert.equal(template.groups[0].fields[0].label_style, undefined);
  assert.throws(() => updateCoverField(template, 'g', 'f', { legacyFormat: { part: 'label', patch: { size: '999pt' } } }), /字号/);
  assert.throws(() => updateCoverField(template, 'g', 'f', { legacyFormat: { part: 'paragraph', patch: { color: '#ff0000' } } }), /不受支持/);
});

test('legacy spacing respects field/group/document priority, zero and additive explicit insets', () => {
  const group = structuredClone(template.groups[0]), field = group.fields[0];
  const theme = { body_size: '10pt', line_gap: 2 };
  assert.equal(coverLegacyBlockSpacing(field, group, theme).marginBottom, '20pt');
  group.style = { block_spacing: '12pt' };
  assert.equal(coverLegacyBlockSpacing(field, group, theme).marginBottom, '12pt');
  field.field_gap = '0pt';
  field.style = { space_before: '3', space_after: '4pt', margin: { top: '2pt', bottom: '1pt', left: '2em', right: '6pt' } };
  assert.deepEqual(coverLegacyBlockSpacing(field, group, theme), {
    marginTop: '0pt', marginBottom: '0pt', paddingTop: '5pt', paddingBottom: '5pt', paddingLeft: '20pt', paddingRight: '6pt',
  });
});

for (const signature of [false, true]) test(`label/value format reaches preview and final PDF; signature=${signature}`, () => {
  const source = structuredClone(template);
  source.groups[0].fields[0].signature_line = signature;
  let next = updateCoverField(source, 'g', 'f', { legacyFormat: { part: 'label', patch: { size: '14pt', font: 'Arial', weight: 'regular', color: '#cf1322', italic: true } } });
  next = updateCoverField(next, 'g', 'f', { legacyFormat: { part: 'value', patch: { size: '12pt', font: 'Times New Roman', weight: 'bold', color: '#1677ff', italic: false } } });
  const ctx = { order: { customer_name: 'Company' } };
  for (const typst of [injectReportFieldsIntoTypst(generateTypst(next), next, ctx), renderContentDoc({ cover: { groups: next.groups, layout_options: next.layout_options, ctx }, projects: [] })]) {
    for (const expected of ['size: 14pt', 'size: 12pt', 'rgb("cf1322")', 'rgb("1677ff")', 'style: "normal"']) assert.ok(typst.includes(expected), expected);
    const result = spawnSync('typst', ['compile', '--font-path', 'fonts', '--package-path', 'typst-packages', '-', '-'], { input: typst });
    assert.equal(result.status, 0, result.stderr.toString());
  }
});

for (const layout of ['grid', 'two-col'] as const) test(`whole field style and hidden label reach both PDF paths: ${layout}`, () => {
  const source = structuredClone(template);
  source.groups[0].layout = layout;
  source.groups[0].style = { weight: 'bold', italic: true };
  const field = source.groups[0].fields[0];
  field.label = 'HIDDEN_LABEL'; field.hide_label = true; field.unit = 'HIDDEN_UNIT';
  field.style = { font: 'Arial', size: '17pt', color: '#123456', weight: 'regular', italic: false };
  field.value_style = { size: '12pt' };
  const ctx = { order: { customer_name: 'Company' } };
  const snapshot = JSON.stringify(source);
  for (const typst of [injectReportFieldsIntoTypst(generateTypst(source), source, ctx), renderContentDoc({ cover: { groups: source.groups, layout_options: source.layout_options, ctx }, projects: [] })]) {
    assert.ok(typst.includes('font: "Arial", size: 17pt'));
    assert.ok(typst.includes('weight: "regular", stroke: none'));
    assert.ok(typst.includes('style: "normal"'));
    assert.ok(typst.includes('rgb("123456")'));
    assert.ok(typst.includes('size: 12pt'));
    assert.ok(!typst.includes('HIDDEN_LABEL'));
    assert.ok(!typst.includes('HIDDEN_UNIT'));
    const result = spawnSync('typst', ['compile', '--font-path', 'fonts', '--package-path', 'typst-packages', '-', '-'], { input: typst });
    assert.equal(result.status, 0, result.stderr.toString());
  }
  assert.equal(JSON.stringify(source), snapshot);
  assert.deepEqual(field.binding, { source: 'order', key: 'customer_name' });
});
