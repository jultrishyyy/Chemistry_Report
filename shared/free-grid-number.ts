import type { FieldDefinition } from './types';
import { applyNumericRounding } from './numeric-rounding';

type Table = NonNullable<FieldDefinition['free_table']>;
/** Keep source precision in storage; rounding is applied before display and formula evaluation. */
export function freeGridNumberText(value: unknown, table: Table, key: string, alreadyRounded = false): string {
  const text = value == null ? '' : String(value);
  if (typeof value === 'boolean' || !text.trim() || !Number.isFinite(Number(text))) return text;
  const data = table.cell_types?.[key] === 'number' || table.input_cells?.[key] || table.cell_formulas?.[key] || table.cell_bindings?.[key];
  const rounded = alreadyRounded ? value : applyNumericRounding(value, table.cell_rounding?.[key] ?? (data ? table.default_rounding : undefined));
  const fmt = table.cell_number_fmt?.[key] ?? (data ? table.default_number_fmt : undefined);
  if (!fmt || fmt.mode === 'none') return String(rounded);
  const digits = Math.max(0, Math.min(10, Math.round(fmt.digits ?? 2)));
  const n = Number(rounded);
  if (fmt.mode === 'significant') return n.toPrecision(Math.max(1, digits));
  if (fmt.mode === 'scientific') return n.toExponential(digits);
  return n.toFixed(digits);
}
