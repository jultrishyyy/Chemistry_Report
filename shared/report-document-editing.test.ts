import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { makeReportManualTable, reportSpacerSize, splitReportParagraph, insertIntoReportParagraph } from './report-document-editing.ts';
import { renderContentDoc, resolveReportFieldValue } from './typst-generator.ts';
import type { FieldDefinition } from './types';

for (const [rows, columns] of [[1, 1], [3, 3], [2, 5]]) test(`inserting ${rows}x${columns} creates exactly that many PDF cells, with no extra header`, () => {
  const field = makeReportManualTable('grid', { rows, columns });
  assert.equal(field.type, 'free_grid');
  assert.equal(field.free_table!.rows.length, rows);
  assert.equal(field.free_table!.columns.length, columns);
  assert.equal(field.free_table!.header_cells, undefined);
  const source = renderContentDoc({ cover: { groups: [{ id: 'g', label: '', layout: 'vertical', fields: [field] }], ctx: {} }, projects: [] });
  const probe = '#show table: it => [#metadata(it.children.len())<grid-count>#it]\n';
  const result = spawnSync('typst', ['query', '--font-path', 'fonts', '--package-path', 'typst-packages', '-', '<grid-count>', '--field', 'value'], { input: probe + source, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [rows * columns]);
});

test('new manual report tables persist and render in both cover and project sections', () => {
  const table = makeReportManualTable('manual_1');
  table.free_table!.cells['r1::c1'] = '测试内容123';
  table.free_table!.spans = { 'r1::c1': { colspan: 2 } };
  assert.equal(table.result_table, undefined, 'new table has no automatic source to restore');
  const section = { groups: [{ id: 'g', label: 'G', layout: 'vertical', fields: [table] }], ctx: {} };
  const snapshot = JSON.stringify(section);
  for (const doc of [{ cover: section, projects: [] }, { cover: { groups: [], ctx: {} }, projects: [section] }]) {
    const source = renderContentDoc(JSON.parse(JSON.stringify(doc)));
    assert.ok(source.includes('测试内容123'));
    assert.ok(source.includes('colspan: 2'));
    assert.ok(!source.includes('列1'));
  }
  assert.equal(JSON.stringify(section), snapshot);
  const another = makeReportManualTable('manual_2');
  assert.deepEqual(another.free_table!.cells, {});
});

test('spacer editing preserves numeric zero, dimensions and renderer defaults', () => {
  for (const [raw, expected] of [
    ['0em', { value: 0, unit: 'em' }], ['12pt', { value: 12, unit: 'pt' }],
    ['0.5cm', { value: 0.5, unit: 'cm' }], ['12', { value: 12, unit: 'pt' }],
    [undefined, { value: 0.5, unit: 'cm' }],
  ] as const) {
    assert.deepEqual(reportSpacerSize(raw), expected);
    const source = renderContentDoc({ cover: { groups: [{ id: 'g', label: '', layout: 'vertical', fields: [{ id: 'space', code: 'space', type: 'spacer', label: '', spacer_height: raw }] }], ctx: {} }, projects: [] });
    assert.ok(source.includes(`#v(${expected.value}${expected.unit})`));
  }
});

test('editor and report share default, empty override, rich text and date resolution', () => {
  const base: FieldDefinition = { id: 'f', code: 'f', label: 'F', type: 'text' };
  const cases: Array<[FieldDefinition, string]> = [
    [{ ...base, default_value: '默认内容' }, '默认内容'],
    [{ ...base, type: 'number', default_value: 0 }, '0'],
    [{ ...base, default_value: '默认内容', binding: { source: 'literal', text: '' } }, ''],
    [{ ...base, rich: true, default_value: '<b>正文</b>' }, '<b>正文</b>'],
    [{ ...base, type: 'date', date_separator: '/', binding: { source: 'literal', text: '2026-09-09' } }, '2026/09/09'],
    [{ ...base, type: 'daterange', date_range: { start: { source: 'literal', text: '2026-09-01' }, end: { source: 'literal', text: '2026-09-09' } } }, '2026-09-01 ~ 2026-09-09'],
  ];
  for (const [field, value] of cases) {
    assert.equal(resolveReportFieldValue(field, {}), value);
    const doc = { cover: { groups: [{ id: 'g', label: '', layout: 'vertical' as const, fields: [field] }], ctx: {} }, projects: [] };
    const snapshot = JSON.stringify(doc), rendered = renderContentDoc(doc);
    if (field.rich) assert.ok(rendered.includes('正文'));
    else if (value) assert.ok(rendered.includes(value), `PDF source includes ${value}`);
    else assert.ok(!rendered.includes('默认内容'), 'clearing must not bring back the template default');
    assert.equal(JSON.stringify(doc), snapshot);
  }
});

test('cursor insertion keeps text, inline formatting and original identity without duplicate bindings', () => {
  assert.deepEqual(splitReportParagraph('前后', 1), ['前', '后']);
  assert.deepEqual(splitReportParagraph('**前后**', 3), ['**前**', '**后**']);
  assert.deepEqual(splitReportParagraph('*前后*', 2), ['*前*', '*后*']);
  assert.deepEqual(splitReportParagraph('_前后_', 2), ['_前_', '_后_']);
  assert.deepEqual(splitReportParagraph('**前后**', 1), ['', '**前后**']);
  assert.deepEqual(splitReportParagraph('😀后', 1), ['😀', '后']);
  const field: FieldDefinition = { id: 'p', code: 'p', label: '', type: 'text', rich: true, hide_label: true,
    page_break_before: true, style: { size: '12pt' }, binding: { source: 'literal', text: '**前后**' } };
  const snapshot = JSON.stringify(field), table = makeReportManualTable('t');
  const fields = insertIntoReportParagraph(field, '**前后**', 3, table, 'tail');
  assert.equal(fields.length, 3); assert.equal(fields[0].id, field.id);
  assert.equal(fields[1].id, 't'); assert.equal(fields[2].id, 'tail');
  assert.equal(resolveReportFieldValue(fields[0], {}), '**前**');
  assert.equal(resolveReportFieldValue(fields[2], {}), '**后**');
  assert.equal(fields[2].page_break_before, undefined);
  assert.deepEqual(fields[2].style, field.style);
  const doc = { cover: { groups: [{ id: 'g', label: '', layout: 'vertical' as const, fields }], ctx: {} }, projects: [] };
  const pdf = renderContentDoc(JSON.parse(JSON.stringify(doc)));
  assert.ok(pdf.indexOf('*前*') < pdf.indexOf('#table(columns:'));
  assert.ok(pdf.indexOf('#table(columns:') < pdf.indexOf('*后*'));
  assert.equal(JSON.stringify(field), snapshot, 'source remains available for undo');
  assert.deepEqual(insertIntoReportParagraph(field, '**前后**', 0, table, 'tail').map(f => f.id), ['t', 'p']);
  assert.deepEqual(insertIntoReportParagraph(field, '**前后**', 8, table, 'tail').map(f => f.id), ['p', 't']);
});
