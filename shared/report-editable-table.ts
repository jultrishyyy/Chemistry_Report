import type { FieldDefinition } from './types';
import { buildFreeTableFromField } from './typst-generator';
type Context = Parameters<typeof buildFreeTableFromField>[1];

export function reportEditableTable(field: FieldDefinition, ctx: Context): NonNullable<FieldDefinition['free_table']> {
  const manual = field.type === 'free_grid' ? !!field.instance_auto_free_table : !!field.free_table?.columns?.length;
  return manual ? field.free_table! : buildFreeTableFromField(field, ctx);
}

/** Called only for an explicit user edit, never on focus or opening a document. */
export function editReportTable(field: FieldDefinition, ctx: Context, edit: (field: FieldDefinition) => void): void {
  const table = reportEditableTable(field, ctx);
  if (table !== field.free_table) {
    if (field.type === 'free_grid') field.instance_auto_free_table = structuredClone(field.free_table || { rows: [], columns: [], cells: {} });
    field.free_table = structuredClone(table);
  }
  edit(field);
}
