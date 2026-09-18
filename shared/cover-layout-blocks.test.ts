import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { insertCoverLayoutBlock, updateCoverField } from './cover-template-editing.ts';
import { generateTypst, injectReportFieldsIntoTypst, renderContentDoc } from './typst-generator.ts';
import type { RecordTemplate } from './types';

const original: RecordTemplate = { name: '首页', version: 1, groups: [
  { id: 'body', label: '', layout: 'vertical', fields: [{ id: 'customer', code: 'customer', label: '客户', type: 'text', binding: { source: 'order', key: 'customer_name' } }] },
  { id: 'sign', label: '编制审核', layout: 'vertical', style: { vertical_align: 'bottom' }, fields: [{ id: 'space', code: 'space', type: 'spacer', label: '', spacer_height: '2cm' }] },
] };
test('inserting fixed assets preserves template bindings, signoff and existing spacing', () => {
  const snapshot = JSON.stringify(original);
  const logo = insertCoverLayoutBlock(original, 'body', 'customer', 'logo', 'logo');
  const space = insertCoverLayoutBlock(logo, 'body', 'logo', 'spacer', 'new_space');
  assert.deepEqual(space.groups[0].fields.map(f => f.id), ['customer', 'logo', 'new_space']);
  assert.deepEqual(space.groups[1], original.groups[1]);
  assert.deepEqual(space.groups[0].fields[0], original.groups[0].fields[0]);
  assert.equal(JSON.stringify(original), snapshot);
  assert.throws(() => insertCoverLayoutBlock(original, 'sign', null, 'logo', 'x'));
  assert.throws(() => insertCoverLayoutBlock(original, 'body', 'missing', 'logo', 'x'));
  assert.throws(() => insertCoverLayoutBlock(original, 'body', null, 'logo', 'customer'));
});
test('logo paths and physical dimensions reach both PDF paths; edits affect only target', () => {
  const inserted = insertCoverLayoutBlock(original, 'body', null, 'logo', 'logo');
  const updated = updateCoverField(inserted, 'body', 'logo', { images: [{ id: 'photo', rel_path: 'fixture/logo.png', display_width_cm: 4, display_height_cm: 2 }] });
  const saved = JSON.parse(JSON.stringify(updated));
  for (const source of [injectReportFieldsIntoTypst(generateTypst(saved), saved, {}), renderContentDoc({ cover: { groups: saved.groups, ctx: {} }, projects: [] })]) {
    assert.ok(source.includes('__CDR_UPLOAD_IMAGE__/fixture/logo.png'));
    assert.ok(source.includes('width: 4cm, height: 2cm'));
    assert.ok(source.includes('#v(2cm)'));
  }
  assert.equal(inserted.groups[0].fields[1].static_images![0].rel_path, undefined);
  assert.throws(() => updateCoverField(original, 'body', 'customer', { images: [] }));
});
test('spacer resizing including zero is explicit and limited to selected spacer', () => {
  const inserted = insertCoverLayoutBlock(original, 'body', null, 'spacer', 'new_space');
  const updated = updateCoverField(inserted, 'body', 'new_space', { spacerHeight: '0pt' });
  assert.equal(updated.groups[0].fields[1].spacer_height, '0pt');
  assert.equal(original.groups[1].fields[0].spacer_height, '2cm');
  assert.throws(() => updateCoverField(inserted, 'body', 'new_space', { spacerHeight: '-2cm' }));
  assert.throws(() => updateCoverField(inserted, 'body', 'customer', { spacerHeight: '2cm' }));
});

test('fixed table dimensions include every row and edits preserve merges, styles and unrelated mappings', () => {
  for (const [rows, columns] of [[1, 1], [3, 3], [2, 5]]) {
    const inserted = insertCoverLayoutBlock(original, 'body', 'customer', 'table', 'fixed_table', { rows, columns });
    const table = inserted.groups[0].fields[1].static_table!;
    assert.equal(table.rows.length, rows); assert.equal(table.columns.length, columns);
    const edited = structuredClone(table);
    edited.cells['r1::c1'] = '固定表格内容';
    edited.cell_styles = { 'r1::c1': { weight: 'bold', color: '#1677ff', size: '12pt' } };
    if (columns > 1) edited.spans = { 'r1::c1': { colspan: 2 } };
    const saved = JSON.parse(JSON.stringify(updateCoverField(inserted, 'body', 'fixed_table', { table: edited })));
    assert.deepEqual(saved.groups[0].fields[0], original.groups[0].fields[0]);
    assert.deepEqual(saved.groups[1], original.groups[1]);
    for (const source of [injectReportFieldsIntoTypst(generateTypst(saved), saved, {}), renderContentDoc({ cover: { groups: saved.groups, ctx: {} }, projects: [] })]) {
      assert.ok(source.includes('固定表格内容')); assert.ok(source.includes('fill: rgb("1677ff")'));
      if (columns > 1) assert.ok(source.includes('colspan: 2'));
      const compiled = spawnSync('typst', ['compile', '--font-path', 'fonts', '--package-path', 'typst-packages', '-', '-'], { input: source });
      assert.equal(compiled.status, 0, compiled.stderr.toString());
    }
  }
  assert.throws(() => updateCoverField(original, 'body', 'customer', { table: { columns: [], rows: [], cells: {} } }));
  assert.throws(() => insertCoverLayoutBlock(original, 'body', null, 'table', 'x', { rows: 0, columns: 3 }));
});
