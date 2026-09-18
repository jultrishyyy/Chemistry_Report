const assert = require('node:assert/strict');
const Module = require('node:module'), original = Module._load;
let called = 0, allowed = true, active = true;
Module._load = function(name, ...rest) {
  if (name === '../../../config/index.js') return { integrationsProfile: 'server', authConfig: { local_admin: 'admin', local_admin_pwd: '123' } };
  if (name === '../services/external-auth.js') return {
    isMockLogin: () => false,
    loginViaCommonLogin: async login => { called++; return { ok: allowed, jobNo: login, userName: 'OA User', departName: 'Test' }; },
  };
  if (name === '../db.js') return { pool: { query: async sql => ({ rows: sql.includes('role_definitions') ? []
    : [{ job_no: 'NEW-OA-USER', user_name: 'OA User', roles: [], active }] }) } };
  return original.call(this, name, ...rest);
};
const router = require('../server/src/routes/auth.ts').default;
Module._load = original;
async function login(name) {
  const handler = router.stack.find(l => l.route?.path === '/login').route.stack[0].handle;
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ body: { loginName: name, pwd: '123' } }, res);
  return res;
}
(async () => {
  assert.equal((await login('NEW-OA-USER')).code, 200);
  assert.equal(called, 1, 'non-whitelisted OA users must reach OA');
  allowed = false;
  assert.equal((await login('admin')).code, 401);
  assert.equal(called, 2, 'admin/123 must not bypass OA in server mode');
  allowed = true; active = false;
  assert.equal((await login('DISABLED')).code, 403);
  console.log('Production login passed: unrestricted OA identities, no local admin bypass, disabled-account and role controls retained (mock OA/DB).');
})().catch(e => { console.error(e); process.exitCode = 1; });
