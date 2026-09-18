import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { coverInlineValue, updateCoverField } from './cover-template-editing.ts';
import { encodeReportRichDocument, storedReportRichDocument, reportRichPlainText, richDocumentToTypst } from './report-rich-document.ts';
import { resolveReportFieldValue, generateTypst, injectReportFieldsIntoTypst, renderContentDoc } from './typst-generator.ts';
import { collectReportBindings } from './binding-integrity.ts';
import type { RecordTemplate } from './types';

test('inline dynamic fields preserve bindings, resolve different orders and survive JSON with marks and whitespace', () => {
  const template: RecordTemplate = { name: '首页', version: 1, groups: [{ id: 'g', label: '', layout: 'vertical', fields: [
    { id: 'f', code: 'f', label: '委托单位', label_width: 'none', type: 'text', binding: { source: 'order', key: 'customer_name' } },
    { id: 'space', code: 'space', label: '', type: 'spacer', spacer_height: '1cm' },
  ] }] };
  const snapshot = JSON.stringify(template);
  const doc = storedReportRichDocument(coverInlineValue(template.groups[0].fields[0]))!;
  doc.content![0].content!.push({ type: 'text', text: '  编号：' }, { type: 'templateField', attrs: { reference: { id: 'order-no', label: '订单号', binding: { source: 'order', key: 'order_no' } } }, marks: [{ type: 'bold' }] });
  const updated = updateCoverField(template, 'g', 'f', { text: encodeReportRichDocument(doc) });
  const saved = JSON.parse(JSON.stringify(updated));
  assert.equal(JSON.stringify(template), snapshot);
  assert.equal(saved.groups[0].fields[1].spacer_height, '1cm');
  const field = saved.groups[0].fields[0];
  for (const customer_name of ['甲公司', '乙公司']) {
    const ctx = { order: { customer_name, order_no: 'NO-123' } };
    const resolved = resolveReportFieldValue(field, ctx);
    assert.equal(reportRichPlainText(resolved), `委托单位：${customer_name}  编号：NO-123`);
    assert.ok(!resolved.includes('templateField'));
    assert.ok(resolved.includes('bold'));
    for (const src of [injectReportFieldsIntoTypst(generateTypst(saved), saved, ctx), renderContentDoc({ cover: { groups: saved.groups, ctx }, projects: [] })]) {
      assert.ok(src.includes(customer_name)); assert.ok(src.includes('NO-123'));
      assert.ok(!src.includes('templateField'));
      const compiled = spawnSync('typst', ['compile', '--font-path', 'fonts', '--package-path', 'typst-packages', '-', '-'], { input: src });
      assert.equal(compiled.status, 0, compiled.stderr.toString());
    }
  }
  const refs = collectReportBindings(saved.groups).filter(ref => ref.binding.source === 'order');
  assert.equal(refs.length, 2, 'mapping integrity must see nested fields');
  assert.throws(() => richDocumentToTypst(doc), /尚未解析/);
});

test('empty and multiline resolved bindings remain valid editor text, never nested rich code', () => {
  for (const text of ['', '第一行\n第二行', '#text[不执行]']) {
    const value = encodeReportRichDocument({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'templateField', attrs: { reference: { id: 'a', label: 'a', binding: { source: 'literal', text } } } }] }] });
    const resolved = resolveReportFieldValue({ id: 'f', code: 'f', label: '', type: 'text', rich: true, binding: { source: 'literal', text: value } }, {});
    assert.equal(reportRichPlainText(resolved), text);
    assert.ok(!resolved.includes('"text":""'));
  }
});

test('conditional empty hiding does not remove manual prose, blank paragraphs or edited spacing', () => {
  const paragraph = storedReportRichDocument(coverInlineValue({ id: 'ref', code: 'ref', type: 'text', label: '', hide_label: true, binding: { source: 'order_samples' } }))!.content![0];
  assert.equal(paragraph.attrs?.templateEmptyPolicy, 'hide');
  const render = (content: any[]) => storedReportRichDocument(resolveReportFieldValue({ id: 'f', code: 'f', label: '', type: 'text', rich: true, binding: { source: 'literal', text: encodeReportRichDocument({ type: 'doc', content }) } }, { order: { customer_name: '' } }))!;
  assert.equal(render([paragraph]).content!.length, 0);
  const edited = structuredClone(paragraph);
  edited.content!.push({ type: 'text', text: '用户备注' });
  assert.equal(render([edited]).content!.length, 1);
  const blank = { type: 'paragraph', attrs: { templateEmptyPolicy: 'hide' }, content: [] };
  assert.equal(render([blank]).content!.length, 1, 'deleted reference leaves an intentional editable blank');
  const manual = { type: 'paragraph', attrs: { spaceBefore: 20, templateSpacing: { spaceBefore: 6 } }, content: [{ type: 'text', text: '手工设置段距' }] };
  assert.equal(render([paragraph, manual]).content![0].attrs?.spaceBefore, 20);
});
