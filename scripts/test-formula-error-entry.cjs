// TSX_TSCONFIG_PATH=client/tsconfig.app.json node --import tsx scripts/test-formula-error-entry.cjs
const assert = require('node:assert/strict');
const React = require('../client/node_modules/react');
const { renderToStaticMarkup } = require('../client/node_modules/react-dom/server');
const { compileGridFormula } = require('../shared/free-grid-excel-formula.ts');
const FormRenderer = require('../client/src/components/FormRenderer/index.tsx').default;
const table = { rows: [{ id: 'r' }], columns: ['a', 'b', 'c'].map(id => ({ id, label: '' })), cells: {}, input_cells: { 'r::a': true } };
table.cell_formulas = {
  'r::b': compileGridFormula(table, '=A1/0'),
  'r::c': compileGridFormula(table, '=IFERROR(B1,"请检查来源")'),
};
const field = { id: 'f', code: 'f', label: 'F', type: 'free_grid', free_table: table };
const template = { name: 'T', version: 1, groups: [{ id: 'g', label: 'G', fields: [field] }] };
const data = { f: { 'r::a': 5 } };
const before = JSON.stringify(data);
const render = data => renderToStaticMarkup(React.createElement(FormRenderer, { template, data, onChange() { throw Error('render must not write'); } }));
const html = render(data);
assert.ok(html.includes('请检查来源'));
assert.ok(html.includes('#DIV/0!'));
assert.ok(html.includes('除数为零'));
assert.ok(!html.includes('[object Object]'));
const fixed = render({ f: { ...data.f, '__formula_override__::r::b': { value: 12 } } });
assert.ok(!fixed.includes('>请检查来源</strong>'));
assert.ok(fixed.includes('>12</strong>'));
assert.equal(JSON.stringify(data), before);
console.log('Entry formula error propagation, tooltip and manual override passed');
