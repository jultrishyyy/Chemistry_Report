import type { FieldDefinition } from './types';

/** Coordinates are an entry convenience only; persist the resolved stable cell keys. */
export function formulaAddressKeys(table: NonNullable<FieldDefinition['free_table']>, text: string): string[] {
  const match = /^\s*\$?([A-Z]+)\$?([1-9]\d*)(?:\s*[:：]\s*\$?([A-Z]+)\$?([1-9]\d*))?\s*$/i.exec(text);
  if (!match) throw new Error('请输入格子位置或区域，例如 B2 或 B2:B8');
  const point = (col: string, row: string) => ({ r: Number(row) - 1, c: [...col.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1 });
  const a = point(match[1], match[2]), b = match[3] ? point(match[3], match[4]) : a;
  if ([a, b].some(p => !Number.isSafeInteger(p.r) || !Number.isSafeInteger(p.c) || p.r >= table.rows.length || p.c >= table.columns.length)) throw new Error('区域超出所选表格，请检查行号和列号');
  return formulaRangeKeys(table, a, b);
}

/** Row-major source order; covered merged cells and headers are never duplicate operands. */
export function formulaRangeKeys(table: NonNullable<FieldDefinition['free_table']>, a: { r: number; c: number }, b: { r: number; c: number }) {
  const covered = new Set<string>();
  for (const [key, span] of Object.entries(table.spans || {})) {
    const [r, c] = key.split('::');
    const ri = table.rows.findIndex(x => x.id === r), ci = table.columns.findIndex(x => x.id === c);
    if (ri < 0 || ci < 0) continue;
    for (let dr = 0; dr < (span.rowspan || 1); dr++) for (let dc = 0; dc < (span.colspan || 1); dc++) {
      if (dr || dc) covered.add(`${ri + dr},${ci + dc}`);
    }
  }
  const keys: string[] = [];
  for (let r = Math.max(0, Math.min(a.r, b.r)); r <= Math.min(table.rows.length - 1, Math.max(a.r, b.r)); r++) {
    for (let c = Math.max(0, Math.min(a.c, b.c)); c <= Math.min(table.columns.length - 1, Math.max(a.c, b.c)); c++) {
      const key = `${table.rows[r].id}::${table.columns[c].id}`;
      if (!covered.has(`${r},${c}`) && !table.header_cells?.[key]) keys.push(key);
    }
  }
  return keys;
}

/** Compact display only. Persisted sources remain stable cell keys, not A1 coordinates. */
export function formulaRangeLabel(table: NonNullable<FieldDefinition['free_table']>, keys: string[]): string | undefined {
  if (!keys.length) return;
  const positions = keys.map(key => {
    const [r, c] = key.split('::');
    return { r: table.rows.findIndex(x => x.id === r), c: table.columns.findIndex(x => x.id === c) };
  });
  if (positions.some(p => p.r < 0 || p.c < 0) || new Set(keys).size !== keys.length) return;
  const r0 = Math.min(...positions.map(p => p.r)), r1 = Math.max(...positions.map(p => p.r));
  const c0 = Math.min(...positions.map(p => p.c)), c1 = Math.max(...positions.map(p => p.c));
  if ((r1 - r0 + 1) * (c1 - c0 + 1) !== keys.length) return;
  const address = (r: number, c: number) => {
    let col = '', n = c + 1;
    while (n) { col = String.fromCharCode(65 + (n - 1) % 26) + col; n = Math.floor((n - 1) / 26); }
    return `${col}${r + 1}`;
  };
  return keys.length === 1 ? address(r0, c0) : `${address(r0, c0)}:${address(r1, c1)}`;
}
