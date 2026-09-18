import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { formatChoiceValue } from './choice-display';
import { flattenDataForDisplay, generateTypstWithData } from './typst-generator.ts';
import type { RecordTemplate } from './types';
test('choice display keeps legacy default and supports inline symbols, numbered lines and bullets', () => {
  const values = ['甲', { custom: '乙' }, '', 0];
  assert.equal(formatChoiceValue(values), '甲、乙、0');
  assert.equal(formatChoiceValue(values, { separator: '，' }), '甲，乙，0');
  assert.equal(formatChoiceValue(values, { layout: 'lines', marker: 'number', ending: '。' }), '1. 甲。\n2. 乙。\n3. 0。');
  assert.equal(formatChoiceValue(['甲', '乙'], { layout: 'lines', marker: 'bullet' }), '• 甲\n• 乙');
  assert.equal(formatChoiceValue(values, { layout: 'lines', marker: 'number_parentheses', ending: '。' }), '（1） 甲。\n（2） 乙。\n（3） 0。');
  assert.equal(formatChoiceValue(Array(12).fill('甲'), { layout: 'lines', marker: 'number_parentheses' }).split('\n')[11], '（12） 甲');
  assert.equal(formatChoiceValue([], { layout: 'lines', marker: 'number_parentheses' }), '');
});
test('single-choice marker is optional without changing multiple choices or punctuation', () => {
  for (const marker of ['number', 'number_parentheses', 'bullet'] as const) {
    const config = { layout: 'lines' as const, marker, ending: '。' };
    assert.notEqual(formatChoiceValue(['甲'], config), '甲。', 'legacy templates retain markers');
    assert.equal(formatChoiceValue(['甲'], { ...config, show_marker_for_single: true }), formatChoiceValue(['甲'], config));
    assert.equal(formatChoiceValue(['', { custom: '甲' }, null], { ...config, show_marker_for_single: false }), '甲。');
    assert.equal(formatChoiceValue([0], { ...config, show_marker_for_single: false }), '0。');
    assert.equal(formatChoiceValue([], { ...config, show_marker_for_single: false }), '');
    assert.equal(formatChoiceValue(['甲', '乙'], { ...config, show_marker_for_single: false }), formatChoiceValue(['甲', '乙'], config));
    assert.equal(formatChoiceValue(['甲', '乙'], { ...config, layout: 'inline', show_marker_for_single: false }), '甲、乙');
  }
});
test('record PDF compiles multi-line choice and text without modifying raw data', () => {
  const tpl: RecordTemplate = { name: '多行验证', version: 1, groups: [{ id: 'g', label: '', layout: 'vertical', fields: [
    { id: 'a', code: 'a', label: '选择', type: 'checkbox', choice_display: { layout: 'lines', marker: 'number_parentheses', ending: '。' } },
    { id: 'b', code: 'b', label: '说明', type: 'text' },
    { id: 'c', code: 'c', label: '单项', type: 'checkbox', choice_display: { layout: 'lines', marker: 'number_parentheses', show_marker_for_single: false, ending: '。' } },
  ] }] };
  const raw = { a: ['甲', '乙'], b: '  第一行\n\n    第二行  内容', c: ['甲'] }, before = JSON.stringify(raw);
  assert.equal(flattenDataForDisplay(tpl, raw).c, '甲。');
  assert.equal(flattenDataForDisplay(tpl, raw).a, '（1） 甲。\n（2） 乙。');
  const result = spawnSync('typst', ['compile', '--font-path', 'fonts', '--package-path', 'typst-packages', '--format', 'svg', '-', '-'], { input: generateTypstWithData(tpl, raw), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.stringify(raw), before);
});
test('Typst layout retains leading spaces and explicit line breaks', () => {
  const source = '#import "@local/record-theme:0.1.0": *\n#set text(font: "Arial", size: 10pt)\n#context [\n#metadata(measure(multiline("A")).width.pt()) <size>\n#metadata(measure(multiline("    A")).width.pt()) <size>\n#metadata(measure(multiline("A\\nB")).height.pt()) <size>\n#metadata(measure(multiline("A")).height.pt()) <size>\n]';
  const result = spawnSync('typst', ['query', '--font-path', 'fonts', '--package-path', 'typst-packages', '-', '<size>', '--field', 'value'], { input: source, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const sizes = JSON.parse(result.stdout);
  assert.ok(sizes[1] > sizes[0] + 5, 'indent spaces occupy measurable width');
  assert.ok(sizes[2] > sizes[3], 'newline produces a taller block');
});
test('fullwidth parenthesis markers align on first and continuation lines', () => {
  const source = '#import "@local/record-theme:0.1.0": *\n#set text(font: ("FangSong", "Arial"), size: 10pt)\n'
    + '#show regex("（[0-9]+）"): it => [#context [#metadata(here().position().x.pt()) <marker-x>]#it]\n'
    + '#field("检测方法", "（1） GB 8410\\n（2） ASTM D5132\\n（10） ISO 3795", numbered_parentheses: true)';
  const result = spawnSync('typst', ['query', '--font-path', 'fonts', '--package-path', 'typst-packages', '-', '<marker-x>', '--field', 'value'], { input: source, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const positions = JSON.parse(result.stdout);
  assert.equal(positions.length, 3);
  assert.ok(positions.every((x: number) => Math.abs(x - positions[0]) < 0.01), JSON.stringify(positions));
});
