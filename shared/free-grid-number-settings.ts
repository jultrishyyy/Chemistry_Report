import type { FieldDefinition, NumericRoundingRule } from './types';

type Table = NonNullable<FieldDefinition['free_table']>;
type Format = NonNullable<Table['cell_number_fmt']>[string];

const ROUNDING_OPTIONS: { value: NumericRoundingRule['mode']; label: string; disabled?: boolean }[] = [
  { value: 'none', label: '不修约' },
  { value: 'half_even', label: '四舍六入五单双（五成双）' },
  { value: 'truncate', label: '直接截尾' },
  { value: 'ceil', label: '向上修约' },
  { value: 'multiple_2', label: '间隔 2（五成双）' },
  { value: 'multiple_5', label: '间隔 5（五成双）' },
  { value: 'piecewise', label: '按数值区间修约' },
];

/** Retired rules remain readable without becoming available for new configurations. */
export function freeGridRoundingOptions(current?: NumericRoundingRule['mode']) {
  if (current !== 'half_up' && current !== 'floor') return ROUNDING_OPTIONS;
  return [...ROUNDING_OPTIONS, {
    value: current,
    label: `${current === 'half_up' ? '四舍五入' : '向下修约'}（历史配置）`,
    disabled: true,
  }];
}

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
