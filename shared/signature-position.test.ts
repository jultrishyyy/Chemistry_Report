import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateTypst, injectReportFieldsIntoTypst, renderContentDoc } from './typst-generator';
import type { RecordTemplate } from './types';
import { fixedFirstPageSignature } from './signature-position';

const fixture = (): RecordTemplate => ({ name: '首页', version: 1, layout_options: { suppress_title: true }, groups: [
  { id: 'body', label: '', hide_title: true, layout: 'vertical', fields: Array.from({ length: 95 }, (_, i) => ({ id: `f${i}`, code: `f${i}`, type: 'text', label: '', hide_label: true, binding: { source: 'literal', text: `正文 ${i}` } })) },
  { id: 'sign', label: '', hide_title: true, layout: 'vertical', style: { vertical_align: 'bottom' }, module_span: 2, fields: [{ id: 'author', code: 'author', type: 'text', label: '编制', signature_line: true }] },
  { id: 'date', label: '', hide_title: true, layout: 'vertical', fields: [{ id: 'signed', code: 'signed', type: 'text', label: '签发日期', binding: { source: 'literal', text: '2026-09-14' } }] },
] });
for (const count of [2, 32, 95]) test(`current-page signing stays after preceding text and at page bottom (${count} lines)`, () => {
  const template = fixture();
  template.groups[0].fields = template.groups[0].fields.slice(0, count);
  template.groups[1].signature_position = 'current_page_bottom';
  for (const final of [false, true]) {
    const source = final ? renderContentDoc({ cover: { groups: template.groups, ctx: {}, layout_options: template.layout_options }, projects: [] }) : generateTypst(template);
    const markers = positions(source), prefix = final ? 'cover::' : '';
    const body = markers.find(m => m.code === `${prefix}f${count - 1}`)!;
    const sign = markers.find(m => m.code === `${prefix}sign`)!;
    const date = markers.find(m => m.code === `${prefix}signed`)!;
    assert.ok(sign.page >= body.page, JSON.stringify({ body, sign }));
    assert.ok(sign.page > body.page || sign.y > body.y, JSON.stringify({ body, sign }));
    assert.ok(sign.y > 500, JSON.stringify(sign));
    assert.equal(date.page, sign.page);
    assert.equal(markers.filter(m => m.code === `${prefix}sign`).length, 1);
  }
});
function positions(source: string) {
  const result = spawnSync('typst', ['query', '--font-path', 'fonts', '--package-path', 'typst-packages', '-', '<__fepos__>', '--field', 'value'], { input: source, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as Array<{ code: string; page: number; y: number }>;
}
for (const final of [false, true]) test(`long body reserves first page signature and its module, final=${final}`, () => {
  const template = fixture(), original = JSON.stringify(template);
  const source = final ? renderContentDoc({ cover: { groups: template.groups, ctx: {}, layout_options: template.layout_options }, projects: [] }) : injectReportFieldsIntoTypst(generateTypst(template), template, {});
  const markers = positions(source), prefix = final ? 'cover::' : '';
  const sign = markers.find(m => m.code === `${prefix}sign`)!;
  assert.ok(sign, JSON.stringify(markers));
  assert.equal(sign.page, 1);
  assert.ok(sign.y > 500, JSON.stringify(sign));
  assert.equal(markers.filter(m => m.code === `${prefix}signed`).length, 1);
  assert.equal(markers.find(m => m.code === `${prefix}signed`)!.page, 1);
  assert.ok(markers.find(m => m.code === `${prefix}f94`)!.page > 1);
  assert.equal(JSON.stringify(template), original);
});
test('explicit flow overrides legacy bottom and explicit fixed works without bottom', () => {
  const template = fixture(), group = template.groups[1];
  group.signature_position = 'flow';
  assert.equal(fixedFirstPageSignature(group), false);
  assert.ok(!generateTypst(template).includes('#place(bottom'));
  group.signature_position = 'first_page_bottom'; delete group.style;
  assert.ok(generateTypst(template).includes('#place(bottom'));
});

test('front cover keeps signature on the report home page rather than the physical cover', () => {
  const template = fixture();
  const markers = positions(renderContentDoc({ front_cover: { groups: [{ id: 'front', label: '', layout: 'vertical', fields: [{ id: 'title', code: 'title', label: '', hide_label: true, type: 'text', binding: { source: 'literal', text: '封面' } }] }], ctx: {} }, cover: { groups: template.groups, ctx: {} }, projects: [] }));
  assert.equal(markers.find(m => m.code === 'cover::sign')!.page, 2);
  assert.equal(markers.filter(m => m.code === 'cover::signed').length, 1);
});

test('preceding anchored module cannot duplicate the fixed signature module', () => {
  const template = fixture();
  template.groups[0].fields = template.groups[0].fields.slice(0, 1);
  template.groups[0].style = { vertical_align: 'center' };
  template.groups[0].module_span = 3;
  const markers = positions(generateTypst(template));
  assert.equal(markers.filter(m => m.code === 'sign').length, 1);
  assert.equal(markers.filter(m => m.code === 'signed').length, 1);
});

test('nested fixed signature is lifted only for rendering and appears once on first page', () => {
  const template = fixture();
  template.groups[1].parent_group_id = 'body';
  template.groups[1].signature_position = 'first_page_bottom';
  template.groups[1].module_span = 1;
  const snapshot = JSON.stringify(template);
  const markers = positions(injectReportFieldsIntoTypst(generateTypst(template), template, {}));
  assert.equal(markers.filter(m => m.code === 'sign').length, 1);
  assert.equal(markers.find(m => m.code === 'sign')!.page, 1);
  assert.ok(markers.find(m => m.code === 'f94')!.page > 1);
  assert.equal(JSON.stringify(template), snapshot, 'stored nesting and text never move');
});
test('nested current-page signature follows long parent content', () => {
  const template = fixture();
  template.groups[1].parent_group_id = 'body';
  template.groups[1].signature_position = 'current_page_bottom';
  const markers = positions(generateTypst(template));
  const sign = markers.find(m => m.code === 'sign')!, last = markers.find(m => m.code === 'f94')!;
  assert.ok(sign.page >= last.page);
  assert.ok(sign.y > 500);
  assert.equal(markers.filter(m => m.code === 'sign').length, 1);
});
