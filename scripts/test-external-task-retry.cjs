const assert = require('node:assert/strict');
const Module = require('node:module'), load = Module._load;
let unfinished = 1, sent = 0, updates = [];
const row = { id: 1, task_id: 'T', test_state: 1, order_no: 'O', sample_external_id: 'S', test_item_name: 'P' };
const db = { query: async sql => ({ rows: sql.includes('WITH candidates') ? [row] : [] }), release() {} };
Module._load = function(name, ...rest) {
  if (name === '../db.js') return { pool: { connect: async () => db, query: async sql => {
    if (sql.includes('AS unfinished')) return { rows: [{ total: 2, unfinished }] };
    updates.push(sql); return { rows: [] };
  } } };
  if (name === './external-report-delivery.js') return {
    isExternalSoapConfigured: () => true,
    updateMaterialTaskState: async () => { sent++; return { ok: true, receipt: 'OK' }; },
  };
  return load.call(this, name, ...rest);
};
const { deliverTaskStateQueue } = require('../server/src/services/external-task-state.ts');
Module._load = load;
(async () => {
  const blocked = await deliverTaskStateQueue([1]);
  assert.equal(sent, 0); assert.equal(blocked[0].ok, false);
  assert.ok(updates[0].includes("delivery_status='pending'"));
  unfinished = 0; updates = [];
  const delivered = await deliverTaskStateQueue([1]);
  assert.equal(sent, 1); assert.equal(delivered[0].ok, true);
  assert.ok(updates[0].includes("delivery_status='sent'"));
  console.log('Task retry regression passed: rework blocks stale completion; full review allows delivery (mock DB/remote).');
})().catch(e => { console.error(e); process.exitCode = 1; });
