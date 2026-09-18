import type { FieldDefinition } from './types';
import { expandEntryRange, type EntryRange } from './free-grid-entry-structure';
import type { ReportTableData } from './report-document-editing';

/** Copy displayed values only: no formula, binding, numeric format or sample identity leaks. */
export function sourceSelectionData(table: NonNullable<FieldDefinition['free_table']>, selection: EntryRange): ReportTableData {
  const range = expandEntryRange(table, selection);
  if (![range.minR, range.maxR, range.minC, range.maxC].every(Number.isInteger) || range.minR < 0 || range.minC < 0 || range.maxR >= table.rows.length || range.maxC >= table.columns.length || range.minR > range.maxR || range.minC > range.maxC) throw Error('选区已失效，请重新框选');
  const rows = range.maxR - range.minR + 1, columns = range.maxC - range.minC + 1;
  if (rows > 100 || columns > 50) throw Error('一次最多插入100行、50列，请缩小选区');
  const cells = Array.from({ length: rows }, (_, r) => Array.from({ length: columns }, (_, c) => String(table.cells[`${table.rows[r + range.minR].id}::${table.columns[c + range.minC].id}`] ?? '')));
  const spans: NonNullable<ReportTableData['spans']> = [];
  for (const [key, span] of Object.entries(table.spans || {})) {
    const [rid, cid] = key.split('::');
    const r = table.rows.findIndex(row => row.id === rid), c = table.columns.findIndex(col => col.id === cid);
    if (r < range.minR || r > range.maxR || c < range.minC || c > range.maxC) continue;
    const rowspan = span.rowspan || 1, colspan = span.colspan || 1;
    if (!Number.isInteger(rowspan) || !Number.isInteger(colspan) || rowspan < 1 || colspan < 1 || r + rowspan > range.maxR + 1 || c + colspan > range.maxC + 1) throw Error('来源合并单元格异常，请重新核对原始记录');
    spans.push({ row: r - range.minR, col: c - range.minC, rowspan, colspan });
    for (let dr = 0; dr < rowspan; dr++) for (let dc = 0; dc < colspan; dc++) if (dr || dc) cells[r - range.minR + dr][c - range.minC + dc] = '';
  }
  return { cells, spans };
}
