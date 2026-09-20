import type { FieldDefinition } from './types';

/** Only editable text cells may prefill a new measurement; automatic values keep their own source. */
export function freeGridTextDefault(table: NonNullable<FieldDefinition['free_table']>, key: string): string {
  if (!table.input_cells?.[key] || table.cell_types?.[key] !== 'text'
    || table.header_cells?.[key] || table.cell_formulas?.[key]
    || table.cell_bindings?.[key] || table.sample_index_cells?.[key]) return '';
  return table.cells[key] ?? '';
}
