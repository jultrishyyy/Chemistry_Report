import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultBasicPublicField, isEmptyTransferValue, isRecordPullSource, matchPublicRecordFields, publicRecordTransferPatch } from './record-field-transfer.ts';
import type { FieldGroup, FieldDefinition } from './types';
const f = (code: string, extra: Partial<FieldDefinition> = {}): FieldDefinition => ({ id: code, code, label: code, type: 'text', data_scope: 'batch_shared', ...extra });
const groups = (...fields: FieldDefinition[]): FieldGroup[] => [{ id: 'g', label: 'g', layout: 'vertical', fields }];

test('public equipment fields copy independent snapshots and respect explicit opt-out', () => {
  const device = f('equipment', { type: 'device_ref' });
  const fields = groups(device);
  const source = { equipment: ['DEVICE-1', 'DEVICE-2'] };
  const preview = matchPublicRecordFields(fields, fields, {}, source);
  assert.equal(preview.matched.length, 1);
  const target = publicRecordTransferPatch({}, preview);
  assert.deepEqual(target.equipment, ['DEVICE-1', 'DEVICE-2']);
  source.equipment.push('DEVICE-3');
  target.equipment.splice(0, 1);
  assert.deepEqual(preview.values.equipment, ['DEVICE-1', 'DEVICE-2']);
  assert.deepEqual(source.equipment, ['DEVICE-1', 'DEVICE-2', 'DEVICE-3']);
  assert.equal(matchPublicRecordFields(fields, groups({ ...device, data_scope: 'record' }), {}, source).matched.length, 0);
  assert.equal(matchPublicRecordFields(groups({ ...device, data_scope: 'record' }), fields, {}, source).matched.length, 0);
  assert.equal(matchPublicRecordFields(fields, fields, {}, { equipment: [] }).matched.length, 0);
  assert.equal(defaultBasicPublicField({ ...device, data_scope: undefined }, { section_role: 'basic' }).data_scope, 'batch_shared');
  assert.equal(defaultBasicPublicField({ ...device, data_scope: 'record' }, { section_role: 'basic' }).data_scope, 'record');
});

test('pull sources require multiple bound templates and exact order/sample/project scope', () => {
  const scope = { orderNo: 'O', sampleId: 'S', testName: 'T', recordId: 1, templateId: 10, templateIds: [10, 20] };
  const source = { id: 2, template_id: 20, order_no: 'O', sample_external_id: 'S', test_item_name: 'T', has_entered_data: true };
  assert.equal(isRecordPullSource(source, scope), true);
  assert.equal(isRecordPullSource({ ...source, has_entered_data: false }, scope), false);
  assert.equal(isRecordPullSource({ ...source, has_entered_data: undefined }, scope), false);
  for (const patch of [{ template_id: 10 }, { template_id: 30 }, { order_no: 'other' }, { sample_external_id: 'other' }, { test_item_name: 'other' }, { cancelled_at: 'now' }, { id: 1 }]) {
    assert.equal(isRecordPullSource({ ...source, ...patch }, scope), false);
  }
  assert.equal(isRecordPullSource(source, { ...scope, templateIds: [10] }), false);
  assert.equal(isRecordPullSource(source, { ...scope, sampleId: '' }), false);
});

test('new basic fields default to public without affecting other sections or explicit choices', () => {
  const field = f('text', { data_scope: undefined });
  assert.equal(defaultBasicPublicField(field, { section_role: 'basic' }).data_scope, 'batch_shared');
  assert.equal(defaultBasicPublicField(field, { section_role: 'results' }).data_scope, undefined);
  assert.equal(defaultBasicPublicField({ ...field, data_scope: 'record' }, { section_role: 'basic' }).data_scope, 'record');
  assert.equal(defaultBasicPublicField({ ...field, type: 'free_grid' }, { section_role: 'basic' }).data_scope, undefined);
  assert.equal(field.data_scope, undefined);
});

test('only matching public fields are pulled; zero, false, multiline and spaces survive', () => {
  const fields = groups(f('zero'), f('false'), f('text'), f('private', { data_scope: undefined }));
  const values = { zero: 0, false: false, text: '  line1\n  line2', private: 'no' };
  const result = matchPublicRecordFields(fields, fields, {}, values);
  assert.deepEqual(result.values, { zero: 0, false: false, text: values.text });
  assert.equal(isEmptyTransferValue(0), false);
  assert.equal(isEmptyTransferValue(false), false);
  assert.equal(isEmptyTransferValue('  '), true);
});

test('existing values and batch-shared values are preserved; source is never mutated', () => {
  const fields = groups(f('a'), f('b'));
  const source = { a: 'old', b: ['shared'] };
  const result = matchPublicRecordFields(fields, fields, { a: 0 }, source);
  assert.equal(result.skipped.length, 1);
  assert.deepEqual(result.values, { b: ['shared'] });
  result.values.b.push('local');
  assert.deepEqual(source.b, ['shared']);
});

test('duplicate codes, incompatible types, units and selection options do not copy', () => {
  const target = groups(f('a'), f('b'), f('c', { unit: 'mm' }), f('d', { type: 'select', options: ['A'] }));
  const source = groups(f('a'), f('a'), f('b', { type: 'number' }), f('c', { unit: 'cm' }), f('d', { type: 'select', options: ['B'] }));
  assert.deepEqual(matchPublicRecordFields(target, source, {}, { a: 'x', b: 1, c: 2, d: 'B' }).values, {});
  assert.deepEqual(matchPublicRecordFields(groups(f('a')), groups(f('a', { data_scope: undefined })), {}, { a: 'x' }).values, {});
  assert.deepEqual(matchPublicRecordFields(groups(f('a', { type: 'checkbox', options: ['A'] })), groups(f('a', { type: 'checkbox', options: ['B'] })), {}, { a: ['B'] }).values, {});
});

test('tables, images, audit and conclusion fields are never copied even when marked public', () => {
  const fields = groups(f('table', { type: 'free_grid' }), f('image', { type: 'image' }), f('audit', { semantic_role: 'tester' as any }));
  fields.push({ id: 'result', label: 'result', layout: 'vertical', section_role: 'conclusion', fields: [f('result')] });
  assert.deepEqual(matchPublicRecordFields(fields, fields, {}, { table: {}, image: ['x'], audit: 'X', result: 'pass' }).values, {});
  assert.equal(matchPublicRecordFields(groups(f('a')), groups(f('a')), {}, {}).matched.length, 0);
});

test('draft sources remain available and differing existing values can be explicitly replaced', () => {
  const scope = { orderNo: 'O', sampleId: 'S', testName: 'T', recordId: 1, templateId: 10, templateIds: [10, 20] };
  assert.equal(isRecordPullSource({ id: 2, template_id: 20, order_no: 'O', sample_external_id: 'S', test_item_name: 'T', audit_status: 'draft', has_entered_data: true }, scope), true);
  const fields = groups(f('same'), f('different'), f('empty'));
  const current = { same: '同步值', different: '模板默认值', empty: '' };
  const source = { same: '同步值', different: '草稿录入值', empty: 0 };
  const preview = matchPublicRecordFields(fields, fields, current, source);
  assert.equal(preview.skipped.filter(item => item.identical).length, 1);
  assert.deepEqual(publicRecordTransferPatch(current, preview), { empty: 0, same: '同步值' });
  assert.deepEqual(publicRecordTransferPatch(current, preview, true), { empty: 0, same: '同步值', different: '草稿录入值' });
  assert.deepEqual(publicRecordTransferPatch({ ...current, different: '新改动', empty: '新录入' }, preview, true), { same: '同步值' });
  assert.equal(current.different, '模板默认值');
});

test('pulled values are a frozen snapshot, including nested selections', () => {
  const fields = groups(f('value'));
  const source = { value: ['最初录入'] };
  const preview = matchPublicRecordFields(fields, fields, {}, source);
  source.value[0] = '来源之后修改';
  const target = publicRecordTransferPatch({}, preview);
  assert.deepEqual(target.value, ['最初录入']);
  target.value.push('目标独立修改');
  assert.deepEqual(source.value, ['来源之后修改']);
});
