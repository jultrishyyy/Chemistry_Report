import type { RecordTemplate, FieldDefinition, FieldGroup, StyleOverride } from './types';

export const canQuickLayout = (field: FieldDefinition, group: FieldGroup) => group.layout === 'vertical' && !group.fields.some(field => field.signature_line) && !field.rich
  && !field.cover_text_styles && ['text', 'textarea', 'number', 'date', 'daterange', 'select'].includes(field.type) && !field.style?.vertical_align;

export function selectCoverFields(order: string[], previous: string[], anchor: string | null, id: string, toggle: boolean, range: boolean): string[] {
  if (!order.includes(id)) return previous;
  if (range && anchor && order.includes(anchor)) return order.slice(Math.min(order.indexOf(anchor), order.indexOf(id)), Math.max(order.indexOf(anchor), order.indexOf(id)) + 1);
  if (toggle) return previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id];
  return [id];
}

export function contiguousCoverSelection(template: RecordTemplate, ids: string[]) {
  const group = template.groups.find(group => ids.length > 1 && ids.every(id => group.fields.some(field => field.id === id)));
  if (!group) return false;
  const indexes = ids.map(id => group.fields.findIndex(field => field.id === id)).sort((a, b) => a - b);
  return indexes.every((index, i) => !i || index === indexes[i - 1] + 1);
}

/** One immutable update per action; reject stale/mixed unsupported selections atomically. */
export function applyCoverBatchLayout(template: RecordTemplate, ids: string[], patch: Partial<StyleOverride>, gap?: string): RecordTemplate {
  const targets = template.groups.flatMap(group => group.fields.filter(field => ids.includes(field.id)).map(field => ({ field, group })));
  if (!ids.length || new Set(ids).size !== ids.length || targets.length !== ids.length || targets.some(({ field, group }) => !canQuickLayout(field, group))) throw new Error('请选择普通竖排字段，特殊布局请单独设置');
  if (gap != null && (!contiguousCoverSelection(template, ids) || !/^\d+(?:\.\d+)?pt$/.test(gap))) throw new Error('请选择同一分区内连续的多个字段');
  const character = Object.fromEntries(Object.entries(patch).filter(([key]) => ['font', 'size', 'weight', 'italic', 'color'].includes(key)));
  return { ...template, groups: template.groups.map(group => ({ ...group, fields: group.fields.map(field => ids.includes(field.id) ? {
    ...field, style: { ...field.style, ...patch },
    ...(Object.keys(character).length ? { label_style: { ...field.label_style, ...character }, value_style: { ...field.value_style, ...character } } : {}),
    ...(gap != null ? { field_gap: gap } : {}),
  } : field) })) };
}
