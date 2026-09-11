import type { FieldDefinition, FieldGroup } from './types';
import { encodeReportRichDocument, readReportRichDocument } from './report-rich-document';
import { reportTextRuns, reportTextRunValue } from './report-text-runs';

/** ProseMirror node sizes: text uses UTF-16 offsets; inline/spacing atoms use 1. */
export function reportTextEndPosition(value: string): number {
  const size = (node: any): number => node.type === 'text' ? (node.text || '').length
    : node.type === 'hardBreak' || node.type === 'reportSpacer' ? 1
    : (node.type === 'doc' ? 0 : 2) + (node.content || []).reduce((sum: number, child: any) => sum + size(child), 0);
  return Math.max(1, size(readReportRichDocument(value)) - 1);
}

export function removeReportBlockWithFocus(group: FieldGroup, id: string, resolve: (field: FieldDefinition) => string): { id: string; position: number } | null {
  const index = group.fields.findIndex(field => field.id === id);
  if (index < 0) return null;
  const runs = reportTextRuns(group);
  const before = runs.find(run => run.start + run.ids.length === index);
  const after = runs.find(run => run.start === index + 1);
  const focus = before ? { id: before.ids[0], position: reportTextEndPosition(reportTextRunValue(before, resolve)) }
    : after ? { id: after.ids[0], position: 1 } : null;
  removeReportBlock(group, id);
  return focus;
}

const paragraph = (field?: FieldDefinition) => field?.type === 'text' && field.rich && field.hide_label
  && field.binding?.source === 'literal';
const empty = () => ({ type: 'paragraph' as const });
const blank = (node: any) => node?.type === 'paragraph' && !node.content?.length;

/** Keep table/image-section layout rules intact; ordinary vertical sections can host prose. */
export function canContinueReportBlocks(group: FieldGroup): boolean {
  return (!group.layout || group.layout === 'vertical') && group.section_role !== 'images' && !group.image_layout;
}

/** Explicit Enter beside a figure; reuse an existing blank edge, not duplicate it. */
export function enterBesideReportBlock(group: FieldGroup, id: string, direction: -1 | 1, code: string): string | null {
  if (!canContinueReportBlocks(group)) return null;
  const index = group.fields.findIndex(f => f.id === id);
  if (index < 0 || paragraph(group.fields[index])) return null;
  const adjacent = group.fields[index + direction];
  if (paragraph(adjacent)) {
    const doc = readReportRichDocument((adjacent.binding as { text: string }).text);
    const nodes = doc.content || (doc.content = []);
    if (direction === 1 && !blank(nodes[0])) nodes.unshift(empty());
    if (direction === -1 && !blank(nodes.at(-1))) nodes.push(empty());
    adjacent.binding = { source: 'literal', text: encodeReportRichDocument(doc) };
    return adjacent.id;
  }
  const field: FieldDefinition = { id: code, code, type: 'text', label: '', hide_label: true, rich: true,
    binding: { source: 'literal', text: encodeReportRichDocument({ type: 'doc', content: [empty()] }) } };
  group.fields.splice(index + (direction === 1 ? 1 : 0), 0, field);
  return field.id;
}

/** Explicit deletion only. Keep paragraph boundaries, formatting and source snapshots. */
export function removeReportBlock(group: FieldGroup, id: string): void {
  const index = group.fields.findIndex(f => f.id === id);
  if (index < 0) return;
  group.fields.splice(index, 1);
  if (!group.report_source_fields) return;
  const before = group.fields[index - 1], after = group.fields[index];
  if (!paragraph(before) || !paragraph(after) || after.page_break_before
    || JSON.stringify(before.style) !== JSON.stringify(after.style)
    || JSON.stringify(before.value_style) !== JSON.stringify(after.value_style)
    || before.field_gap !== after.field_gap) return;
  const left = readReportRichDocument((before.binding as { text: string }).text);
  const right = readReportRichDocument((after.binding as { text: string }).text);
  before.binding = { source: 'literal', text: encodeReportRichDocument({ type: 'doc', content: [...(left.content || []), ...(right.content || [])] }) };
  group.fields.splice(index, 1);
}
