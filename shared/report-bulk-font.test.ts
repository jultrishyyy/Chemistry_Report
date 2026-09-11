import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { applyReportTableFont, reportFontStyle } from './report-bulk-font';
import { renderContentDoc } from './typst-generator';
import type { FieldDefinition } from './types';

const field = (): FieldDefinition => ({ id: 't', code: 't', type: 'free_grid', label: '',
  style: { space_before: '13pt', space_after: '7pt' },
  free_table: { columns: [{ id: 'a', label: 'A', width: '2fr', style: { color: '#ff0000' } }],
    rows: [{ id: 'r', height: '2cm' }], cells: { 'r::a': 'TOKEN' },
    cell_formulas: { 'r::a': { type: 'sum', sources: [] } }, cell_bindings: { 'r::a': { source: 'literal', text: 'TOKEN' } },
    cell_styles: { 'r::a': { font: 'Arial', size: '9pt', line_height: '0.3em', align: 'right' } },
    spans: { 'r::a': { colspan: 1, rowspan: 1 } } } });
test('bulk font changes only native typography and preserves data, formula, bindings, dimensions and spacing', () => {
  const f = field(), old = structuredClone(f);
  applyReportTableFont(f, { font: 'Times New Roman', fontSize: 14, bold: true, italic: true, color: '#1677ff' });
  assert.equal(f.instance_auto_free_table, undefined, 'formatting must not convert or freeze a live table');
  for (const key of ['cells', 'cell_formulas', 'cell_bindings', 'rows', 'spans'] as const) assert.deepEqual(f.free_table![key], old.free_table![key]);
  assert.deepEqual(f.style, old.style);
  assert.equal(f.free_table!.columns[0].width, '2fr');
  assert.equal(f.free_table!.cell_styles!['r::a'].line_height, '0.3em');
  assert.equal(f.free_table!.cell_styles!['r::a'].align, 'right');
  assert.equal(f.free_table!.cell_styles!['r::a'].font, 'Times New Roman');
  applyReportTableFont(f, { bold: false });
  assert.equal(f.free_table!.cell_styles!['r::a'].weight, 'regular');
  assert.equal(f.table_style!.header_bold, false);
  assert.deepEqual(reportFontStyle({ font: 'invalid', fontSize: Infinity, color: 'bad' }), {});
});
for (const type of ['free_grid', 'report_result_table'] as const) test(`bulk table typography reaches actual Typst: ${type}`, () => {
  const f = field(); f.type = type;
  delete f.free_table!.cell_formulas;
  delete f.free_table!.cell_styles; delete f.free_table!.columns[0].style;
  applyReportTableFont(f, { fontSize: 14, bold: true, italic: true, color: '#1677ff' });
  const source = renderContentDoc({ cover: { groups: [{ id: 'g', label: '', layout: 'vertical', fields: [f] }], ctx: {} }, projects: [] });
  const probe = '#show text: it => context [#metadata((value: it.text, size: text.size, weight: text.weight, style: text.style, fill: repr(text.fill)))<bulk>#it]\n';
  const result = spawnSync('typst', ['query', '--font-path', 'fonts', '--package-path', 'typst-packages', '-', '<bulk>', '--field', 'value'], { input: probe + source, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const token = JSON.parse(result.stdout).find((n: any) => n.value === 'TOKEN');
  assert.ok(token); assert.equal(token.size, '14pt'); assert.equal(token.weight, 'bold'); assert.equal(token.style, 'italic'); assert.ok(token.fill.includes('1677ff'));
});
