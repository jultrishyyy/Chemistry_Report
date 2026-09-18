import { SPREADSHEET_FUNCTIONS, maskFormulaStrings } from './spreadsheet-expression';

export function formulaCompletion(text: string, caret: number) {
  text = maskFormulaStrings(text);
  const match = /[A-Za-z][A-Za-z0-9_.]*$/.exec(text.slice(0, caret));
  if (!match) return null;
  const start = caret - match[0].length;
  if (start && /[\w.]/.test(text[start - 1])) return null;
  const end = caret + (/^[A-Za-z0-9_.]*/.exec(text.slice(caret))?.[0].length || 0);
  const query = match[0].toUpperCase();
  const options = SPREADSHEET_FUNCTIONS.filter(name => name.includes(query))
    .sort((a, b) => Number(b.startsWith(query)) - Number(a.startsWith(query)) || a.localeCompare(b));
  return options.length ? { start, end, options } : null;
}

/** Replace a selected range/address, otherwise insert exactly at the caret. */
export function formulaInsertionRange(text: string, start: number, end: number) {
  if (start !== end) return { start, end };
  for (const match of maskFormulaStrings(text).matchAll(/\b[A-Za-z]+[1-9]\d*(?::[A-Za-z]+[1-9]\d*)?\b/g)) {
    const left = match.index!, right = left + match[0].length;
    if (start >= left && start <= right && !/^\s*\(/.test(text.slice(right))) return { start: left, end: right };
  }
  return { start, end };
}

export function formulaParameterHint(text: string, caret: number): string {
  const stack: { name: string; arg: number }[] = [];
  for (const token of maskFormulaStrings(text).slice(0, caret).matchAll(/([A-Za-z][A-Za-z0-9_.]*)\s*\(|[(),]/g)) {
    if (token[0] === ')') stack.pop();
    else if (token[0] === ',') { if (stack.length) stack[stack.length - 1].arg++; }
    else stack.push({ name: (token[1] || '').toUpperCase(), arg: 0 });
  }
  const current = stack.at(-1);
  if (!current?.name || !SPREADSHEET_FUNCTIONS.includes(current.name)) return '';
  const signatures: Record<string, string> = {
    IFERROR: 'IFERROR(计算表达式, 出错时返回值)',
    IF: 'IF(条件, 成立时返回值, 不成立时返回值)',
    AND: 'AND(条件1, 条件2, …)', OR: 'OR(条件1, 条件2, …)', NOT: 'NOT(条件)',
    SUM: 'SUM(数值或区域, …)', AVERAGE: 'AVERAGE(数值或区域, …)',
    ROUND: 'ROUND(数值, 小数位数)', TRUNC: 'TRUNC(数值, 小数位数)',
    POWER: 'POWER(底数, 指数)', SQRT: 'SQRT(数值)', LOG: 'LOG(数值, 底数)',
  };
  return `${signatures[current.name] || `${current.name}(数值参数)`} · 第 ${current.arg + 1} 个参数`;
}
