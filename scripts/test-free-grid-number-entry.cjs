// TSX_TSCONFIG_PATH=client/tsconfig.app.json node --import tsx scripts/test-free-grid-number-entry.cjs
const assert = require('node:assert/strict');
const React = require('../client/node_modules/react');
const { renderToStaticMarkup } = require('../client/node_modules/react-dom/server');
const { planExcelImport } = require('../shared/excel-import.ts');
const { freeGridNumberText } = require('../shared/free-grid-number.ts');
const { applyNumericRounding } = require('../shared/numeric-rounding.ts');
const { renderFreeGridTypst } = require('../shared/typst-generator.ts');
const FormRenderer = require('../client/src/components/FormRenderer/index.tsx').default;
const Settings = require('../client/src/components/FreeGridNumberSettings.tsx').default;
const { Select, Button } = require('../client/node_modules/antd');
const table = {
  rows: [{ id: 'a' }], columns: [{ id: 'x', label: '长度' }], cells: {}, input_cells: { 'a::x': true },
  default_number_fmt: { mode: 'decimals', digits: 3 }, default_rounding: { mode: 'half_even', digits: 2 },
};
const field = { id: 'f', code: 'f', label: '结果', type: 'free_grid', free_table: table };
const source = { name: 'Data', grid: [[1.245]], merges: [], blocked: [], notices: [] };
const plan = planExcelImport(field, {}, source, { r0: 0, r1: 0, c0: 0, c1: 0 }, 'row', [0]);
assert.deepEqual(plan.issues, []);
assert.equal(plan.value['a::x'], 1.245, 'retain source precision for later rule changes');
assert.equal(freeGridNumberText(plan.value['a::x'], table, 'a::x'), '1.240');
const template = { name: 'T', version: 1, groups: [{ id: 'g', label: 'G', fields: [field] }] };
const html = renderToStaticMarkup(React.createElement(FormRenderer, { template, data: { f: plan.value }, onChange: () => { throw Error('render must not mutate'); } }));
assert.ok(html.includes('>1.240</textarea>'), 'imported input uses rounding then formatting');
assert.ok(renderFreeGridTypst(field, table, plan.value).includes('1.240'), 'PDF agrees with entry display');
for (const value of ['', '  ', null, undefined, true, '<0.01', '未检出']) {
  assert.equal(applyNumericRounding(value, table.default_rounding), value, 'non-numeric/empty values do not become zero');
}
assert.equal(freeGridNumberText(0, table, 'a::x'), '0.000');
const unconfigured = { ...table, default_number_fmt: undefined, default_rounding: undefined, cell_formulas: { 'a::x': { type: 'sum', sources: [] } } };
assert.equal(freeGridNumberText(1.2456789, unconfigured, 'a::x'), '1.2456789', 'unconfigured formula has no implicit three-digit format');
assert.equal(freeGridNumberText('1.23000', { ...unconfigured, cell_formulas: undefined }, 'a::x'), '1.23000', 'unconfigured input retains original text precision');
const exempt = { ...table, cell_number_fmt: { 'a::x': { mode: 'none', digits: 2 } }, cell_rounding: { 'a::x': { mode: 'none' } } };
assert.equal(freeGridNumberText(1.2456789, exempt, 'a::x'), '1.2456789', 'explicit none overrides configured table defaults');
const overridden = { ...table, cell_rounding: { 'a::x': { mode: 'none' } }, cell_number_fmt: { 'a::x': { mode: 'significant', digits: 4 } } };
assert.equal(freeGridNumberText(1.245, overridden, 'a::x'), '1.245');
assert.equal(freeGridNumberText(1.245, { ...overridden, cell_number_fmt: { 'a::x': { mode: 'scientific', digits: 2 } } }, 'a::x'), '1.25e+0');
const withInstance = { ...plan.value, __free_table_structure__: { ...table, default_rounding: { mode: 'half_up', digits: 2 } } };
const instanceHtml = renderToStaticMarkup(React.createElement(FormRenderer, { template, data: { f: withInstance }, onChange: () => {} }));
assert.ok(instanceHtml.includes('>1.250</textarea>'), 'persisted instance rules override template');
assert.ok(renderFreeGridTypst(field, table, withInstance).includes('1.250'), 'PDF uses saved instance rounding');
const formulaTable = { ...table, rows: [...table.rows, { id: 'total' }], cell_formulas: { 'total::x': { type: 'sum', sources: ['a::x'] } } };
const formulaField = { ...field, free_table: formulaTable };
const formulaTemplate = { ...template, groups: [{ id: 'g', label: 'G', fields: [formulaField] }] };
const formulaHtml = renderToStaticMarkup(React.createElement(FormRenderer, { template: formulaTemplate, data: { f: plan.value }, onChange: () => {} }));
assert.ok(formulaHtml.includes('<strong>1.240</strong>'), 'downstream formula consumes rounded value and respects display format');
const noRuleTable = { ...formulaTable, default_number_fmt: undefined, default_rounding: undefined };
const noRuleField = { ...field, free_table: noRuleTable };
const noRuleTemplate = { ...template, groups: [{ id: 'g', label: 'G', fields: [noRuleField] }] };
const precise = { 'a::x': 1.2456789 };
const noRuleHtml = renderToStaticMarkup(React.createElement(FormRenderer, { template: noRuleTemplate, data: { f: precise }, onChange: () => {} }));
assert.ok(noRuleHtml.includes('<strong>1.2456789</strong>'));
assert.ok(noRuleHtml.includes('>1.2456789</textarea>'));
assert.ok(renderFreeGridTypst(noRuleField, noRuleTable, precise).includes('1.2456789'), 'PDF preserves unconfigured formula precision too');
const previewHtml = renderToStaticMarkup(React.createElement(FormRenderer, { template: formulaTemplate, data: { f: plan.value }, previewFieldCode: 'f', onChange: () => { throw Error('preview must not write'); } }));
assert.ok(previewHtml.includes('inert=""') && previewHtml.includes('<strong>1.240</strong>'));
assert.ok(!previewHtml.includes('>导入 Excel<'), 'target preview never recursively mounts an import wizard');
const before = JSON.stringify(table);
const original = React.useState;
let scope = 'selection', updated;
React.useState = () => [scope, value => { scope = value; }];
function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== 'object' || !node.props) return [];
  return [node, ...nodes(node.props.children), ...nodes(node.props.content)];
}
const settings = () => nodes(Settings({ table, cellKeys: ['a::x'], onChange: value => { updated = value; } }));
try {
  const popup = Settings({ table, cellKeys: ['a::x'], onChange: value => { updated = value; } });
  assert.equal(popup.props.rootClassName, 'free-grid-number-settings-popup');
  scope = 'table'; popup.props.onOpenChange(true);
  assert.equal(scope, 'selection', 'opening settings never silently reuses whole-table scope');
  settings().find(n => n.type === Select && n.props['aria-label'] === '修约方式').props.onChange('truncate');
  assert.equal(updated.cell_rounding['a::x'].mode, 'truncate');
  assert.equal(updated.default_rounding.mode, 'half_even');
  scope = 'table';
  settings().find(n => n.type === Select && n.props['aria-label'] === '数字格式').props.onChange('scientific');
  assert.equal(updated.default_number_fmt.mode, 'scientific');
  settings().find(n => n.type === Button && n.props.children === '清除整表数字格式与修约').props.onClick();
  assert.equal(freeGridNumberText(plan.value['a::x'], updated, 'a::x'), '1.245', 'clearing rules restores already imported precision without reimport');
  assert.equal(updated.default_rounding, undefined);
  assert.deepEqual(updated.cell_number_fmt, {});
  scope = 'selection';
  settings().find(n => n.type === Button && n.props.children === '选区恢复整表默认').props.onClick();
  assert.deepEqual(updated.cell_rounding, {});
  assert.equal(JSON.stringify(table), before, 'settings never mutate the template');
} finally { React.useState = original; }
console.log('Numeric import/display/PDF, precision, instance rules, empty/text, selection/table settings passed');
