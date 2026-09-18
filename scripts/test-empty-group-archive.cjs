// In-memory route regression: never connects to the application database.
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
let requested = false, archived = false, queries = 0;
const db = {
  async query(sql, params) {
    queries++;
    assert.ok(!(params || []).some(p => typeof p === 'number' && !Number.isFinite(p)));
    if (/SELECT COUNT/.test(sql)) return { rows: [{ count: 0 }] };
    if (/SELECT/.test(sql)) return { rows: [{ id: 7, name: '空项目组', archived_at: archived ? new Date() : null, archive_requested_by: requested ? '管理员' : null }] };
    if (/SET archive_requested_by=\$1/.test(sql)) requested = true;
    if (/SET archive_requested_by=NULL/.test(sql)) requested = false;
    if (/SET archived_at=NOW/.test(sql)) { archived = true; requested = false; }
    return { rows: [], rowCount: 0 };
  }, release() {},
};
const pool = { ...db, connect: async () => db };
Module._load = function(name, ...rest) {
  if (name === '../db.js') return { pool };
  if (name === './auth.js') return { requirePermission: () => (_req, _res, next) => next() };
  if (name === '../services/template-versions.js') {
    const actual = originalLoad.call(this, name, ...rest);
    return { ...actual, actorHasPermission: () => true, readActor: () => ({ name: '管理员', role: 'admin', roles: ['admin'] }) };
  }
  return originalLoad.call(this, name, ...rest);
};
const routers = [
  [require('../server/src/routes/test-methods.ts').default, '/groups'],
  [require('../server/src/routes/report-project-families.ts').default, ''],
];
Module._load = originalLoad;
async function invoke(router, prefix, action, id = '7', body = {}) {
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  let valid = false;
  router.params.id[0]({}, res, () => { valid = true; }, id);
  if (!valid) return res;
  const route = router.stack.find(l => l.route?.path === `${prefix}/:id/${action}`).route;
  await route.stack.at(-1).handle({ params: { id }, body }, res);
  return res;
}
(async () => {
  for (const [router, prefix] of routers) {
    requested = false; archived = false;
    for (const action of ['archive-request', 'archive-request/cancel', 'archive-review']) {
      const before = queries;
      assert.equal((await invoke(router, prefix, action, 'NaN')).code, 400);
      assert.equal(queries, before, 'invalid IDs must never reach the database');
    }
    assert.equal((await invoke(router, prefix, 'archive-request')).code, 200);
    assert.equal(requested, true);
    assert.equal((await invoke(router, prefix, 'archive-request/cancel')).code, 200);
    assert.equal(requested, false);
    await invoke(router, prefix, 'archive-request');
    const result = await invoke(router, prefix, 'archive-review', '7', { decision: 'approve' });
    assert.equal(result.code, 200); assert.equal(result.body.detached_template_count, 0);
    assert.equal(archived, true);
  }
  console.log('Empty record/report groups: request, cancel, approve and invalid-ID rejection passed (mock database).');
})().catch(error => { console.error(error); process.exitCode = 1; });
