/** Excel/表格软件复制出来的 text/plain：列用 Tab，行用换行。 */
export function parseSpreadsheetClipboard(text: string): string[][] {
  const normalized = text.replace(/\r\n?/g, '\n');
  const rows: string[][] = []; let row: string[] = [], value = '', quoted = false;
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (quoted) {
      if (ch === '"' && normalized[i + 1] === '"') { value += '"'; i++; }
      else if (ch === '"') quoted = false;
      else value += ch;
    } else if (ch === '"' && value === '') quoted = true;
    else if (ch === '\t') { row.push(value); value = ''; }
    else if (ch === '\n') { row.push(value); rows.push(row); row = []; value = ''; }
    else value += ch;
  }
  if (value !== '' || row.length || !normalized.endsWith('\n')) { row.push(value); rows.push(row); }
  return rows;
}

export function serializeSpreadsheetClipboard(rows: string[][]): string {
  return rows.map(row => row.map(value => /[\t\n\r"]/.test(value)
    ? `"${value.replace(/"/g, '""')}"` : value).join('\t')).join('\r\n');
}
