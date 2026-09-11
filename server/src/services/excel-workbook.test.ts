import assert from 'node:assert/strict';
import { test } from 'node:test';
import ExcelJS from 'exceljs';
import { workbookPreview, isExcelTempPath } from './excel-workbook.ts';

test('real xlsx roundtrip preserves physical positions, merges, formula cache, rich text and zero', async () => {
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('数据');
  ws.mergeCells('B2:C2'); ws.getCell('B2').value = '合并表头';
  ws.getCell('B4').value = 0; ws.getCell('C4').value = { formula: '1+2', result: 3 };
  ws.getCell('D4').value = { formula: '1+2' }; ws.getCell('E4').value = { error: '#DIV/0!' };
  ws.getCell('F4').value = { richText: [{ text: '未' }, { text: '检出' }] };
  ws.getCell('G4').value = new Date('2026-09-09T00:00:00Z');
  const read = new ExcelJS.Workbook(); await read.xlsx.load(await wb.xlsx.writeBuffer());
  const [sheet] = workbookPreview(read);
  assert.equal(sheet.grid.length, 4); assert.equal(sheet.grid[0][0], '');
  assert.equal(sheet.grid[1][1], '合并表头'); assert.equal(sheet.grid[1][2], '');
  assert.equal(sheet.grid[3][1], 0); assert.equal(sheet.grid[3][2], 3);
  assert.equal(sheet.grid[3][5], '未检出'); assert.equal(sheet.grid[3][6], '2026-09-09');
  assert.equal(sheet.notices.length, 2); assert.ok(sheet.blocked.includes('3,3')); assert.ok(sheet.blocked.includes('1,2'));
});
test('oversized sheets are explicitly unavailable without blocking result sheets', () => {
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Too big'); ws.getCell('A10001').value = 1;
  wb.addWorksheet('Results').getCell('A1').value = 42;
  const [large, result] = workbookPreview(wb);
  assert.match(large.unavailable_reason!, /范围过大/); assert.deepEqual(large.grid, []);
  assert.equal(result.grid[0][0], 42);
});
test('instrument trace sheets with thousands of actual data rows are supported', () => {
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('试样 1');
  for (let r = 1; r <= 3922; r++) ws.getCell(r, 2).value = r;
  wb.addWorksheet('测试结果').getCell('B3').value = 75;
  const [trace, result] = workbookPreview(wb);
  assert.equal(trace.grid.length, 3922); assert.equal(trace.grid[3921][1], 3922);
  assert.equal(result.grid[2][1], 75);
});
test('trailing blank styles are ignored but merged headers and physical addresses remain intact', async () => {
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Data');
  ws.getCell('ZZ5000').font = { bold: true };
  ws.mergeCells('B2:D2'); ws.getCell('B2').value = '表头'; ws.getCell('B4').value = 0;
  const read = new ExcelJS.Workbook(); await read.xlsx.load(await wb.xlsx.writeBuffer());
  const [sheet] = workbookPreview(read);
  assert.equal(sheet.grid.length, 4); assert.equal(sheet.grid[0].length, 4);
  assert.equal(sheet.grid[3][1], 0); assert.equal(sheet.merges[0].c1, 3);
});
test('legacy extraction refuses arbitrary paths and sibling directories', () => {
  const name = 'a'.repeat(32), root = '/tmp/excel-imports';
  assert.equal(isExcelTempPath(`${root}/${name}`, root), true);
  for (const path of [`${root}/../${name}`, `${root}-other/${name}`, '/etc/passwd', `${root}/file.xlsx`, null]) assert.equal(isExcelTempPath(path, root), false);
});
