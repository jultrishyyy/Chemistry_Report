import type { FieldDefinition, FieldGroup } from './types';

/** Compatibility for the former default label; preserve user-defined labels and identity. */
export function conclusionDisplayField(field: FieldDefinition): FieldDefinition {
  return field.conclusion_role === 'project_name' && field.label === '名称'
    ? { ...field, label: '项目名称' } : field;
}

export const CONCLUSION_COLUMNS = [
  { role: 'item_name', label: '子项目名称' },
  { role: 'judgment_requirement', label: '判定要求' },
  { role: 'limit', label: '限值' },
  { role: 'conclusion', label: '结论' },
] as const;

/** Only lossless, ordinary conclusion rows are compacted; custom layouts remain intact. */
export function compactConclusionChildren(parent: FieldGroup, children: FieldGroup[]): FieldGroup[] {
  if (parent.section_role !== 'conclusion' || !children.length) return [];
  const rows = children.filter(child => child.section_role === 'conclusion' && child.conclusion_kind === 'item'
    && !child.page_break_before && child.fields.length > 0
    && child.fields.every(field => CONCLUSION_COLUMNS.some(column => column.role === field.conclusion_role)
      && !field.page_break_before && !field.rich && !field.semantic_role
      && ['text', 'textarea', 'number', 'select', 'checkbox', 'radio'].includes(field.type))
    && CONCLUSION_COLUMNS.every(column => child.fields.filter(field => field.conclusion_role === column.role).length <= 1));
  return rows.length === children.length ? rows : [];
}
