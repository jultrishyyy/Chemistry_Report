import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCoverBatchLayout, selectCoverFields } from './cover-batch-layout';
import type { RecordTemplate } from './types';
const template: RecordTemplate = { name: 'test', version: 1, groups: [{ id: 'g', label: '', layout: 'vertical', fields: [
  { id: 'a', code: 'a', type: 'text', label: '名称', binding: { source: 'literal', text: '  原文  ' }, style: { color: '#123456' } },
  { id: 'b', code: 'b', type: 'text', label: '客户', binding: { source: 'order', key: 'customer_name' } },
  { id: 's', code: 's', type: 'spacer', label: '', spacer_height: '2cm' },
] }] };
test('selection toggles and ranges retain stable identity', () => {
  assert.deepEqual(selectCoverFields(['a', 'b', 's'], ['a'], 'a', 's', false, true), ['a', 'b', 's']);
  assert.deepEqual(selectCoverFields(['a', 'b'], ['a', 'b'], 'a', 'a', true, false), ['b']);
});
test('one batch preserves source styles, values, bindings and spacers and is immutable', () => {
  const snapshot = JSON.stringify(template);
  const next = applyCoverBatchLayout(template, ['a', 'b'], { size: '14pt', align: 'center' }, '0pt');
  assert.equal(JSON.stringify(template), snapshot);
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(next.groups[0].fields[i].binding, template.groups[0].fields[i].binding);
    assert.equal(next.groups[0].fields[i].field_gap, '0pt');
    assert.equal(next.groups[0].fields[i].label_style?.size, '14pt');
  }
  assert.equal(next.groups[0].fields[0].style?.color, '#123456');
  assert.deepEqual(next.groups[0].fields[2], template.groups[0].fields[2]);
});
test('stale, special and invalid gap selections reject the entire batch', () => {
  assert.throws(() => applyCoverBatchLayout(template, ['a', 'gone'], { align: 'left' }));
  assert.throws(() => applyCoverBatchLayout(template, ['a', 's'], { align: 'left' }));
  assert.throws(() => applyCoverBatchLayout(template, ['a'], {}, '2pt'));
});
