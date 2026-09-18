import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverGroupLayout, coverGridChunks } from './cover-group-layout.ts';
import type { FieldGroup } from './types';

const group: FieldGroup = { id: 'g', label: '基本信息', layout: 'vertical', hide_title: true, fields: [] };
test('grid partitions preserve order, full-width aligned fields, independent figure blocks and source spacers', () => {
  const source: FieldGroup = { ...group, layout: 'grid', style: { block_spacing: '0pt' }, fields: [
    { id: 'a', code: 'a', type: 'text', label: 'A' },
    { id: 'blank', code: 'blank', type: 'spacer', label: '', spacer_height: '3cm' },
    { id: 'b', code: 'b', type: 'text', label: 'B', style: { align: 'right' } },
    { id: 'c', code: 'c', type: 'text', label: 'C' },
    { id: 'pic', code: 'pic', type: 'static_content', static_kind: 'images', label: '图片' },
    { id: 'd', code: 'd', type: 'text', label: 'D' },
    { id: 'e', code: 'e', type: 'text', label: 'E' },
  ] };
  const snapshot = JSON.stringify(source), chunks = coverGridChunks(source);
  assert.deepEqual(chunks.map(c => [c.fields.map(f => f.id), c.columns]), [[['a'], 3], [['b'], 1], [['c'], 3], [['pic'], 1], [['d', 'e'], 2]]);
  assert.ok(chunks.every(c => c.rowGap === '0pt' && c.columnGap === '16pt'));
  assert.equal(JSON.stringify(source), snapshot);
  const two = coverGridChunks({ ...source, layout: 'two-col' });
  assert.equal(two[0].columns, 2); assert.equal(two[0].columnGap, '24pt');
  assert.equal(coverGridChunks({ ...source, layout: 'vertical' })[0].fields.length, 7);
});
test('hidden sections use configured gaps including zero, without a fixed 16px tail', () => {
  assert.equal(coverGroupLayout(group).section.marginBottom, '6pt');
  assert.equal(coverGroupLayout(group, { body_size: 12, line_gap: 2 }).section.marginBottom, '24pt');
  assert.equal(coverGroupLayout({ ...group, style: { block_spacing: '0pt' } }, { line_gap: '20pt' }).section.marginBottom, '0pt');
  const explicit = coverGroupLayout({ ...group, style: { space_before: '5', space_after: '8pt', margin: { top: '2pt', left: '2em' } } });
  assert.equal(explicit.content.paddingTop, '7pt');
  assert.equal(explicit.content.paddingBottom, '8pt');
  assert.equal(explicit.content.paddingLeft, '20pt');
});
test('section titles use document scale or independent style, not the content style', () => {
  const source = { ...group, hide_title: false, style: { size: '30pt' }, title_gap: '0pt' };
  const before = JSON.stringify(source);
  const layout = coverGroupLayout(source, { body_size: 10, heading_scale: 1.5, paragraph_gap: '0pt', section_style: 'center-bold' });
  assert.equal(layout.section.paddingTop, '0pt');
  assert.equal(layout.title.fontSize, '15pt');
  assert.equal(layout.title.marginBottom, '0pt');
  assert.equal(layout.title.textAlign, 'center');
  assert.equal(layout.title.fontWeight, 'bold');
  const custom = coverGroupLayout({ ...source, title_style: { font: 'Arial', weight: 'regular', size: '18pt', color: '#123456' } });
  assert.equal(custom.title.fontSize, '18pt');
  assert.equal(custom.title.fontWeight, 'normal');
  assert.equal(custom.title.fontFamily, '"Arial"');
  assert.equal(custom.title.color, '#123456');
  assert.equal(JSON.stringify(source), before, 'display projection never writes template content');
});
