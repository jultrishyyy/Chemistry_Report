import type { FieldDefinition } from './types';

type Table = NonNullable<FieldDefinition['free_table']>;
type Format = NonNullable<Table['cell_number_fmt']>[string];

/** An explicit whole-table format action unifies numeric cells, not their values or rounding. */
export function setFreeGridTableNumberFormat(table: Table, format: Format | undefined): Table {
  const formats = { ...table.cell_number_fmt };
  for (const key of Object.keys(formats)) {
    if (table.header_cells?.[key] || table.sample_index_cells?.[key]) continue;
    const type = table.cell_types?.[key];
    if (type === 'text' || type === 'choice') continue;
    if (type === 'number' || table.input_cells?.[key] || table.cell_formulas?.[key] || table.cell_bindings?.[key]) delete formats[key];
  }
  return { ...table, default_number_fmt: !format || format.mode === 'none' ? undefined : { ...format, mode: format.mode }, cell_number_fmt: formats };
}
