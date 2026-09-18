import type { FieldDefinition, FieldGroup, RecordTemplate } from './types';

export const RECORD_LAYOUT_KEY = '__record_layout';
const TEXT_TYPES = new Set(['text', 'textarea', 'number', 'date', 'daterange', 'select', 'checkbox', 'computed', 'reference']);
export function canArrangeRecordField(field: FieldDefinition): boolean {
  return TEXT_TYPES.has(field.type) && !field.signature_line;
}
export function canArrangeRecordGroup(group: FieldGroup): boolean {
  return group.section_role !== 'images' && !group.fields.some(f => f.signature_line)
    && group.fields.some(canArrangeRecordField);
}
export function recordLayoutRows(group: FieldGroup): FieldDefinition[][] {
  const rows: FieldDefinition[][] = [];
  let pending: FieldDefinition[] = [];
  const flush = () => { if (pending.length) rows.push(pending); pending = []; };
  for (const field of group.fields) {
    if (!canArrangeRecordField(field) || field.full_width || group.layout !== 'two-col') {
      flush(); rows.push([field]);
    } else {
      pending.push(field);
      if (pending.length === 2) flush();
    }
  }
  flush();
  return rows;
}
export function applyRecordLayout(template: RecordTemplate, data: Record<string, any>): RecordTemplate {
  const settings = data[RECORD_LAYOUT_KEY];
  if (!settings || typeof settings !== 'object') return template;
  return { ...template, groups: template.groups.map(group => {
    if (!canArrangeRecordGroup(group)) return group;
    const layout = settings.groups?.[group.id];
    return { ...group, ...(layout === 'vertical' || layout === 'two-col' ? { layout } : {}),
      fields: group.fields.map(field => {
        const full = settings.fields?.[field.code];
        return canArrangeRecordField(field) && typeof full === 'boolean' ? { ...field, full_width: full } : field;
      }),
    };
  }) };
}
