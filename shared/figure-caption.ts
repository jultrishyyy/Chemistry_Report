import type { RecordTemplate } from './types';

/**
 * 图/表备注的录入实例键。
 *
 * 备注本身属于模板排版定义，但每份原始记录允许覆盖。键是否存在具有语义：
 * 不存在＝继续使用模板默认值；存在且为空＝本次记录明确不显示备注。
 */
export const figureCaptionFieldKey = (fieldCode: string) => `__figure_caption__::field::${fieldCode}`;
export const figureCaptionGroupKey = (groupId: string) => `__figure_caption__::group::${groupId}`;
export const isFigureCaptionDataKey = (key: string) => key.startsWith('__figure_caption__::');

export function applyFigureCaptionOverrides(
  template: RecordTemplate,
  data: Record<string, any>,
): RecordTemplate {
  let changed = false;
  const groups = template.groups.map(group => {
    const groupKey = figureCaptionGroupKey(group.id);
    const hasGroupOverride = Object.prototype.hasOwnProperty.call(data, groupKey);
    let groupChanged = hasGroupOverride;
    const fields = group.fields.map(field => {
      const fieldKey = figureCaptionFieldKey(field.code);
      if (!Object.prototype.hasOwnProperty.call(data, fieldKey)) return field;
      groupChanged = true;
      return { ...field, caption: String(data[fieldKey] ?? '') };
    });
    if (!groupChanged) return group;
    changed = true;
    return {
      ...group,
      fields,
      ...(hasGroupOverride
        ? { image_layout: { ...(group.image_layout || {}), caption: String(data[groupKey] ?? '') } }
        : {}),
    };
  });
  return changed ? { ...template, groups } : template;
}
