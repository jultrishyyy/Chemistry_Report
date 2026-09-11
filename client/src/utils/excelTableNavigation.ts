import type React from 'react';

const FOCUSABLE = [
  'textarea:not(:disabled)',
  'input:not(:disabled):not([type="hidden"])',
  '[contenteditable="true"]',
  '.ant-select:not(.ant-select-disabled) .ant-select-selector',
].join(',');

function focusableIn(cell: HTMLTableCellElement | null): HTMLElement | null {
  if (!cell) return null;
  const element = cell.querySelector<HTMLElement>(FOCUSABLE);
  if (!element || element.closest('[aria-disabled="true"]')) return null;
  return element;
}

/** 给当前录入格加 Excel 式活动边框；只在同一张表里保留一个标记。 */
export function markSpreadsheetActiveCell(target: HTMLElement | null) {
  const cell = target?.closest<HTMLTableCellElement>('td, th');
  const table = cell?.closest<HTMLTableElement>('table');
  if (!cell || !table) return;
  table.querySelectorAll('.spreadsheet-active-cell').forEach(element => element.classList.remove('spreadsheet-active-cell'));
  cell.classList.add('spreadsheet-active-cell');
}

function focusAndSelect(element: HTMLElement | null) {
  if (!element) return;
  element.focus();
  markSpreadsheetActiveCell(element);
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    element.select();
  }
  element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

type VisualTableGrid = {
  slots: Array<Array<HTMLTableCellElement | undefined>>;
  origins: Map<HTMLTableCellElement, { row: number; col: number }>;
  width: number;
};

/** 将带 rowspan/colspan 的 HTML table 展开为视觉坐标网格。 */
function buildVisualTableGrid(table: HTMLTableElement): VisualTableGrid {
  const rows = Array.from(table.rows);
  const slots: Array<Array<HTMLTableCellElement | undefined>> = Array.from({ length: rows.length }, () => []);
  const origins = new Map<HTMLTableCellElement, { row: number; col: number }>();
  let width = 0;
  rows.forEach((row, rowIndex) => {
    let col = 0;
    Array.from(row.cells).forEach(cell => {
      while (slots[rowIndex][col]) col++;
      origins.set(cell, { row: rowIndex, col });
      const rowSpan = Math.max(1, cell.rowSpan || 1);
      const colSpan = Math.max(1, cell.colSpan || 1);
      for (let rr = rowIndex; rr < Math.min(rows.length, rowIndex + rowSpan); rr++) {
        for (let cc = col; cc < col + colSpan; cc++) slots[rr][cc] = cell;
      }
      col += colSpan;
      width = Math.max(width, col);
    });
  });
  return { slots, origins, width };
}

function nextFocusableInVisualGrid(
  grid: VisualTableGrid,
  current: HTMLTableCellElement,
  direction: 'left' | 'right' | 'up' | 'down',
): HTMLElement | null {
  const origin = grid.origins.get(current);
  if (!origin) return null;
  const rowSpan = Math.max(1, current.rowSpan || 1);
  const colSpan = Math.max(1, current.colSpan || 1);
  let row = origin.row;
  let col = origin.col;
  if (direction === 'left') col--;
  if (direction === 'right') col += colSpan;
  if (direction === 'up') row--;
  if (direction === 'down') row += rowSpan;

  const step = () => {
    if (direction === 'left') col--;
    if (direction === 'right') col++;
    if (direction === 'up') row--;
    if (direction === 'down') row++;
  };
  const inBounds = () => row >= 0 && row < grid.slots.length && col >= 0 && col < grid.width;
  let last: HTMLTableCellElement | undefined;
  while (inBounds()) {
    const candidate = grid.slots[row]?.[col];
    if (candidate && candidate !== last) {
      const focusable = focusableIn(candidate);
      if (focusable) return focusable;
      last = candidate;
    }
    step();
  }
  return null;
}

/**
 * 表格录入的 Excel 式键盘导航。
 *
 * - 方向键：四向移动；Enter：向下，到最底行时向右；Shift+Enter：在当前格内换行。
 * - 方向键：移动到相邻可编辑格。
 * - 自动跳过公式、固定文字、被合并覆盖的格和禁用控件。
 * - 选择框可作为活动格，但由受控组件决定何时展开：Enter 展开，展开时方向键/Enter 留给选项；收起后方向键继续移动。
 */
export function handleExcelTableKeyDown(event: React.KeyboardEvent<HTMLTableElement>, onForwardBoundary?: () => void, onBackwardBoundary?: () => void) {
  if (event.defaultPrevented || event.nativeEvent.isComposing) return;
  // Keep text selection and OS/editor shortcuts local, especially during report cross-selection.
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
  const key = event.key;
  if (!['Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) return;

  const target = event.target as HTMLElement;
  if (!target.matches('input, textarea, [contenteditable="true"], .ant-select-selector')
    && !target.closest('.ant-select-selector')) return;

  // 文本格内用 Shift+Enter 换行；普通 Enter 始终用于移动，避免最后一行意外换行。
  if (key === 'Enter' && event.shiftKey) return;

  // 选择框关闭时：Enter 交给它展开；方向键仍由本导航移动到相邻格。
  // 展开时：所有键交给下拉菜单完成上下选择与 Enter 确认。
  const select = target.closest<HTMLElement>('.ant-select');
  if (select?.classList.contains('ant-select-open')) return;
  if (select && key === 'Enter') return;

  const cell = target.closest<HTMLTableCellElement>('td, th');
  const table = cell?.closest<HTMLTableElement>('table');
  const row = cell?.parentElement as HTMLTableRowElement | null;
  if (!cell || !table || !row) return;

  const grid = buildVisualTableGrid(table);
  const direction = key === 'ArrowLeft' ? 'left'
    : key === 'ArrowRight' ? 'right'
      : key === 'ArrowUp' ? 'up' : 'down';
  let destination = nextFocusableInVisualGrid(grid, cell, direction);

  // 最底行按 Enter 没有下一行时，改为同一行向右移动；不让 textarea 退化成直接换行。
  if (!destination && key === 'Enter') {
    destination = nextFocusableInVisualGrid(grid, cell, 'right');
  }

  if (!destination) {
    if (onBackwardBoundary && (key === 'ArrowLeft' || key === 'ArrowUp')) {
      event.preventDefault(); event.stopPropagation(); onBackwardBoundary(); return;
    }
    if (onForwardBoundary && (key === 'ArrowRight' || key === 'ArrowDown')) {
      event.preventDefault(); event.stopPropagation(); onForwardBoundary(); return;
    }
    // 最右下角没有下一格时也保持 Enter=移动的语义，不在单元格内插入换行。
    if (key === 'Enter') event.preventDefault();
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  focusAndSelect(destination);
}
