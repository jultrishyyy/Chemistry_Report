import { isFormulaError } from './formula-error';

/** Presentation only: never replace values used by downstream calculations. */
export function formulaAwaitingInput(sources: unknown[], result: unknown): boolean {
  const empty = (value: unknown) => value == null || (typeof value === 'string' && value.trim() === '');
  if (!sources.length || !sources.every(empty)) return false;
  // Syntax, missing references and other genuine errors must remain visible.
  return !isFormulaError(result)
    || (result.code === '#VALUE!' && result.message === '空值不能参与数值运算');
}
