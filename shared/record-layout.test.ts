import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyRecordLayout, recordLayoutRows, RECORD_LAYOUT_KEY } from './record-layout';
import type { FieldDefinition, RecordTemplate } from './types';
import { generateTypstWithData } from './typst-generator';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const field = (code: string, type = 'text') => ({ id: code, code, label: code, type }) as FieldDefinition;
const template: RecordTemplate = { name: 'layout', version: 1, groups: [{ id: 'g', label: '条件', layout: 'two-col',
  fields: [field('a'), field('b'), field('table', 'free_grid'), field('c'), field('image', 'image'), field('d')] }] };
test('two columns keep tables and images full width and preserve ordering', () => {
  assert.deepEqual(recordLayoutRows(template.groups[0]).map(r => r.map(f => f.code)), [['a','b'], ['table'], ['c'], ['image'], ['d']]);
});
test('instance overrides are serialized, do not mutate template or field identities', () => {
  const before = JSON.stringify(template);
  const data = JSON.parse(JSON.stringify({ [RECORD_LAYOUT_KEY]: { groups: { g: 'vertical' }, fields: { a: true } }, a: 'actual data' }));
  const next = applyRecordLayout(template, data);
  assert.equal(next.groups[0].layout, 'vertical');
  assert.equal(next.groups[0].fields[0].full_width, true);
  assert.equal(recordLayoutRows(next.groups[0]).length, 6);
  assert.equal(JSON.stringify(template), before);
  assert.equal(data.a, 'actual data');
  assert.equal(next.groups[0].fields[0].code, 'a');
});
test('full-width text flushes incomplete rows; invalid overrides ignored', () => {
  const next = applyRecordLayout(template, { [RECORD_LAYOUT_KEY]: { groups: { g: 'invalid' }, fields: { b: true, table: false } } });
  assert.equal(next.groups[0].layout, 'two-col');
  assert.deepEqual(recordLayoutRows(next.groups[0]).slice(0, 3).map(r => r.map(f => f.code)), [['a'], ['b'], ['table']]);
  assert.equal(next.groups[0].fields[2].full_width, undefined);
});
test('two-column PDF compiles with full-width text, multiline values and instance override', () => {
  const sample: RecordTemplate = { name: '双栏测试', version: 1, groups: [{ id: 'g', label: '条件', layout: 'vertical', fields: [
    field('a'), field('b'), { ...field('notes', 'textarea'), full_width: true }, field('c'),
  ] }] };
  const source = generateTypstWithData(sample, { a: '23', b: '50%', notes: '第一行\n第二行', c: '结束',
    [RECORD_LAYOUT_KEY]: { groups: { g: 'two-col' } } });
  assert.ok(source.includes('columns: (1fr, 1fr)'));
  const pdf = spawnSync('typst', ['compile', '-', '-'], { input: source, maxBuffer: 5 * 1024 * 1024,
    env: { ...process.env, TYPST_PACKAGE_PATH: resolve('typst-packages') } });
  assert.equal(pdf.status, 0, pdf.stderr.toString());
  assert.equal(pdf.stdout.subarray(0, 5).toString(), '%PDF-');
});
