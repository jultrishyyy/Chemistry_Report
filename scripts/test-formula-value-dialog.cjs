// Component state regression; does not replace browser layout verification.
const assert = require('node:assert/strict');
const React = require('../client/node_modules/react');
const { Button, Modal, Input } = require('../client/node_modules/antd');
const FormRenderer = require('../client/src/components/FormRenderer/index.tsx').default;
const original = { state: React.useState, ref: React.useRef, effect: React.useEffect };
let slots = [], cursor = 0, changed;
React.useState = initial => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; };
React.useRef = initial => React.useState(() => ({ current: initial }))[0];
React.useEffect = () => {};
function nodes(n) { return Array.isArray(n) ? n.flatMap(nodes) : n?.props ? [n, ...nodes(n.props.children)] : []; }
function text(n) { return Array.isArray(n) ? n.map(text).join('') : n?.props ? text(n.props.children) : typeof n === 'string' || typeof n === 'number' ? String(n) : ''; }
try {
  const table = { rows: [{ id: 's' }], columns: [{ id: 'input' }, { id: 'result' }], cells: {}, input_cells: { 's::input': true },
    cell_formulas: { 's::result': { type: 'custom', sources: ['s::input'], expression: 'A1 * 2', params: { source_aliases: { 's::input': 'A1' } } } } };
  const field = { id: 'f', code: 'f', label: 'F', type: 'free_grid', free_table: table };
  const raw = { 's::input': 12.3456, '__formula_override__::s::result': { value: '99', calculated_value: 1 } };
  const tree = FormRenderer({ template: { groups: [{ id: 'g', fields: [field] }] }, data: { f: raw }, onChange: v => { changed = v; } });
  const cell = nodes(tree).find(n => n.type?.name === 'ConfirmableFormulaValue');
  assert.ok(cell);
  assert.equal(cell.props.label, 'B1');
  assert.equal(cell.props.formulaText, '=A1 * 2');
  assert.equal(cell.props.automaticValue, 24.6912, 'auto value is recalculated, not the manual value or saved old calculation');
  slots = []; const render = () => { cursor = 0; return cell.type(cell.props); };
  let dialogTree = render();
  const button = nodes(dialogTree).find(n => n.type === Button);
  assert.equal(text(button), '99ƒ*');
  button.props.onClick(); dialogTree = render();
  const modal = nodes(dialogTree).find(n => n.type === Modal);
  assert.equal(modal.props.open, true);
  assert.ok(text(modal).includes('公式格：B1'));
  assert.ok(text(modal).includes('=A1 * 2'));
  assert.ok(text(modal).includes('公式自动计算结果：24.6912'));
  nodes(dialogTree).find(n => n.type === Input).props.onChange({ target: { value: '88' } });
  nodes(render()).find(n => n.type === Modal).props.onOk();
  assert.equal(changed.f['__formula_override__::s::result'].value, '88');
  assert.equal(changed.f['__formula_override__::s::result'].calculated_value, 24.6912);
  assert.equal(raw['s::input'], 12.3456);
  console.log('Formula value: compact marker, readable formula, current automatic result and correction audit passed');
} finally {
  React.useState = original.state; React.useRef = original.ref; React.useEffect = original.effect;
}
