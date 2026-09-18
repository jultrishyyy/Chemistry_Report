/** Runtime-only calculation result. Never confuses literal "#DIV/0!" with an error. */
export type FormulaErrorCode = '#DIV/0!' | '#VALUE!' | '#NUM!' | '#REF!' | '#CYCLE!' | '#ERROR!';
export class FormulaError {
  readonly kind = 'formula-error';
  readonly code: FormulaErrorCode;
  readonly message: string;
  constructor(code: FormulaErrorCode, message: string) { this.code = code; this.message = message; }
  toString() { return this.code; }
  toJSON() { return { kind: this.kind, code: this.code, message: this.message }; }
}
export function isFormulaError(value: unknown): value is FormulaError {
  return !!value && typeof value === 'object' && (value as FormulaError).kind === 'formula-error'
    && ['#DIV/0!', '#VALUE!', '#NUM!', '#REF!', '#CYCLE!', '#ERROR!'].includes((value as FormulaError).code);
}
export function formulaErrorText(value: unknown): string {
  return isFormulaError(value) ? value.code : String(value ?? '');
}
export function invalidGridReference(table: { rows: { id: string }[]; columns: { id: string }[] } | undefined, key: string): FormulaError | undefined {
  const [r, c] = key.split('::');
  if (!Array.isArray(table?.rows) || !Array.isArray(table?.columns)
    || !table.rows.some(row => row.id === r) || !table.columns.some(col => col.id === c)) return new FormulaError('#REF!', '来源表格或单元格已删除');
}
