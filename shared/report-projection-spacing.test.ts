import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REPORT_SEED_SNAPSHOTS } from './seed-report-templates.data.ts';
import { continuousTextValue } from './report-continuous-text.ts';
import { reportTextRuns, reportTextRunValue, updateReportTextRun, projectReportTextRuns } from './report-text-runs.ts';
import { renderContentDoc, resolveReportFieldValue } from './typst-generator.ts';

test('partially edited density prose renders identically before and after materializing the remaining unit field', () => {
  const template = REPORT_SEED_SNAPSHOTS.find(t => t.name === '密度试验项目报告')!;
  const original = structuredClone(template.field_definitions.find(g => g.id === 'pg_method')!);
  for (const f of original.fields) f.binding = { source: 'literal', text: f.unit === '℃' ? '22.2' : f.label === '检测方法' ? 'GB 8410-2006' : '去离子水' };
  const group = structuredClone(original);
  group.report_source_fields = structuredClone(group.fields);
  const first = group.fields[0];
  const prefix = continuousTextValue({ ...original, fields: original.fields.slice(0, 2) }, f => resolveReportFieldValue(f, {}));
  group.fields.splice(0, 2, { id: first.id, code: first.code, label: '', type: 'text', rich: true, hide_label: true, binding: { source: 'literal', text: prefix } });
  const doc = (g: typeof group) => ({ cover: { groups: [], ctx: {} }, projects: [{ name: '密度', groups: [g], ctx: {} }] });
  const snapshot = JSON.stringify(group), before = renderContentDoc(doc(group));
  assert.equal(JSON.stringify(group), snapshot, 'projection must not save a conversion on open');
  const run = reportTextRuns(group)[0];
  updateReportTextRun(group, run.ids, reportTextRunValue(run, f => resolveReportFieldValue(f, {})));
  assert.equal(renderContentDoc(doc(group)), before, 'first edit must not switch spacing/layout paths');
  assert.ok(!before.includes('data.liquid_temp'));
  assert.equal((before.match(/22.2/g) || []).length, 1);
  const locked = { ...original, fields: [...original.fields, { id: 'signature', code: 'signature', label: '', type: 'text' as const, signature_line: true }] };
  assert.equal(projectReportTextRuns(locked, () => ''), locked);
});
