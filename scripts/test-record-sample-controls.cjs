// TSX_TSCONFIG_PATH=client/tsconfig.app.json node --import tsx scripts/test-record-sample-controls.cjs
const assert = require('node:assert/strict');
const React = require('../client/node_modules/react');
const { renderToStaticMarkup } = require('../client/node_modules/react-dom/server');
const FormRenderer = require('../client/src/components/FormRenderer/index.tsx').default;
const { buildFieldDefaults } = require('../shared/matrix-flatten.ts');
const { editSampleAxes } = require('../shared/free-grid-samples.ts');
for (const axis of ['row', 'col']) {
 for (const partial of [false, true]) {
  const field = { id: 'f', code: 'f', label: 'Grid', type: 'free_grid', free_table: {
    rows: [{ id: 'a' }, { id: 'b' }], columns: [{ id: 'x', label: '' }, { id: 'y', label: '' }], cells: {},
    input_cells: { 'a::x': true, 'b::x': true, 'a::y': true, 'b::y': true },
    sample_bands: [{ id: 's', axis, refs: axis === 'row' ? ['a', 'b'] : ['x', 'y'],
      ...(partial ? { cross_refs: axis === 'row' ? ['x'] : ['a'] } : {}) }],
  } };
  if (partial) {
    field.free_table.rows.unshift({ id: 'before' });
    field.free_table.rows.push({ id: 'after' });
    field.free_table.columns.unshift({ id: 'left', label: '' });
    field.free_table.columns.push({ id: 'right', label: '' });
  }
  field.caption = 'HiddenTableCaption';
  const template = { groups: [{ id: 'g', label: 'Group', layout: 'vertical', fields: [field] }] };
  const data = buildFieldDefaults(template);
  const before = JSON.stringify(data);
  const savedTemplate = JSON.parse(JSON.stringify(template));
  const html = renderToStaticMarkup(React.createElement(FormRenderer, { template: savedTemplate, data, onChange: () => {} }));
  assert.ok(html.includes(axis === 'row' ? '新增试样行' : '新增试样列'));
  assert.ok(!html.includes('HiddenTableCaption'), 'table caption editor is hidden during entry');
  assert.ok(!html.includes('删除试样行') && !html.includes('删除试样列'), 'delete commands stay in closed context menus');
  assert.ok(html.includes(axis === 'row' ? '右键管理此试样行' : '右键管理此试样列'), 'sample headers expose context menu affordance');
  assert.ok(html.includes(axis === 'row' ? 'scope="row"' : 'scope="col"'), 'context menus belong to axis headers');
  assert.ok(html.includes('表格操作帮助'));
  assert.ok(!html.includes('Shift+Enter'), 'keyboard instructions are hidden until help is opened');
  assert.ok(html.includes('调整结构'));
  assert.ok(!html.includes('上方插行'), 'ordinary insertion stays behind structure editing');
  assert.ok(!html.includes('样品数：') && !html.includes('＋ 样品'));
  assert.equal(JSON.stringify(data), before);
  assert.ok(html.includes('data-sample-controls="add-sample"'));
  assert.ok(html.indexOf('data-sample-controls="add-sample"') < html.indexOf('<table'), 'add action is above scrollable grid');
  assert.ok(html.includes('padding:4px 10px'), 'field content leaves room for the active blue indicator');
  const headerField = savedTemplate.groups[0].fields[0];
  headerField.free_table.header_cells = { 'a::x': true };
  headerField.free_table.cells['a::x'] = 'ProtectedHeader';
  headerField.free_table.cell_options = { 'a::x': ['UnsafeChoice'] };
  const headerHtml = renderToStaticMarkup(React.createElement(FormRenderer, { template: savedTemplate, data, onChange: () => {} }));
  assert.ok(headerHtml.includes('data-readonly-header="true"'));
  assert.ok(headerHtml.includes('ProtectedHeader'));
  assert.ok(!headerHtml.includes('表头名称（本次录入可修改）'));
  assert.ok(!headerHtml.includes('placeholder="选择"'), 'header role overrides choice/input configuration during normal entry');
  assert.ok(/<td[^>]*ant-dropdown-trigger[^>]*>[\s\S]*?data-readonly-header/.test(headerHtml), 'actual sample header also receives a context menu');
  const band = headerField.free_table.sample_bands[0];
  const newHeaderKey = axis === 'row' ? 'b::x' : 'a::y';
  headerField.free_table.header_cells[newHeaderKey] = true;
  headerField.free_table.cells[newHeaderKey] = 'AddedHeaderLabel';
  const addedRaw = editSampleAxes(headerField.free_table, data.f, band, band.refs.map(ref => ({ ref, sample: 0 })));
  const addedHtml = renderToStaticMarkup(React.createElement(FormRenderer, { template: savedTemplate, data: { ...data, f: addedRaw }, onChange: () => {} }));
  assert.ok(addedHtml.includes('aria-label="新增试样表头"'), 'added sample headers editable without structure mode');
  assert.ok(addedHtml.includes('data-readonly-header="true"'), 'original headers stay readonly');
  console.log(`${axis}, partial=${partial}: top add action, context headers and compact help passed`);
 }
}
