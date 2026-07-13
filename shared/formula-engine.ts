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
  | 'custom';

export interface Formula {
  type: FormulaType;
  sources?: string[];
  params?: Record<string, any>;
  decimals?: number;
  /** custom 类型：算术表达式（支持 + - * / ( ) 数字 变量），变量名 = sources 数组下标对应的 v1, v2, v3... */
  expression?: string;
}

export const FORMULA_TYPES: { type: FormulaType; label: string; description: string }[] = [
  { type: 'average', label: '平均值', description: '多个字段求平均' },
  { type: 'sum', label: '总和', description: '多个字段求和' },
  { type: 'max', label: '最大值', description: '多个字段取最大' },
  { type: 'min', label: '最小值', description: '多个字段取最小' },
  { type: 'threshold', label: '阈值判定', description: '字段值与阈值比较，输出合格/不合格' },
  { type: 'range', label: '范围判定', description: '字段值是否在上下限范围内' },
  { type: 'unit_convert', label: '单位换算', description: '字段值乘以系数' },
  { type: 'percentage', label: '百分比', description: '分子/分母 × 100' },
  { type: 'text_concat', label: '文本拼接', description: '多个字段用分隔符拼接' },
  { type: 'zh_en_map', label: '中英文映射', description: '根据映射表转换值' },
  { type: 'nd_sum', label: 'N.D. 视为 0 求和', description: 'N.D. 视为 0 后求和' },
  { type: 'multi_conclusion', label: '多结论判定', description: '任一不合格则整体不合格' },
  { type: 'round_format', label: '取整/格式化', description: '保留小数位 + 千分位' },
  { type: 'custom', label: '自定义表达式', description: '用 v1/v2/v3... 等变量写算术表达式（支持 + - * / 括号）' },
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
    case 'custom': {
      const expr = (formula.expression || '').trim();
      if (!expr) return null;
      // sources 数组下标 -> v1, v2, v3 变量
      const vars: Record<string, any> = {};
      sources.forEach((srcCode, i) => {
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
