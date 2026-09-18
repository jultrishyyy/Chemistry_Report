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

// Empty cells use one icon; text (including a unit-only header) is rendered once.
{
  const ft = {
    rows: [{ id: 'r' }], columns: ['a', 'b', 'c', 'd'].map(id => ({ id, label: '' })),
    cells: { 'r::b': '普通文字唯一', 'r::c': '单位表头唯一', 'r::d': '公式文字唯一' },
    header_cells: { 'r::c': true },
    cell_unit_bindings: { 'r::c': { source: 'literal', text: 'mm' } },
    cell_bindings: { 'r::d': { source: 'record_free_formula_cell', field_code: 'source', cell_key: 'r::d' } },
  };
  const source = { id: 's', code: 'source', type: 'free_grid', label: '来源', free_table: { ...ft, header_cells: {}, cell_bindings: {}, cell_formulas: { 'r::d': { type: 'sum', sources: [] } } } };
  const html = renderToStaticMarkup(React.createElement(FreeGridCanvas, {
    field: { id: 't', code: 'target', type: 'free_grid', free_table: ft },
    linkedRecord: { groups: [{ id: 'g', fields: [source] }] }, editorMode: 'report-project', onChange: () => {},
  }));
  assert.equal((html.match(/aria-label="添加映射"/g) || []).length, 1);
  assert.ok(html.includes('data-report-sample-region-toolbar'));
  assert.ok(html.includes('设为试样区'));
  assert.ok(!html.includes('点击添加映射'));
  assert.ok(!html.includes('添加内容映射'));
  for (const text of ['普通文字唯一', '单位表头唯一', '公式文字唯一']) assert.equal(html.split(text).length - 1, 1, text);
  console.log('minimal mapping placeholders and single text rendering passed');
}
