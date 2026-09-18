import type { RecordTemplate, FieldDefinition, FieldGroup, CellBinding } from './types';
import { validateCoverLegacyFormat, type CoverLegacyFormat } from './cover-legacy-format';
import { coverPartText, formatCoverText, rebaseCoverTextStyles } from './cover-text-selection';
import { makeReportManualTable } from './report-document-editing';
import { encodeReportRichDocument, readReportRichDocument, storedReportRichDocument, type ReportRichNode } from './report-rich-document';
export type CoverPartSelection = { part: 'label' | 'value'; text: string; from: number; to: number };
export type CoverSelectionTarget = { groupId: string; fieldId: string; selections: CoverPartSelection[] };
/** One history update, including when the selection crosses group boundaries. */
export function formatCoverSelection(template: RecordTemplate, targets: CoverSelectionTarget[], patch: CoverLegacyFormat['patch']): RecordTemplate {
  if (!targets.length || new Set(targets.map(t => JSON.stringify([t.groupId, t.fieldId]))).size !== targets.length) throw new Error('无效文字选区');
  let next = template;
  for (const target of targets) next = updateCoverField(next, target.groupId, target.fieldId, { legacySelectionFormat: { patch, selections: target.selections } });
  return next;
}
export type CoverFieldChange = { text: string } | { legacySelectionFormat: { patch: CoverLegacyFormat['patch']; selections: CoverPartSelection[] } } | { legacyFormat: CoverLegacyFormat; selection?: { text: string; from: number; to: number } } | { legacyLiteral: string } | { legacyLabel: string } | { binding: CellBinding } | { images: NonNullable<FieldDefinition['static_images']> } | { spacerHeight: string } | { table: NonNullable<FieldDefinition['static_table']> };

/** Explicit user action only: opening an empty template must not dirty it. */
export function startCoverBody(template: RecordTemplate, groupId: string | null, newGroupId: string, fieldId: string) {
  const group = groupId === null ? undefined : template.groups.find(g => g.id === groupId);
  if (groupId !== null && (!group || group.fields.length || !coverGroupCanFlow(group))) throw new Error('正文位置已变化，请重新选择');
  if (!fieldId || template.groups.some(g => g.fields.some(f => f.id === fieldId || f.code === fieldId))) throw new Error('内容编号重复');
  if (!group && (!newGroupId || template.groups.some(g => g.id === newGroupId))) throw new Error('分区编号重复');
  const next = structuredClone(template);
  const target = group ? next.groups.find(g => g.id === group.id)! : { id: newGroupId, label: '正文', layout: 'vertical' as const, hide_title: true, fields: [] as FieldDefinition[] };
  if (!group) next.groups.push(target);
  target.fields.push({ id: fieldId, code: fieldId, type: 'text', label: '', hide_label: true, rich: true,
    binding: { source: 'literal', text: encodeReportRichDocument({ type: 'doc', content: [{ type: 'paragraph' }] }) } });
  return { template: next, groupId: target.id, fieldId };
}

export function insertCoverLayoutBlock(template: RecordTemplate, groupId: string, afterId: string | null, kind: 'logo' | 'spacer' | 'table', id: string, dimensions?: { rows: number; columns: number }): RecordTemplate {
  const group = template.groups.find(g => g.id === groupId);
  if (!group || !coverGroupCanFlow(group)) throw new Error('请先选择普通正文区域');
  if (!id || template.groups.some(g => g.fields.some(f => f.id === id || f.code === id))) throw new Error('内容编号重复');
  const index = afterId === null ? group.fields.length : group.fields.findIndex(f => f.id === afterId) + 1;
  if (afterId !== null && index === 0) throw new Error('插入位置已变化，请重新选择');
  const field: FieldDefinition = kind === 'logo'
    ? { id, code: id, type: 'static_content', label: 'Logo', hide_label: true, static_kind: 'images', static_display: 'both', static_images: [{ id: `${id}_image`, name: 'Logo', display_width_cm: 4 }], static_layout: { before_pt: 0, after_pt: 4 } }
    : kind === 'table' ? { id, code: id, type: 'static_content', label: '固定表格', hide_label: true, static_kind: 'table', static_display: 'both', static_table: makeReportManualTable(id, dimensions).free_table }
    : { id, code: id, type: 'spacer', label: '', spacer_height: '0.5cm' };
  const next = structuredClone(template);
  next.groups.find(g => g.id === groupId)!.fields.splice(index, 0, field);
  return next;
}

export function insertConfiguredCoverField(template: RecordTemplate, groupId: string, afterId: string | null, field: FieldDefinition): RecordTemplate {
  const group = template.groups.find(g => g.id === groupId);
  if (!group || !coverGroupCanFlow(group)) throw new Error('请先选择普通正文区域');
  if (!field.id || !field.code || template.groups.some(g => g.fields.some(f => [f.id, f.code].some(id => id === field.id || id === field.code)))) throw new Error('字段编号重复');
  const index = afterId == null ? group.fields.length : group.fields.findIndex(f => f.id === afterId) + 1;
  if (afterId != null && index === 0) throw new Error('插入位置已变化，请重新选择');
  const next = structuredClone(template);
  next.groups.find(g => g.id === groupId)!.fields.splice(index, 0, { ...structuredClone(field), cover_configured_field: true });
  return next;
}

export function coverSourceFields(template: RecordTemplate): FieldDefinition[] {
  const sources: FieldDefinition[] = [];
  for (const field of template.groups.flatMap(group => group.fields)) {
    if (field.type === 'text' && field.binding?.source !== 'literal' && field.binding) sources.push(field);
    if (!field.rich || field.binding?.source !== 'literal') continue;
    const visit = (node: ReportRichNode) => {
      const ref = node.attrs?.reference;
      if (node.type === 'templateField' && ref && ref.binding.source !== 'literal') sources.push({ id: ref.id, code: ref.id, label: ref.label, type: 'text', binding: ref.binding });
      node.content?.forEach(visit);
    };
    const doc = storedReportRichDocument(field.binding.text);
    if (doc) visit(doc);
  }
  return sources;
}

/** A reference owns its source configuration; deleting/copying it cannot orphan another field. */
export function coverCanEditInline(field: FieldDefinition): boolean {
  if (field.cover_configured_field && !field.rich) return false;
  if (field.cover_text_styles) return false;
  return coverFieldMode(field) === 'text' || (field.type === 'text' && coverFieldMode(field) === 'binding'
    && !field.rich && !field.label_style && !field.value_style && (field.hide_label || field.label_width === 'none'));
}
export function coverInlineValue(field: FieldDefinition, labelBold = true): string {
  if (coverFieldMode(field) === 'text') return coverStaticTextValue(field);
  if (!coverCanEditInline(field) || !field.binding) throw new Error('此字段暂不支持内联编辑');
  return encodeReportRichDocument({ type: 'doc', content: [{ type: 'paragraph', ...(field.hide_label && !field.unit ? { attrs: { templateEmptyPolicy: 'hide' as const } } : {}), content: [
    ...(!field.hide_label ? [{ type: 'text' as const, text: `${field.label}：`, ...((field.label_bold ?? labelBold) ? { marks: [{ type: 'bold' as const }] } : {}) }] : []),
    { type: 'templateField', attrs: { reference: { id: field.id, label: field.label || '动态字段', binding: field.binding } } },
    ...(field.unit ? [{ type: 'text' as const, text: ` ${field.unit}` }] : []),
  ] }] });
}

export function coverGroupCanFlow(group: FieldGroup): boolean {
  return (!group.layout || group.layout === 'vertical') && !group.image_layout && group.section_role !== 'images'
    && !group.fields.some(f => f.signature_line) && !group.style?.vertical_align && !(group.module_span && group.module_span > 1);
}
export function coverFieldMode(field: FieldDefinition): 'text' | 'binding' | 'spacer' | 'configuration' {
  if (field.type === 'spacer') return 'spacer';
  if (!['text', 'textarea', 'number', 'date', 'select'].includes(field.type) || field.signature_line || field.formula) return 'configuration';
  if (field.binding && field.binding.source !== 'literal') return 'binding';
  return ['text', 'textarea'].includes(field.type) && field.hide_label && !field.unit && !field.value_style ? 'text' : 'configuration';
}
/** Plain literals are NOT Markdown; preserve stars, whitespace and soft breaks. */
export function coverStaticTextValue(field: FieldDefinition): string {
  const raw = String(field.binding?.source === 'literal' ? field.binding.text : field.default_value ?? '');
  if (field.rich) return encodeReportRichDocument(readReportRichDocument(raw));
  const content: ReportRichNode[] = raw.split('\n').flatMap((text, index) => [
    ...(index ? [{ type: 'hardBreak' as const }] : []), ...(text ? [{ type: 'text' as const, text }] : []),
  ]);
  return encodeReportRichDocument({ type: 'doc', content: [{ type: 'paragraph', content }] });
}
export function updateCoverField(template: RecordTemplate, groupId: string, fieldId: string, change: CoverFieldChange): RecordTemplate {
  const sourceGroup = template.groups.find(g => g.id === groupId);
  const source = sourceGroup?.fields.find(f => f.id === fieldId);
  if (!sourceGroup || !source) throw new Error('内容位置已变化，请重新选择');
  if ('legacySelectionFormat' in change) {
    const { selections, patch } = change.legacySelectionFormat;
    if (!selections.length || selections.length > 2 || new Set(selections.map(s => s.part)).size !== selections.length) throw new Error('无效文字选区');
    // Build privately: validation failure cannot publish a partially formatted field.
    let next = template;
    for (const selection of selections) {
      if (selection.part !== 'label' && selection.part !== 'value') throw new Error('无效文字选区');
      next = updateCoverField(next, groupId, fieldId, { legacyFormat: { part: selection.part, patch }, selection });
    }
    return next;
  }
  if ('legacyFormat' in change) {
    if (!['text', 'textarea', 'number', 'date', 'daterange', 'select'].includes(source.type)) throw new Error('此内容不支持文字格式设置');
    validateCoverLegacyFormat(change.legacyFormat);
    if (source.signature_line && change.legacyFormat.part === 'paragraph') throw new Error('签署行保持模板定位');
    const next = structuredClone(template), target = next.groups.find(g => g.id === groupId)!.fields.find(f => f.id === fieldId)!;
    if (change.selection && change.legacyFormat.part !== 'paragraph') {
      const part = change.legacyFormat.part, text = coverPartText(source, part);
      if (part === 'value' && (source.rich || source.formula || (source.binding && source.binding.source !== 'literal'))) throw new Error('动态值只能整体设置格式');
      if (text !== change.selection.text) throw new Error('文字已变化，请重新选择');
      target.cover_text_styles = { ...target.cover_text_styles, [part]: formatCoverText(text, target.cover_text_styles?.[part], change.selection.from, change.selection.to, change.legacyFormat.patch) };
      return next;
    }
    const key = change.legacyFormat.part === 'label' ? 'label_style' : change.legacyFormat.part === 'value' ? 'value_style' : 'style';
    target[key] = { ...target[key], ...change.legacyFormat.patch };
    if (change.legacyFormat.part !== 'paragraph') {
      const ranges = target.cover_text_styles?.[change.legacyFormat.part];
      if (ranges) ranges.spans = ranges.spans.map(span => {
        const style = { ...span.style };
        for (const key of Object.keys(change.legacyFormat.patch)) delete (style as any)[key];
        return { ...span, style };
      }).filter(span => Object.keys(span.style).length);
    }
    return next;
  }
  if ('legacyLiteral' in change || 'legacyLabel' in change) {
    if (!['text', 'textarea', 'number', 'date', 'daterange', 'select'].includes(source.type)) throw new Error('此内容不支持直接文字编辑');
    if ('legacyLiteral' in change && (!['text', 'textarea'].includes(source.type) || source.rich || source.formula || (source.binding && source.binding.source !== 'literal'))) throw new Error('不能用固定文字覆盖动态来源');
    const next = structuredClone(template), target = next.groups.find(g => g.id === groupId)!.fields.find(f => f.id === fieldId)!;
    const part = 'legacyLabel' in change ? 'label' : 'value', text = 'legacyLabel' in change ? change.legacyLabel : change.legacyLiteral;
    if (target.cover_text_styles?.[part]) target.cover_text_styles[part] = rebaseCoverTextStyles(target.cover_text_styles[part], text);
    if ('legacyLabel' in change) target.label = change.legacyLabel;
    else target.binding = { source: 'literal', text: change.legacyLiteral };
    return next;
  }
  if (!coverGroupCanFlow(sourceGroup) && ('text' in change || 'binding' in change)) throw new Error('此区域请使用字段配置编辑');
  if ('text' in change && (!coverCanEditInline(source) || !storedReportRichDocument(change.text))) throw new Error('此字段不能转换为普通文字');
  if ('binding' in change && (!['text', 'textarea', 'number', 'date', 'select'].includes(source.type) || source.signature_line || source.formula)) throw new Error('此字段请使用字段配置编辑');
  if ('images' in change && (source.type !== 'static_content' || source.static_kind !== 'images')) throw new Error('此字段不是固定图片');
  if ('table' in change && (source.type !== 'static_content' || source.static_kind !== 'table')) throw new Error('此字段不是固定表格');
  if ('spacerHeight' in change && (source.type !== 'spacer' || !/^(?:\d+(?:\.\d+)?|\.\d+)(?:pt|cm|mm|em|in)$/.test(change.spacerHeight))) throw new Error('无效留白高度');
  const next = structuredClone(template), target = next.groups.find(g => g.id === groupId)!.fields.find(f => f.id === fieldId)!;
  if ('text' in change) {
    target.rich = true; target.hide_label = true; delete target.unit;
    target.binding = { source: 'literal', text: change.text };
  }
  else if ('binding' in change) target.binding = structuredClone(change.binding);
  else if ('images' in change) target.static_images = structuredClone(change.images);
  else if ('table' in change) target.static_table = structuredClone(change.table);
  else target.spacer_height = change.spacerHeight;
  return next;
}
