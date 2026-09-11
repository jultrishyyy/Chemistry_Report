// TSX_TSCONFIG_PATH=client/tsconfig.app.json node --import tsx scripts/test-entry-grid-coordinates.cjs
const assert = require('node:assert/strict');
const React = require('../client/node_modules/react');
const { renderToStaticMarkup } = require('../client/node_modules/react-dom/server');
const FormRenderer = require('../client/src/components/FormRenderer/index.tsx').default;
for (const axis of [null, 'row', 'col']) {
  const table = {
    rows: [{ id: 'r' }, { id: 'tail' }],
    columns: Array.from({ length: 27 }, (_, i) => ({ id: `c${i}`, label: '' })),
    cells: { 'r::c0': '原表头' }, header_cells: { 'r::c0': true },
    input_cells: { 'tail::c1': true }, spans: { 'r::c0': { colspan: 2 } },
    ...(axis ? { sample_bands: [{ id: 's', axis, refs: [axis === 'row' ? 'tail' : 'c26'] }] } : {}),
  };
  const field = { id: 'f', code: 'f', label: 'F', type: 'free_grid', free_table: table };
  const data = { f: { '__sample_count__::s': 2 } };
  const snapshot = JSON.stringify({ table, data });
  const html = renderToStaticMarkup(React.createElement(FormRenderer, {
    template: { groups: [{ id: 'g', fields: [field] }] }, data,
    onChange: () => { throw Error('coordinate rendering must not write data'); },
  }));
  assert.equal((html.match(/data-grid-column=/g) || []).length, axis === 'col' ? 28 : 27);
  assert.equal((html.match(/data-grid-row=/g) || []).length, axis === 'row' ? 3 : 2);
  assert.ok(html.includes('data-grid-column="A"'));
  assert.ok(html.includes('data-grid-column="AA"'));
  assert.ok(html.includes('data-grid-row="1"'));
  assert.ok(html.includes('colSpan="2"') || html.includes('colspan="2"'));
  assert.ok(html.includes('原表头'));
  for (const legend of ['数字录入', '文字录入', '选择录入', '固定文字', '公式（点击可修正）']) {
    assert.ok(!html.includes(legend), `entry legend removed: ${legend}`);
  }
  assert.equal(JSON.stringify({ table, data }), snapshot);
  console.log(`${axis || 'plain'}: column letters, row numbers, sample expansion and merged cells passed`);
}
