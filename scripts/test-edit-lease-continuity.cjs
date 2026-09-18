const assert = require('node:assert/strict');
const Module = require('node:module');
const clientRequire = Module.createRequire(require('node:path').resolve('client/package.json'));
const { JSDOM } = clientRequire('jsdom');
const React = clientRequire('react');
const { createRoot } = clientRequire('react-dom/client');
const { act } = React;
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
global.window = dom.window; global.document = dom.window.document;
global.IS_REACT_ACT_ENVIRONMENT = true;
window.setInterval = () => 1; window.clearInterval = () => {};
let poll, current, held = { lease_token: 'token-1', holder_name: '测试用户' }, failRenew = null, acquireResult = null, renews = 0, acquires = 0, releases = 0;
const axios = {
  get: async () => ({ data: { lease: held } }),
  post: async url => {
    if (url.endsWith('/acquire')) {
      acquires++;
      if (acquireResult instanceof Error || acquireResult?.response) throw acquireResult;
      return { data: { lease: acquireResult || held } };
    }
    renews++; if (failRenew) throw failRenew; return { data: { ok: true } };
  },
  delete: async () => { releases++; return {}; },
};
const originalLoad = Module._load;
Module._load = function(name, ...rest) {
  if (name === 'axios') return axios;
  if (name === '../utils/serialPolling') return { startSerialPolling: work => { poll = work; void work(); return () => {}; } };
  return originalLoad.call(this, name, ...rest);
};
const { useExclusiveEditLease } = require('../client/src/hooks/useCollaboration.ts');
Module._load = originalLoad;
function Harness({ id = '1' }) {
  current = useExclusiveEditLease({ resourceType: 'record_template', resourceId: id, enabled: true });
  return null;
}
(async () => {
  let root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(Harness)));
  assert.equal(current.token, 'token-1');
  await act(async () => root.unmount());
  assert.equal(releases, 0, 'a passive same-account tab must not release another tab edit lease');
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(Harness)));
  // Saving or unrelated UI rerenders must not reset editing or restart polling.
  const originalPoll = poll;
  await act(async () => root.render(React.createElement(Harness)));
  assert.equal(poll, originalPoll); assert.equal(current.acquired, true);
  held = null;
  await act(async () => poll());
  assert.equal(renews, 1); assert.equal(current.token, 'token-1');
  failRenew = new Error('network timeout');
  await act(async () => poll());
  assert.equal(current.acquired, true, 'network failure must not discard the edit token');
  failRenew = { response: { status: 423 } };
  acquireResult = { lease_token: 'token-recovered', holder_name: '测试用户' };
  await act(async () => poll());
  assert.equal(current.token, 'token-recovered', 'an active editor must automatically recover an available lease');
  assert.equal(acquires, 1);
  held = { lease_token: 'token-2', holder_name: '测试用户' };
  await act(async () => poll());
  held = { lease_token: null, holder_name: '另一位用户' };
  acquireResult = { response: { status: 423, data: { lease: held } } };
  const before = renews;
  await act(async () => poll());
  assert.equal(current.acquired, false); assert.equal(current.holderName, '另一位用户');
  assert.equal(renews, before + 1, 'verify the current token before accepting a possibly stale handoff snapshot');
  held = { lease_token: 'own-token', holder_name: '测试用户' };
  acquireResult = null;
  await act(async () => current.acquire());
  await act(async () => root.unmount());
  assert.equal(releases, 1, 'explicitly acquired lease is still released on leaving');
  dom.window.close();
  console.log('Edit lease continuity: rerender/save, expiry recovery, network timeout and handoff protection passed.');
})().catch(error => { console.error(error); dom.window.close(); process.exitCode = 1; });
