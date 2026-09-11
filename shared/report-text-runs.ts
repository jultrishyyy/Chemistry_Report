import type { FieldDefinition, FieldGroup } from './types';
import { canEditContinuousText, continuousTextValue } from './report-continuous-text';
import { storedReportRichDocument } from './report-rich-document';
import { reportLengthPt } from './report-body-layout';

export interface ReportTextRun { start: number; ids: string[]; group: FieldGroup; isolated?: boolean }
const gapLength = (value: string) => /^\d+(?:\.\d+)?$/.test(value.trim()) ? `${value.trim()}em` : value;

/** Explicit paragraph spacing supersedes the old field wrapper at the same edge. */
export function reportParagraphOuterStyle(style: FieldDefinition['style'], value: string): FieldDefinition['style'] {
  const nodes = storedReportRichDocument(value)?.content;
  if (!nodes?.length || !style) return style;
  const next = { ...style };
  if (nodes[0].attrs?.spaceBefore != null) delete next.space_before;
  if (nodes.at(-1)?.attrs?.spaceAfter != null) delete next.space_after;
  return next;
}

function isolatedText(group: FieldGroup, field: FieldDefinition): FieldGroup | null {
  if (field.signature_line || field.type === 'spacer') return null;
  const style = { ...field.style };
  if (Object.entries(style).some(([key, value]) => value != null && !['font', 'size', 'color', 'weight', 'italic', 'align', 'line_height', 'tracking', 'space_before', 'space_after'].includes(key))) return null;
  for (const key of ['font', 'line_height', 'tracking', 'space_before', 'space_after'] as const) {
    const value = style[key];
    if (value != null && (key === 'font' ? typeof value !== 'string' || !value.trim()
      : reportLengthPt(value, key === 'line_height' ? 'em' : 'pt') === undefined)) return null;
    delete style[key];
  }
  if (field.field_gap && reportLengthPt(field.field_gap, 'em') === undefined) return null;
  const cleanField = { ...field, style, field_gap: undefined, page_break_before: undefined };
  // Existing rich text already carries inline formatting; its outer style is
  // retained on the independent block, never flattened into adjacent prose.
  if (field.rich) cleanField.style = {};
  const candidate = { ...group, report_source_fields: undefined, report_document: undefined, fields: [cleanField] };
  if (!canEditContinuousText(candidate)) return null;
  return { ...candidate, style: { ...group.style, ...field.style,
    ...(field.field_gap ? { space_before: field.style?.space_before || gapLength(field.field_gap), space_after: field.style?.space_after || gapLength(field.field_gap) } : {}) } };
}

/** Read-only grouping: opening a mixed section never rewrites its bindings. */
export function reportTextRuns(group: FieldGroup): ReportTextRun[] {
  if (group.layout !== 'vertical' || group.section_role === 'images' || group.image_layout || group.report_document) return [];
  const runs: ReportTextRun[] = [];
  for (let index = 0; index < group.fields.length; index++) {
    const field = group.fields[index];
    const candidate: FieldGroup = { ...group, report_source_fields: undefined, report_document: undefined, fields: [field] };
    // Keep fixed spacers as layout blocks, not empty editors.
    if (field.type === 'spacer') continue;
    if (!canEditContinuousText(candidate)) {
      const isolated = isolatedText(group, field);
      if (isolated) runs.push({ start: index, ids: [field.id], isolated: true,
        group: { ...isolated, id: field.id, label: '', hide_title: true } });
      continue;
    }
    const previous = runs.at(-1);
    if (previous && !previous.isolated && previous.start + previous.ids.length === index) {
      previous.ids.push(field.id); previous.group.fields.push(field);
    } else runs.push({ start: index, ids: [field.id], group: { ...candidate, id: field.id, label: '', hide_title: true, fields: [field] } });
  }
  return runs;
}

/** Update one run by stable IDs. Retain the entire original source once only. */
export function updateReportTextRun(group: FieldGroup, ids: string[], value: string): FieldDefinition | null {
  if (!storedReportRichDocument(value)) return null;
  const run = reportTextRuns(group).find(run => run.ids.length === ids.length && run.ids.every((id, i) => id === ids[i]));
  if (!run) return null;
  if (!group.report_source_fields) group.report_source_fields = JSON.parse(JSON.stringify(group.fields));
  const first = group.fields[run.start];
  const field: FieldDefinition = { id: first.id, code: first.code, type: 'text', label: '', hide_label: true, rich: true,
    ...(run.isolated ? { style: { ...first.style,
      ...(first.field_gap ? { space_before: first.style?.space_before || gapLength(first.field_gap), space_after: first.style?.space_after || gapLength(first.field_gap) } : {}) }, page_break_before: first.page_break_before } : {}),
    binding: { source: 'literal', text: value } };
  group.fields.splice(run.start, ids.length, field);
  field.style = reportParagraphOuterStyle(field.style, value);
  return field;
}

export function reportTextRunValue(run: ReportTextRun, resolve: (field: FieldDefinition) => string): string {
  return continuousTextValue(run.group, resolve);
}

/** PDF uses the same run projection as the editor, even before the first edit.
 * Source fields/snapshots are never modified by this read-only projection.
 */
export function projectReportTextRuns(group: FieldGroup, resolve: (field: FieldDefinition) => string): FieldGroup {
  if (group.fields.some(field => field.signature_line)) return group;
  const runs = reportTextRuns(group);
  if (!runs.length) return group;
  const fields: FieldDefinition[] = [];
  for (let index = 0; index < group.fields.length;) {
    const run = runs.find(run => run.start === index);
    if (!run) { fields.push(group.fields[index++]); continue; }
    const first = group.fields[index];
    fields.push({ id: first.id, code: first.code, type: 'text', label: '', hide_label: true, rich: true,
      ...(run.isolated ? { style: { ...first.style,
        ...(first.field_gap ? { space_before: first.style?.space_before || gapLength(first.field_gap), space_after: first.style?.space_after || gapLength(first.field_gap) } : {}) }, page_break_before: first.page_break_before } : {}),
      binding: { source: 'literal', text: reportTextRunValue(run, resolve) } });
    index += run.ids.length;
  }
  return { ...group, fields };
}
