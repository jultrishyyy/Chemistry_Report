const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
let row;
const pool = { query: async (sql, args) => {
  assert.match(sql, /UPDATE edit_leases/);
  assert.match(sql, /resource_type=\$2 AND resource_id=\$3 AND holder_job_no=\$4/);
  assert.match(sql, /lease_token=\$5::uuid/);
  const matches = row && row.token === args[4] && row.owner === args[3]
    && row.type === args[1] && row.id === args[2]
    && (!/AND expires_at > NOW\(\)/.test(sql) || !row.expired);
  if (matches) { row.expired = false; return { rows: [{ expires_at: new Date() }] }; }
  return { rows: [] };
} };
Module._load = function(name, ...rest) {
  if (name === '../db.js') return { pool };
  return originalLoad.call(this, name, ...rest);
};
const router = require('../server/src/routes/collaboration.ts').default;
Module._load = originalLoad;
const handler = router.stack.find(l => l.route?.path === '/leases/heartbeat').route.stack[0].handle;
async function heartbeat(token = 'original') {
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ body: { resource_type: 'record_template', resource_id: '7', lease_token: token }, header: name => name === 'X-User-Job' ? 'tester' : '测试用户' }, res);
  return res;
}
(async () => {
  row = { token: 'original', owner: 'tester', type: 'record_template', id: '7', expired: true };
  assert.equal((await heartbeat()).code, 200, 'same token may renew after background throttling');
  assert.equal(row.expired, false);
  row.token = 'new-owner-token'; row.owner = 'other';
  assert.equal((await heartbeat()).code, 423, 'old owner cannot renew a transferred lease');
  row = null;
  assert.equal((await heartbeat()).code, 423, 'released lease cannot be resurrected');
  console.log('Lease renewal: expired exact-token recovery, handoff and release protections passed (mock database).');
})().catch(error => { console.error(error); process.exitCode = 1; });
