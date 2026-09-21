// Run: node node_modules/tsx/dist/cli.mjs --tsconfig client/tsconfig.app.json scripts/test-equipment-detail-ui.cjs
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const clientRequire = createRequire(require.resolve('../client/package.json'));
const { JSDOM } = clientRequire('jsdom');
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'SVGElement', 'ShadowRoot']) {
  Object.defineProperty(global, key, { configurable: true, value: dom.window[key] });
}
const getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
// JSDOM does not implement pseudo-element styles used by the modal scrollbar check.
window.getComputedStyle = element => getComputedStyle(element);
global.getComputedStyle = window.getComputedStyle;
window.matchMedia = query => ({
  matches: false, media: query, addListener() {}, removeListener() {},
  addEventListener() {}, removeEventListener() {},
});
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = clientRequire('react');
const { createRoot } = clientRequire('react-dom/client');
const { ConfigProvider } = clientRequire('antd');
const axios = clientRequire('axios');
const EquipmentLibrary = require('../client/src/pages/Equipment/Library.tsx').default;
const devices = [
  { id: 1, asset_code: 'EQ-1', name: 'Device one', model: 'Model A' },
  { id: 2, asset_code: 'EQ-2', name: 'Device two', model: 'Model B' },
];
const requests = [];
const originalGet = axios.get;
axios.get = (url, options) => {
  if (url === '/api/equipment') return Promise.resolve({ data: { items: devices, total: devices.length } });
  return new Promise((resolve, reject) => requests.push({ url, options, resolve, reject }));
};
const root = createRoot(document.getElementById('root'));
const click = selector => React.act(async () => {
  const button = document.querySelector(selector);
  assert.ok(button, `Missing button: ${selector}`);
  button.click();
});
const open = code => click(`[aria-label="查看设备详情：${code}"]`);
const close = () => click('.ant-modal-close');
const answer = (request, data) => React.act(async () => request.resolve({ data }));
const dialog = () => document.querySelector('[role="dialog"]');
const values = () => Array.from(dialog().querySelectorAll('.ant-descriptions-item-content'), element => element.textContent);
const labels = () => Array.from(dialog().querySelectorAll('.ant-descriptions-item-label'), element => element.textContent);

(async () => {
  try {
    await React.act(async () => root.render(React.createElement(ConfigProvider, { theme: { token: { motion: false } } },
      React.createElement(EquipmentLibrary))));
    await open('EQ-1');
    assert.equal(requests[0].url, '/api/equipment/1', 'view must fetch the detail endpoint, not reuse the summary row');
    assert.ok(dialog().querySelector('[role="status"]'), 'show loading while waiting for details');
    const body = dialog().querySelector('.ant-modal-body');
    assert.equal(body.style.overflowY, 'auto', 'long details must scroll inside the modal');
    assert.equal(body.style.maxHeight, 'calc(100dvh - 140px)', 'detail height must follow the viewport');
    const raw = {
      管理编号: 'EQ-1', 仪器名称: 'Device one', 生产厂家: 'Additional Excel field',
      备注: null, 空字符串: '', 数量: 0, 启用: false,
      富文本: { richText: [{ text: 'First ' }, { text: 'second' }] },
    };
    await answer(requests[0], { ...devices[0], raw_payload: raw });
    assert.deepEqual(labels(), Object.keys(raw), 'include every imported column, including blank columns');
    assert.deepEqual(values(), ['EQ-1', 'Device one', 'Additional Excel field', '—', '—', '0', 'false', 'First second']);
    await close();

    for (const raw_payload of [null, {}]) {
      await open('EQ-2');
      await answer(requests.at(-1), { ...devices[1], raw_payload });
      assert.equal(labels().length, 10, 'legacy devices without raw data show the ten known fields');
      assert.ok(values().includes('EQ-2'));
      assert.ok(dialog().textContent.includes('未保留 Excel 原始字段'));
      await close();
    }

    await open('EQ-1');
    await React.act(async () => requests.at(-1).reject(new Error('Network unavailable')));
    assert.ok(dialog().textContent.includes('设备详情加载失败'));
    assert.ok(dialog().textContent.includes('Network unavailable'));
    assert.equal(dialog().querySelector('.ant-descriptions'), null, 'errors must not masquerade as complete details');
    await click('.ant-alert-actions button');
    assert.ok(dialog().querySelector('[role="status"]'));
    await answer(requests.at(-1), { ...devices[0], raw_payload: raw });
    assert.ok(values().includes('Additional Excel field'), 'retry loads the original fields');
    await close();

    await open('EQ-1');
    await React.act(async () => requests.at(-1).reject(new axios.AxiosError(
      'Request failed', undefined, undefined, undefined, { status: 404, data: { error: 'Not found' } },
    )));
    assert.ok(dialog().textContent.includes('该设备不存在或已被删除'));
    await close();

    await open('EQ-1');
    const stale = requests.at(-1);
    await close();
    assert.equal(stale.options.signal.aborted, true, 'closing cancels the pending detail request');
    await open('EQ-2');
    await answer(requests.at(-1), { ...devices[1], raw_payload: { 管理编号: 'EQ-2', 备注: 'Latest device' } });
    await answer(stale, { ...devices[0], raw_payload: raw });
    assert.deepEqual(values(), ['EQ-2', 'Latest device'], 'a late response must not replace the newly opened device');
    await close();

    await open('EQ-1');
    const pending = requests.at(-1);
    await React.act(async () => root.unmount());
    assert.equal(pending.options.signal.aborted, true, 'leaving the page cancels detail loading');
    console.log('Equipment details: endpoint, all Excel columns, blanks, zero/false, rich text, legacy fallback, errors, retry, 404 and cancellation passed.');
  } finally {
    await React.act(async () => root.unmount());
    axios.get = originalGet;
    dom.window.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
