import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reportBindingReview } from './report-binding-review.ts';
import type { FieldGroup } from './types';

const source = [{ id: 'source', label: '试验条件', fields: [
  { id: 'f1', code: 'temperature', label: '温度', type: 'text' },
] }] as FieldGroup[];
const report = [{ id: 'report', label: '条件', fields: [
  { id: 'r1', code: 'report_temp', label: '试验温度', type: 'text', binding: { source: 'record_field', field_code: 'temperature' } },
] }] as FieldGroup[];
test('display rename and reorder preserve binding', () => {
  const renamed = structuredClone(source);
  renamed[0].fields[0].label = '环境温度';
  assert.deepEqual(reportBindingReview(report, renamed), []);
});
test('deleted field reports readable target without discarding stored binding', () => {
  const before = JSON.stringify(report);
  const issues = reportBindingReview(report, []);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].fieldCode, 'report_temp');
  assert.equal(issues[0].fieldName, '试验温度');
  assert.equal(JSON.stringify(report), before);
});
test('same label with different code does not silently rebind', () => {
  const replacement = structuredClone(source);
  replacement[0].fields[0].code = 'new_temperature';
  assert.equal(reportBindingReview(report, replacement).length, 1);
});
test('new unused field does not invalidate existing bindings', () => {
  const extended = structuredClone(source);
  extended[0].fields.push({ ...extended[0].fields[0], id: 'f2', code: 'humidity', label: '湿度' });
  assert.deepEqual(reportBindingReview(report, extended), []);
});
