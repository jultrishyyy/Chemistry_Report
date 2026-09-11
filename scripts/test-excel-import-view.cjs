// TSX_TSCONFIG_PATH=client/tsconfig.app.json node --import tsx scripts/test-excel-import-view.cjs
const assert = require('node:assert/strict');
const React = require('../client/node_modules/react');
const { renderToStaticMarkup } = require('../client/node_modules/react-dom/server');
const FormRenderer = require('../client/src/components/FormRenderer/index.tsx').default;
const FreeGridCanvas = require('../client/src/components/FieldEditor/MatrixEditor/FreeGridCanvas.tsx').default;
const ft = { rows: [{ id: 'r' }], columns: [{ id: 'c', label: '' }], cells: {}, input_cells: { 'r::c': true },
  excel_import: { enabled: true, sheet_name: '', mode: 'auto' } };
const fields = ['a', 'b'].map(code => ({ id: code, code, label: code, type: 'free_grid', free_table: ft }));
const template = { name: 'Import', version: 1, groups: [{ id: 'g', label: 'G', layout: 'vertical', fields }] };
let writes = 0;
const html = renderToStaticMarkup(React.createElement(FormRenderer, { template, data: {}, onChange: () => { writes++; } }));
assert.equal((html.match(/>导入 Excel</g) || []).length, 1, 'one upload entry for the complete record');
assert.ok(!html.includes('accept=".xlsx,.xls"'));
assert.equal(writes, 0);
const config = renderToStaticMarkup(React.createElement(FreeGridCanvas, { field: fields[0], template, onChange: () => { writes++; } }));
assert.ok(config.includes('Sheet名称（选填）'));
assert.ok(!config.includes('数据起始行') && !config.includes('数据起始列') && !config.includes('目标起点'));
assert.equal(writes, 0);
console.log('single workbook entry, xlsx-only upload and optional-Sheet-only template configuration passed');
