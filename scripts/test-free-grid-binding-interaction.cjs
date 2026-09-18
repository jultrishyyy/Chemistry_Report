// Exercises real Canvas event handlers and persistence; no browser layout assertions.
const assert = require('node:assert/strict');
const React = require('../client/node_modules/react');
const { Button, Modal, Select, message } = require('../client/node_modules/antd');
const Canvas = require('../client/src/components/FieldEditor/MatrixEditor/FreeGridCanvas.tsx').default;
const Picker = require('../client/src/components/ReportEditor/BindingPickerModal.tsx').default;
const { validateReportBindings } = require('../shared/binding-integrity.ts');
const original = { success: message.success, warning: message.warning, state: React.useState, ref: React.useRef, effect: React.useEffect };
let slots, cursor;
const notices = [];
message.success = text => notices.push(text);
message.warning = text => { throw new Error(text); };
React.useState = initial => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; };
React.useRef = initial => React.useState(() => ({ current: initial }))[0];
React.useEffect = () => {};
function nodes(node) { if (Array.isArray(node)) return node.flatMap(nodes); if (!node || !node.props) return []; return [node, ...nodes(node.props.children)]; }
function label(node) { return Array.isArray(node) ? node.map(label).join('') : typeof node === 'string' ? node : ''; }
const button = (tree, text) => nodes(tree).find(n => n.type === Button && label(n.props.children) === text);
try {
  for (const axis of ['row', 'col']) {
    slots = []; cursor = 0;
    const sourceKey = 'sr::sc', targetKey = 'tr::tc';
    const source = { id: 's', code: 's', type: 'free_grid', free_table: {
      rows: [{ id: 'sr' }], columns: [{ id: 'sc', label: '' }], cells: {}, input_cells: { [sourceKey]: true },
      sample_bands: [{ id: 'samples', axis, refs: axis === 'row' ? ['sr'] : ['sc'] }],
    } };
    const field = { id: 't', code: 't', type: 'free_grid', free_table: {
      rows: [{ id: 'h' }, { id: 'tr' }], columns: [{ id: 'label', label: '' }, { id: 'tc', label: '' }],
      cells: { 'h::tc': '标题', 'tr::label': '项目' }, header_cells: { 'h::tc': true, 'tr::label': true },
      sample_bands: [{ id: 'report', axis, refs: axis === 'row' ? ['tr'] : ['tc'], cross_refs: axis === 'row' ? ['tc'] : ['tr'], source_field: 's', source_band_id: 'samples' }],
    } };
    const record = { groups: [{ id: 'g', fields: [source] }] };
    const props = { field, linkedRecord: record, editorMode: 'report-project', onChange: patch => Object.assign(field, patch) };
    const render = () => { cursor = 0; return Canvas(props); };
    let tree = render();
    const axisCell = nodes(tree).find(n => n.type === 'th' && n.props.title?.startsWith(axis === 'row' ? 'B 列' : '第 2 行'));
    // Row-number title varies; use its explicit row selection handler.
    const selection = axisCell || nodes(tree).filter(n => n.type === 'th' && n.props.onClick && !n.props.title?.includes('列：')).at(-1);
    assert.ok(selection, `${axis} axis selection exists`);
    selection.props.onClick(); tree = render();
    const parameter = button(tree, axis === 'row' ? '绑定试样列' : '绑定试样行');
    assert.equal(parameter.props.disabled, false, 'whole-axis selection enables parameter binding');
    parameter.props.onClick(); tree = render();
    let picker = nodes(tree).find(n => n.type === Picker);
    assert.equal(picker.props.allowedSources, undefined, 'same source categories as other fields');
    assert.equal(picker.props.compactFreeGrid, false);
    assert.notEqual(picker.props.onCombinedChange({ source: 'record_free_cell_sample', field_code: 's', cell_key: sourceKey }), false);
    assert.equal(field.free_table.cell_bindings[targetKey].source, 'record_free_cell_sample');
    assert.equal(field.free_table.cell_bindings['h::tc'], undefined);
    assert.equal(field.free_table.cell_bindings['tr::label'], undefined);
    assert.deepEqual(validateReportBindings([{ id: 'g', fields: [field] }], record.groups), []);
    picker.props.onClose(); tree = render();
    button(tree, '选择来源').props.onClick(); tree = render();
    picker = nodes(tree).find(n => n.type === Picker);
    assert.equal(picker.props.freeGridAllowSample, true);
    picker.props.onCombinedChange({ source: 'order', key: 'order_no' });
    assert.equal(field.free_table.cell_bindings[targetKey].source, 'order');
    assert.equal(field.free_table.cell_bindings['h::tc'], undefined);
    picker.props.onClose(); tree = render();
    const sampleAxis = nodes(tree).find(n => n.type === 'th' && n.props.title?.startsWith(axis === 'row' ? '第 2 行' : 'B 列'));
    sampleAxis.props.onClick(); tree = render();
    button(tree, '选择来源').props.onClick(); tree = render();
    picker = nodes(tree).find(n => n.type === Picker);
    assert.equal(picker.props.freeGridAllowSample, true, 'selecting the sample row/column excludes its shared header');
    assert.notEqual(picker.props.onCombinedChange({ source: 'record_free_cell_sample', field_code: 's', cell_key: sourceKey }), false);
    assert.equal(field.free_table.cell_bindings[targetKey].source, 'record_free_cell_sample');
    assert.deepEqual(validateReportBindings([{ id: 'g', fields: [field] }], record.groups), []);
    console.log(`${axis}: whole-axis selection, full source picker, saved sample and order bindings passed`);
    picker.props.onClose();
    delete field.free_table.sample_bands;
    field.free_table.cell_bindings['h::tc'] = { source: 'record_free_cell_sample', field_code: 's', cell_key: sourceKey };
    const unrelated = { ...source, id: 'unrelated', code: 'unrelated' };
    record.groups[0].fields.unshift(unrelated);
    tree = render();
    nodes(tree).find(n => n.props['data-grid-cell'] === '1-1').props.onMouseDown({ button: 0, buttons: 1, preventDefault() {}, stopPropagation() {} });
    tree = render();
    button(tree, '设为试样区').props.onClick(); tree = render();
    const regionModal = nodes(tree).find(n => n.type === Modal && n.props.title === '设置试样区域');
    const sourceSelect = nodes(regionModal).find(n => n.type === Select && n.props['aria-label'] === '试样来源表格');
    assert.equal(sourceSelect.props.value, 's', 'region source defaults to existing mappings, not the first table');
    regionModal.props.onOk(); tree = render();
    assert.equal(field.free_table.sample_bands[0].source_field, 's');
    assert.ok(field.free_table.cell_bindings['h::tc'], 'out-of-region mappings are preserved, not deleted');
    assert.ok(nodes(tree).some(n => n.props['data-sample-region-issues']), 'old mapping conflicts are shown after the region is created');
    assert.ok(notices.some(text => text.includes('已关联试样区域')));
    console.log(`${axis}: region confirmation succeeds with existing outside mappings and exposes actionable issues`);
    delete field.free_table.sample_bands;
    tree = render();
    nodes(tree).find(n => n.props['data-grid-cell'] === '1-1').props.onMouseDown({ button: 0, buttons: 1, preventDefault() {}, stopPropagation() {} });
    tree = render();
    const unchanged = JSON.stringify(field);
    button(tree, '选择试样行／列来源').props.onClick(); tree = render();
    picker = nodes(tree).find(n => n.type === Picker);
    assert.equal(picker.props.freeGridAllowSample, true);
    assert.equal(picker.props.compactFreeGrid, true);
    assert.deepEqual(picker.props.sampleSelectionShape, { rows: 1, columns: 1 });
    assert.equal(field.free_table.sample_bands, undefined, 'opening the picker does not require or create a region');
    picker.props.onClose(); tree = render();
    assert.equal(JSON.stringify(field), unchanged, 'cancel leaves the entire table unchanged');
    button(tree, '选择试样行／列来源').props.onClick(); tree = render();
    picker = nodes(tree).find(n => n.type === Picker);
    assert.notEqual(picker.props.onCombinedChange({ source: 'record_free_cell_sample', field_code: 's', cell_key: sourceKey }), false);
    assert.equal(field.free_table.sample_bands[0].source_axis_mapping, 'ordinal');
    assert.equal(field.free_table.cell_bindings[targetKey].source, 'record_free_cell_sample');
    assert.ok(field.free_table.cell_bindings['h::tc'], 'old outside mappings remain reviewable');
    console.log(`${axis}: direct selection opens, cancels and commits without a region setup step`);


  }
} finally { message.success = original.success; message.warning = original.warning; React.useState = original.state; React.useRef = original.ref; React.useEffect = original.effect; }
