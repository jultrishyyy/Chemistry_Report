// TSX_TSCONFIG_PATH=client/tsconfig.app.json node --import tsx scripts/test-free-grid-template-regressions.cjs
const assert = require('node:assert/strict');
const { JSDOM } = require('../client/node_modules/jsdom');
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  pretendToBeVisual: true, url: 'http://localhost',
});
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement',
  'Element', 'Node', 'MutationObserver', 'getComputedStyle', 'ShadowRoot', 'SVGElement', 'HTMLBodyElement', 'HTMLHtmlElement']) {
  Object.defineProperty(global, key, { configurable: true, value: dom.window[key] });
}
global.requestAnimationFrame = window.requestAnimationFrame.bind(window);
global.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
global.IS_REACT_ACT_ENVIRONMENT = true;
global.ResizeObserver = window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
require.extensions['.css'] = () => {};
const React = require('../client/node_modules/react');
const { createRoot } = require('../client/node_modules/react-dom/client');
const Canvas = require('../client/src/components/FieldEditor/MatrixEditor/FreeGridCanvas.tsx').default;
const FormRenderer = require('../client/src/components/FormRenderer/index.tsx').default;
const NumberSettings = require('../client/src/components/FreeGridNumberSettings.tsx').default;
const { resolveReportFreeGridValues } = require('../shared/typst-generator.ts');
const { buildFieldDefaults } = require('../shared/matrix-flatten.ts');
const root = createRoot(document.getElementById('root'));
let saved;
function Harness({ initial }) {
  const [field, setField] = React.useState(initial);
  saved = field;
  return React.createElement(Canvas, {
    field, template: { groups: [{ id: 'g', label: 'G', fields: [field] }] },
    onChange: patch => setField(current => ({ ...current, ...patch })),
  });
}
let entered;
function EntryHarness({ template, initial }) {
  const [data, setData] = React.useState(initial);
  entered = data;
  return React.createElement(FormRenderer, { template, data, onChange: setData });
}
async function mouse(node, type, extra = {}) {
  assert.ok(node, `Missing mouse target: ${type}`);
  await React.act(async () => node.dispatchEvent(new window.MouseEvent(type, {
    bubbles: true, cancelable: true, button: 0, ...extra,
  })));
}
async function fill(node, value) {
  assert.ok(node, 'Missing input');
  await React.act(async () => {
    const prototype = node.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, value);
    node.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}
const cell = address => document.querySelector(`[data-grid-cell="${address}"]`);
const formulaInput = () => document.querySelector('[aria-label="单元格公式"]');
async function select(address, extra) {
  await mouse(cell(address), 'mousedown', extra);
  await mouse(window, 'mouseup');
}
async function saveFormula(text) {
  await fill(formulaInput(), text);
  await React.act(async () => formulaInput().dispatchEvent(new window.KeyboardEvent('keydown', {
    key: 'Enter', bubbles: true, cancelable: true,
  })));
}
async function openSelect(label) {
  await mouse(document.querySelector(`[aria-label="${label}"]`), 'mousedown');
}
async function choose(label, title) {
  await openSelect(label);
  await mouse(document.querySelector(`.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title="${title}"]`), 'click');
}
function checkRoundingOptions(label) {
  const input = document.querySelector(`[aria-label="${label}"]`);
  const popup = document.getElementById(input.getAttribute('aria-controls')).closest('.ant-select-dropdown');
  const options = [...popup.querySelectorAll('.ant-select-item-option')];
  assert.ok(options.length >= 7, 'rounding options are visible');
  const selectable = options.filter(option => !option.classList.contains('ant-select-item-option-disabled')).map(option => option.title);
  assert.deepEqual(selectable, ['不修约', '四舍六入五单双（五成双）', '直接截尾', '向上修约', '间隔 2（五成双）', '间隔 5（五成双）', '按数值区间修约']);
}
(async () => {
  try {
    for (const span of [{ colspan: 2 }, { rowspan: 2 }, { rowspan: 2, colspan: 2 }]) {
      const initial = { id: 'f', code: 'f', type: 'free_grid', label: 'Grid', free_table: {
        rows: ['r1', 'r2', 'r3'].map(id => ({ id })),
        columns: ['a', 'b', 'c'].map(id => ({ id, label: '' })),
        cells: { 'r1::c': '2', 'r2::c': '3' },
        spans: { 'r1::a': span },
      } };
      await React.act(async () => root.render(React.createElement(Harness, { key: JSON.stringify(span), initial })));
      await select('0-0');
      assert.equal(formulaInput().disabled, false, 'a merged cell is one editable formula target');
      await saveFormula('=SUM(C1:C2)');
      assert.deepEqual(saved.free_table.cell_formulas['r1::a'].sources, ['r1::c', 'r2::c']);
      assert.deepEqual(saved.free_table.spans['r1::a'], span, 'formula editing retains merge geometry');
      const restored = JSON.parse(JSON.stringify(saved));
      assert.equal(resolveReportFreeGridValues(restored, restored.free_table)['r1::a'], '5');
      await select('2-2');
      await select('0-0');
      assert.equal(formulaInput().value, '=SUM(C1,C2)', 'saved merged formula can reopen');
      await saveFormula('=C1*4');
      assert.equal(resolveReportFreeGridValues(saved, saved.free_table)['r1::a'], '8');
      await select('2-2', { shiftKey: true });
      assert.equal(formulaInput().disabled, true, 'multiple logical cells must not share a formula target');
    }
    console.log('Merged cell formulas: horizontal, vertical, rectangle, save/reopen, evaluation and multi-cell guard passed');
    const initial = { id: 'text', code: 'text', label: 'Text', type: 'free_grid', free_table: {
      rows: [{ id: 'r' }], columns: [{ id: 'a', label: '' }], cells: {},
      input_cells: { 'r::a': true }, cell_types: { 'r::a': 'text' },
      default_number_fmt: { mode: 'decimals', digits: 0 }, default_rounding: { mode: 'half_up' },
    } };
    await React.act(async () => root.render(React.createElement(Harness, { key: 'text', initial })));
    await mouse(cell('0-0'), 'dblclick');
    await fill(document.querySelector('[aria-label="默认填写内容"]'), '001.20\nEngineer default');
    assert.equal(saved.free_table.cells['r::a'], '001.20\nEngineer default');
    assert.ok(cell('0-0').textContent.includes('Engineer default'));
    const configured = JSON.parse(JSON.stringify(saved));
    await choose('单元格数据类型', '数字');
    assert.equal(document.querySelector('[aria-label="默认填写内容"]'), null);
    assert.equal(saved.free_table.cells['r::a'], undefined, 'switching to measurements removes text defaults');
    await openSelect('单元格修约方式');
    checkRoundingOptions('单元格修约方式');
    assert.ok(document.querySelector('.ant-select-item-option-disabled[title="四舍五入（历史配置）"]'));
    await mouse(document.body, 'mousedown');
    await openSelect('整表修约方式');
    checkRoundingOptions('整表修约方式');
    await mouse(document.body, 'mousedown');
    const template = { name: 'T', version: 1, groups: [{ id: 'g', label: 'G', fields: [configured] }] };
    for (const raw of [{}, buildFieldDefaults(template)]) {
      await React.act(async () => root.render(React.createElement(EntryHarness, { key: `entry-${Object.keys(raw).length}`, template, initial: raw })));
      let input = document.querySelector('td textarea:not([aria-hidden])');
      assert.equal(input.value, '001.20\nEngineer default');
      await fill(input, 'Changed by engineer');
      assert.equal(entered.text['r::a'], 'Changed by engineer');
      await fill(input, '');
      assert.equal(entered.text['r::a'], '');
      const restored = JSON.parse(JSON.stringify(entered));
      await React.act(async () => root.render(React.createElement(EntryHarness, { key: `restored-${Object.keys(raw).length}`, template, initial: restored })));
      input = document.querySelector('td textarea:not([aria-hidden])');
      assert.equal(input.value, '', 'save/reload preserves explicit clearing');
    }
    await React.act(async () => root.render(React.createElement(NumberSettings, {
      table: configured.free_table, cellKeys: ['r::a'], onChange: () => {},
    })));
    await mouse(document.querySelector('button'), 'click');
    await openSelect('修约方式');
    checkRoundingOptions('修约方式');
    console.log('Text default configuration, type switch, entry/edit/clear/reload and all rounding selectors passed');
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
  }
})().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
