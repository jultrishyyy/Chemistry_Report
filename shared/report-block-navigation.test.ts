import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FieldDefinition, FieldGroup } from './types';
import { enterBesideReportBlock, removeReportBlock, removeReportBlockWithFocus, reportTextEndPosition } from './report-block-navigation.ts';
import { makeReportManualTable } from './report-document-editing.ts';
import { encodeReportRichDocument, readReportRichDocument, reportRichPlainText } from './report-rich-document.ts';
import { renderContentDoc } from './typst-generator.ts';

const text = (id: string, value: string): FieldDefinition => ({ id, code: id, type: 'text', label: '', hide_label: true, rich: true,
  binding: { source: 'literal', text: encodeReportRichDocument({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: value, marks: [{ type: 'bold' }] }] }] }) } });
const group = (): FieldGroup => ({ id: 'g', label: '', layout: 'vertical', report_source_fields: [text('source', '源数据')],
  fields: [text('before', '前文'), makeReportManualTable('figure'), text('after', '后文')] });
const value = (f: FieldDefinition) => (f.binding as { text: string }).text;

test('deleting a figure returns the original text boundary, even after paragraphs merge', () => {
  const g = group(), source = structuredClone(g.report_source_fields);
  const expected = reportTextEndPosition(value(g.fields[0]));
  const focus = removeReportBlockWithFocus(g, 'figure', value);
  assert.deepEqual(focus, { id: 'before', position: expected });
  assert.equal(g.fields.length, 1);
  assert.ok(expected < reportTextEndPosition(value(g.fields[0])), 'focus stays before the preserved following text');
  assert.deepEqual(g.report_source_fields, source);
  const onlyAfter = group(); onlyAfter.fields.shift();
  assert.deepEqual(removeReportBlockWithFocus(onlyAfter, 'figure', value), { id: 'after', position: 1 });
  const onlyFigure = group(); onlyFigure.fields = [makeReportManualTable('figure')];
  assert.equal(removeReportBlockWithFocus(onlyFigure, 'figure', value), null);
  assert.equal(onlyFigure.fields.length, 0, 'deletion does not add an unsolicited paragraph');
  assert.equal(removeReportBlockWithFocus(onlyFigure, 'missing', value), null);
});

test('Enter/Shift+Enter create an editable blank edge, preserving text and reusing empty edges', () => {
  const g = group();
  assert.equal(enterBesideReportBlock(g, 'figure', 1, 'new'), 'after');
  assert.equal(enterBesideReportBlock(g, 'figure', -1, 'new'), 'before');
  assert.equal(reportRichPlainText(value(g.fields[0])), '前文\n');
  assert.equal(reportRichPlainText(value(g.fields[2])), '\n后文');
  const snapshot = JSON.stringify(g);
  enterBesideReportBlock(g, 'figure', 1, 'other'); enterBesideReportBlock(g, 'figure', -1, 'other');
  assert.equal(JSON.stringify(g), snapshot);
  assert.equal(readReportRichDocument(value(g.fields[2])).content![1].content![0].marks![0].type, 'bold');
});
test('missing paragraphs between figures or at an edge are created without changing the source snapshot', () => {
  const g = group(), source = JSON.stringify(g.report_source_fields);
  g.fields = [makeReportManualTable('first'), makeReportManualTable('second')];
  assert.equal(enterBesideReportBlock(g, 'first', -1, 'start'), 'start');
  assert.equal(enterBesideReportBlock(g, 'first', 1, 'middle'), 'middle');
  assert.equal(enterBesideReportBlock(g, 'second', 1, 'end'), 'end');
  assert.deepEqual(g.fields.map(f => f.id), ['start', 'first', 'middle', 'second', 'end']);
  assert.equal(JSON.stringify(g.report_source_fields), source);
  delete g.report_source_fields;
  assert.equal(enterBesideReportBlock(g, 'first', 1, 'reused'), 'middle');
});
test('ordinary project sections accept prose beside a table without freezing bindings or changing its configuration', () => {
  const g = group(); delete g.report_source_fields;
  const table = makeReportManualTable('table');
  g.fields = [table];
  const original = JSON.stringify(table);
  assert.equal(enterBesideReportBlock(g, 'table', 1, 'note'), 'note');
  assert.equal(g.report_source_fields, undefined);
  assert.equal(g.report_document, undefined);
  assert.equal(JSON.stringify(g.fields[0]), original);
  g.fields[1].binding = { source: 'literal', text: '表后说明' };
  const pdf = renderContentDoc({ cover: { groups: [JSON.parse(JSON.stringify(g))], ctx: {} }, projects: [] });
  assert.ok(pdf.includes('表后说明'));
  for (const patch of [{ layout: 'inline' }, { layout: 'two-col' }, { layout: 'table' }, { layout: 'grid' }]) {
    const special = { ...g, ...patch } as FieldGroup;
    const snapshot = JSON.stringify(special);
    assert.equal(enterBesideReportBlock(special, 'table', -1, 'blocked'), null);
    assert.equal(JSON.stringify(special), snapshot);
  }
  const images = { ...g, section_role: 'images' as const, image_layout: { cols: 2 } };
  images.fields = [makeReportManualTable('table')];
  assert.equal(enterBesideReportBlock(images, 'table', -1, 'image-note'), 'image-note');
  assert.deepEqual(images.fields.map(field => field.id), ['image-note', 'table']);
});
test('explicit figure deletion joins compatible text editors but preserves paragraph breaks and rich formatting', () => {
  const g = group(), source = JSON.stringify(g.report_source_fields);
  removeReportBlock(g, 'figure');
  assert.equal(g.fields.length, 1);
  assert.equal(reportRichPlainText(value(g.fields[0])), '前文\n后文');
  assert.equal(JSON.stringify(g.report_source_fields), source);
  const reopened = JSON.parse(JSON.stringify(g));
  const pdf = renderContentDoc({ cover: { groups: [reopened], ctx: {} }, projects: [] });
  assert.ok(pdf.includes('#strong[前文]')); assert.ok(pdf.includes('#strong[后文]'));
  assert.ok(!pdf.includes('列1'));
});
test('different styles, explicit page breaks and non-mixed groups are not automatically joined', () => {
  for (const setup of [(g: FieldGroup) => { g.fields[2].style = { size: '12pt' }; },
    (g: FieldGroup) => { g.fields[2].page_break_before = true; },
    (g: FieldGroup) => { delete g.report_source_fields; }]) {
    const g = group(); setup(g); removeReportBlock(g, 'figure'); assert.equal(g.fields.length, 2);
    const saved = JSON.stringify(g); removeReportBlock(g, 'missing'); assert.equal(JSON.stringify(g), saved);
  }
});
