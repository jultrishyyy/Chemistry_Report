import type { FieldDefinition } from './types';

type Table = NonNullable<FieldDefinition['free_table']>;
type Axis = 'row' | 'col';
/** Resize at the bottom/right only; reject invalid dimensions without partial edits. */
export function resizeReportTable(table: Table, rowCount: number, columnCount: number, newId: () => string): string | null {
  if (!Number.isInteger(rowCount) || !Number.isInteger(columnCount) || rowCount < 1 || columnCount < 1 || rowCount > 1000 || columnCount > 200) return '表格尺寸需为整数：1–1000 行、1–200 列';
  const next = structuredClone(table);
  for (const [axis, count] of [['row', rowCount], ['col', columnCount]] as const) {
    const items = () => axis === 'row' ? next.rows : next.columns;
    while (items().length > count) {
      const error = deleteReportTableAxis(next, axis, items().at(-1)!.id);
      if (error) return error;
    }
    while (items().length < count) {
      const error = insertReportTableAxis(next, axis, items().length, newId());
      if (error) return error;
    }
  }
  Object.assign(table, next);
  return null;
}
const extent = (value?: number) => Number.isFinite(value) ? Math.max(1, Math.floor(value!)) : 1;
function rectangles(table: Table) {
  return Object.entries(table.spans || {}).flatMap(([key, span]) => {
    const [rid, cid] = key.split('::');
    const r = table.rows.findIndex(row => row.id === rid), c = table.columns.findIndex(col => col.id === cid);
    return r < 0 || c < 0 ? [] : [{ key, r, c,
      rs: Math.min(extent(span.rowspan), table.rows.length - r),
      cs: Math.min(extent(span.colspan), table.columns.length - c) }];
  });
}
function saveSpan(table: Table, key: string, rs: number, cs: number) {
  const spans = table.spans || (table.spans = {});
  if (rs <= 1 && cs <= 1) delete spans[key];
  else spans[key] = { ...(rs > 1 ? { rowspan: rs } : {}), ...(cs > 1 ? { colspan: cs } : {}) };
}

/** Report snapshot only. Stable IDs keep unaffected cells in place. */
export function insertReportTableAxis(table: Table, axis: Axis, at: number, id: string): string | null {
  const items = axis === 'row' ? table.rows : table.columns;
  if (!Number.isInteger(at) || at < 0 || at > items.length || table.rows.some(x => x.id === id) || table.columns.some(x => x.id === id)) return '新增位置无效，请重新选择单元格';
  const rects = rectangles(table);
  if (axis === 'row') table.rows.splice(at, 0, { id });
  else table.columns.splice(at, 0, { id, label: '新列' });
  for (const rect of rects) {
    const start = axis === 'row' ? rect.r : rect.c, size = axis === 'row' ? rect.rs : rect.cs;
    if (start < at && at < start + size) saveSpan(table, rect.key, rect.rs + Number(axis === 'row'), rect.cs + Number(axis === 'col'));
  }
  return null;
}

export function deleteReportTableAxis(table: Table, axis: Axis, id: string): string | null {
  const items = axis === 'row' ? table.rows : table.columns, at = items.findIndex(x => x.id === id);
  if (at < 0) return '目标已变化，请重新选择单元格';
  if (items.length <= 1) return '表格至少保留一行和一列';
  const rects = rectangles(table);
  // Never silently move a merged value onto a covered cell with its own stored value.
  if (rects.some(rect => (axis === 'row' ? rect.r === at && rect.rs > 1 : rect.c === at && rect.cs > 1))) return '此行或列包含合并单元格的起始格，请先拆分后再删除';
  if (axis === 'row') table.rows.splice(at, 1); else table.columns.splice(at, 1);
  for (const key of Object.keys(table.cells)) {
    const parts = key.split('::');
    if (parts[axis === 'row' ? 0 : 1] === id) delete table.cells[key];
  }
  for (const rect of rects) {
    const start = axis === 'row' ? rect.r : rect.c, size = axis === 'row' ? rect.rs : rect.cs;
    if (start === at) { if (table.spans) delete table.spans[rect.key]; }
    else if (start < at && at < start + size) saveSpan(table, rect.key, rect.rs - Number(axis === 'row'), rect.cs - Number(axis === 'col'));
  }
  return null;
}

export function resizeReportTableMerge(table: Table, rowId: string, colId: string, dimension: 'rowspan' | 'colspan', value: number): string | null {
  const r = table.rows.findIndex(x => x.id === rowId), c = table.columns.findIndex(x => x.id === colId), key = `${rowId}::${colId}`;
  if (r < 0 || c < 0 || !Number.isInteger(value) || value < 1) return '合并范围无效';
  const old = table.spans?.[key] || {};
  const rs = dimension === 'rowspan' ? value : extent(old.rowspan), cs = dimension === 'colspan' ? value : extent(old.colspan);
  if (r + rs > table.rows.length || c + cs > table.columns.length) return '合并范围超出表格';
  if (rectangles(table).some(other => other.key !== key && (other.rs > 1 || other.cs > 1) && r < other.r + other.rs && r + rs > other.r && c < other.c + other.cs && c + cs > other.c)) return '范围内已有合并单元格，请先拆分后再合并';
  saveSpan(table, key, rs, cs);
  if (!(key in table.cells)) table.cells[key] = '';
  return null;
}

export function mergeReportTableRange(table: Table, top: number, left: number, bottom: number, right: number): string | null {
  if (![top, left, bottom, right].every(Number.isInteger) || top < 0 || left < 0 || bottom < top || right < left || bottom >= table.rows.length || right >= table.columns.length) return '选区已变化，请重新选择';
  const intersecting = rectangles(table).filter(r => r.r <= bottom && r.r + r.rs > top && r.c <= right && r.c + r.cs > left);
  if (intersecting.some(r => r.r < top || r.c < left || r.r + r.rs - 1 > bottom || r.c + r.cs - 1 > right)) return '请完整选中已有合并单元格，或先拆分';
  for (const r of intersecting) { if (table.spans) delete table.spans[r.key]; }
  saveSpan(table, `${table.rows[top].id}::${table.columns[left].id}`, bottom - top + 1, right - left + 1);
  return null;
}

/** Validate a whole multi-row/column deletion before committing any part of it. */
export function deleteReportTableRange(table: Table, axis: Axis, from: number, to: number): string | null {
  const items = axis === 'row' ? table.rows : table.columns;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to >= items.length) return '选区已变化，请重新选择';
  if (to - from + 1 >= items.length) return '表格至少保留一行和一列';
  const next = structuredClone(table);
  for (const item of items.slice(from, to + 1).reverse()) {
    const error = deleteReportTableAxis(next, axis, item.id);
    if (error) return error;
  }
  table.rows = next.rows; table.columns = next.columns; table.cells = next.cells; table.spans = next.spans;
  return null;
}
