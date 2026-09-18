import type { FieldDefinition, RecordTemplate } from './types';
import { coverFieldMode, coverGroupCanFlow, coverStaticTextValue, insertCoverLayoutBlock, insertConfiguredCoverField } from './cover-template-editing';
import { encodeReportRichDocument, storedReportRichDocument, type ReportRichNode } from './report-rich-document';

const empty = () => encodeReportRichDocument({ type: 'doc', content: [{ type: 'paragraph' }] });
export const isCoverFigure = (field: FieldDefinition) => field.type === 'static_content' && ['images', 'table'].includes(field.static_kind || '');
const isNativeText = (field: FieldDefinition) => ['text', 'textarea', 'number', 'date', 'daterange', 'select'].includes(field.type);

/** Only an explicit keypress may remove a plain boundary paragraph; positioning remains protected. */
export function deleteCoverBlankParagraph(template: RecordTemplate, groupId: string, fieldId: string, paragraphIndex: number, direction: -1 | 1): { template: RecordTemplate; figureId: string; edge: -1 | 1 } | null {
  const group = template.groups.find(g => g.id === groupId), index = group?.fields.findIndex(f => f.id === fieldId) ?? -1;
  if (!group || !coverGroupCanFlow(group) || index < 0) return null;
  const field = group.fields[index];
  if (!canSplitCoverText(field) || field.cover_configured_field) return null;
  const doc = storedReportRichDocument(coverStaticTextValue(field));
  const paragraphs = doc?.content || [], paragraph = paragraphs[paragraphIndex];
  if (!paragraph || paragraph.type !== 'paragraph' || (paragraphIndex !== 0 && paragraphIndex !== paragraphs.length - 1)) return null;
  if ((paragraph.content || []).some(node => node.type !== 'text' || !!node.text?.trim())) return null;
  if (paragraph.attrs?.spaceBefore || paragraph.attrs?.spaceAfter || paragraph.attrs?.lineGap) return null;
  const side = ([direction, -direction] as Array<-1 | 1>).find(side => {
    const neighbor = group.fields[index + side];
    return neighbor && (isCoverFigure(neighbor) || isNativeText(neighbor)) && (side === -1 ? paragraphIndex === 0 : paragraphIndex === paragraphs.length - 1);
  });
  if (!side) return null;
  const next = structuredClone(template), fields = next.groups.find(g => g.id === groupId)!.fields;
  if (paragraphs.length === 1) fields.splice(index, 1);
  else {
    const remaining = structuredClone(doc!); remaining.content!.splice(paragraphIndex, 1);
    fields[index] = { ...fields[index], rich: true, binding: { source: 'literal', text: encodeReportRichDocument(remaining) } };
  }
  return { template: next, figureId: group.fields[index + side].id, edge: side === -1 ? 1 : -1 };
}
export function continueCoverFigure(template: RecordTemplate, groupId: string, figureId: string, direction: -1 | 1, id: string): { template: RecordTemplate; fieldId: string } {
  const group = template.groups.find(g => g.id === groupId), index = group?.fields.findIndex(f => f.id === figureId) ?? -1;
  if (!group || !coverGroupCanFlow(group) || index < 0) throw new Error('图表位置已变化，请重新选择');
  const figure = group.fields[index];
  if (!isCoverFigure(figure) && !isNativeText(figure)) throw new Error('此区域暂不支持图文衔接');
  const neighbor = group.fields[index + direction];
  if (neighbor && coverFieldMode(neighbor) === 'text' && !neighbor.cover_configured_field) return { template, fieldId: neighbor.id };
  if (template.groups.some(g => g.fields.some(f => f.id === id || f.code === id))) throw new Error('内容编号重复');
  const next = structuredClone(template);
  next.groups.find(g => g.id === groupId)!.fields.splice(index + (direction === 1 ? 1 : 0), 0, {
    id, code: id, type: 'text', label: '', hide_label: true, rich: true, binding: { source: 'literal', text: empty() },
  });
  return { template: next, fieldId: id };
}

/** Split only flowing literal prose; never duplicate layout positioning or resolved business values. */
export function canSplitCoverText(field: FieldDefinition): boolean {
  return coverFieldMode(field) === 'text' && !field.page_break_before && !field.semantic_role && !field.style?.margin && !field.style?.keep_together
    && !field.style?.space_before && !field.style?.space_after && !field.style?.vertical_align;
}
export type CoverTextSplit = { value: string; before: string; after: string };
export function insertCoverBlockAtText(template: RecordTemplate, groupId: string, fieldId: string, split: CoverTextSplit, kind: 'logo' | 'table', blockId: string, tailId: string, dimensions?: { rows: number; columns: number }, configuredField?: FieldDefinition): RecordTemplate {
  const group = template.groups.find(g => g.id === groupId), source = group?.fields.find(f => f.id === fieldId);
  if (!group || !coverGroupCanFlow(group) || !source || !canSplitCoverText(source)) throw new Error('此文字带有特殊版式，请在内容块之后插入');
  if (coverStaticTextValue(source) !== split.value) throw new Error('文字已变化，请重新定位光标后插入');
  const before = split.before ? storedReportRichDocument(split.before) : storedReportRichDocument(empty());
  const after = split.after ? storedReportRichDocument(split.after) : storedReportRichDocument(empty());
  if (!before || !after) throw new Error('无效的文字选区');
  const leaves = (node: ReportRichNode): ReportRichNode[] => node.content ? node.content.flatMap(leaves) : ['paragraph', 'doc'].includes(node.type) ? [] : [node];
  const signature = (nodes: ReportRichNode[]) => {
    const normalized: ReportRichNode[] = [];
    for (const node of nodes) {
      const last = normalized.at(-1);
      if (last?.type === 'text' && node.type === 'text' && JSON.stringify(last.marks || []) === JSON.stringify(node.marks || [])) last.text = (last.text || '') + (node.text || '');
      else normalized.push(structuredClone(node));
    }
    return JSON.stringify(normalized);
  };
  if (signature([...leaves(before), ...leaves(after)]) !== signature(leaves(storedReportRichDocument(split.value)!))) throw new Error('选区不完整，不能丢弃文字或字段来源');
  if (!tailId || tailId === blockId || template.groups.some(g => g.fields.some(f => f.id === tailId || f.code === tailId))) throw new Error('内容编号重复');
  if (configuredField && configuredField.id !== blockId) throw new Error('字段编号不一致');
  const next = configuredField ? insertConfiguredCoverField(template, groupId, fieldId, configuredField) : insertCoverLayoutBlock(template, groupId, fieldId, kind, blockId, dimensions);
  const fields = next.groups.find(g => g.id === groupId)!.fields;
  const index = fields.findIndex(f => f.id === fieldId);
  if (!split.before) {
    const block = fields[index + 1];
    fields.splice(index, 2, block, { ...fields[index], rich: true, binding: { source: 'literal', text: encodeReportRichDocument(after) } });
    return next;
  }
  fields[index] = { ...fields[index], rich: true, binding: { source: 'literal', text: encodeReportRichDocument(before) } };
  if (split.after) fields.splice(index + 2, 0, { ...structuredClone(source), id: tailId, code: tailId, rich: true, binding: { source: 'literal', text: encodeReportRichDocument(after) } });
  return next;
}
