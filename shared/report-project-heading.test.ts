import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { reportProjectHeadingValue } from './report-project-heading';
import { encodeReportRichDocument, reportRichPlainText } from './report-rich-document';
import { renderContentDoc } from './typst-generator';

test('editable heading starts with the exact legacy PDF text and does not write on open', () => {
  const project = { name: '内部项目', title: '密度', seq: 2 };
  const before = JSON.stringify(project);
  assert.equal(reportRichPlainText(reportProjectHeadingValue(project)!), '2) 密度');
  assert.equal(JSON.stringify(project), before);
  assert.equal(reportProjectHeadingValue({ name: '未编号' }), null);
});

test('saved heading replaces only PDF heading, preserving project identity and escaped text', () => {
  const value = encodeReportRichDocument({ type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: '2) 修改  名称 #abc', marks: [{ type: 'bold' }] },
    { type: 'hardBreak' }, { type: 'text', text: '补充文字' },
  ] }] });
  const project = { name: '内部项目', title: '旧显示标题', seq: 2, report_heading: value, groups: [], ctx: {} };
  const doc = { cover: { groups: [], ctx: {} }, projects: [project] };
  const before = JSON.stringify(doc);
  const source = renderContentDoc(JSON.parse(before));
  assert.ok(source.includes('修改'));
  assert.ok(source.includes('#text("  ")'));
  assert.ok(source.includes('补充文字'));
  assert.ok(source.includes('\\#abc'));
  assert.ok(!source.includes('2) 旧显示标题'));
  assert.ok(source.includes('proj0::__project_heading__'));
  assert.equal(JSON.stringify(doc), before);
  assert.equal(reportProjectHeadingValue(project), value);
});

test('clearing a heading does not resurrect the source project name', () => {
  const project = { name: '原名', seq: 1, report_heading: '', groups: [], ctx: {} };
  assert.equal(reportProjectHeadingValue(project), '');
  const source = renderContentDoc({ cover: { groups: [], ctx: {} }, projects: [project] });
  assert.ok(!source.includes('1) 原名'));
});

test('initial and saved unchanged headings use the identical PDF rendering path', () => {
  const project = { name: '密度', seq: 1, groups: [], ctx: {} };
  const cover = { groups: [], ctx: {}, layout_options: { theme_config: { font: 'FangSong' } } };
  const initial = renderContentDoc({ cover, projects: [project] });
  const saved = renderContentDoc({ cover, projects: [{ ...project, report_heading: reportProjectHeadingValue(project)! }] });
  assert.equal(initial, saved);
});

for (const font of ['Arial', 'FangSong']) {
  test(`actual Typst heading weights agree with bold marks and clear strokes: ${font}`, () => {
    const heading = encodeReportRichDocument({ type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'BOLDTOKEN', marks: [{ type: 'bold' }] },
      { type: 'text', text: 'REGULARTOKEN' },
    ] }] });
    const source = renderContentDoc({ cover: { groups: [], ctx: {}, layout_options: { theme_config: { font } } },
      projects: [{ name: 'Test', seq: 1, report_heading: heading, groups: [], ctx: {} }] });
    const probe = '#show text: it => context [#metadata((value: it.text, weight: text.weight, stroke: repr(text.stroke)))<__heading_weight__>#it]\n';
    const result = spawnSync('typst', ['query', '--font-path', 'fonts', '--package-path', 'typst-packages', '-', '<__heading_weight__>', '--field', 'value'], { input: probe + source, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const weights = JSON.parse(result.stdout);
    const bold = weights.find((item: any) => item.value === 'BOLDTOKEN');
    const regular = weights.find((item: any) => item.value === 'REGULARTOKEN');
    assert.equal(bold.weight, 'bold');
    assert.equal(regular.weight, 'regular');
    assert.equal(regular.stroke, 'none', 'removing bold must also remove synthetic-bold stroke');
    if (font === 'FangSong') assert.notEqual(bold.stroke, 'none');
    else assert.equal(bold.stroke, 'none');
  });
}
