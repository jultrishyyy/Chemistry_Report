import type { ReportTableData } from '../../../shared/report-document-editing';
import { parseSpreadsheetClipboard } from './spreadsheetClipboard';

/** Import data only, never HTML attributes, scripts, bindings or formulas. */
export function reportTableClipboard(html: string, plain: string): ReportTableData | null {
  if (html.length > 2_000_000 || plain.length > 2_000_000) throw Error('复制内容过大，请缩小选区');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const tables = doc.querySelectorAll('table');
  if (!tables.length) {
    if (!plain.includes('\t')) return null;
    const cells = parseSpreadsheetClipboard(plain), width = Math.max(...cells.map(row => row.length));
    if (cells.length > 100 || width > 50) throw Error('一次最多插入100行、50列，请缩小选区');
    return { cells: cells.map(row => Array.from({ length: width }, (_, c) => row[c] ?? '')) };
  }
  if (tables.length !== 1) return null;
  const table = tables[0];
  const outside = doc.body.cloneNode(true) as HTMLElement;
  outside.querySelector('table')?.remove();
  if (outside.textContent?.trim()) return null;
  if (table.rows.length > 100) throw Error('一次最多插入100行，请缩小选区');
  const cells: string[][] = Array.from({ length: table.rows.length }, () => []);
  const occupied = new Set<string>(), spans: NonNullable<ReportTableData['spans']> = [];
  const readText = (node: Node): string => node.nodeName === 'BR' ? '\n' : node.nodeType === 3 ? node.textContent || '' : ['SCRIPT', 'STYLE'].includes(node.nodeName) ? '' : [...node.childNodes].map(readText).join('');
  let width = 0;
  [...table.rows].forEach((row, r) => {
    let c = 0;
    for (const cell of row.cells) {
      while (occupied.has(`${r}/${c}`)) c++;
      const rs = cell.rowSpan || table.rows.length - r, cs = cell.colSpan || 1;
      if (c + cs > 50 || r + rs > cells.length) throw Error('表格合并范围超出限制，请缩小选区');
      for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) {
        const key = `${r + dr}/${c + dc}`;
        if (occupied.has(key)) throw Error('复制的合并单元格重叠，请重新选择');
        occupied.add(key); cells[r + dr][c + dc] = '';
      }
      cells[r][c] = readText(cell);
      if (rs > 1 || cs > 1) spans.push({ row: r, col: c, rowspan: rs, colspan: cs });
      c += cs; width = Math.max(width, c);
    }
  });
  return cells.length && width ? { cells: cells.map(row => Array.from({ length: width }, (_, c) => row[c] ?? '')), spans } : null;
}
