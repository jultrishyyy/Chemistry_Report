import type { FieldDefinition } from './types';

// Table display names are metadata; printed titles are independently configured.
export const TABLE_TITLE_TYPES = new Set<string>(['free_grid', 'report_result_table', 'report_equipment_table', 'report_sample_table', 'report_sample_description_table', 'report_conclusion_table']);
export function usesIndependentTableTitle(field: FieldDefinition): boolean {
  return field.type === 'data_matrix' || TABLE_TITLE_TYPES.has(field.type);
}
export function reportFigureTitle(field: FieldDefinition): string {
  return usesIndependentTableTitle(field) ? field.table_title || '' : field.label || '';
}
export function setReportFigureTitle(field: FieldDefinition, title: string): void {
  if (usesIndependentTableTitle(field)) field.table_title = title;
  else {
    field.label = title;
    if (title.trim()) field.hide_label = false;
  }
}
