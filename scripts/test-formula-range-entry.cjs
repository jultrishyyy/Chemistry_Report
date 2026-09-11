// TSX_TSCONFIG_PATH=client/tsconfig.app.json node --import tsx scripts/test-formula-range-entry.cjs
const assert = require('node:assert/strict');
const React = require('../client/node_modules/react');
const { renderToStaticMarkup } = require('../client/node_modules/react-dom/server');
const FormRenderer = require('../client/src/components/FormRenderer/index.tsx').default;
for (const axis of ['row', 'col']) {
  const ft = {
    rows: [{ id: 'a' }, { id: 'b' }, { id: 'total' }],
    columns: [{ id: 'x', label: '' }], cells: {}, input_cells: { 'a::x': true, 'b::x': true },
    sample_bands: [{ id: 's', axis, refs: ['a', 'b'] }],
    cell_formulas: { 'total::x': { type: 'sum', sources: ['a::x', 'b::x'] } },
  };
  const key = k => axis === 'row' ? k : k.split('::').reverse().join('::');
  if (axis === 'col') {
    ft.rows = [{ id: 'x' }]; ft.columns = ['a', 'b', 'total'].map(id => ({ id, label: '' }));
    ft.input_cells = { 'x::a': true, 'x::b': true };
    ft.cell_formulas = { 'x::total': { type: 'sum', sources: ['x::a', 'x::b'] } };
  }
  const field = { id: 'f', code: 'f', label: 'F', type: 'free_grid', free_table: ft };
  const template = { groups: [{ id: 'g', label: 'G', fields: [field] }] };
  const raw = { '__sample_axes__::s': [{ ref: 'a', sample: 0 }, { ref: 'b', sample: 0 }, { ref: 'b', sample: 1 }],
    [`${key('a::x')}::s0`]: 11, [`${key('b::x')}::s0`]: 12, [`${key('b::x')}::s1`]: 100 };
  for (const [scope, expected] of [['selected', '23'], ['all', '123']]) {
    ft.cell_formulas[key('total::x')].sample_scope = scope;
    const snapshot = JSON.stringify(raw);
    const html = renderToStaticMarkup(React.createElement(FormRenderer, { template, data: { f: raw }, onChange: () => { throw Error('render must not write'); } }));
    assert.ok(html.includes(`<strong>${expected}</strong>`), `${axis}/${scope}: unconfigured formula must retain its value without implicit decimals`);
    assert.equal(JSON.stringify(raw), snapshot);
  }
  console.log(`${axis}: fixed/dynamic formula entry rendering passed`);
}
