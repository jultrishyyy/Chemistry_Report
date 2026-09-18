const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
const calls = [];
let responses = [];
const db = {
  query: async (sql, params) => { calls.push({ sql, params }); return { rows: responses.shift() || [] }; },
  release() {},
};
const pool = { ...db, connect: async () => db };
class VersionFlowError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
Module._load = function(name, ...rest) {
  if (name === '../db.js') return { pool };
  if (name === '../services/template-versions.js') return { actorHasPermission: () => true, VersionFlowError };
  return originalLoad.call(this, name, ...rest);
};
const router = require('../server/src/routes/report-project-families.ts').default;
Module._load = originalLoad;
async function invoke(path, method, req) {
  const layer = router.stack.find(l => l.route?.path === path && l.route.methods[method]);
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await layer.route.stack[0].handle(req, res);
  return res;
}
(async () => {
  const members = [{ id: 11, template_kind: 'cover', report_project_family_id: 1 }, { id: 12, template_kind: 'project', report_project_family_id: 1 }];
  for (const kind of ['cover', 'project']) {
    responses = [[{ id: 1, name: 'Shared', template_kind: 'project' }], members];
    const res = await invoke('/', 'get', { query: { kind } });
    assert.deepEqual(res.body[0].templates, members);
    assert.ok(!calls.at(-2).sql.includes('f.template_kind=$1'));
    assert.ok(!calls.at(-1).sql.includes('t.template_kind=f.template_kind'));
  }
  responses = [[], [{ id: 1, template_kind: 'project' }], members.map(m => ({ ...m, report_project_family_id: null })), members, []];
  const added = await invoke('/:id/templates', 'post', { params: { id: '1' }, body: { template_ids: [11, 12] } });
  assert.equal(added.code, 200);
  assert.equal(added.body.count, 2);
  assert.ok(calls.some(c => c.sql === 'COMMIT'));
  responses = [[], [{ id: 1, template_kind: 'project' }], [{ id: 11, name: 'Already grouped', template_kind: 'cover', report_project_family_id: 2 }], []];
  const rejected = await invoke('/:id/templates', 'post', { params: { id: '1' }, body: { template_ids: [11] } });
  assert.notEqual(rejected.code, 200);
  assert.equal(calls.at(-1).sql, 'ROLLBACK');
  console.log('Shared report groups: both entry kinds, mixed membership, transactional attach and existing-membership guard passed (mock database).');
})().catch(error => { console.error(error); process.exitCode = 1; });
