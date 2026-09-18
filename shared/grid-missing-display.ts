import { FormulaError, isFormulaError } from './formula-error';

export const isMissingGridValue = (value: unknown) => value == null || (typeof value === 'string' && !value.trim());
/** 保留错误对象供依赖公式使用，绝不将展示占位符写入计算或录入数据。 */
export function completeGridFormula(result: unknown, sources: unknown[]): unknown {
  return sources.some(isMissingGridValue) ? new FormulaError('#VALUE!', '来源数据尚未填写完整') : result;
}
export function gridOutputText(value: unknown, dataCell: boolean, formulaCell = false): string {
  if (isFormulaError(value) || (formulaCell && /^#(?:VALUE!|DIV\/0!|NUM!|REF!|CYCLE!|ERROR!)$/.test(String(value)))) return '/';
  return dataCell && isMissingGridValue(value) ? '/' : String(value ?? '');
}
