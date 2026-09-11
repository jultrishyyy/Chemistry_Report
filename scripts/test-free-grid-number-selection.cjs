// Component state and real outside-click handler regression (no browser DOM).
// TSX_TSCONFIG_PATH=client/tsconfig.app.json node --import tsx scripts/test-free-grid-number-selection.cjs
const assert = require('node:assert/strict');
const React = require('../client/node_modules/react');
const FormRenderer = require('../client/src/components/FormRenderer/index.tsx').default;
const Settings = require('../client/src/components/FreeGridNumberSettings.tsx').default;
const { Select } = require('../client/node_modules/antd');
const originals = { useState: React.useState, useEffect: React.useEffect, useRef: React.useRef, document: global.document, window: global.window };
const selected = { fieldCode: 'f', r0: 0, r1: 0, c0: 0, c1: 0 };
let slots = [null, 'f', selected], cursor = 0, effects = [], changed;
const handlers = {};
React.useState = initial => {
  const index = cursor++;
  if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
  return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
};
React.useRef = initial => React.useState(() => ({ current: initial }))[0];
React.useEffect = callback => { effects.push(callback); };
global.document = { addEventListener: (name, handler) => { handlers[name] = handler; }, removeEventListener: () => {}, querySelectorAll: () => [] };
global.window = { addEventListener: () => {}, removeEventListener: () => {} };
function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== 'object' || !node.props) return [];
  return [node, ...nodes(node.props.children), ...nodes(node.props.content)];
}
try {
  const table = { rows: [{ id: 'r' }], columns: [{ id: 'c' }], cells: {}, input_cells: { 'r::c': true } };
  const field = { id: 'f', code: 'f', label: 'F', type: 'free_grid', free_table: table };
  const props = { template: { groups: [{ id: 'g', label: 'G', fields: [field] }] }, data: { f: { 'r::c': 1.2345 } }, onChange: value => { changed = value; } };
  let tree = FormRenderer(props);
  effects[0]();
  const click = className => handlers.mousedown({ target: { closest: selector => selector.split(',').map(s => s.trim()).includes(className) ? {} : null } });
  click('.free-grid-number-settings-popup');
  assert.deepEqual(slots[2], selected, 'clicking popover controls preserves selection');
  click('.ant-select-dropdown');
  assert.deepEqual(slots[2], selected, 'clicking a portal dropdown option preserves selection');
  cursor = 0; effects = []; tree = FormRenderer(props);
  const settings = nodes(tree).find(node => node.type === Settings);
  assert.deepEqual(settings.props.cellKeys, ['r::c']);
  const state = React.useState;
  React.useState = () => ['selection', () => {}];
  const popup = Settings(settings.props);
  React.useState = state;
  nodes(popup).find(node => node.type === Select && node.props['aria-label'] === '数字格式').props.onChange('decimals');
  assert.deepEqual(changed.f.__free_table_structure__.cell_number_fmt['r::c'], { mode: 'decimals', digits: 2 });
  assert.equal(changed.f['r::c'], 1.2345, 'editing format preserves source value');
  click('.outside');
  assert.equal(slots[2], null, 'real outside clicks still clear selection');
  console.log('Popover and dropdown selection retention, applying format, raw precision and outside-clear passed');
} finally {
  React.useState = originals.useState; React.useEffect = originals.useEffect; React.useRef = originals.useRef;
  global.document = originals.document; global.window = originals.window;
}
