import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { coverTextRuns, commitCoverTextRun } from './cover-text-runs.ts';
import { generateTypst, injectReportFieldsIntoTypst, renderContentDoc } from './typst-generator.ts';
import type { RecordTemplate } from './types';
import { encodeReportRichDocument, storedReportRichDocument } from './report-rich-document.ts';

function tailPosition(template: RecordTemplate, final: boolean, customer_name = 'Customer') {
  const ctx = { order: { customer_name, sample_name: customer_name } };
  const source = final ? renderContentDoc({ cover: { groups: template.groups, layout_options: template.layout_options, ctx }, projects: [] })
    : injectReportFieldsIntoTypst(generateTypst(template), template, ctx);
  const result = spawnSync('typst', ['query', '--font-path', 'fonts', '--package-path', 'typst-packages', '-', '<__fepos__>', '--field', 'value'], { input: source, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const markers = JSON.parse(result.stdout);
  const marker = markers.find((m: any) => m.code === 'tail' || m.code === 'cover::tail');
  assert.ok(marker, JSON.stringify(markers));
  return marker.y;
}

for (const final of [false, true]) for (const customer of ['', '—', 'Customer']) for (const position of [0, 1, 2]) {
  test(`empty dynamic paragraph retains legacy visibility: ${JSON.stringify(customer)}, position=${position}, final=${final}`, () => {
    const template: RecordTemplate = { name: '', version: 1, layout_options: { theme_config: { body_size: 10, line_gap: '6pt' } }, groups: [{ id: 'g', label: '', hide_title: true, layout: 'vertical', fields: [
      { id: 'a', code: 'a', type: 'text', label: '', hide_label: true, binding: { source: 'literal', text: 'First line' } },
      { id: 'b', code: 'b', type: 'text', label: '', hide_label: true, binding: { source: 'order_samples' } },
      { id: 'c', code: 'c', type: 'text', label: '', hide_label: true, binding: { source: 'literal', text: 'Last line' } },
      { id: 'tail', code: 'tail', type: 'number', label: 'Tail', default_value: 1 },
    ] }] };
    const dynamic = template.groups[0].fields.splice(1, 1)[0];
    template.groups[0].fields.splice(position, 0, dynamic);
    const [run] = coverTextRuns(template), edited = commitCoverTextRun(template, 'g', run.ids, run.value, run.value, true);
    const before = tailPosition(template, final, customer), after = tailPosition(edited, final, customer);
    assert.ok(Math.abs(before - after) < 0.2, `before=${before}, after=${after}`);
  });
}

for (const final of [false, true]) for (const content of ['  First  line  ', 'First\nSecond', 'First\n\nThird']) {
  test(`cover preserves whitespace and line breaks during conversion: ${JSON.stringify(content)}, final=${final}`, () => {
    const template: RecordTemplate = { name: '', version: 1, layout_options: { theme_config: { body_size: 12, line_gap: '0.8em' } }, groups: [{ id: 'g', label: '', hide_title: true, layout: 'vertical', style: { block_spacing: '4pt' }, fields: [
      { id: 'a', code: 'a', type: 'text', label: '', hide_label: true, binding: { source: 'literal', text: content } },
      { id: 'b', code: 'b', type: 'text', label: '', hide_label: true, binding: { source: 'order', key: 'customer_name' } },
      { id: 'tail', code: 'tail', type: 'number', label: 'Tail', default_value: 1 },
    ] }] };
    const [run] = coverTextRuns(template);
    const edited = commitCoverTextRun(template, 'g', run.ids, run.value, run.value, true);
    const before = tailPosition(template, final), after = tailPosition(edited, final);
    assert.ok(Math.abs(before - after) < 0.2, `before=${before}, after=${after}`);
  });
}

test('explicit rich paragraph spacing is never cleared as a generated field gap', () => {
  const value = encodeReportRichDocument({ type: 'doc', content: [{ type: 'paragraph', attrs: { spaceBefore: 14, spaceAfter: 19 }, content: [{ type: 'text', text: 'User spacing' }] }] });
  const template: RecordTemplate = { name: '', version: 1, groups: [{ id: 'g', label: '', layout: 'vertical', fields: ['a', 'b'].map(id => ({ id, code: id, label: '', hide_label: true, rich: true, type: 'text', binding: { source: 'literal', text: value } })) }] };
  const [run] = coverTextRuns(template), nodes = storedReportRichDocument(run.value)!.content!;
  assert.equal(nodes[0].attrs?.spaceBefore, 14);
  assert.equal(nodes.at(-1)?.attrs?.spaceAfter, 19);
});

for (const final of [false, true]) for (const gap of ['0pt', '6pt', '12pt']) {
  test(`cover continuous text preserves following content position: gap=${gap}, final=${final}`, () => {
    const template: RecordTemplate = { name: '', version: 1, layout_options: { theme_config: { body_size: 10, line_gap: gap } }, groups: [{ id: 'g', label: '', hide_title: true, layout: 'vertical', fields: [
      { id: 'a', code: 'a', type: 'text', label: '', hide_label: true, binding: { source: 'literal', text: 'First line' } },
      { id: 'b', code: 'b', type: 'text', label: '', hide_label: true, binding: { source: 'literal', text: 'Second line' } },
      { id: 'tail', code: 'tail', type: 'number', label: 'Tail', default_value: 1 },
    ] }] };
    const [run] = coverTextRuns(template);
    const edited = commitCoverTextRun(template, 'g', run.ids, run.value, run.value, true);
    const before = tailPosition(template, final), after = tailPosition(edited, final);
    assert.ok(Math.abs(before - after) < 0.2, `before=${before}, after=${after}`);
  });
}
