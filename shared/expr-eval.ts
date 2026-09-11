/**
 * 极简算术表达式求值器。
 *
 * 支持：+ - * / ^ %、括号、数字、标识符及白名单数学函数。
 *
 * 用于数据表格列级公式：每行用本行其他列的值算出本列。
 * 不用 eval，不依赖第三方包，safe for user input。
 */

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'id'; value: string }
  | { kind: 'op'; value: '+' | '-' | '*' | '/' | '^' | '%' }
  | { kind: 'lp' }
  | { kind: 'rp' }
  | { kind: 'comma' };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\n') { i++; continue; }
    if (ch === '(') { tokens.push({ kind: 'lp' }); i++; continue; }
    if (ch === ')') { tokens.push({ kind: 'rp' }); i++; continue; }
    if (ch === ',') { tokens.push({ kind: 'comma' }); i++; continue; }
    if ('+-*/^%'.includes(ch)) {
      tokens.push({ kind: 'op', value: ch as any });
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      tokens.push({ kind: 'num', value: Number(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      // 函数名允许 Excel 常见的点号（STDEV.S / VAR.P）；变量别名仍由调用方限制为安全标识符。
      while (j < src.length && /[A-Za-z0-9_.]/.test(src[j])) j++;
      tokens.push({ kind: 'id', value: src.slice(i, j) });
      i = j;
      continue;
    }
    throw new Error(`表达式非法字符: '${ch}' @ ${i}`);
  }
  return tokens;
}

/**
 * Pratt 风格简化版：
 *   expr  := term   (('+' | '-') term)*
 *   term  := unary  (('*' | '/') unary)*
 *   unary := ('-' | '+') unary | power
 *   power := primary ('^' unary)?       // 右结合
 *   primary := num | id | function-call | '(' expr ')'，末尾可带百分号
 */
class Parser {
  private pos = 0;
  private tokens: Token[];
  constructor(tokens: Token[]) { this.tokens = tokens; }

  private peek(): Token | undefined { return this.tokens[this.pos]; }
  private consume(): Token { return this.tokens[this.pos++]; }

  parse(resolve: (id: string) => number, call: (name: string, args: number[]) => number): number {
    const v = this.expr(resolve, call);
    if (this.pos < this.tokens.length) throw new Error('表达式有多余内容');
    return v;
  }

  private expr(resolve: (id: string) => number, call: (name: string, args: number[]) => number): number {
    let left = this.term(resolve, call);
    while (true) {
      const t = this.peek();
      if (!t || t.kind !== 'op' || (t.value !== '+' && t.value !== '-')) break;
      this.consume();
      const right = this.term(resolve, call);
      left = t.value === '+' ? left + right : left - right;
    }
    return left;
  }

  private term(resolve: (id: string) => number, call: (name: string, args: number[]) => number): number {
    let left = this.unary(resolve, call);
    while (true) {
      const t = this.peek();
      if (!t || t.kind !== 'op' || (t.value !== '*' && t.value !== '/')) break;
      this.consume();
      const right = this.unary(resolve, call);
      if (t.value === '/') {
        if (right === 0) return NaN;
        left = left / right;
      } else {
        left = left * right;
      }
    }
    return left;
  }

  private unary(resolve: (id: string) => number, call: (name: string, args: number[]) => number): number {
    const t = this.peek();
    if (t && t.kind === 'op' && (t.value === '-' || t.value === '+')) {
      this.consume();
      const v = this.unary(resolve, call);
      return t.value === '-' ? -v : v;
    }
    return this.power(resolve, call);
  }

  private power(resolve: (id: string) => number, call: (name: string, args: number[]) => number): number {
    let left = this.primary(resolve, call);
    const t = this.peek();
    if (t?.kind === 'op' && t.value === '^') {
      this.consume();
      left = Math.pow(left, this.unary(resolve, call));
    }
    return left;
  }

  private primary(resolve: (id: string) => number, call: (name: string, args: number[]) => number): number {
    const t = this.consume();
    if (!t) throw new Error('表达式提前结束');
    let value: number;
    if (t.kind === 'num') value = t.value;
    else if (t.kind === 'id') {
      if (this.peek()?.kind === 'lp') {
        this.consume();
        const args: number[] = [];
        if (this.peek()?.kind !== 'rp') {
          while (true) {
            args.push(this.expr(resolve, call));
            if (this.peek()?.kind !== 'comma') break;
            this.consume();
          }
        }
        const rp = this.consume();
        if (!rp || rp.kind !== 'rp') throw new Error('函数缺少右括号');
        value = call(t.value, args);
      } else value = resolve(t.value);
    }
    else if (t.kind === 'lp') {
      value = this.expr(resolve, call);
      const rp = this.consume();
      if (!rp || rp.kind !== 'rp') throw new Error('缺少右括号');
    } else throw new Error(`表达式非法语法`);
    while (this.peek()?.kind === 'op' && (this.peek() as { kind: 'op'; value: string }).value === '%') {
      this.consume();
      value /= 100;
    }
    return value;
  }
}

const roundScale = (digits: number) => Math.pow(10, Math.trunc(digits));

function callMathFunction(rawName: string, args: number[]): number {
  const name = rawName.toUpperCase();
  if (args.some(value => !Number.isFinite(value))) return NaN;
  const one = () => { if (args.length !== 1) return NaN; return args[0]; };
  const two = () => args.length === 2 ? args : null;
  switch (name) {
    case 'SUM': return args.length ? args.reduce((sum, value) => sum + value, 0) : NaN;
    case 'AVERAGE': return args.length ? args.reduce((sum, value) => sum + value, 0) / args.length : NaN;
    case 'MIN': return args.length ? Math.min(...args) : NaN;
    case 'MAX': return args.length ? Math.max(...args) : NaN;
    case 'COUNT': return args.length;
    case 'PRODUCT': return args.length ? args.reduce((product, value) => product * value, 1) : NaN;
    case 'MEDIAN': {
      if (!args.length) return NaN;
      const values = [...args].sort((a, b) => a - b);
      const middle = Math.floor(values.length / 2);
      return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
    }
    case 'VAR.S':
    case 'VAR_S':
    case 'STDEV.S':
    case 'STDEV_S': {
      if (args.length < 2) return NaN;
      const mean = args.reduce((sum, value) => sum + value, 0) / args.length;
      const variance = args.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / (args.length - 1);
      return name.startsWith('STDEV') ? Math.sqrt(variance) : variance;
    }
    case 'VAR.P':
    case 'VAR_P':
    case 'STDEV.P':
    case 'STDEV_P': {
      if (!args.length) return NaN;
      const mean = args.reduce((sum, value) => sum + value, 0) / args.length;
      const variance = args.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / args.length;
      return name.startsWith('STDEV') ? Math.sqrt(variance) : variance;
    }
    case 'POWER':
    case 'POW': { const pair = two(); return pair ? Math.pow(pair[0], pair[1]) : NaN; }
    case 'ROOT': {
      const pair = two();
      if (!pair || pair[1] === 0) return NaN;
      if (pair[0] < 0 && Number.isInteger(pair[1]) && Math.abs(pair[1] % 2) === 1) {
        return -Math.pow(Math.abs(pair[0]), 1 / pair[1]);
      }
      return Math.pow(pair[0], 1 / pair[1]);
    }
    case 'SQRT': return Math.sqrt(one());
    case 'ABS': return Math.abs(one());
    case 'EXP': return Math.exp(one());
    case 'LN': return Math.log(one());
    case 'LOG10': return Math.log10(one());
    case 'LOG': {
      if (args.length === 1) return Math.log10(args[0]);
      if (args.length === 2 && args[1] > 0 && args[1] !== 1) return Math.log(args[0]) / Math.log(args[1]);
      return NaN;
    }
    case 'MOD': { const pair = two(); return pair && pair[1] !== 0 ? pair[0] % pair[1] : NaN; }
    case 'ROUND': {
      if (args.length < 1 || args.length > 2) return NaN;
      const scale = roundScale(args[1] || 0);
      return Math.round(args[0] * scale) / scale;
    }
    case 'ROUNDUP': {
      if (args.length < 1 || args.length > 2) return NaN;
      const scale = roundScale(args[1] || 0);
      return (args[0] < 0 ? Math.floor(args[0] * scale) : Math.ceil(args[0] * scale)) / scale;
    }
    case 'ROUNDDOWN': {
      if (args.length < 1 || args.length > 2) return NaN;
      const scale = roundScale(args[1] || 0);
      return (args[0] < 0 ? Math.ceil(args[0] * scale) : Math.floor(args[0] * scale)) / scale;
    }
    case 'CEILING': {
      if (args.length < 1 || args.length > 2) return NaN;
      const significance = Math.abs(args[1] || 1);
      return Math.ceil(args[0] / significance) * significance;
    }
    case 'FLOOR': {
      if (args.length < 1 || args.length > 2) return NaN;
      const significance = Math.abs(args[1] || 1);
      return Math.floor(args[0] / significance) * significance;
    }
    case 'SIN': return Math.sin(one());
    case 'COS': return Math.cos(one());
    case 'TAN': return Math.tan(one());
    case 'ASIN': return Math.asin(one());
    case 'ACOS': return Math.acos(one());
    case 'ATAN': return Math.atan(one());
    case 'PI': return args.length === 0 ? Math.PI : NaN;
    default: return NaN;
  }
}

/**
 * 求一个表达式。identifier 通过 vars 映射解析，遇到未知 id 或非数值返回 NaN。
 * 出错返回 null（调用方决定展示什么）。
 */
export function evalArithmetic(expr: string, vars: Record<string, any>): number | null {
  try {
    const tokens = tokenize(expr);
    const parser = new Parser(tokens);
    const result = parser.parse((id) => {
      if (id.toUpperCase() === 'PI') return Math.PI;
      if (id.toUpperCase() === 'E') return Math.E;
      const raw = vars[id];
      if (raw === null || raw === undefined || raw === '') return NaN;
      const n = Number(raw);
      return isNaN(n) ? NaN : n;
    }, callMathFunction);
    if (isNaN(result) || !isFinite(result)) return null;
    return result;
  } catch {
    return null;
  }
}

/** 提取表达式用到的所有 identifier，用于依赖关系检查和 UI 提示。 */
export function extractIdentifiers(expr: string): string[] {
  try {
    const tokens = tokenize(expr);
    const ids = new Set<string>();
    tokens.forEach((t, index) => {
      if (t.kind !== 'id') return;
      const upper = t.value.toUpperCase();
      const isFunction = tokens[index + 1]?.kind === 'lp';
      if (!isFunction && upper !== 'PI' && upper !== 'E') ids.add(t.value);
    });
    return Array.from(ids);
  } catch {
    return [];
  }
}
