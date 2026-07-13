/**
 * 极简算术表达式求值器。
 *
 * 支持：+ - * / ( ) 数字字面量 标识符
 *
 * 用于数据表格列级公式：每行用本行其他列的值算出本列。
 * 不用 eval，不依赖第三方包，safe for user input。
 */

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'id'; value: string }
  | { kind: 'op'; value: '+' | '-' | '*' | '/' }
  | { kind: 'lp' }
  | { kind: 'rp' };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\n') { i++; continue; }
    if (ch === '(') { tokens.push({ kind: 'lp' }); i++; continue; }
    if (ch === ')') { tokens.push({ kind: 'rp' }); i++; continue; }
    if ('+-*/'.includes(ch)) {
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
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
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
 *   unary := ('-' | '+')? primary
 *   primary := num | id | '(' expr ')'
 */
class Parser {
  private pos = 0;
  private tokens: Token[];
  constructor(tokens: Token[]) { this.tokens = tokens; }

  private peek(): Token | undefined { return this.tokens[this.pos]; }
  private consume(): Token { return this.tokens[this.pos++]; }

  parse(resolve: (id: string) => number): number {
    const v = this.expr(resolve);
    if (this.pos < this.tokens.length) throw new Error('表达式有多余内容');
    return v;
  }

  private expr(resolve: (id: string) => number): number {
    let left = this.term(resolve);
    while (true) {
      const t = this.peek();
      if (!t || t.kind !== 'op' || (t.value !== '+' && t.value !== '-')) break;
      this.consume();
      const right = this.term(resolve);
      left = t.value === '+' ? left + right : left - right;
    }
    return left;
  }

  private term(resolve: (id: string) => number): number {
    let left = this.unary(resolve);
    while (true) {
      const t = this.peek();
      if (!t || t.kind !== 'op' || (t.value !== '*' && t.value !== '/')) break;
      this.consume();
      const right = this.unary(resolve);
      if (t.value === '/') {
        if (right === 0) return NaN;
        left = left / right;
      } else {
        left = left * right;
      }
    }
    return left;
  }

  private unary(resolve: (id: string) => number): number {
    const t = this.peek();
    if (t && t.kind === 'op' && (t.value === '-' || t.value === '+')) {
      this.consume();
      const v = this.primary(resolve);
      return t.value === '-' ? -v : v;
    }
    return this.primary(resolve);
  }

  private primary(resolve: (id: string) => number): number {
    const t = this.consume();
    if (!t) throw new Error('表达式提前结束');
    if (t.kind === 'num') return t.value;
    if (t.kind === 'id') return resolve(t.value);
    if (t.kind === 'lp') {
      const v = this.expr(resolve);
      const rp = this.consume();
      if (!rp || rp.kind !== 'rp') throw new Error('缺少右括号');
      return v;
    }
    throw new Error(`表达式非法语法`);
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
      const raw = vars[id];
      if (raw === null || raw === undefined || raw === '') return NaN;
      const n = Number(raw);
      return isNaN(n) ? NaN : n;
    });
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
    for (const t of tokens) if (t.kind === 'id') ids.add(t.value);
    return Array.from(ids);
  } catch {
    return [];
  }
}
