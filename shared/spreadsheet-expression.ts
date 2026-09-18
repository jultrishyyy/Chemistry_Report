import { ARITHMETIC_FUNCTIONS, evalArithmetic, validateArithmetic } from './expr-eval';
import { FormulaError, isFormulaError } from './formula-error';

export const SPREADSHEET_FUNCTIONS = [...ARITHMETIC_FUNCTIONS, 'IF', 'AND', 'OR', 'NOT'];
export type SpreadsheetValue = number | string | boolean | null;
type Node = { kind: 'value'; value: SpreadsheetValue } | { kind: 'id'; name: string }
  | { kind: 'call'; name: string; args: Node[] }
  | { kind: 'op'; op: string; args: Node[] };
type Token = { text: string; string?: boolean };

/** Double quotes use Excel's doubled-quote escaping; never rewrite literal text. */
export function mapFormulaCode(text: string, map: (code: string) => string): string {
  return text.split(/("(?:[^"]|"")*"|"[^"]*$)/g).map((part, i) => i % 2 ? part : map(part)).join('');
}
export function maskFormulaStrings(text: string): string {
  return text.replace(/"(?:[^"]|"")*"|"[^"]*$/g, part => ' '.repeat(part.length));
}

function parse(text: string): Node {
  if (text.length > 100000) throw new Error('公式过长');
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    if (/\s/.test(text[i])) { i++; continue; }
    if (text[i] === '"') {
      i++; let value = '', closed = false;
      while (i < text.length) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') { value += '"'; i += 2; continue; }
          i++; closed = true; break;
        }
        value += text[i++];
      }
      if (!closed) throw new Error('文本缺少结束双引号');
      tokens.push({ text: value, string: true }); continue;
    }
    const match = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|^[A-Za-z_][A-Za-z0-9_.]*|^(?:<>|<=|>=|[+*/^%(),=<>\-&])/.exec(text.slice(i));
    if (!match) throw new Error(`无法识别字符 ${text[i]}`);
    tokens.push({ text: match[0] }); i += match[0].length;
  }
  let position = 0, depth = 0;
  const peek = () => tokens[position]?.string ? undefined : tokens[position]?.text;
  const precedence: Record<string, number> = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 6 };
  function expression(min = 0): Node {
    if (++depth > 128) throw new Error('公式嵌套过深');
    const token = tokens[position++];
    if (!token) throw new Error('公式尚未填写完整');
    let node: Node;
    if (token.string) node = { kind: 'value', value: token.text };
    else if (token.text === '+' || token.text === '-') node = { kind: 'op', op: `u${token.text}`, args: [expression(5)] };
    else if (token.text === '(') {
      node = expression();
      if (peek() !== ')') throw new Error('缺少右括号'); position++;
    } else if (/^(\d|\.)/.test(token.text)) node = { kind: 'value', value: Number(token.text) };
    else if (/^[A-Za-z_]/.test(token.text)) {
      if (peek() === '(') {
        position++; const args: Node[] = [];
        if (peek() !== ')') {
          do { args.push(expression()); if (peek() !== ',') break; position++; } while (true);
        }
        if (peek() !== ')') throw new Error('函数缺少右括号'); position++;
        const name = token.text.toUpperCase();
        if (!SPREADSHEET_FUNCTIONS.includes(name)) throw new Error(`暂不支持函数 ${name}`);
        if (['IF', 'AND', 'OR', 'NOT'].includes(name)) {
          if ((name === 'IF' && args.length !== 3) || (name === 'NOT' && args.length !== 1) || !args.length) throw new Error(`函数 ${name} 的参数数量不正确`);
        } else validateArithmetic(`${name}(${args.map(() => '1').join(',')})`);
        node = { kind: 'call', name, args };
      } else node = { kind: 'id', name: token.text };
    } else throw new Error(`公式语法错误：${token.text}`);
    while (peek() === '%') { position++; node = { kind: 'op', op: '%', args: [node] }; }
    while (peek() && precedence[peek()!] !== undefined && precedence[peek()!] >= min) {
      const op = tokens[position++].text, priority = precedence[op];
      node = { kind: 'op', op, args: [node, expression(op === '^' ? priority : priority + 1)] };
    }
    depth--; return node;
  }
  const root = expression();
  if (position !== tokens.length) throw new Error('公式存在多余内容');
  return root;
}

export function spreadsheetIdentifiers(text: string): string[] {
  const ids = new Set<string>();
  function walk(node: Node) {
    if (node.kind === 'id' && !['TRUE', 'FALSE', 'PI', 'E'].includes(node.name.toUpperCase())) ids.add(node.name);
    if ('args' in node) node.args.forEach(walk);
  }
  walk(parse(text)); return [...ids];
}

/** Errors are internal exceptions, distinct from valid empty-string results.
 * Parse/validate ALL branches first; evaluate only the selected IF branch. */
export function evalSpreadsheetResult(text: string, vars: Record<string, unknown>): SpreadsheetValue | FormulaError {
  const numeric = (v: SpreadsheetValue): number => {
    if (v === null || v === '' || (typeof v === 'string' && !v.trim())) throw new FormulaError('#VALUE!', '空值不能参与数值运算');
    const n = Number(v); if (!Number.isFinite(n)) throw new FormulaError('#VALUE!', '不是有效数值'); return n;
  };
  const truth = (v: SpreadsheetValue): boolean => typeof v === 'boolean' ? v : numeric(v) !== 0;
  const finite = (n: number) => { if (!Number.isFinite(n)) throw new FormulaError('#NUM!', '计算结果不是有限数值'); return n; };
  function evaluate(node: Node): SpreadsheetValue {
    if (node.kind === 'value') return node.value;
    if (node.kind === 'id') {
      const name = node.name.toUpperCase();
      if (name === 'TRUE' || name === 'FALSE') return name === 'TRUE';
      if (name === 'PI') return Math.PI;
      if (name === 'E') return Math.E;
      if (!Object.prototype.hasOwnProperty.call(vars, node.name)) throw new FormulaError('#REF!', '引用无效');
      const value = vars[node.name];
      if (isFormulaError(value)) throw value;
      if (value === undefined || value === null) return null;
      if (typeof value !== 'number' && typeof value !== 'string' && typeof value !== 'boolean') throw new Error('不支持的数据类型');
      if (typeof value === 'number') finite(value);
      return value;
    }
    if (node.kind === 'call') {
      if (node.name === 'IF') return evaluate(node.args[truth(evaluate(node.args[0])) ? 1 : 2]);
      if (node.name === 'IFERROR') { try { return evaluate(node.args[0]); } catch { return evaluate(node.args[1]); } }
      const args = node.args.map(evaluate);
      if (node.name === 'AND') return args.map(truth).every(Boolean);
      if (node.name === 'OR') return args.map(truth).some(Boolean);
      if (node.name === 'NOT') return !truth(args[0]);
      const numbers = args.map(numeric);
      const result = evalArithmetic(`${node.name}(${numbers.map((_, index) => `x${index}`).join(',')})`, Object.fromEntries(numbers.map((n, i) => [`x${i}`, n])));
      if (result === null) throw new FormulaError('#NUM!', '数学函数无法计算该数值'); return result;
    }
    const a = evaluate(node.args[0]);
    if (node.op === 'u-') return -numeric(a);
    if (node.op === 'u+') return numeric(a);
    if (node.op === '%') return numeric(a) / 100;
    const b = evaluate(node.args[1]);
    if (node.op === '&') return String(a ?? '') + String(b ?? '');
    if (['=', '<>', '<', '>', '<=', '>='].includes(node.op)) {
      const left = typeof a === 'string' ? a.toLowerCase() : a;
      const right = typeof b === 'string' ? b.toLowerCase() : b;
      // Data-entry numeric cells may store their values as decimal strings.
      // Never coerce blank strings to zero when comparing them.
      const numberLike = (v: SpreadsheetValue) => typeof v === 'number' || (typeof v === 'string' && !!v.trim() && Number.isFinite(Number(v)));
      const equal = left === right || (a === null && b === '') || (b === null && a === '')
        || (numberLike(a) && numberLike(b) && Number(a) === Number(b));
      if (node.op === '=') return equal;
      if (node.op === '<>') return !equal;
      const x = numeric(a), y = numeric(b);
      return node.op === '<' ? x < y : node.op === '>' ? x > y : node.op === '<=' ? x <= y : x >= y;
    }
    const x = numeric(a), y = numeric(b);
    if (node.op === '/' && y === 0) throw new FormulaError('#DIV/0!', '除数为零');
    return finite(node.op === '+' ? x + y : node.op === '-' ? x - y : node.op === '*' ? x * y : node.op === '/' ? x / y : x ** y);
  }
  try { return evaluate(parse(text)); } catch (error) {
    return isFormulaError(error) ? error : new FormulaError('#ERROR!', error instanceof Error ? error.message : '公式无法计算');
  }
}

/** Legacy API keeps its nullable result; grid execution uses the detailed API. */
export function evalSpreadsheet(text: string, vars: Record<string, unknown>): SpreadsheetValue {
  const result = evalSpreadsheetResult(text, vars);
  return isFormulaError(result) ? null : result;
}
