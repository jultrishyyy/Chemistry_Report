// Static component regression; browser interactions need a separate acceptance pass.
// TSX_TSCONFIG_PATH=client/tsconfig.app.json node --import tsx scripts/test-report-mapping-view.cjs
const assert = require('node:assert/strict');
const React = require('../client/node_modules/react');
const { renderToStaticMarkup } = require('../client/node_modules/react-dom/server');
const FreeGridCanvas = require('../client/src/components/FieldEditor/MatrixEditor/FreeGridCanvas.tsx').default;
const { buildProjectGroupsFromRecord } = require('../shared/report-inherit.ts');

for (const axis of ['row', 'col']) {
  const ft = {
    rows: [{ id: 'a' }, { id: 'b' }], columns: [{ id: 'x', label: '' }, { id: 'y', label: '' }], cells: {},
    input_cells: { 'a::x': true, 'b::x': true, 'a::y': true, 'b::y': true },
    sample_bands: [{ id: 's', axis, refs: axis === 'row' ? ['a', 'b'] : ['x', 'y'] }],
  };
  const field = { id: 'f', code: 'f', label: 'Source', type: 'free_grid', free_table: ft };
  const record = { groups: [{ id: 'g', label: 'G', layout: 'vertical', fields: [field] }] };
  const report = buildProjectGroupsFromRecord(record).groups[0].fields[0];
  const original = JSON.stringify({ record, report });
  const render = () => renderToStaticMarkup(React.createElement(FreeGridCanvas, {
    field: report, linkedRecord: record, editorMode: 'report-project', onChange: () => {},
  }));
  const mapped = render();
  assert.ok(mapped.includes('选择来源'));
  assert.ok(!mapped.includes('按每个试样取值'));
  assert.ok(!mapped.includes('转置'));
  const recordHtml = renderToStaticMarkup(React.createElement(FreeGridCanvas, {
    field, template: record, editorMode: 'record', onChange: () => {},
  }));
  assert.ok(!recordHtml.includes('转置'));
  assert.ok(!recordHtml.includes('设为试样区'));
  assert.ok(recordHtml.includes('清除试样区域'));
  const emptyBandHtml = renderToStaticMarkup(React.createElement(FreeGridCanvas, {
    field: { ...field, free_table: { ...ft, sample_bands: undefined } }, template: record, editorMode: 'record', onChange: () => {},
  }));
  assert.ok(emptyBandHtml.includes('设为试样区'));
  assert.ok(!emptyBandHtml.includes('清除试样区域'));
  assert.equal(JSON.stringify({ record, report }), original, 'loading either orientation must preserve saved layout and bindings');
  assert.equal((mapped.match(/data-grid-cell=/g) || []).length, 4);
  delete report.free_table.cell_bindings['a::x'];
  assert.equal((render().match(/data-grid-cell=/g) || []).length, 4, 'clearing a source must not change geometry');
  report.free_table.spans = { 'a::x': { rowspan: 2, colspan: 1 } };
  assert.equal((render().match(/data-grid-cell=/g) || []).length, 3, 'actual merges must still render');
  console.log(`${axis}: source controls and actual merge geometry passed`);
}
