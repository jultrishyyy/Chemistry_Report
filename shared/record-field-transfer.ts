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

export function isEmptyTransferValue(value: unknown): boolean {
  if (value == null || value === '') return true;
  if (typeof value === 'string') return !value.trim();
  if (Array.isArray(value)) return value.length === 0;
  return typeof value === 'object' && Object.keys(value).length === 0;
}

/** New basic fields default to public; preserve explicit opt-outs and unsafe types. */
export function defaultBasicPublicField(field: FieldDefinition, group: Pick<FieldGroup, 'section_role'>): FieldDefinition {
  return group.section_role === 'basic' && field.data_scope == null && isRecordFieldTransferable(field, group)
    ? { ...field, data_scope: 'batch_shared' } : field;
}

/** Only explicitly public fields with unambiguous codes/types may be copied. */
export function matchPublicRecordFields(targetGroups: FieldGroup[], sourceGroups: FieldGroup[],
  current: Record<string, any>, source: Record<string, any>) {
  const entries = (groups: FieldGroup[]) => groups.flatMap(group => (group.fields || []).map(field => ({ field, group })));
  const targets = entries(targetGroups), sources = entries(sourceGroups);
  const matched: any[] = [], skipped: any[] = [], unmatched: any[] = [];
  const values: Record<string, any> = {};
  for (const { field, group } of targets) {
    if (!field.code || field.data_scope !== 'batch_shared' || !isRecordFieldTransferable(field, group)) continue;
    const matches = sources.filter(entry => entry.field.code === field.code);
    const src = matches[0];
    const item = { code: field.code, label: field.label };
    if (targets.filter(entry => entry.field.code === field.code).length !== 1 || matches.length !== 1
      || src.field.data_scope !== 'batch_shared' || src.field.type !== field.type || !isRecordFieldTransferable(src.field, src.group)) {
      unmatched.push({ ...item, reason: '没有唯一且类型一致的公共字段' }); continue;
    }
    const value = source[field.code];
    if (isEmptyTransferValue(value)) { unmatched.push({ ...item, reason: '来源未填写' }); continue; }
    if ((field.unit || '') !== (src.field.unit || '')) {
      unmatched.push({ ...item, reason: '单位不同' }); continue;
    }
    if (['select', 'checkbox'].includes(field.type) && (!!field.allow_multiple !== !!src.field.allow_multiple
      || JSON.stringify(field.options || []) !== JSON.stringify(src.field.options || []))) {
      unmatched.push({ ...item, reason: '选项配置不同' }); continue;
    }
    if (!isEmptyTransferValue(current[field.code])) {
      skipped.push({ ...item, value: structuredClone(current[field.code]), sourceValue: structuredClone(value),
        identical: JSON.stringify(current[field.code]) === JSON.stringify(value) });
      continue;
    }
    values[field.code] = structuredClone(value);
    matched.push({ ...item, value: structuredClone(value), previousValue: structuredClone(current[field.code]) });
  }
  return { matched, skipped, unmatched, values };
}

/** Apply only the values the user previewed; do not overwrite edits made since then. */
export function publicRecordTransferPatch(current: Record<string, any>, preview: ReturnType<typeof matchPublicRecordFields>, replaceExisting = false) {
  const patch: Record<string, any> = {};
  for (const item of preview.matched) {
    if (JSON.stringify(current[item.code]) === JSON.stringify(item.previousValue)) patch[item.code] = structuredClone(item.value);
  }
  for (const item of preview.skipped) {
    if ((item.identical || replaceExisting) && JSON.stringify(current[item.code]) === JSON.stringify(item.value)) patch[item.code] = structuredClone(item.sourceValue);
  }
  return patch;
}

export function isRecordPullSource(source: any, scope: {
  orderNo: string; sampleId: string; testName: string; recordId?: string | number | null;
  templateId: number; templateIds: number[];
}) {
  return source.has_entered_data === true && !!scope.orderNo && !!scope.sampleId && !!scope.testName
    && new Set(scope.templateIds).size > 1
    && scope.templateIds.includes(Number(scope.templateId))
    && scope.templateIds.includes(Number(source.template_id))
    && Number(source.template_id) !== Number(scope.templateId)
    && Number(source.id) !== Number(scope.recordId || 0) && !source.cancelled_at
    && String(source.order_no || '') === scope.orderNo
    && String(source.sample_external_id || '') === scope.sampleId
    && String(source.test_item_name || '') === scope.testName;
}
