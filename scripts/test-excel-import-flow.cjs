// Component event/state regression without a browser DOM.
// TSX_TSCONFIG_PATH=client/tsconfig.app.json node --import tsx scripts/test-excel-import-flow.cjs
const assert = require('node:assert/strict');
const React = require('../client/node_modules/react');
const axios = require('../client/node_modules/axios').default;
const Wizard = require('../client/src/components/ExcelImportWizard.tsx').default;
const SourcePreview = require('../client/src/components/ExcelSheetPreview.tsx').default;
const { Modal, Button, Upload, Tabs, Checkbox } = require('../client/node_modules/antd');
const originals = { useState: React.useState, useRef: React.useRef, useMemo: React.useMemo, post: axios.post };
let slots = [], cursor = 0, writes = [];
React.useState = initial => {
  const index = cursor++;
  if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
  return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
};
React.useRef = initial => React.useState(() => ({ current: initial }))[0];
React.useMemo = callback => callback();
const field = { id: 'f', code: 'f', label: '结果', type: 'free_grid', free_table: {
  rows: [{ id: 'h' }, { id: 'a' }], columns: [{ id: 'x', label: '长度' }],
  cells: { 'h::x': '长度' }, header_cells: { 'h::x': true }, input_cells: { 'a::x': true },
  excel_import: { enabled: true, mode: 'auto', sheet_name: '' },
} };
const sheet = name => ({ name, grid: [['长度'], [12]], merges: [], blocked: [], notices: [] });
let simulated;
const props = { fields: [field], data: {}, onApply: update => writes.push(update), renderPreview: (_, value) => { simulated = value; return null; } };
function render() { cursor = 0; return Wizard(props); }
function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== 'object' || !node.props) return [];
  return [node, ...nodes(node.props.children), ...(node.type === Tabs ? node.props.items.flatMap(item => nodes(item.children)) : [])];
}
const find = (tree, type, predicate = () => true) => nodes(tree).find(node => node.type === type && predicate(node.props));
const button = (tree, label) => find(tree, Button, props => props.children === label);
const visibleModal = tree => find(tree, Modal, props => props.open);
async function upload(sheets) {
  slots = []; writes = [];
  axios.post = async () => ({ data: { sheets } });
  const file = new Blob(['fixture']); file.name = 'fixture.xlsx';
  find(render(), Upload).props.beforeUpload(file);
  await new Promise(resolve => setImmediate(resolve));
  return render();
}
(async () => {
  try {
    let tree = await upload([sheet('Data')]);
    assert.equal(visibleModal(tree).props.title, '选择导入方式');
    assert.equal(writes.length, 0);
    button(tree, '直接导入').props.onClick();
    button(tree, '直接导入').props.onClick();
    assert.equal(writes.length, 1, 'direct import commits once without per-table review');
    assert.equal(visibleModal(render()), undefined);

    tree = await upload([sheet('Data')]);
    button(tree, '核对导入信息').props.onClick(); tree = render();
    assert.equal(writes.length, 0, 'opening review does not write');
    assert.ok(!visibleModal(tree).props.okButtonProps?.disabled);
    assert.equal(nodes(tree).filter(node => node.type === Checkbox).length, 0, 'no per-table confirmation checkbox');
    button(tree, '跳过此表格').props.onClick(); tree = render();
    visibleModal(tree).props.onOk();
    assert.equal(writes.length, 0, 'all skipped cannot write');
    button(render(), '恢复导入此表格').props.onClick(); tree = render();
    visibleModal(tree).props.onOk(); assert.equal(writes.length, 1);

    tree = await upload([sheet('A'), sheet('B')]);
    button(tree, '直接导入').props.onClick(); tree = render();
    assert.equal(writes.length, 0, 'ambiguous Sheet never silently imports');
    assert.notEqual(visibleModal(tree).props.title, '选择导入方式', 'missing assignment opens review');
    visibleModal(tree).props.onCancel(); assert.equal(visibleModal(render()), undefined);
    tree = await upload([{ ...sheet('Data'), grid: [['长度'], [12.3456], [''], ['长度'], [25.6789]] }]);
    button(tree, '核对导入信息').props.onClick(); tree = render();
    find(tree, SourcePreview).props.onPick({ r0: 4, r1: 4, c0: 0, c1: 0 }); tree = render();
    assert.equal(simulated.f['a::x'], 25.6789, 'reselection refreshes the target preview immediately');
    assert.equal(writes.length, 0, 'live target preview does not commit data');
    console.log('Excel import flow: chooser, direct commit, duplicate guard, review, skip/restore, missing Sheet and cancel passed');
  } finally { Object.assign(React, { useState: originals.useState, useRef: originals.useRef, useMemo: originals.useMemo }); axios.post = originals.post; }
})().catch(error => { console.error(error); process.exitCode = 1; });
