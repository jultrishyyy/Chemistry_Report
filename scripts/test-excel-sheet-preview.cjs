// TSX_TSCONFIG_PATH=client/tsconfig.app.json node --import tsx scripts/test-excel-sheet-preview.cjs
const assert = require('node:assert/strict');
const React = require('../client/node_modules/react');
const { renderToStaticMarkup } = require('../client/node_modules/react-dom/server');
const ExcelSheetPreview = require('../client/src/components/ExcelSheetPreview.tsx').default;
const sheet = {
  name: '测试结果',
  grid: [['', '弯曲测试', ''], ['', '强度 MPa', '模量 MPa'], ['试样1', 75.61, 2140.33], ['试样2', 0, '']],
  merges: [{ r0: 0, r1: 0, c0: 1, c1: 2 }], blocked: ['0,2'], notices: [],
};
let writes = 0;
const render = (data, extra = {}) => renderToStaticMarkup(React.createElement(ExcelSheetPreview, {
  sheet: data, selected: { r0: 2, r1: 3, c0: 1, c1: 2 }, writingCells: ['B3', 'C3', 'B4'],
  destinations: { B3: '试样1 · 弯曲强度（原值：空）' }, rowPage: 1, colPage: 1,
  onPage: () => writes++, onPick: () => writes++, ...extra,
}));
const before = JSON.stringify(sheet);
const html = render(sheet);
assert.ok(html.includes('Excel原表预览'));
assert.ok(html.includes('colSpan="2"') || html.includes('colspan="2"'));
assert.ok(html.includes('75.61') && html.includes('2140.33') && html.includes('>0</div>'));
assert.equal((html.match(/data-import-write="true"/g) || []).length, 3);
assert.equal((html.match(/data-import-selected="true"/g) || []).length, 4);
assert.ok(html.includes('将写入：试样1 · 弯曲强度'));
assert.ok(!html.includes('data-excel-address="C1"'), 'merged slave is not duplicated');
assert.ok(html.includes('excel-sheet-scroll') && html.includes('excel-sheet-grid'), 'overflow belongs to a bounded worksheet container');
assert.ok(html.includes('可导入区域') && html.includes('已选择区域'));
const colored = render(sheet, { availableRanges: [{ r0: 1, r1: 3, c0: 1, c1: 2 }] });
assert.ok(/data-excel-address="B2"[^>]*background:#e6f4ff/.test(colored), 'unselected candidate region is blue');
assert.ok(/data-excel-address="B3"[^>]*background:#d9f7be/.test(colored), 'selected region is green');
assert.ok(/data-excel-address="C4"[^>]*background:#d9f7be/.test(colored), 'selected blank cells are green too, not just changed values');
assert.ok(colored.includes('data-excel-address="A1"'), 'full worksheet includes cells outside import ranges');
const long = '超长内容'.repeat(300);
assert.ok(render({ ...sheet, grid: [[long]] }).includes(long), 'long values remain intact for hover/copy, not sliced off');
const large = { ...sheet, grid: Array.from({ length: 45 }, (_, r) => Array.from({ length: 23 }, (_, c) => `${r + 1}/${c + 1}`)), merges: [{ r0: 39, r1: 41, c0: 19, c1: 21 }] };
const page = render(large, { rowPage: 2, colPage: 2, selected: undefined, writingCells: [] });
assert.ok(page.includes('40/20'), 'a merge clipped by page boundaries retains its original master text');
assert.ok(page.includes('data-excel-address="T40"'));
assert.ok(page.includes('>41</th>') && page.includes('>U</th>'), 'physical row and column addresses survive pagination');
const focused = render(sheet, { focused: true });
assert.ok(!focused.includes('data-excel-address="A3"') && !focused.includes('data-excel-address="B2"'), 'focused preview excludes cells outside the selected region');
assert.equal((focused.match(/data-import-selected="true"/g) || []).length, 4);
assert.ok(focused.includes('data-excel-address="B3"') && focused.includes('>0</div>'));
assert.ok(!focused.includes('拖动框选'), 'focused preview does not invite accidental reselection');
const focusedPage = render({ ...large, merges: [] }, { focused: true, selected: { r0: 2, r1: 44, c0: 1, c1: 22 }, rowPage: 2, colPage: 2 });
assert.ok(focusedPage.includes('data-excel-address="V43"'), 'focused pages use selection-relative offsets and preserve workbook coordinates');
assert.ok(!focusedPage.includes('data-excel-address="U43"'));
assert.equal(JSON.stringify(sheet), before);
assert.equal(writes, 0, 'preview render does not apply imports');
console.log('Excel visual preview: highlights, destination, merges, clipping, pagination, long text and read-only rendering passed');
