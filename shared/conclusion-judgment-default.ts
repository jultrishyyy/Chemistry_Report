import type { FieldGroup } from './types';

export const judgmentChoiceDefaults = {
  type: 'select' as const, allow_multiple: false, allow_custom: true,
  options: ['标准要求', '客户要求'],
};

export function updateConclusionJudgment(groups: FieldGroup[]): FieldGroup[] {
  return groups.map(group => ({ ...group, fields: group.fields.map(field => {
    if (field.type === 'record_conclusion' && field.record_conclusion) {
      const cfg = field.record_conclusion;
      return { ...field, record_conclusion: { ...cfg,
        ...(cfg.project_summary ? { project_summary: { ...cfg.project_summary, judgment_options: [...judgmentChoiceDefaults.options] } } : {}),
        items: cfg.items.map(item => ({ ...item, judgment_options: [...judgmentChoiceDefaults.options] })),
      } };
    }
    const matches = field.conclusion_role === 'judgment_requirement'
      || ((['conclusion', 'judgment'].includes(group.section_role || '') || group.label === '结论') && (field.label === '判定要求' || ['judgment_req', 'conclusion_judgment'].includes(field.code)));
    return matches ? { ...field, ...judgmentChoiceDefaults, options: [...judgmentChoiceDefaults.options],
      ...(field.default_value !== undefined ? { default_value: judgmentChoiceValue(field.default_value) as any } : {}) } : field;
  }) }));
}
/** 自定义单选使用对象保存，保留原始空格和换行；不丢弃旧有说明。 */
export function judgmentChoiceValue(value: unknown): unknown {
  if (Array.isArray(value)) return judgmentChoiceValue(value.map(v => typeof v === 'object' && v ? v.custom ?? '' : String(v ?? '')).join('、'));
  if (value == null || value === '' || typeof value === 'object') return value;
  const text = String(value);
  return judgmentChoiceDefaults.options.includes(text) ? text : { custom: text };
}
