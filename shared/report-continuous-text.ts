import type { FieldDefinition, FieldGroup } from './types';
import { encodeReportRichDocument, readReportRichDocument, storedReportRichDocument, type ReportRichNode } from './report-rich-document';

const ordinary = new Set(['text', 'textarea', 'number', 'date', 'daterange', 'select', 'checkbox', 'spacer']);
const fontSize = (value: unknown): number | undefined => {
  if (typeof value !== 'string' || !/^(?:\d+(?:\.\d+)?|\.\d+)\s*(?:pt)?$/.test(value.trim())) return undefined;
  const size = parseFloat(value);
  return size >= 6 && size <= 72 ? size : undefined;
};
const simpleStyle = (style: object | undefined, paragraph = false) => !style || Object.entries(style).every(([key, value]) => {
  if (value == null) return true;
  if (key === 'weight') return value === 'bold' || value === 'regular';
  if (key === 'italic') return typeof value === 'boolean';
  if (key === 'size') return fontSize(value) !== undefined;
  if (key === 'color') return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  return paragraph && key === 'align' && ['left', 'center', 'right'].includes(value as string);
});

/** Do not flatten tables, signatures, columns or styles the text schema cannot preserve. */
export function canEditContinuousText(group: FieldGroup): boolean {
  return (!group.report_source_fields || !!group.report_document) && group.layout === 'vertical' && !!group.fields?.length && !group.image_layout
    && group.fields.every(f => ordinary.has(f.type) && !f.cover_text_styles && !f.signature_line && !f.field_gap
      && (!f.rich || !f.unit)
      // Older saved overrides may already contain a flattened page break. Keep
      // them renderable; reject NEW conversions instead of breaking old PDFs.
      && (!f.page_break_before || !!group.report_document)
      && simpleStyle(f.style, true) && simpleStyle(f.label_style) && simpleStyle(f.value_style)
      && (!f.rich || (![f.style, f.label_style, f.value_style].some(style => style && Object.values(style).some(value => value != null))))
      && (!f.rich || f.hide_label || !f.label)
      && (f.type !== 'spacer' || ![f.style, f.label_style, f.value_style].some(style => style && Object.values(style).some(value => value != null)))
      && (f.type !== 'spacer' || /^(?:\d+(?:\.\d+)?|\.\d+)\s*(?:em|pt|cm|mm|in)?$/.test(f.spacer_height || '0.5cm')));
}

/** Plain values are literal text, never parsed as Markdown. */
export function continuousTextValue(group: FieldGroup, resolve: (field: FieldDefinition) => string): string {
  // The retained fields are a restore/audit snapshot, not a newer document.
  if (group.report_document) {
    if (group.report_document.version !== 1 || !storedReportRichDocument(group.report_document.value)) throw new Error('不支持的报告正文版本或内容');
    return group.report_document.value;
  }
  if (group.report_source_fields) {
    return encodeReportRichDocument({ type: 'doc', content: group.fields.flatMap(field => field.rich
      ? readReportRichDocument(resolve(field)).content || []
      : [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text: ordinary.has(field.type)
        ? (field.type === 'spacer' ? '【留白】' : `${!field.hide_label && field.label ? field.label + '：' : ''}${resolve(field)}${field.unit ? ' ' + field.unit : ''}`)
        : `【${field.type === 'image' ? '图片' : '表格'}：${field.label || field.code}】` }] }]) });
  }
  const content: ReportRichNode[] = [];
  for (const field of group.fields) {
    if (field.type === 'spacer') {
      const height = (field.spacer_height || '0.5cm').replace(/\s/g, '');
      content.push({ type: 'reportSpacer', attrs: { height: /[a-z]$/.test(height) ? height : `${height}pt` } });
      continue;
    }
    const value = resolve(field);
    if (field.rich) { content.push(...(readReportRichDocument(value).content || [])); continue; }
    const text = (value: string, part: 'label' | 'value' | 'unit'): ReportRichNode[] => {
      // The template renders the unit outside value_args: inherit the field
      // style, but not label/value-specific overrides.
      const style = { ...field.style, ...(part === 'label' ? field.label_style : part === 'value' ? field.value_style : undefined) };
      const marks: NonNullable<ReportRichNode['marks']> = [];
      if (style.weight === 'bold' || (part === 'label' && style.weight == null && field.label_bold === true)) marks.push({ type: 'bold' });
      if (style.italic) marks.push({ type: 'italic' });
      const size = fontSize(style.size);
      if (size !== undefined || style.color) marks.push({ type: 'reportTextStyle', attrs: {
        ...(size !== undefined ? { fontSize: size } : {}), ...(style.color ? { color: style.color } : {}),
      } });
      return value.split('\n').flatMap((line, index) => [
        ...(index ? [{ type: 'hardBreak' as const }] : []),
        ...(line ? [{ type: 'text' as const, text: line, ...(marks.length ? { marks } : {}) }] : []),
      ]);
    };
    content.push({ type: 'paragraph', ...(field.style?.align ? { attrs: { textAlign: field.style.align } } : {}), content: [
      ...(!field.hide_label && field.label ? text(`${field.label}：`, 'label') : []),
      ...text(value, 'value'),
      ...(field.unit ? text(` ${field.unit}`, 'unit') : []),
    ] });
  }
  return encodeReportRichDocument({ type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] });
}

/** A projection only: never replace the retained source fields in storage. */
export function projectContinuousGroups(groups: FieldGroup[]): FieldGroup[] {
  return groups.map(group => {
    if (!group.report_document) return group;
    const value = continuousTextValue(group, () => '');
    if (!canEditContinuousText(group)) throw new Error('连续正文不能覆盖图表、签名或复杂排版分区');
    return { ...group, fields: [{ id: `${group.id}__body`, code: `${group.id}__body`, type: 'text', label: '', hide_label: true, rich: true, binding: { source: 'literal', text: value } }] };
  });
}

export function hasContinuousText(doc: any): boolean {
  return [doc?.front_cover, doc?.cover, ...(doc?.projects || [])].some(section => section?.groups?.some((g: FieldGroup) => !!g.report_document || !!g.report_source_fields));
}

/** Materialize mixed blocks inside the SAME group: nesting/module boundaries stay intact. */
export function insertContinuousFigure(group: FieldGroup, inserted: FieldDefinition, split: { before: string; after: string }, codes: [string, string]): FieldGroup {
  if (!canEditContinuousText(group)) throw new Error('此分区不支持连续正文转换');
  const paragraph = (value: string, code: string): FieldDefinition => ({
    id: code, code, type: 'text', label: '', hide_label: true, rich: true,
    binding: { source: 'literal', text: value || encodeReportRichDocument({ type: 'doc', content: [{ type: 'paragraph' }] }) },
  });
  for (const value of [split.before, split.after]) if (value && !storedReportRichDocument(value)) throw new Error('无效正文选区，请重新定位光标');
  const copy: FieldGroup = JSON.parse(JSON.stringify(group));
  copy.report_source_fields = copy.fields;
  copy.fields = [paragraph(split.before, codes[0]), JSON.parse(JSON.stringify(inserted)), paragraph(split.after, codes[1])];
  delete copy.report_document;
  return copy;
}

export function restoreContinuousSource(group: FieldGroup): FieldGroup {
  const copy: FieldGroup = JSON.parse(JSON.stringify(group));
  if (copy.report_source_fields) copy.fields = copy.report_source_fields;
  delete copy.report_source_fields;
  delete copy.report_document;
  return copy;
}
