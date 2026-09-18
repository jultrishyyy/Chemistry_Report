import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availableReportAssignments, splitReportMethodMatches } from './report-generation-selection';
const record = (id: number, template: number, candidate = template + 100) => ({ record_data_id: id, record_template_id: template,
  record_template_name: `Method ${template}`, record_data_status: 'reviewed',
  project_template_candidates: candidate ? [{ id: candidate, name: 'Report', version_id: 1, version_no: 1 }] : [] });
const entry = { scope_key: 's1:t1', sample_name: 'A', project_name: 'Test', status: 'matched' as const,
  assignments: [record(74, 49), record(73, 48), record(72, 47), record(71, 47)] };
test('three methods produce three chapters; earlier revisions of one method do not duplicate it', () => {
  const methods = splitReportMethodMatches([entry]);
  assert.equal(methods.length, 3);
  assert.equal(new Set(methods.map(m => m.scope_key)).size, 3);
  assert.deepEqual(splitReportMethodMatches(methods), methods);
  assert.deepEqual(availableReportAssignments([entry]).map(a => a.record_data_id), [74, 73, 72]);
  const selected = availableReportAssignments([entry], [{ scope_key: 's1:t1', record_data_id: 74, project_template_id: 149 }]);
  assert.deepEqual(selected.map(a => a.record_data_id), [74, 73, 72], 'legacy choice applies to its method without suppressing siblings');
});
test('method exclusions and missing templates do not suppress other methods or the density project', () => {
  const density = { ...entry, scope_key: 's1:t2', project_name: 'Density', assignments: [record(75, 32)] };
  const partial = { ...entry, assignments: [record(74, 49), record(73, 48, 0), record(72, 47)] };
  assert.deepEqual(availableReportAssignments([partial, density]).map(a => a.record_data_id), [74, 72, 75]);
  assert.deepEqual(availableReportAssignments([entry, density], [{ scope_key: 's1:t1:method:48', enabled: false }]).map(a => a.record_data_id), [74, 72, 75]);
  assert.deepEqual(availableReportAssignments([entry, density], [{ scope_key: 's1:t1', enabled: false }]).map(a => a.record_data_id), [75]);
});
