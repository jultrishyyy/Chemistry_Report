import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { encodeReportRichDocument, type ReportRichNode } from './report-rich-document';
import { renderContentDoc } from './typst-generator';

function projectPosition(lineGap: number, kind: 'single' | 'softBreak' | 'paragraphs'): number {
  const paragraph = (text: string): ReportRichNode => ({ type: 'paragraph', attrs: { lineGap }, content: [{ type: 'text', text }] });
  const content = [paragraph('First project line')];
  if (kind === 'softBreak') content[0].content!.push({ type: 'hardBreak' }, { type: 'text', text: 'Second project line' });
  if (kind === 'paragraphs') content.push(paragraph('Second project paragraph'));
  const value = encodeReportRichDocument({ type: 'doc', content });
  const doc: any = { cover: { groups: [], ctx: {}, layout_options: { theme_config: { body_size: 10 } } }, projects: [{ name: 'Project', ctx: {}, groups: [{ id: 'g', label: '', hide_title: true, layout: 'vertical', fields: [
    { id: 'note', code: 'note', type: 'text', label: '', hide_label: true, rich: true, binding: { source: 'literal', text: value } },
    { id: 'table', code: 'table', type: 'report_result_table', label: '', free_table: { columns: [{ id: 'c', label: 'Result' }], rows: [{ id: 'r' }], cells: { 'r::c': '1' } } },
  ] }] }] };
  const source = renderContentDoc(JSON.parse(JSON.stringify(doc)));
  const result = spawnSync('typst', ['query', '--package-path', 'typst-packages', '-', '<__fepos__>', '--field', 'value'], { input: source, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).find((marker: any) => marker.code === 'proj0::table').y;
}

for (const kind of ['single', 'softBreak', 'paragraphs'] as const) {
  test(`project PDF line height includes every line box: ${kind}`, () => {
    const delta = projectPosition(1, kind) - projectPosition(0, kind);
    const expected = kind === 'single' ? 10 : 20;
    assert.ok(Math.abs(delta - expected) < 0.2, `line-height increase must move the following table by ${expected}pt, got ${delta}`);
  });
}

function tablePosition(type: 'free_grid' | 'report_result_table', before: number, after: number, lineGap: number, multiline = false, headerGap?: number): number {
  const table = { id: 'table', code: 'table', type, label: '', style: { space_before: `${before}pt`, space_after: `${after}pt` }, free_table: {
    columns: [{ id: 'c', label: 'Header', ...(headerGap != null ? { style: { line_height: `${headerGap}em` } } : {}) }], rows: [{ id: 'r' }], cells: { 'r::c': multiline ? 'First\nSecond' : 'Result' },
    cell_styles: { 'r::c': { line_height: `${lineGap}em` } },
  } };
  const tail = { id: 'tail', code: 'tail', type: 'text', label: '', hide_label: true, default_value: 'After table' };
  const doc: any = { cover: { groups: [], ctx: {}, layout_options: { theme_config: { body_size: 10 } } }, projects: [{ name: 'Project', ctx: {}, groups: [
    { id: 'table_group', label: '', hide_title: true, layout: 'vertical', fields: [table] },
    { id: 'tail_group', label: '', hide_title: true, layout: 'vertical', fields: [tail] },
  ] }] };
  const source = renderContentDoc(JSON.parse(JSON.stringify(doc)));
  const result = spawnSync('typst', ['query', '--package-path', 'typst-packages', '-', '<__fepos__>', '--field', 'value'], { input: source, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).find((marker: any) => marker.code === 'proj0::tail').y;
}
for (const type of ['free_grid', 'report_result_table'] as const) {
  test(`project ${type}: first/last table spacing survives its containing section`, () => {
    const base = tablePosition(type, 0, 0, 0);
    assert.ok(Math.abs(tablePosition(type, 20, 0, 0) - base - 20) < 0.2);
    assert.ok(Math.abs(tablePosition(type, 0, 20, 0) - base - 20) < 0.2);
  });
  test(`project ${type}: cell line height affects single and multiline cells`, () => {
    for (const multiline of [false, true]) {
      const delta = tablePosition(type, 0, 0, 1, multiline) - tablePosition(type, 0, 0, 0, multiline);
      const expected = multiline ? 20 : 10;
      assert.ok(Math.abs(delta - expected) < 0.2, `${multiline ? 'multiline' : 'single'} cell height delta ${delta}, expected ${expected}`);
    }
  });
}
test('project separate header: line height is applied to the header as well', () => {
  const delta = tablePosition('report_result_table', 0, 0, 0, false, 1) - tablePosition('report_result_table', 0, 0, 0, false, 0);
  assert.ok(Math.abs(delta - 10) < 0.2, `header height delta ${delta}`);
});
