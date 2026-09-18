import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { formatCoverText, rebaseCoverTextStyles, coverTextSegments } from './cover-text-selection.ts';
import { updateCoverField, formatCoverSelection } from './cover-template-editing.ts';
import { generateTypst, injectReportFieldsIntoTypst, renderContentDoc } from './typst-generator.ts';
import type { RecordTemplate } from './types';
import { canEditContinuousText } from './report-continuous-text.ts';

test('cross-part formatting is atomic and preserves bindings and layout', () => {
  const template: RecordTemplate = { name: '', version: 1, groups: [{ id: 'g', label: '', layout: 'vertical', fields: [
    { id: 'f', code: 'f', type: 'text', label: '标签', label_width: '8em', binding: { source: 'literal', text: 'ABCD' } },
  ] }] };
  const change = { legacySelectionFormat: { patch: { size: '18pt' }, selections: [
    { part: 'label' as const, text: '标签', from: 1, to: 2 },
    { part: 'value' as const, text: 'ABCD', from: 0, to: 2 },
  ] } };
  const next = updateCoverField(template, 'g', 'f', change);
  const f = next.groups[0].fields[0];
  assert.equal(f.cover_text_styles!.label!.spans[0].style.size, '18pt');
  assert.equal(f.cover_text_styles!.value!.spans[0].style.size, '18pt');
  assert.deepEqual(f.binding, template.groups[0].fields[0].binding);
  assert.equal(f.label_width, '8em');
  change.legacySelectionFormat.selections[1].text = 'stale';
  assert.throws(() => updateCoverField(template, 'g', 'f', change), /文字已变化/);
  assert.equal(template.groups[0].fields[0].cover_text_styles, undefined);
  const dynamic = structuredClone(template); dynamic.groups[0].fields[0].binding = { source: 'order', key: 'customer_name' };
  assert.throws(() => updateCoverField(dynamic, 'g', 'f', change), /动态值/);
  assert.equal(dynamic.groups[0].fields[0].cover_text_styles, undefined);
});

test('partial formatting preserves outside characters and supports overlapping format changes', () => {
  const one = formatCoverText('ABCD', undefined, 1, 3, { weight: 'bold' });
  const two = formatCoverText('ABCD', one, 2, 4, { color: '#ff0000' });
  assert.deepEqual(coverTextSegments('ABCD', two).map(s => [s.text, s.style]), [['A', {}], ['B', { weight: 'bold' }], ['C', { weight: 'bold', color: '#ff0000' }], ['D', { color: '#ff0000' }]]);
  const typed = rebaseCoverTextStyles(two, 'ABxxCD')!;
  assert.equal(coverTextSegments(typed.text, typed).map(s => s.text).join(''), 'ABxxCD');
  assert.ok(typed.spans.some(s => s.to === 6 && s.style.color === '#ff0000'));
  assert.throws(() => formatCoverText('AB', one, 0, 99, { weight: 'bold' }), /选区/);
});

test('multi-field selection updates both groups atomically without changing source or spacing', () => {
  const template: RecordTemplate = { name: '', version: 1, groups: ['g1', 'g2'].map(id => ({ id, label: '', layout: 'vertical', fields: [
    { id: 'f', code: id, type: 'text', label: '标签', label_width: '8em', binding: { source: 'literal', text: 'ABCD' } },
    { id: 'space', code: `${id}_space`, type: 'spacer', label: '', spacer_height: '2cm' },
  ] })) };
  const targets = ['g1', 'g2'].map(groupId => ({ groupId, fieldId: 'f', selections: [{ part: 'value' as const, text: 'ABCD', from: 1, to: 3 }] }));
  const next = formatCoverSelection(template, targets, { weight: 'bold', font: 'Arial' });
  for (const group of next.groups) {
    assert.deepEqual(coverTextSegments('ABCD', group.fields[0].cover_text_styles!.value).map(s => [s.text, s.style.weight]), [['A', undefined], ['BC', 'bold'], ['D', undefined]]);
    assert.equal(group.fields[1].spacer_height, '2cm');
    assert.equal(group.fields[0].label_width, '8em');
  }
  assert.deepEqual(next.groups[0].fields[0].binding, template.groups[0].fields[0].binding);
  assert.equal(template.groups[0].fields[0].cover_text_styles, undefined);
  targets[1].selections[0].text = 'stale';
  assert.throws(() => formatCoverSelection(template, targets, { italic: true }), /文字已变化/);
  assert.equal(template.groups[0].fields[0].cover_text_styles, undefined, 'failure of the last target cannot mutate earlier targets');
  assert.throws(() => formatCoverSelection(template, [targets[0], targets[0]], { italic: true }), /无效/);
});

for (const [signature, layout] of [[false, 'vertical'], [true, 'vertical'], [false, 'grid'], [false, 'two-col']] as const) test(`selected label/value survives JSON and both PDF paths, signature=${signature}, layout=${layout}`, () => {
  const template: RecordTemplate = { name: '', version: 1, groups: [{ id: 'g', label: '', layout, fields: [
    { id: 'f', code: 'f', label: '单位名称', type: 'text', signature_line: signature, label_width: '8em', binding: { source: 'literal', text: 'ABCD' } },
    { id: 's', code: 's', type: 'spacer', label: '', spacer_height: '2cm' },
  ] }] };
  let next = updateCoverField(template, 'g', 'f', { legacyFormat: { part: 'label', patch: { color: '#ff0000', weight: 'regular' } }, selection: { text: '单位名称', from: 0, to: 2 } });
  next = updateCoverField(next, 'g', 'f', { legacyFormat: { part: 'value', patch: { weight: 'bold', size: '14pt' } }, selection: { text: 'ABCD', from: 1, to: 3 } });
  const saved = JSON.parse(JSON.stringify(next));
  assert.equal(canEditContinuousText(saved.groups[0]), false, 'a legacy report projection must not discard partial formatting');
  assert.deepEqual(saved.groups[0].fields[0].binding, template.groups[0].fields[0].binding);
  assert.equal(saved.groups[0].fields[0].label_width, '8em');
  assert.equal(saved.groups[0].fields[0].signature_line, signature);
  for (const typst of [injectReportFieldsIntoTypst(generateTypst(saved), saved, {}), renderContentDoc({ cover: { groups: saved.groups, ctx: {} }, projects: [] })]) {
    assert.ok(typst.includes('rgb("ff0000")'));
    assert.ok(typst.includes('size: 14pt'));
    assert.ok(typst.includes('#text("BC")'));
    const result = spawnSync('typst', ['compile', '--font-path', 'fonts', '--package-path', 'typst-packages', '-', '-'], { input: typst });
    assert.equal(result.status, 0, result.stderr.toString());
  }
  assert.throws(() => updateCoverField(next, 'g', 'f', { legacyFormat: { part: 'value', patch: { weight: 'bold' } }, selection: { text: 'stale', from: 0, to: 2 } }), /文字已变化/);
  const full = updateCoverField(next, 'g', 'f', { legacyFormat: { part: 'value', patch: { weight: 'regular' } } });
  assert.ok(full.groups[0].fields[0].cover_text_styles!.value!.spans.every(s => !s.style.weight));
  const dynamic = structuredClone(template); dynamic.groups[0].fields[0].binding = { source: 'order', key: 'customer_name' };
  assert.throws(() => updateCoverField(dynamic, 'g', 'f', { legacyFormat: { part: 'value', patch: { weight: 'bold' } }, selection: { text: '', from: 0, to: 1 } }), /动态值/);
});
