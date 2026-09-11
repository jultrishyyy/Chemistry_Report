import type ExcelJS from 'exceljs';
import { resolve, dirname, basename } from 'node:path';
import type { ImportSheet } from '../../../shared/excel-import.ts';

export function isExcelTempPath(value: unknown, root: string): value is string {
  return typeof value === 'string' && dirname(resolve(value)) === resolve(root) && /^[a-f0-9]{32}$/.test(basename(value));
}

export function workbookPreview(workbook: ExcelJS.Workbook): ImportSheet[] {
  if (workbook.worksheets.length > 25) throw new Error('工作簿超过25个Sheet，请拆分文件后导入');
  let total = 0;
  return workbook.worksheets.map(ws => {
    // Formatting-only rows/columns are not data. Keep original coordinates, including leading blanks.
    let rows = 0, cols = 0;
    const meaningful = (value: any) => value != null && value !== '' &&
      !(typeof value === 'object' && 'richText' in value && !value.richText.some((part: any) => part.text));
    ws.eachRow(row => row.eachCell(cell => {
      if (!meaningful(cell.value) || (cell.isMerged && cell.master.address !== cell.address)) return;
      rows = Math.max(rows, Number(cell.row)); cols = Math.max(cols, Number(cell.col));
    }));
    const activeMerges = (ws.model.merges || []).filter(address => meaningful(ws.getCell(address.split(':')[0]).value));
    for (const address of activeMerges) {
      const end = ws.getCell(address.split(':')[1] || address);
      rows = Math.max(rows, Number(end.row)); cols = Math.max(cols, Number(end.col));
    }
    if (rows > 10000 || cols > 200 || rows * cols > 200000 || total + rows * cols > 200000) {
      const reason = `Sheet“${ws.name}”数据范围过大（${rows}行、${cols}列），本页未加载；可继续导入其它Sheet。单页最多1万行、200列，工作簿预览总计20万格。`;
      return { name: ws.name, grid: [], merges: [], blocked: [], notices: [reason], hidden: ws.state !== 'visible', unavailable_reason: reason };
    }
    total += rows * cols;
    const blocked: string[] = [], notices: string[] = [];
    const grid = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => {
      const cell = ws.getCell(r + 1, c + 1);
      if (cell.isMerged && cell.master.address !== cell.address) { blocked.push(`${r},${c}`); return ''; }
      let value: any = cell.value;
      if (value && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value)) {
        if (value.result == null) { blocked.push(`${r},${c}`); notices.push(`${cell.address}公式没有缓存结果，已跳过；请用Excel重新计算并保存`); return ''; }
        value = value.result;
      }
      if (value?.error) { blocked.push(`${r},${c}`); notices.push(`${cell.address}为Excel错误值，已跳过`); return ''; }
      if (value instanceof Date) return value.toISOString().slice(0, 10);
      if (value?.richText) return value.richText.map((v: any) => v.text || '').join('');
      if (value && typeof value === 'object' && 'text' in value) return String(value.text || '');
      return value == null ? '' : typeof value === 'number' || typeof value === 'boolean' ? value : String(value);
    }));
    const merges = activeMerges.map(address => {
      const [from, to = from] = address.split(':');
      const a = ws.getCell(from), b = ws.getCell(to);
      return { r0: Number(a.row) - 1, c0: Number(a.col) - 1, r1: Number(b.row) - 1, c1: Number(b.col) - 1 };
    });
    return { name: ws.name, grid, merges, blocked, notices, hidden: ws.state !== 'visible' };
  });
}
