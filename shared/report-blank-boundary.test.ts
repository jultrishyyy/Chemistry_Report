import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FieldDefinition, FieldGroup } from './types';
import { deleteBlankBesideFigure } from './report-blank-boundary';
import { encodeReportRichDocument, readReportRichDocument } from './report-rich-document';
import { renderFreeTableTypst } from './typst-generator';
const text = (id: string, nodes: any[]): FieldDefinition => ({ id, code: id, type: 'text', label: '', hide_label: true, rich: true,
  binding: { source: 'literal', text: encodeReportRichDocument({ type: 'doc', content: nodes }) } });
const figure: FieldDefinition = { id: 'table', code: 'table', label: '', type: 'report_result_table' };
const resolve = (f: FieldDefinition) => (f.binding as any)?.text || '';
const p = { type: 'paragraph' };
test('figure Backspace/Delete removes one adjacent blank, never nonempty content or figure', () => {
  const groups: FieldGroup[] = [{ id: 'g', label: '', layout: 'vertical', fields: [text('t', [{ type: 'paragraph', content: [{ type: 'text', text: '保留正文' }] }, p]), figure] }];
  assert.equal(deleteBlankBesideFigure(groups, 'g', 'table', -1, resolve), true);
  const value = resolve(groups[0].fields[0]);
  assert.equal(readReportRichDocument(value).content?.length, 1);
  const before = JSON.stringify(groups);
  assert.equal(deleteBlankBesideFigure(groups, 'g', 'table', -1, resolve), false);
  assert.equal(JSON.stringify(groups), before);
  assert.equal(groups[0].fields.at(-1)?.id, 'table');
});
test('single blank before/after figure is removed, including adjacent untitled prose group', () => {
  for (const side of [-1, 1] as const) {
    const prose: FieldGroup = { id: 'p', label: '', layout: 'vertical', fields: [text('blank', [p])] };
    const fig: FieldGroup = { id: 'g', label: '', layout: 'vertical', fields: [figure] };
    const groups = side === -1 ? [prose, fig] : [fig, prose];
    assert.equal(deleteBlankBesideFigure(groups, 'g', 'table', side, resolve), true);
    assert.deepEqual(groups, [fig]);
  }
});
test('first empty paragraph after a table is removed without deleting the following styled note', () => {
  const note = text('note', [p, { type: 'paragraph', attrs: { lineGap: 0.8, spaceAfter: 6 }, content: [{ type: 'text', text: '备注：保留内容' }] }]);
  note.style = { size: '9pt' };
  const groups: FieldGroup[] = [{ id: 'g', label: '', layout: 'vertical', fields: [figure, note] }];
  assert.equal(deleteBlankBesideFigure(groups, 'g', 'table', 1, resolve), true);
  const result = readReportRichDocument(resolve(groups[0].fields[1]));
  assert.equal(result.content?.length, 1);
  assert.equal(result.content?.[0].content?.[0].text, '备注：保留内容');
  assert.equal(result.content?.[0].attrs?.lineGap, 0.8);
  assert.equal(groups[0].fields[1].style?.size, '9pt');
  const snapshot = JSON.stringify(groups);
  assert.equal(deleteBlankBesideFigure(groups, 'g', 'table', 1, resolve), false);
  assert.equal(JSON.stringify(groups), snapshot);
});
test('protected or titled groups are not removed; spacer can be deleted explicitly at boundary', () => {
  const groups: FieldGroup[] = [{ id: 'p', label: '标题', layout: 'vertical', fields: [text('blank', [p])] }, { id: 'g', label: '', layout: 'vertical', fields: [figure] }];
  assert.equal(deleteBlankBesideFigure(groups, 'g', 'table', -1, resolve), false);
  groups[0].fields[0].signature_line = true;
  groups[0].label = '';
  assert.equal(deleteBlankBesideFigure(groups, 'g', 'table', -1, resolve), false);
  groups[1].fields.unshift({ id: 's', code: 's', type: 'spacer', label: '', spacer_height: '1em' });
  assert.equal(deleteBlankBesideFigure(groups, 'g', 'table', -1, resolve), true);
  assert.equal(groups[1].fields.length, 1);
});
test('manual table cell styles reach PDF renderer', () => {
  const source = renderFreeTableTypst(figure, { columns: [{ id: 'c', label: '参数' }], rows: [{ id: 'r' }], cells: { 'r::c': '值' },
    cell_styles: { 'r::c': { weight: 'bold', size: '14pt', color: '#1677ff', align: 'left' } } });
  assert.match(source, /14pt/);
  assert.match(source, /1677ff/);
  assert.match(source, /align: left/);
});
test('whitespace and hard-break-only paragraphs below figures are deletable, styled notes are retained', () => {
  for (const content of [[{ type: 'text', text: '  \u00a0' }], [{ type: 'hardBreak' }]]) {
    const blank = text('blank', [{ type: 'paragraph', content }]); blank.style = { size: '9pt' };
    const groups: FieldGroup[] = [{ id: 'g', label: '', layout: 'vertical', fields: [figure, blank] }];
    assert.equal(deleteBlankBesideFigure(groups, 'g', 'table', 1, resolve), true);
    assert.deepEqual(groups[0].fields, [figure]);
  }
});
test('table line spacing reaches header and body, figure spacing is not emitted twice', () => {
  const source = renderFreeTableTypst({ ...figure, style: { space_before: '12pt', space_after: '0pt' } }, {
    columns: [{ id: 'c', label: '参数', style: { line_height: '0.8em' } }], rows: [{ id: 'r' }], cells: { 'r::c': '第一行\n第二行' }, cell_styles: { 'r::c': { line_height: '0.3em' } },
  });
  assert.match(source, /leading: 0.8em/); assert.match(source, /leading: 0.3em/);
  assert.match(source, /top: 12pt, bottom: 0pt/);
  assert.ok(!source.includes('#v(12pt)'));
});
test('report table physical widths and row tracks include the separate header without adding inset twice', () => {
  const table: NonNullable<FieldDefinition['free_table']> = { columns: [{ id: 'c', label: '标题', width: '3cm' }], rows: [{ id: 'r', height: '1cm' }], cells: { 'r::c': '值' }, header_height: '1cm', row_height_mode: 'track' };
  const source = renderFreeTableTypst(figure, JSON.parse(JSON.stringify(table)));
  assert.match(source, /columns: \(3cm\)/);
  assert.match(source, /rows: \(1cm, 1cm\)/);
  assert.ok(!source.includes('#block(height: 1cm)'));
  delete table.row_height_mode;
  assert.ok(renderFreeTableTypst(figure, table).includes('#block(height: 1cm)'), 'untouched legacy heights retain their old rendering');
});
test('independent column header styles survive JSON and reach PDF without changing labels', () => {
  const table = JSON.parse(JSON.stringify({ columns: [{ id: 'c', label: '参数#1', style: { size: '16pt', color: '#1677ff', weight: 'regular', italic: true, align: 'left' } }], rows: [{ id: 'r' }], cells: { 'r::c': '值' } }));
  const source = renderFreeTableTypst(figure, table);
  assert.match(source, /16pt/); assert.match(source, /1677ff/); assert.match(source, /align: left/);
  assert.equal(table.columns[0].label, '参数#1');
});
