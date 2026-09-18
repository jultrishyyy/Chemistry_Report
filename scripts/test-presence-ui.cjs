const assert = require('node:assert/strict');
const { JSDOM } = require('../client/node_modules/jsdom');
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
for (const key of ['window', 'document', 'navigator', 'HTMLElement']) Object.defineProperty(global, key, { configurable: true, value: dom.window[key] });
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('../client/node_modules/react');
const { createRoot } = require('../client/node_modules/react-dom/client');
const axios = require('../client/node_modules/axios').default;
const originalPost = axios.post, originalDelete = axios.delete;
const { useCollaborationPresence } = require('../client/src/hooks/useCollaboration.ts');
const requests = [];
axios.post = (url, data, options) => new Promise(resolve => requests.push({ url, data, options, resolve }));
axios.delete = async () => ({});
let state;
function Probe(props) { state = useCollaborationPresence(props); return null; }
const root = createRoot(document.getElementById('root'));
const props = { resourceType: 'record_data', resourceId: 1, enabled: true, changes: [] };
const render = () => React.act(async () => root.render(React.createElement(Probe, props)));
const answer = (index, name) => React.act(async () => {
  requests[index].resolve({ data: { users: [{ user_name: name }], recent_changes: [] } });
  for (let i = 0; i < 5; i++) await Promise.resolve();
});
(async () => {
  await render(); assert.equal(requests.length, 1);
  props.changes = ['修改尺寸']; await render();
  await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 1250)); });
  assert.equal(requests.length, 1, 'change notification must not overlap initial heartbeat');
  await answer(0, 'first');
  assert.equal(requests.length, 2, 'latest changes are sent after the in-flight request');
  assert.deepEqual(requests[1].data.changes, ['修改尺寸']);
  props.resourceId = 2; await render();
  assert.deepEqual(state.users, [], 'new record must not display old presence');
  assert.equal(requests[1].options.signal.aborted, true);
  assert.deepEqual(requests[2].data.changes, ['修改尺寸'], 'sent signature cannot leak across records');
  await answer(2, 'new'); await answer(1, 'old');
  assert.equal(state.users[0].user_name, 'new', 'late old response cannot overwrite current presence');
  props.enabled = false; await render(); assert.deepEqual(state.users, []);
  await React.act(async () => root.unmount());
  console.log('Presence: coalescing, trailing update, record isolation, abort and disable passed');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  axios.post = originalPost; axios.delete = originalDelete; dom.window.close();
});
