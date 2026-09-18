import type { FieldDefinition, FieldGroup, StyleOverride } from './types';
import { REPORT_TEXT_FONTS } from './report-rich-document';
import { reportLengthPt, reportFontStack } from './report-body-layout';

export type CoverLegacyFormat = { part: 'label' | 'value' | 'paragraph'; patch: Partial<StyleOverride> };
export function validateCoverLegacyFormat(change: CoverLegacyFormat) {
  const keys = Object.keys(change.patch);
  if (!['label', 'value', 'paragraph'].includes(change.part) || !keys.length) throw new Error('无效的文字格式目标');
  const allowed = change.part === 'paragraph' ? ['align'] : ['font', 'size', 'color', 'weight', 'italic'];
  for (const key of keys) {
    const value = (change.patch as any)[key];
    if (!allowed.includes(key)) throw new Error('此文字格式不受支持');
    if (key === 'font' && !(REPORT_TEXT_FONTS as readonly unknown[]).includes(value)) throw new Error('无效字体');
    if (key === 'size' && (typeof value !== 'string' || !/^\d+(?:\.\d+)?pt$/.test(value) || parseFloat(value) < 6 || parseFloat(value) > 72)) throw new Error('字号应为 6–72 pt');
    if (key === 'color' && (typeof value !== 'string' || !/^#[\da-f]{6}$/i.test(value))) throw new Error('无效颜色');
    if (key === 'weight' && !['bold', 'regular'].includes(value)) throw new Error('无效字重');
    if (key === 'italic' && typeof value !== 'boolean') throw new Error('无效斜体设置');
    if (key === 'align' && !['left', 'center', 'right'].includes(value)) throw new Error('无效对齐方式');
  }
}

/** Same field → group → document cascade used by the template renderer. */
export function coverLegacyFormatState(field: FieldDefinition, group: FieldGroup, theme: Record<string, any> = {}, part: 'label' | 'value' | 'paragraph') {
  const own = part === 'label' ? field.label_style : part === 'value' ? field.value_style : undefined;
  const inherited = { ...group.style, ...field.style, ...own };
  const documentSize = reportLengthPt(theme.body_size, 'pt') || 10;
  const groupSize = reportLengthPt(group.style?.size, 'pt', documentSize) || documentSize;
  const fieldSize = reportLengthPt(field.style?.size, 'pt', groupSize) || groupSize;
  return {
    font: inherited.font || theme.font || 'Songti SC',
    size: reportLengthPt(own?.size, 'pt', fieldSize) || fieldSize,
    color: inherited.color || '#000000',
    bold: part === 'label' ? (own?.weight ? own.weight === 'bold' : field.label_bold ?? theme.label_weight !== 'regular') : inherited.weight === 'bold',
    italic: inherited.italic === true,
    align: field.style?.align || group.style?.align || 'left',
  };
}

/** Shared by toolbar and visible legacy text; units use paragraph, not value, style. */
export function coverLegacyPartCss(field: FieldDefinition, group: FieldGroup, theme: Record<string, any> = {}, part: 'label' | 'value' | 'paragraph') {
  const format = coverLegacyFormatState(field, group, theme, part);
  return {
    fontFamily: reportFontStack(format.font, true), fontSize: `${format.size}pt`, color: format.color,
    fontWeight: format.bold ? 'bold' : 'normal', fontStyle: format.italic ? 'italic' : 'normal',
  };
}

/** #field uses collapsing block gaps; explicit v()/pad spacing remains additive. */
export function coverLegacyBlockSpacing(field: FieldDefinition, group: FieldGroup, theme: Record<string, any> = {}) {
  const size = coverLegacyFormatState(field, group, theme, 'paragraph').size;
  const gap = reportLengthPt(field.field_gap, 'pt', size)
    ?? reportLengthPt(group.style?.block_spacing, 'pt', size)
    ?? reportLengthPt(theme.line_gap, 'em', size) ?? 0.6 * size;
  const length = (value: unknown) => reportLengthPt(value, 'pt', size) ?? 0;
  return {
    marginTop: `${gap}pt`, marginBottom: `${gap}pt`,
    paddingTop: `${length(field.style?.space_before) + length(field.style?.margin?.top)}pt`,
    paddingBottom: `${length(field.style?.space_after) + length(field.style?.margin?.bottom)}pt`,
    paddingLeft: `${length(field.style?.margin?.left)}pt`, paddingRight: `${length(field.style?.margin?.right)}pt`,
  };
}
