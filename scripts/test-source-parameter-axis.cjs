const assert = require('node:assert/strict');
const React = require('../client/node_modules/react');
const { FreeGridCellPicker } = require('../client/src/components/ReportEditor/BindingPickerModal.tsx');
const { sampleParameterBindings } = require('../shared/free-grid-parameter-binding.ts');
const original = { state: React.useState, effect: React.useEffect };
let slots, cursor;
React.useState = initial => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; };
React.useEffect = () => {};
function nodes(node) { if (Array.isArray(node)) return node.flatMap(nodes); if (!node || !node.props) return []; return [node, ...nodes(node.props.children)]; }
try {
  for (const axis of ['row', 'col']) {
    slots = []; cursor = 0;
    const k = (sample, parameter) => axis === 'row' ? `${sample}::${parameter}` : `${parameter}::${sample}`;
    const field = { id: 'f', code: 'f', label: 'Source', type: 'free_grid', free_table: {
      rows: (axis === 'row' ? ['h', 's1', 's2', 'outside'] : ['p', 'other']).map(id => ({ id })),
      columns: (axis === 'row' ? ['p', 'other'] : ['h', 's1', 's2', 'outside']).map(id => ({ id, label: '' })),
      cells: { [k('h', 'p')]: 'Parameter' }, header_cells: { [k('h', 'p')]: true },
      input_cells: { [k('s1', 'p')]: true }, cell_formulas: { [k('s2', 'p')]: { type: 'sum', sources: [] } },
      cell_units: { [k('s1', 'p')]: 'mm' },
      sample_bands: [{ id: 'samples', axis, refs: ['s1', 's2'], cross_refs: ['p'] }],
    } };
    let selected = { source: 'literal', text: '' }, unit;
    const props = { fields: [field], value: selected, allowSample: true, allowTemplate: false, allowFixed: true, parameterAxis: true,
      onPick: b => { selected = b; props.value = b; }, onPickUnit: b => { unit = b; } };
    const render = () => { cursor = 0; return FreeGridCellPicker(props); };
    let tree = render();
    const button = nodes(tree).find(n => n.props['aria-label'] === (axis === 'row' ? '选择第1列试样数据' : '选择第1行试样数据'));
    assert.equal(button.props.disabled, false);
    button.props.onClick(); tree = render();
    assert.equal(selected.cell_key, k('s1', 'p'));
    assert.equal(unit.source, 'record_free_cell_unit_sample');
    assert.deepEqual(nodes(tree).filter(n => n.props['data-source-selected']).map(n => n.props['data-source-cell']), [k('s1', 'p'), k('s2', 'p')]);
    const band = { id: 'target', axis, refs: ['t1', 't2'], cross_refs: ['tp'], source_field: 'f', source_band_id: 'samples' };
    const mapped = sampleParameterBindings(band, [k('t1', 'tp'), k('t2', 'tp')], field, selected);
    assert.equal(mapped.bindings[k('t2', 'tp')].source, 'record_free_formula_cell_sample');
    props.parameterAxis = false;
    assert.ok(!nodes(render()).some(n => String(n.props['aria-label']).startsWith('选择第')), 'ordinary cell mapping keeps single-cell semantics');
    props.parameterAxis = true;
    props.sampleSelectionShape = axis === 'row' ? { rows: 1, columns: 2 } : { rows: 2, columns: 1 };
    tree = render();
    const axisLabel = axis === 'row' ? '选择第1列试样数据' : '选择第1行试样数据';
    assert.equal(nodes(tree).find(n => n.props['aria-label'] === axisLabel).props.disabled, true, 'not enough source parameters disables the range');
    field.free_table.sample_bands[0].cross_refs = ['p', 'other'];
    tree = render();
    nodes(tree).find(n => n.props['aria-label'] === axisLabel).props.onClick(); tree = render();
    assert.equal(nodes(tree).filter(n => n.props['data-source-selected']).length, 4, 'multi-parameter targets highlight the corresponding whole source columns/rows');
    console.log(`${axis}: source axis click highlights only its sample data and saves input/formula/unit bindings`);
  }
} finally { React.useState = original.state; React.useEffect = original.effect; }
