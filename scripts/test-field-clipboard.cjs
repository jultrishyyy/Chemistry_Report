// Component event/state regression, not browser DnD/positioning verification.
const assert = require('node:assert/strict');
const React = require('../client/node_modules/react');
const { Dropdown, Button, message } = require('../client/node_modules/antd');
const Editor = require('../client/src/components/FieldEditor/index.tsx').default;
const original = { state: React.useState, ref: React.useRef, effect: React.useEffect, memo: React.useMemo, storage: global.localStorage, window: global.window, success: message.success, warning: message.warning };
let slots = [], cursor = 0;
React.useState = initial => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; };
React.useRef = initial => React.useState(() => ({ current: initial }))[0];
React.useEffect = () => {}; React.useMemo = fn => fn();
global.localStorage = { getItem: () => null }; global.window = { innerWidth: 1200, innerHeight: 900, getSelection: () => null };
message.success = () => {}; message.warning = () => {};
function nodes(n) { return Array.isArray(n) ? n.flatMap(nodes) : n?.props ? [n, ...nodes(n.props.children)] : []; }
try {
  for (const editorMode of ['record', 'report-cover', 'report-project']) {
    slots = []; let changed;
    const field = { id: 'f', code: 'f', label: '内容', type: 'text', default_value: '保留' };
    const props = { editorMode, template: { id: 1, name: 'T', version: 1, groups: [{ id: 'g', label: 'G', fields: [field] }] }, onChange: v => { changed = v; } };
    const render = () => { cursor = 0; const inner = Editor(props).props.children; return inner.type(inner.props); };
    const menu = tree => nodes(tree).find(n => n.type === Dropdown && n.props.trigger?.includes('contextMenu'));
    let tree = render();
    menu(tree).props.menu.onClick({ key: 'copy', domEvent: { stopPropagation() {} } });
    tree = render(); assert.equal(menu(tree).props.menu.items[1].disabled, false);
    menu(tree).props.menu.onClick({ key: 'paste', domEvent: { stopPropagation() {} } });
    assert.equal(changed.groups[0].fields.length, 2);
    assert.notEqual(changed.groups[0].fields[1].code, 'f');
    assert.equal(changed.groups[0].fields[1].default_value, '保留');
    props.template = changed;
    tree = render();
    assert.ok(!nodes(tree).some(n => n.type === Button && n.props.children === '粘贴字段'));
    assert.equal(menu(tree).props.menu.items[1].label, '粘贴字段');
    nodes(tree).find(n => n.type === Dropdown && n.props.trigger?.includes('contextMenu') && n.props.menu.items.length === 1).props.menu.onClick({ domEvent: { stopPropagation() {} } });
    assert.equal(changed.groups[0].fields.length, 3);
    assert.equal(new Set(changed.groups[0].fields.map(f => f.id)).size, 3);
    props.template = changed; tree = render();
    const keyEvent = (key, editable = false, mac = false) => ({ key, ctrlKey: !mac, metaKey: mac,
      target: { closest: selector => selector === '[data-field-clipboard]' ? { dataset: { fieldClipboard: 'f' } } : selector === '[data-field-paste-group]' ? null : editable ? {} : null },
      preventDefault() { this.prevented = true; }, stopPropagation() {} });
    for (const mac of [false, true]) {
      tree.props.onKeyDown(keyEvent('c', false, mac)); tree = render();
      const event = keyEvent('v', false, mac); tree.props.onKeyDown(event);
      assert.equal(event.prevented, true);
      assert.equal(changed.groups[0].fields.length, props.template.groups[0].fields.length + 1);
      props.template = changed; tree = render();
    }
    const inputEvent = keyEvent('v', true); tree.props.onKeyDown(inputEvent);
    assert.equal(inputEvent.prevented, undefined, 'native text paste is not intercepted');
    props.readOnly = true; tree = render();
    assert.equal(menu(tree).props.menu.items[1].disabled, true);
    const readonlyEvent = keyEvent('v'); tree.props.onKeyDown(readonlyEvent);
    assert.equal(readonlyEvent.prevented, undefined);
    console.log(`${editorMode}: context-only paste, Ctrl/Cmd shortcuts, native text clipboard and readonly passed`);
  }
} finally {
  React.useState = original.state; React.useRef = original.ref; React.useEffect = original.effect; React.useMemo = original.memo;
  global.localStorage = original.storage; global.window = original.window; message.success = original.success; message.warning = original.warning;
}
