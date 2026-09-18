const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
let matches, selections = [], generated = [], updates = [], locked = false;
const samples = [{ id: 'S1', name: 'Same', test_infos: [{ name: 'Ready' }, { name: 'NoTemplate' }] },
  { id: 'S2', name: 'Same', test_infos: [{ name: 'Missing' }] }];
const candidate = (id, manufacturer = null) => ({ id, name: `T${id}`, version_id: id * 10, version_no: 1, host_manufacturer_id: manufacturer });
const entry = (scope_key, project_name, assignments, sample_external_id = 'S1') => ({ scope_key, project_name, sample_name: 'Same',
  sample_external_id, status: assignments.length ? 'matched' : 'needs_record', assignments });
const ready = (id, candidates, status = 'reviewed') => ({ record_data_id: id, record_data_status: status, project_template_candidates: candidates });
const pool = { query: async (sql, params) => {
  if (sql.startsWith('SELECT customer_name')) return { rows: [{ payload: { samples } }] };
  if (sql.startsWith('SELECT host_manufacturer_id')) return { rows: [{ host_manufacturer_id: 7 }] };
  if (sql.startsWith('SELECT payload')) return { rows: [{ payload: { samples } }] };
  if (sql.startsWith('SELECT content_doc')) return { rows: [] };
  if (sql.includes('INSERT INTO report_batches')) return { rows: [{ id: 5 }] };
  if (sql.startsWith('SELECT * FROM report_requisitions')) return { rows: [{ id: 1, order_no: 'O', report_number: 'R',
    generation_configured_at: null, template_selections: selections, scope: { samples }, report_id: locked ? 8 : null }] };
  if (sql.includes('rework') && sql.includes('SELECT')) return { rows: locked ? [{ id: 1 }] : [] };
  if (sql.includes('UPDATE report_requisitions')) { updates.push(params); return { rows: [] }; }
  throw new Error(`Unexpected query: ${sql}`);
} };
Module._load = function(name, ...rest) {
  if (name === '../db.js') return { pool };
  if (name === '../services/external-report-info.js') return { matchRequisitionScope: async () => matches, buildReportMetaFromReq: () => ({}) };
  if (name === './reports.js') return { generateAndStoreReport: async params => { generated.push(params); return { report_id: 20 }; } };
  if (['../services/typst-compiler.js', '../services/external-report-delivery.js', '../services/rework-ops.js'].includes(name)) return {};
  return originalLoad.call(this, name, ...rest);
};
const router = require('../server/src/routes/external.ts').default;
Module._load = originalLoad;
const route = router.stack.find(layer => layer.route?.path === '/requisitions/generate').route.stack[0].handle;
async function run(assignments) {
  generated = []; updates = [];
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await route({ body: { order_no: 'O', cover_template_id: 9, items: [{ requisition_id: 1, ...(assignments ? { assignments } : {}) }] }, header: () => 'Tester' }, res);
  assert.equal(res.code, 200, JSON.stringify(res.body));
  return res.body.reports[0];
}
(async () => {
  matches = [entry('ready', 'Ready', [ready(1, [candidate(11), candidate(12, 7)])]),
    entry('missing-template', 'NoTemplate', [ready(2, [])]), entry('missing-record', 'Missing', [], 'S2'),
    entry('pending', 'Ready', [ready(3, [candidate(13)], 'submitted')]),
    entry('outside', 'Extra', [ready(9, [candidate(19)])], 'S2')];
  assert.equal((await run()).ok, true);
  assert.deepEqual(generated[0].project_assignments.map(a => [a.record_data_id, a.project_template_id]), [[1, 12]]);
  assert.deepEqual(generated[0].report_samples.map(s => s.id), ['S1'], 'same-name unavailable sample must not leak onto cover');
  assert.equal(JSON.parse(updates[0][3])[0].project_template_version_id, 120);
  selections = [{ scope_key: 'ready', enabled: true, record_data_id: 1, project_template_id: 11 }];
  assert.equal((await run()).ok, true);
  assert.equal(generated[0].project_assignments[0].project_template_id, 11);
  assert.equal((await run([{ scope_key: 'ready', enabled: false }])).ok, false);
  assert.equal(generated.length, 0);
  selections = [];
  assert.equal((await run([{ scope_key: 'ready', enabled: false }, { scope_key: 'outside', enabled: true }])).ok, true);
  assert.deepEqual(generated[0].project_assignments.map(a => a.project_template_id), [19], 'explicit scope override and fallback template work without OEM match');
  locked = true;
  assert.equal((await run()).locked, true);
  assert.equal(generated.length, 0);
  locked = false;
  matches = [entry('missing-record', 'Missing', [], 'S2')];
  assert.equal((await run()).ok, false);
  assert.equal(generated.length, 0);
  console.log('Direct generation passed: no configuration prerequisite, partial scope, default/manual templates, exclusions, empty scope, rework lock and cover sample isolation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
