const assert = require('node:assert/strict');
const Module = require('node:module');
const load = Module._load;
let dbRows = [], calls = [], events = [], remote = { ok: false, error: 'remote failed' };
const db = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: dbRows.shift() || [] }; }, release() {} };
Module._load = function(name, ...rest) {
  if (name === '../db.js') return { pool: { ...db, connect: async () => db } };
  if (name === './reports.js' || name === '../services/typst-compiler.js') return {};
  if (name === '../services/external-report-delivery.js') return { cancelReportFlowFromDiGui: async () => { events.push('cancel'); return remote; } };
  if (name === '../services/rework-ops.js') return {
    returnReportForEdit: async () => events.push('revision'),
    returnReportToDataEntry: async () => { events.push('data_entry'); return { rejected_record_ids: [1] }; },
    markReportApproved: async () => events.push('approved'),
  };
  return load.call(this, name, ...rest);
};
const router = require('../server/src/routes/external.ts').default;
Module._load = load;
async function invoke(path, body) {
  const route = router.stack.find(l => l.route?.path === path && l.route.methods.post);
  const res = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
  await route.route.stack[0].handle({ body, params: { id: '1' }, header: name => name === 'X-User-Job' ? 'J1' : 'Test' }, res);
  return res;
}
async function modify(body, delivery = 'sent', external = 'submitted_external') {
  calls = []; events = [];
  dbRows = [[], [{ report_id: 1, report_number: 'R', record_state: body.RecordState?.trim() || '审核通过', delivery_status: delivery }],
    [{ id: 1, order_no: 'O', external_status: external }], [], []];
  return invoke('/report-modify', { SysNumber: 'S', ...body });
}
(async () => {
  await modify({ RecordState: ' 审核不通过 ' }); assert.deepEqual(events, ['revision']);
  await modify({ RecordState: '审核不通过' }, 'failed'); assert.deepEqual(events, ['revision']);
  await modify({ RecordState: '草稿' }); assert.deepEqual(events, ['revision']);
  await modify({ RecordState: '审核通过' }); assert.deepEqual(events, ['approved']);
  await modify({ Remark: 'metadata only' }); assert.deepEqual(events, [], 'old approval state must not execute again');
  await modify({ RecordState: '审核通过' }, 'none', 'none'); assert.deepEqual(events, []);
  await modify({ ModifyType: 'data_entry', RecordState: '审核通过' }); assert.deepEqual(events, ['data_entry']);
  const invalid = await modify({ ModifyType: 'typo' }); assert.equal(invalid.body.results[0].ok, false);
  for (const success of [false, true]) {
    calls = []; events = [];
    remote = success ? { ok: true, recordState: '草稿', receipt: 'OK' } : { ok: false, error: 'rejected' };
    dbRows = [[], [{ report_id: 1, sys_number: 'S', delivery_status: 'sent', external_status: 'submitted_external' }], [], [], [], []];
    const res = await invoke('/requisitions/:id/withdraw-delivery', {});
    assert.deepEqual(events, ['cancel']);
    assert.equal(res.code, success ? 200 : 502);
    assert.equal(calls.some(c => c.sql.includes("delivery_status='none'")), success);
  }
  console.log('External modify/withdraw route tests passed (mock database and remote): explicit states, legacy delivery mismatch, metadata-only, data rework and remote-first withdrawal.');
})().catch(e => { console.error(e); process.exitCode = 1; });
