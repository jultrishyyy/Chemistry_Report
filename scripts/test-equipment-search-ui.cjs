const assert = require('node:assert/strict');
const { JSDOM } = require('../client/node_modules/jsdom');
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
for (const key of ['window', 'document', 'navigator', 'HTMLElement']) Object.defineProperty(global, key, { configurable: true, value: dom.window[key] });
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('../client/node_modules/react');
const { createRoot } = require('../client/node_modules/react-dom/client');
const { useEquipmentSearch } = require('../client/src/hooks/useEquipmentSearch.ts');
const requests = [];
global.fetch = (url, options) => new Promise(resolve => requests.push({ url, options, resolve }));
let state;
function Probe() { state = useEquipmentSearch(); return null; }
const root = createRoot(document.getElementById('root'));
const wait = () => React.act(async () => { await new Promise(resolve => setTimeout(resolve, 330)); });
const answer = async (request, name) => React.act(async () => {
  request.resolve({ ok: true, json: async () => ({ items: [{ asset_code: name, name }] }) });
  await Promise.resolve();
});
(async () => {
  await React.act(async () => root.render(React.createElement(Probe)));
  await React.act(async () => state.setKeyword('old'));
  await wait();
  await React.act(async () => state.setKeyword('new'));
  assert.equal(requests[0].options.signal.aborted, true);
  await wait();
  await answer(requests[1], 'new');
  await answer(requests[0], 'old');
  assert.deepEqual(state.items.map(r => r.name), ['new'], 'late old response must not replace the latest result');
  await React.act(async () => state.setKeyword('pending'));
  assert.deepEqual(state.items, [], 'previous matches disappear immediately');
  await wait();
  await React.act(async () => state.setKeyword(''));
  await answer(requests[2], 'pending');
  assert.deepEqual(state.items, [], 'cleared search cannot be repopulated by stale response');
  assert.equal(state.loading, false);
  await React.act(async () => root.unmount());
  console.log('Equipment search UI: stale, replaced and cleared query tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
