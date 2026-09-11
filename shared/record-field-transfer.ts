import type { FieldDefinition, FieldGroup } from './types';

/**
 * 原始记录跨模板复用的统一边界。
 *
 * 只允许能够按“字段编码 + 字段类型”安全匹配的普通录入字段。测试结果表、图片、
 * 审核签字、结论以及计算/动态结构都应由各测试方法独立维护，不能跨模板自动覆盖。
 */
const NON_TRANSFERABLE_FIELD_TYPES = new Map<FieldDefinition['type'], string>([
  ['data_matrix', '数据表格'],
  ['free_grid', '自由表格'],
  ['image', '图片'],
  ['record_conclusion', '检测结论'],
  ['computed', '计算字段'],
  ['variant_list', '动态结构'],
  ['static_content', '模板固定内容'],
]);

export function getRecordFieldTransferExclusion(
  field: Pick<FieldDefinition, 'type' | 'semantic_role'>,
  group?: Pick<FieldGroup, 'section_role'>,
): string | null {
  if (field.semantic_role || group?.section_role === 'signoff') return '审核字段';
  if (group?.section_role === 'conclusion' || group?.section_role === 'judgment') return '结论/判定字段';
  if (group?.section_role === 'images') return '图片字段';
  return NON_TRANSFERABLE_FIELD_TYPES.get(field.type) || null;
}

export function isRecordFieldTransferable(
  field: Pick<FieldDefinition, 'type' | 'semantic_role'>,
  group?: Pick<FieldGroup, 'section_role'>,
): boolean {
  return getRecordFieldTransferExclusion(field, group) === null;
}
