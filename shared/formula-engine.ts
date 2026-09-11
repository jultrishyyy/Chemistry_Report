import { evalArithmetic } from './expr-eval';

export type FormulaType =
  | 'average'
  | 'sum'
  | 'max'
  | 'min'
  | 'threshold'
  | 'range'
  | 'unit_convert'
  | 'percentage'
  | 'text_concat'
  | 'zh_en_map'
  | 'nd_sum'
  | 'multi_conclusion'
  | 'round_format'
  | 'visual'
  | 'custom';

export interface Formula {
  sample_scope?: 'all' | 'selected';
  /** 矩阵迁移专用：保留旧公式逐步计算时的 decimals 语义。 */
  preserve_legacy_precision?: true;
  type: FormulaType;
  sources?: string[];
  params?: Record<string, any>;
  decimals?: number;
  /** custom 类型：安全数学表达式（支持四则、幂、百分号及白名单函数），变量名 = sources 数组下标对应的 v1, v2, v3... */
  expression?: string;
}

export const FORMULA_TYPES: { type: FormulaType; label: string; description: string }[] = [
  { type: 'average', label: '平均值', description: '多个字段求平均' },
  { type: 'sum', label: '总和', description: '多个字段求和' },
  { type: 'max', label: '最大值', description: '多个字段取最大' },
  { type: 'min', label: '最小值', description: '多个字段取最小' },
  { type: 'unit_convert', label: '单位换算', description: '字段值乘以系数' },
  { type: 'percentage', label: '百分比', description: '分子/分母 × 100' },
  { type: 'text_concat', label: '文本拼接', description: '多个字段用分隔符拼接' },
  { type: 'zh_en_map', label: '中英文映射', description: '根据映射表转换值' },
  { type: 'nd_sum', label: 'N.D. 视为 0 求和', description: 'N.D. 视为 0 后求和' },
  { type: 'round_format', label: '取整/格式化', description: '保留小数位 + 千分位' },
  { type: 'visual', label: '可视化计算', description: '无需代码搭建四则运算' },
  { type: 'custom', label: '自定义公式', description: '用点选格子插入变量，按 Excel 风格编写安全数学公式' },
];

function getNumericValues(sources: string[], data: Record<string, any>): number[] {
  return sources.map(s => {
    const v = data[s];
    if (v === null || v === undefined || v === '' || v === 'N.D.') return NaN;
    const n = Number(v);
    return n;
  }).filter(n => !isNaN(n));
}

function getAllValues(sources: string[], data: Record<string, any>): any[] {
  return sources.map(s => data[s]);
}

export function execute(formula: Formula, data: Record<string, any>): any {
  const { type, sources = [], params = {}, decimals } = formula;

  switch (type) {
    case 'average': {
      const vals = getNumericValues(sources, data);
      if (vals.length === 0) return null;
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      return decimals !== undefined ? Number(avg.toFixed(decimals)) : avg;
    }
    case 'sum': {
      const vals = getNumericValues(sources, data);
      if (vals.length === 0) return null;
      const sum = vals.reduce((a, b) => a + b, 0);
      return decimals !== undefined ? Number(sum.toFixed(decimals)) : sum;
    }
    case 'max': {
      const vals = getNumericValues(sources, data);
      return vals.length > 0 ? Math.max(...vals) : null;
    }
    case 'min': {
      const vals = getNumericValues(sources, data);
      return vals.length > 0 ? Math.min(...vals) : null;
    }
    case 'threshold': {
      const field = sources[0];
      const value = Number(data[field]);
      if (isNaN(value)) return null;
      const { operator = '>=', threshold = 0, pass = '合格', fail = '不合格' } = params;
      switch (operator) {
        case '>=': return value >= threshold ? pass : fail;
        case '>': return value > threshold ? pass : fail;
        case '<=': return value <= threshold ? pass : fail;
        case '<': return value < threshold ? pass : fail;
        case '==': return value === threshold ? pass : fail;
        default: return null;
      }
    }
    case 'range': {
      const field = sources[0];
      const value = Number(data[field]);
      if (isNaN(value)) return null;
      const { lower = 0, upper = 100, pass = '合格', fail = '不合格' } = params;
      return (value >= lower && value <= upper) ? pass : fail;
    }
    case 'unit_convert': {
      const field = sources[0];
      const value = Number(data[field]);
      if (isNaN(value)) return null;
      const { factor = 1, offset = 0 } = params;
      const result = value * factor + offset;
      return decimals !== undefined ? Number(result.toFixed(decimals)) : result;
    }
    case 'percentage': {
      const [numerator, denominator] = sources;
      const num = Number(data[numerator]);
      const den = Number(data[denominator]);
      if (isNaN(num) || isNaN(den) || den === 0) return null;
      const pct = (num / den) * 100;
      return decimals !== undefined ? Number(pct.toFixed(decimals)) : pct;
    }
    case 'text_concat': {
      const { separator = ', ' } = params;
      const vals = getAllValues(sources, data).filter(v => v !== null && v !== undefined && v !== '');
      return vals.join(separator);
    }
    case 'zh_en_map': {
      const field = sources[0];
      const value = data[field];
      const { mapping = {} } = params;
      return mapping[value] ?? value;
    }
    case 'nd_sum': {
      const vals = sources.map(s => {
        const v = data[s];
        if (v === 'N.D.' || v === 'ND' || v === 'n.d.') return 0;
        const n = Number(v);
        return isNaN(n) ? 0 : n;
      });
      const sum = vals.reduce((a, b) => a + b, 0);
      return decimals !== undefined ? Number(sum.toFixed(decimals)) : sum;
    }
    case 'multi_conclusion': {
      const { pass = '合格', fail = '不合格' } = params;
      const vals = getAllValues(sources, data);
      const hasFailure = vals.some(v => v === fail || v === '不合格' || v === 'fail' || v === 'FAIL');
      return hasFailure ? fail : pass;
    }
    case 'round_format': {
      const field = sources[0];
      const value = Number(data[field]);
      if (isNaN(value)) return null;
      const d = decimals ?? 2;
      const { thousands = false } = params;
      const rounded = value.toFixed(d);
      if (thousands) {
        const [int, dec] = rounded.split('.');
        return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (dec ? '.' + dec : '');
      }
      return Number(rounded);
    }
    case 'visual': {
      const mode = params.visual_mode || 'calculation';
      if (mode === 'condition') {
        const conditions = Array.isArray(params.conditions) ? params.conditions : [];
        if (!sources.length || conditions.length < sources.length) return null;
        const compare = (raw: any, condition: any): boolean => {
          const left = Number(raw);
          const right = Number(condition?.value);
          if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
          switch (condition?.operator || '>=') {
            case '>=': return left >= right;
            case '>': return left > right;
            case '<=': return left <= right;
            case '<': return left < right;
            case '==': return left === right;
            case '!=': return left !== right;
            default: return false;
          }
        };
        const results = sources.map((source, index) => compare(data[source], conditions[index]));
        const passed = params.logic === 'any' ? results.some(Boolean) : results.every(Boolean);
        return passed ? (params.pass ?? '合格') : (params.fail ?? '不合格');
      }

      const values = sources.map(source => Number(data[source]));
      if (!values.length || values.some(value => !Number.isFinite(value))) return null;
      const operators: string[] = Array.isArray(params.operators) ? params.operators : [];
      let result = values[0];
      for (let index = 1; index < values.length; index++) {
        const value = values[index];
        switch (operators[index - 1] || '+') {
          case '+': result += value; break;
          case '-': result -= value; break;
          case '*': result *= value; break;
          case '/':
            if (value === 0) return null;
            result /= value;
            break;
          default: return null;
        }
      }
      const factor = Number(params.factor ?? 1);
      const offset = Number(params.offset ?? 0);
      if (!Number.isFinite(factor) || !Number.isFinite(offset)) return null;
      result = result * factor + offset;
      return decimals !== undefined ? Number(result.toFixed(decimals)) : result;
    }
    case 'custom': {
      const expr = (formula.expression || '').trim();
      if (!expr) return null;
      // sources 数组下标 -> v1, v2, v3 变量
      const vars: Record<string, any> = {};
      sources.forEach((srcCode, i) => {
        vars[`v${i + 1}`] = data[srcCode];
      });
      // 自由表格可把点选格子显示为 A1、B2 等易读变量名；实际依赖仍以稳定
      // 单元格 id 保存，行列调整后不会丢失公式关系。
      const aliases = params.source_aliases && typeof params.source_aliases === 'object'
        ? params.source_aliases as Record<string, string>
        : {};
      sources.forEach((srcCode, i) => {
        const alias = aliases[srcCode];
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias || '')) vars[alias] = data[srcCode];
        // v1/v2… 永远可用，作为地址变化后的稳定兜底。
        vars[`v${i + 1}`] = data[srcCode];
      });
      const r = evalArithmetic(expr, vars);
      if (r === null) return null;
      return decimals !== undefined ? Number(r.toFixed(decimals)) : r;
    }
    default:
      return null;
  }
}

/**
 * 公式链内部计算专用：显示精度不能参与后续计算。
 *
 * 历史 Formula.decimals 同时承担过“结果显示位数”，因此嵌套公式会把上游约数继续计算。
 * round_format 的 decimals 是公式本身的显式取整语义，必须保留；其它类型均在链内移除。
 */
export function executeWithFullPrecision(formula: Formula, data: Record<string, any>): any {
  return execute(formula.type === 'round_format' || formula.preserve_legacy_precision ? formula : { ...formula, decimals: undefined }, data);
}

export function extractDeps(formula: Formula): string[] {
  return formula.sources || [];
}

interface FieldWithFormula {
  code: string;
  formula?: Formula;
}

export function topologicalOrder(fields: FieldWithFormula[]): string[] {
  const graph = new Map<string, string[]>();
  const allCodes = new Set(fields.map(f => f.code));

  for (const f of fields) {
    const deps = f.formula ? extractDeps(f.formula).filter(d => allCodes.has(d)) : [];
    graph.set(f.code, deps);
  }

  const visited = new Set<string>();
  const result: string[] = [];
  const visiting = new Set<string>();

  function visit(code: string) {
    if (visited.has(code)) return;
    if (visiting.has(code)) return; // cycle — handled by detectCycles
    visiting.add(code);
    for (const dep of graph.get(code) || []) {
      visit(dep);
    }
    visiting.delete(code);
    visited.add(code);
    result.push(code);
  }

  for (const code of allCodes) {
    visit(code);
  }

  return result;
}

export function detectCycles(fields: FieldWithFormula[]): string[][] {
  const graph = new Map<string, string[]>();
  const allCodes = new Set(fields.map(f => f.code));

  for (const f of fields) {
    const deps = f.formula ? extractDeps(f.formula).filter(d => allCodes.has(d)) : [];
    graph.set(f.code, deps);
  }

  const cycles: string[][] = [];
  const visited = new Set<string>();
  const path: string[] = [];
  const inPath = new Set<string>();

  function dfs(code: string) {
    if (inPath.has(code)) {
      const cycleStart = path.indexOf(code);
      cycles.push([...path.slice(cycleStart), code]);
      return;
    }
    if (visited.has(code)) return;

    path.push(code);
    inPath.add(code);

    for (const dep of graph.get(code) || []) {
      dfs(dep);
    }

    path.pop();
    inPath.delete(code);
    visited.add(code);
  }

  for (const code of allCodes) {
    dfs(code);
  }

  return cycles;
}
