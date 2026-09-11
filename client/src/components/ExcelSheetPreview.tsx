import { useEffect, useRef } from 'react';
import { Pagination, Select } from 'antd';
import { columnName, type ImportRange, type ImportSheet } from '../../../shared/excel-import';

/** A bounded, coordinate-preserving view; original workbook data is never mutated. */
export default function ExcelSheetPreview({ sheet, selected, writingCells, destinations = {}, rowPage, colPage, onPage, onPick, focused = false, availableRanges = [] }: {
  sheet: ImportSheet; selected?: ImportRange; writingCells: string[]; rowPage: number; colPage: number;
  onPage: (page: { rowPage?: number; colPage?: number }) => void;
  onPick: (range: ImportRange) => void;
  destinations?: Record<string, string>;
  focused?: boolean;
  availableRanges?: ImportRange[];
}) {
  const anchor = useRef<ImportRange | null>(null);
  useEffect(() => {
    const clear = () => { anchor.current = null; };
    window.addEventListener('mouseup', clear); window.addEventListener('blur', clear);
    return () => { window.removeEventListener('mouseup', clear); window.removeEventListener('blur', clear); };
  }, []);
  useEffect(() => { anchor.current = null; }, [sheet.name, rowPage, colPage]);
  const cols = Math.max(0, ...sheet.grid.map(row => row.length));
  const view = focused && selected ? selected : { r0: 0, c0: 0, r1: sheet.grid.length - 1, c1: cols - 1 };
  const rowsTotal = Math.max(0, view.r1 - view.r0 + 1), colsTotal = Math.max(0, view.c1 - view.c0 + 1);
  const currentRow = Math.min(rowPage, Math.max(1, Math.ceil(rowsTotal / 40)));
  const currentCol = Math.min(colPage, Math.max(1, Math.ceil(colsTotal / 20)));
  const r0 = view.r0 + (currentRow - 1) * 40, r1 = Math.min(view.r1, r0 + 39);
  const c0 = view.c0 + (currentCol - 1) * 20, c1 = Math.min(view.c1, c0 + 19);
  const writing = new Set(writingCells), blocked = new Set(sheet.blocked);
  const extend = (a: ImportRange, b: ImportRange) => ({ r0: Math.min(a.r0, b.r0), r1: Math.max(a.r1, b.r1), c0: Math.min(a.c0, b.c0), c1: Math.max(a.c1, b.c1) });
  return <section className="excel-source-preview" aria-label="Excel原表预览">
    <div className="excel-preview-toolbar">
      <strong>Excel 原表 · {sheet.name}</strong>
      <span className="excel-preview-legend"><i style={{ background: '#e6f4ff' }} />可导入区域 <i style={{ background: '#d9f7be' }} />已选择区域</span>
      {!focused && <span className="excel-preview-hint">拖动框选数据区域，或按 Shift 点击另一角。</span>}
    </div>
    <div className="excel-sheet-scroll" tabIndex={0} aria-label="可滚动的Excel表格">
      <table className="excel-sheet-grid" style={{ width: 44 + Math.max(0, c1 - c0 + 1) * 150 }}>
        <colgroup><col style={{ width: 44 }} />{Array.from({ length: Math.max(0, c1 - c0 + 1) }, (_, j) => <col key={j} style={{ width: 150 }} />)}</colgroup>
        <thead><tr><th aria-label="行号" />{Array.from({ length: Math.max(0, c1 - c0 + 1) }, (_, j) => <th key={j} scope="col">{columnName(c0 + j)}</th>)}</tr></thead>
        <tbody>{sheet.grid.slice(r0, r1 + 1).map((row, i) => {
          const r = r0 + i;
          return <tr key={r}><th scope="row">{r + 1}</th>{Array.from({ length: Math.max(0, c1 - c0 + 1) }, (_, j) => {
            const c = c0 + j;
            const merge = sheet.merges.find(m => r >= m.r0 && r <= m.r1 && c >= m.c0 && c <= m.c1);
            if (merge && (r !== Math.max(r0, merge.r0) || c !== Math.max(c0, merge.c0))) return null;
            const bounds = merge || { r0: r, r1: r, c0: c, c1: c };
            const address = `${columnName(bounds.c0)}${bounds.r0 + 1}`;
            const text = String(merge ? sheet.grid[merge.r0]?.[merge.c0] ?? '' : row[c] ?? '');
            const inside = !!selected && bounds.r0 <= selected.r1 && bounds.r1 >= selected.r0 && bounds.c0 <= selected.c1 && bounds.c1 >= selected.c0;
            const available = availableRanges.some(range => bounds.r0 <= range.r1 && bounds.r1 >= range.r0 && bounds.c0 <= range.c1 && bounds.c1 >= range.c0);
            const willWrite = writing.has(address);
            const isBlocked = blocked.has(`${bounds.r0},${bounds.c0}`);
            return <td key={c} rowSpan={merge ? Math.min(r1, merge.r1) - r + 1 : undefined} colSpan={merge ? Math.min(c1, merge.c1) - c + 1 : undefined}
              data-excel-address={address} data-import-selected={inside || undefined} data-import-available={available || undefined} data-import-write={willWrite || undefined}
              aria-selected={inside} title={`${address}：${text}${isBlocked ? '（无法导入）' : willWrite ? `\n将写入：${destinations[address] || '原始记录'}` : ''}`}
              style={{ background: inside ? '#d9f7be' : available ? '#e6f4ff' : '#fff', color: isBlocked ? '#999' : undefined, boxShadow: inside ? 'inset 0 0 0 1px #95de64' : undefined }}
              onMouseDown={e => { if (focused || e.button !== 0) return; e.preventDefault(); anchor.current = e.shiftKey && selected ? { ...selected, r1: selected.r0, c1: selected.c0 } : bounds; onPick(extend(anchor.current, bounds)); }}
              onMouseEnter={e => { if (!focused && e.buttons === 1 && anchor.current) onPick(extend(anchor.current, bounds)); }}>
              <div className="excel-cell-text">{text}</div>
            </td>;
          })}</tr>;
        })}</tbody>
      </table>
      {!sheet.grid.length && <div style={{ padding: 20 }}>此工作表没有可导入的数据</div>}
    </div>
    {(rowsTotal > 40 || colsTotal > 20) && <div className="excel-preview-toolbar">
      {rowsTotal > 40 && <Pagination size="small" simple current={currentRow} pageSize={40} total={rowsTotal} showSizeChanger={false} onChange={rowPage => onPage({ rowPage })} />}
      {colsTotal > 20 && <Select aria-label="查看Excel列范围" style={{ width: 190, maxWidth: '100%' }} value={currentCol} options={Array.from({ length: Math.ceil(colsTotal / 20) }, (_, i) => ({ value: i + 1, label: `${columnName(view.c0 + i * 20)}–${columnName(Math.min(view.c1, view.c0 + i * 20 + 19))} 列` }))} onChange={colPage => onPage({ colPage })} />}
    </div>}
  </section>;
}
