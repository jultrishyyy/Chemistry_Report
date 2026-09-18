import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { coverFieldMode, coverGroupCanFlow, coverStaticTextValue, updateCoverField, startCoverBody, insertCoverLayoutBlock, insertConfiguredCoverField, coverCanEditInline } from './cover-template-editing.ts';
import { coverTextRuns } from './cover-text-runs.ts';
import { storedReportRichDocument } from './report-rich-document.ts';
import { generateTypst, injectReportFieldsIntoTypst, renderContentDoc } from './typst-generator.ts';
import type { RecordTemplate } from './types';

const original: RecordTemplate = { name: '首页', version: 1, groups: [
  { id: 'g', label: '', hide_title: true, layout: 'vertical', fields: [
    { id: 'text', code: 'intro', type: 'text', label: '', hide_label: true, binding: { source: 'literal', text: '原文  *星号*\n\n下一行' } },
    { id: 'space', code: 'space', type: 'spacer', label: '', spacer_height: '1.2cm' },
    { id: 'customer', code: 'customer', type: 'text', label: '委托单位', binding: { source: 'order', key: 'customer_name' } },
  ] },
] };

test('configured text keeps its native settings identity even when label is hidden', () => {
  const next = insertConfiguredCoverField(original, 'g', 'text', { id: 'added', code: 'added', label: '新字段', type: 'text', hide_label: true, binding: { source: 'literal', text: '保留配置' } });
  const field = next.groups[0].fields[1];
  assert.equal(coverCanEditInline(field), false);
  assert.equal(field.cover_configured_field, true);
  assert.ok(coverTextRuns(next).every(run => !run.ids.includes('added')));
  const edited = updateCoverField(next, 'g', 'added', { legacyLiteral: '继续修改' });
  assert.equal(edited.groups[0].fields[1].type, 'text');
  assert.equal(JSON.parse(JSON.stringify(edited)).groups[0].fields[1].cover_configured_field, true);
});

for (const hasGroup of [false, true]) test(`blank cover starts editable rich body without discarding template settings: group=${hasGroup}`, () => {
  const source: RecordTemplate = { name: '空白首页', version: 1, layout_options: { theme_config: { font: 'FangSong', margin_h: '2.4cm' } }, groups: hasGroup ? [{ id: 'g', label: '', hide_title: true, layout: 'vertical', fields: [] }] : [] };
  const snapshot = JSON.stringify(source);
  const result = startCoverBody(source, hasGroup ? 'g' : null, 'new_group', 'body');
  const field = result.template.groups[0].fields[0];
  assert.ok(field.rich && field.hide_label);
  assert.equal(storedReportRichDocument(coverStaticTextValue(field))!.content![0].type, 'paragraph');
  assert.deepEqual(result.template.layout_options, source.layout_options);
  assert.equal(JSON.stringify(source), snapshot);
  assert.throws(() => startCoverBody(result.template, result.groupId, 'another', 'second'), /位置已变化/);
  const withTable = insertCoverLayoutBlock(result.template, result.groupId, 'body', 'table', 'table1', { rows: 3, columns: 3 });
  const saved = JSON.parse(JSON.stringify(withTable));
  assert.equal(saved.groups[0].fields.length, 2);
  const typst = injectReportFieldsIntoTypst(generateTypst(saved), saved, {});
  const compiled = spawnSync('typst', ['compile', '--font-path', 'fonts', '--package-path', 'typst-packages', '-', '-'], { input: typst });
  assert.equal(compiled.status, 0, compiled.stderr.toString());
});

test('legacy in-place edits retain fixed labels, signature placement and dynamic mappings', () => {
  const template: RecordTemplate = { name: '签署', version: 1, groups: [{ id: 'sign', label: '', layout: 'vertical', style: { vertical_align: 'bottom' }, fields: [
    { id: 'a', code: 'a', type: 'text', label: '编 制', signature_line: true, binding: { source: 'literal', text: '  姓名  ' }, label_width: '6em' },
    { id: 'b', code: 'b', type: 'text', label: '日期', binding: { source: 'order', key: 'received_at' } },
  ] }] };
  const next = updateCoverField(template, 'sign', 'a', { legacyLiteral: '  新姓名\n第二行  ' });
  assert.deepEqual(next.groups[0].style, template.groups[0].style);
  assert.equal(next.groups[0].fields[0].signature_line, true);
  assert.equal(next.groups[0].fields[0].label_width, '6em');
  assert.deepEqual(next.groups[0].fields[1], template.groups[0].fields[1]);
  const label = updateCoverField(next, 'sign', 'b', { legacyLabel: '签发日期' });
  assert.deepEqual(label.groups[0].fields[1].binding, template.groups[0].fields[1].binding);
  assert.throws(() => updateCoverField(template, 'sign', 'b', { legacyLiteral: '覆盖来源' }), /动态来源/);
  assert.equal(template.groups[0].fields[0].binding?.source === 'literal' && template.groups[0].fields[0].binding.text, '  姓名  ');
});

test('opening the layout projection preserves all original data and literal whitespace', () => {
  const before = JSON.stringify(original);
  const field = original.groups[0].fields[0];
  assert.equal(coverFieldMode(field), 'text');
  const nodes = storedReportRichDocument(coverStaticTextValue(field))!.content![0].content!;
  assert.deepEqual(nodes.map(n => n.type), ['text', 'hardBreak', 'hardBreak', 'text']);
  assert.equal(nodes[0].text, '原文  *星号*');
  assert.equal(nodes[0].marks, undefined);
  assert.equal(JSON.stringify(original), before);
});

test('editing changes only the target value and preserves bindings, spaces and stable identities', () => {
  const value = coverStaticTextValue({ ...original.groups[0].fields[0], binding: { source: 'literal', text: '修改正文  后续\n第二行' } });
  const next = updateCoverField(original, 'g', 'text', { text: value });
  assert.deepEqual(next.groups[0].fields.slice(1), original.groups[0].fields.slice(1));
  assert.equal(next.groups[0].fields[0].id, 'text');
  assert.equal(next.groups[0].fields[0].code, 'intro');
  assert.equal(next.groups[0].fields[0].rich, true);
  assert.equal(coverStaticTextValue(JSON.parse(JSON.stringify(next)).groups[0].fields[0]), value);
  assert.equal(original.groups[0].fields[0].rich, undefined);
  for (const source of [
    injectReportFieldsIntoTypst(generateTypst(next), next, {}),
    renderContentDoc({ cover: { groups: next.groups, ctx: {} }, projects: [] }),
  ]) {
    assert.ok(source.includes('修改正文'));
    assert.ok(source.includes('1.2cm'));
    const compiled = spawnSync('typst', ['compile', '--font-path', 'fonts', '--package-path', 'typst-packages', '-', '-'], { input: source });
    assert.equal(compiled.status, 0, compiled.stderr.toString());
  }
});

test('mapping edits remain mappings and source switching can continue in the open drawer', () => {
  const next = updateCoverField(original, 'g', 'customer', { binding: { source: 'literal', text: '' } });
  const again = updateCoverField(next, 'g', 'customer', { binding: { source: 'literal', text: '固定单位' } });
  assert.deepEqual(again.groups[0].fields[2].binding, { source: 'literal', text: '固定单位' });
  assert.deepEqual(again.groups[0].fields.slice(0, 2), original.groups[0].fields.slice(0, 2));
  assert.throws(() => updateCoverField(original, 'g', 'customer', { text: coverStaticTextValue(original.groups[0].fields[0]) }), 'fixed-width labels must not silently become flowing text');
});

test('label, units, value formatting and signature layouts use the compatible configuration path', () => {
  const text = original.groups[0].fields[0];
  for (const field of [{ ...text, hide_label: false }, { ...text, unit: 'mm' }, { ...text, value_style: { size: '12pt' } }]) {
    assert.equal(coverFieldMode(field), 'configuration');
  }
  assert.equal(coverGroupCanFlow({ ...original.groups[0], style: { vertical_align: 'bottom' } }), false);
  assert.throws(() => updateCoverField(original, 'missing', 'text', { text: 'x' }));
  assert.throws(() => updateCoverField(original, 'g', 'text', { text: 'unencoded text' }));
});
