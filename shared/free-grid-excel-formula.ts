import type { FieldDefinition } from './types';
import type { Formula } from './formula-engine';
import { mapFormulaCode, spreadsheetIdentifiers } from './spreadsheet-expression';

type Table = NonNullable<FieldDefinition['free_table']>;
const aggregates = new Set(['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'PRODUCT', 'MEDIAN', 'VAR.S', 'VAR.P', 'STDEV.S', 'STDEV.P']);
export function gridFormulaAddress(table: Table, key: string): string {
  const [r, c] = key.split('::');
  const ri = table.rows.findIndex(x => x.id === r);
  let ci = table.columns.findIndex(x => x.id === c) + 1;
  if (ri < 0 || ci < 1) return '#REF!';
  let name = '';
  while (ci) { ci--; name = String.fromCharCode(65 + ci % 26) + name; ci = Math.floor(ci / 26); }
  return `${name}${ri + 1}`;
}

export function compileGridFormula(table: Table, text: string): Formula & { sources: string[] } {
  if (text.length > 10000) throw new Error('公式过长');
  const sources: string[] = [];
  const point = (address: string) => {
    const match = /^([A-Z]+)([1-9]\d*)$/i.exec(address);
    if (!match) throw new Error(`无效地址 ${address}`);
    const c = [...match[1].toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const r = Number(match[2]) - 1;
    if (!table.rows[r] || !table.columns[c]) throw new Error(`地址 ${address} 超出表格范围`);
    return { r, c };
  };
  const variable = (r: number, c: number) => {
    const key = `${table.rows[r].id}::${table.columns[c].id}`;
    let index = sources.indexOf(key);
    if (index < 0) { sources.push(key); index = sources.length - 1; }
    return `v${index + 1}`;
  };
  let expression = text.trim().replace(/^=\s*/, '');
  if (!expression) throw new Error('请输入公式');
  const literals: string[] = [];
  expression = expression.replace(/"(?:[^"]|"")*"/g, literal => { literals.push(literal); return `_literal_${literals.length - 1}`; });
  // A range is currently supported only as an entire aggregate argument.
  expression = expression.replace(/\b([A-Z]+[1-9]\d*)\s*:\s*([A-Z]+[1-9]\d*)\b/gi, (whole, a, b, offset) => {
    const prefix = expression.slice(0, offset);
    const stack: string[] = [];
    for (const token of prefix.matchAll(/([A-Z][A-Z0-9_.]*)\s*\(|[()]/gi)) {
      if (token[0] === ')') stack.pop(); else stack.push((token[1] || '').toUpperCase());
    }
    if (!aggregates.has(stack.at(-1) || '') || !/[,(]\s*$/.test(prefix)
      || !/^\s*[,)]/.test(expression.slice(offset + whole.length))) throw new Error('区域引用请放在 SUM、AVERAGE 等聚合函数的参数中');
    const start = point(a), end = point(b), values: string[] = [];
    if ((Math.abs(end.r - start.r) + 1) * (Math.abs(end.c - start.c) + 1) > 20000) throw new Error('引用区域过大');
    for (let r = Math.min(start.r, end.r); r <= Math.max(start.r, end.r); r++)
      for (let c = Math.min(start.c, end.c); c <= Math.max(start.c, end.c); c++) values.push(variable(r, c));
    // Protected placeholders avoid interpreting internal v1 as an address.
    return values.map(v => `_${v}`).join(',');
  });
  expression = expression.replace(/\b([A-Z]+[1-9]\d*)\b(?!\s*\()/gi, address => {
    const { r, c } = point(address); return variable(r, c);
  }).replace(/\b_v(\d+)\b/g, 'v$1');
  expression = expression.replace(/\b_literal_(\d+)\b/g, (_, index) => literals[Number(index)] ?? _);
  for (const id of spreadsheetIdentifiers(expression)) {
    if (!/^v[1-9]\d*$/.test(id) || Number(id.slice(1)) > sources.length) throw new Error(`无法识别 ${id}，请使用 A1 这样的格子地址`);
  }
  return { type: 'custom', sources, expression, params: { expression_dialect: 'excel_v1' } };
}

/** Resolve stable IDs to their current addresses, including legacy aliases. */
export function displayGridFormula(table: Table, formula?: Formula): string | null {
  if (!formula) return '';
  if (formula.type !== 'custom' || (formula.sources || []).some(s => s.startsWith('@free-grid:'))) return null;
  const aliases = formula.params?.source_aliases as Record<string, string> | undefined;
  const names = new Map<string, string>();
  (formula.sources || []).forEach((key, index) => {
    const address = gridFormulaAddress(table, key);
    if (aliases?.[key]) names.set(aliases[key], address);
    names.set(`v${index + 1}`, address);
  });
  return '=' + mapFormulaCode(formula.expression || '', code => code.replace(/\b[A-Za-z_][A-Za-z0-9_.]*\b/g, id => names.get(id) ?? id));
}
