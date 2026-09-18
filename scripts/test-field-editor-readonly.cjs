const assert = require('node:assert/strict');
const { JSDOM } = require('../client/node_modules/jsdom');
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'ShadowRoot', 'getComputedStyle']) {
  Object.defineProperty(global, key, { configurable: true, value: dom.window[key] });
}
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('../client/node_modules/react');
const { createRoot } = require('../client/node_modules/react-dom/client');
const { Button, Input } = require('../client/node_modules/antd');
const Boundary = require('../client/src/components/FieldEditor/ReadOnlyEditorContent.tsx').default;
let writes = 0;
function Settings() {
  const [open, setOpen] = React.useState(false);
  return React.createElement(React.Fragment, null,
    React.createElement(Input, { value: '试样区域', onChange: () => writes++ }),
    React.createElement(Button, { onClick: () => { writes++; setOpen(true); } }, '设置'),
    open && React.createElement('span', { 'data-pending': true }, '临时配置'));
}
const root = createRoot(document.getElementById('root'));
const render = readOnly => React.act(async () => root.render(React.createElement(Boundary, { readOnly }, React.createElement(Settings))));
(async () => {
  await render(true);
  assert.ok(document.querySelector('[inert]'), 'native grid interactions must be inert');
  assert.equal(document.querySelector('input').disabled, true);
  assert.equal(document.querySelector('button').disabled, true);
  await React.act(async () => document.querySelector('button').click());
  assert.equal(writes, 0, 'readonly buttons cannot edit or show success');
  await render(false);
  assert.equal(document.querySelector('[inert]'), null);
  assert.equal(document.querySelector('button').disabled, false);
  await React.act(async () => document.querySelector('button').click());
  assert.equal(writes, 1);
  assert.ok(document.querySelector('[data-pending]'));
  await render(true);
  assert.equal(document.querySelector('[data-pending]'), null, 'loss of edit permission must discard pending editor state');
  assert.equal(document.querySelector('button').disabled, true);
  await React.act(async () => root.unmount());
  console.log('Readonly field settings: disabled controls, inert grid, edit unlock and permission-loss reset passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
