import type { FieldDefinition } from './types';
import { applyNumericRounding } from './numeric-rounding';
import { isFormulaError } from './formula-error';

type Table = NonNullable<FieldDefinition['free_table']>;
type Format = NonNullable<Table['cell_number_fmt']>[string];
function isLiteralCell(table: Table, key: string): boolean {
  const source = table.cell_bindings?.[key]?.source;
  if (source === 'record_free_formula_cell' || source === 'record_free_formula_cell_sample') return false;
  return !table.cell_formulas?.[key] && (table.cell_types?.[key] === 'text' || table.cell_types?.[key] === 'choice');
}
export function freeGridNumberFormat(table: Table, key: string): Format | undefined {
  if (isLiteralCell(table, key)) return undefined;
  const data = table.cell_types?.[key] === 'number' || table.input_cells?.[key] || table.cell_formulas?.[key] || table.cell_bindings?.[key];
  return table.cell_number_fmt?.[key] ?? (data ? table.default_number_fmt : undefined);
}
export function numberFormatDigits(value: unknown, fmt: Format): number {
  const digits = Math.max(0, Math.min(10, Math.round(fmt.digits ?? 2)));
  const n = Math.abs(Number(value));
  const exponent = !n || !Number.isFinite(n) ? 0 : Number(n.toExponential().split('e')[1]);
  return fmt.mode === 'significant' ? Math.max(1, digits) - 1 - exponent
    : fmt.mode === 'scientific' ? digits - exponent : digits;
}
/** Format precision takes precedence over legacy independent rounding digits. */
export function roundFreeGridValue(value: unknown, table: Table | undefined, key: string): unknown {
  if (isFormulaError(value)) return value;
  if (!table) return value;
  if (isLiteralCell(table, key)) return value;
  const data = table.cell_types?.[key] === 'number' || table.input_cells?.[key] || table.cell_formulas?.[key] || table.cell_bindings?.[key];
  const rule = table.cell_rounding?.[key] ?? (data ? table.default_rounding : undefined);
  if (!rule || rule.mode === 'none') return value;
  if (rule.mode === 'piecewise') return applyNumericRounding(value, rule);
  const fmt = freeGridNumberFormat(table, key);
  if (fmt && fmt.mode !== 'none') return applyNumericRounding(value, { ...rule, digits: numberFormatDigits(value, fmt) });
  if (rule.mode === 'multiple_2' || rule.mode === 'multiple_5' || (!fmt && rule.digits != null)) return applyNumericRounding(value, rule);
  return value;
}
/** Display-only rounding does not feed back into formulas. */
export function formatGridNumber(value: unknown, fmt: Format | undefined): string {
  if (isFormulaError(value)) return value.code;
  const text = value == null ? '' : String(value);
  if (!fmt || fmt.mode === 'none' || typeof value === 'boolean' || !text.trim() || !Number.isFinite(Number(text))) return text;
  const digits = Math.max(0, Math.min(10, Math.round(fmt.digits ?? 2)));
  const n = Number(applyNumericRounding(value, { mode: 'half_up', digits: numberFormatDigits(value, fmt) }));
  if (fmt.mode === 'significant') return n.toPrecision(Math.max(1, digits));
  if (fmt.mode === 'scientific') return n.toExponential(digits);
  return n.toFixed(digits);
}
/** Keep source precision in storage; rounding is applied before display and formula evaluation. */
export function freeGridNumberText(value: unknown, table: Table, key: string, alreadyRounded = false): string {
  if (isFormulaError(value)) return value.code;
  const text = value == null ? '' : String(value);
  if (typeof value === 'boolean' || !text.trim() || !Number.isFinite(Number(text))) return text;
  const rounded = alreadyRounded ? value : roundFreeGridValue(value, table, key);
  return formatGridNumber(rounded, freeGridNumberFormat(table, key));
}
