import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hideAutomaticSampleTable } from './report-table-visibility';
import { renderSampleTableTypst } from './typst-generator.ts';
import type { FieldDefinition } from './types';
test('automatic single-sample table is hidden in editor and PDF without modifying the field', () => {
  const field: FieldDefinition = { id: 's', code: 's', label: '样品信息表', type: 'report_sample_table', sample_table: { mode: 'auto' } };
  const before = JSON.stringify(field);
  for (const order_samples of [[], [{ no: '2#', name: '样品B', model: 'EPDM-50' }]]) {
    assert.equal(hideAutomaticSampleTable(field, { order_samples }), true);
    assert.equal(renderSampleTableTypst(field, { order_samples }), '');
  }
  assert.equal(hideAutomaticSampleTable(field, { order_samples: [{}, {}] }), false);
  assert.equal(hideAutomaticSampleTable(field, { blank_scope: true }), false);
  assert.equal(hideAutomaticSampleTable({ ...field, sample_table: { mode: 'always' } }, { order_samples: [{}] }), false);
  assert.equal(hideAutomaticSampleTable({ ...field, free_table: { columns: [{ id: 'c', label: '' }], rows: [{ id: 'r' }], cells: { 'r::c': '手工内容' } } }, { order_samples: [{}] }), false);
  assert.equal(JSON.stringify(field), before);
});

test('single-sample tables render by default', () => {
  const field: FieldDefinition = { id: 's', code: 's', label: '样品信息表', type: 'report_sample_table' };
  const ctx = { order_samples: [{ no: '1#', name: 'SampleVisible', model: 'PartVisible' }] };
  assert.equal(hideAutomaticSampleTable(field, ctx), false);
  assert.match(renderSampleTableTypst(field, ctx), /SampleVisible/);
  assert.match(renderSampleTableTypst(field, ctx), /PartVisible/);
});
