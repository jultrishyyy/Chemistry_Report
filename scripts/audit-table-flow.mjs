// Read-only synthetic probes. No database, HTTP calls, or user records are used.
// Run from the repository root: node --import tsx scripts/audit-table-flow.mjs
import { buildProjectGroupsFromRecord } from '../shared/report-inherit.ts';
import { renderFreeGridTypst, resolveBinding } from '../shared/typst-generator.ts';
import { buildFreeGridLayout } from '../shared/free-grid-layout.ts';
import { parseSpreadsheetClipboard } from '../client/src/utils/spreadsheetClipboard.ts';

const table = {
  rows: [{ id: 'h' }, { id: 'a' }, { id: 'b' }], columns: [{ id: 'x', label: '值' }],
  cells: { 'h::x': '备注', 'a::x': 'Default' }, header_cells: { 'h::x': true },
  input_cells: { 'a::x': true, 'b::x': true },
  sample_bands: [{ id: 's', axis: 'row', refs: ['a', 'b'] }],
};
const field = { id: 'f', code: 'f', label: 'Table', type: 'free_grid', free_table: table };
const record = { groups: [{ id: 'g', label: 'G', fields: [field] }] };
const raw = { '__sample_count__::s': 2, 'a::x::s0': 'Aone', 'a::x::s1': 'Atwo', 'b::x::s0': 'Bone', 'b::x::s1': 'Btwo' };
const context = { linked_record_template: record, record_raw_data: { f: raw } };
const reportTable = {
  ...table, cells: {}, header_cells: {},
  cell_bindings: {
    'a::x': { source: 'record_free_cell_sample', field_code: 'f', cell_key: 'a::x' },
    'b::x': { source: 'record_free_cell_sample', field_code: 'f', cell_key: 'b::x' },
  },
  sample_bands: [{ id: 's', axis: 'row', refs: ['a', 'b'], source_field: 'f', source_band_id: 's' }],
};
const reportValues = ft => renderFreeGridTypst(field, ft, undefined, context).match(/Aone|Atwo|Bone|Btwo/g) || [];
const inherited = buildProjectGroupsFromRecord(record).groups.flatMap(g => g.fields).find(f => f.type === 'free_grid');
const checks = [
  {
    id: 'F01', description: '报告与原始记录多行试样顺序一致',
    expected: ['Aone', 'Bone', 'Atwo', 'Btwo'], actual: reportValues(reportTable),
    recordRows: buildFreeGridLayout(table, raw).displayRows.map(r => [r.id, r.sample]),
  },
  {
    id: 'F02', description: '仅选择第二个试样时按原试样身份取值',
    expected: ['Atwo', 'Btwo'],
    actual: reportValues({ ...reportTable, sample_bands: [{ ...reportTable.sample_bands[0], sample_filter: { mode: 'indices', indices: [1] } }] }),
  },
  {
    id: 'F03', description: '逐试样备注不因显示名称变成共享值',
    expected: 'record_free_cell_sample', actual: inherited.free_table.cell_bindings['a::x'].source,
  },
  {
    id: 'F04', description: '报告尊重显式清空，不恢复模板默认值',
    expected: '', actual: resolveBinding({ source: 'record_free_cell', field_code: 'f', cell_key: 'a::x' }, {
      linked_record_template: record, record_raw_data: { f: { 'a::x': '' } },
    }),
  },
  {
    id: 'F05', description: '粘贴包含引号包裹的单元格内换行',
    expected: [['line1\nline2', '42']], actual: parseSpreadsheetClipboard('"line1\nline2"\t42'),
  },
];
console.log(JSON.stringify(checks.map(check => ({ ...check, matchesExpected: JSON.stringify(check.actual) === JSON.stringify(check.expected) })), null, 2));
// These are audit observations, not a CI gate. Promote each to a regression test when fixing it.
