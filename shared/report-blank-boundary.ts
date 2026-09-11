import type { FieldDefinition, FieldGroup } from './types';
import { canEditContinuousText, continuousTextValue } from './report-continuous-text';
import { reportTextRuns, reportTextRunValue, updateReportTextRun } from './report-text-runs';
import { encodeReportRichDocument, readReportRichDocument } from './report-rich-document';

/** Delete only one adjacent empty paragraph/spacer. Never delete the figure or nonempty prose. */
export function deleteBlankBesideFigure(groups: FieldGroup[], groupId: string, fieldId: string, side: -1 | 1,
  resolve: (field: FieldDefinition) => string): boolean {
  const gi = groups.findIndex(g => g.id === groupId), source = groups[gi];
  if (!source || source.fields.some(f => f.signature_line) || (source.module_span || 1) > 1) return false;
  const fi = source.fields.findIndex(f => f.id === fieldId);
  if (fi < 0) return false;
  let group = source, at = fi + side;
  if (at < 0 || at >= group.fields.length) {
    group = groups[gi + side];
    if (!group || group.parent_group_id !== source.parent_group_id || group.section_role === 'images') return false;
    at = side === -1 ? group.fields.length - 1 : 0;
  }
  if (group.fields.some(f => f.signature_line) || (group.module_span || 1) > 1 || (group.layout && group.layout !== 'vertical') || group.image_layout) return false;
  if (group.fields[at]?.type === 'spacer') { group.fields.splice(at, 1); return true; }
  const pure = !!group.report_document || canEditContinuousText(group);
  const run = reportTextRuns(group).find(r => side === -1 ? r.start + r.ids.length - 1 === at : r.start === at);
  if (!pure && !run) return false;
  const value = pure ? continuousTextValue(group, resolve) : reportTextRunValue(run!, resolve);
  const doc = readReportRichDocument(value), nodes = doc.content || [];
  const edge = side === -1 ? nodes.at(-1) : nodes[0];
  if (edge?.type !== 'paragraph' || edge.content?.some(node => node.type !== 'hardBreak' && (node.type !== 'text' || !!node.text?.trim()))) return false;
  if (nodes.length === 1) {
    if (pure) {
      if (group.label && !group.hide_title) return false;
      groups.splice(groups.indexOf(group), 1);
    } else {
      group.fields = group.fields.filter(f => !run!.ids.includes(f.id));
      if (group !== source && !group.fields.length && (!group.label || group.hide_title)) groups.splice(groups.indexOf(group), 1);
    }
  } else {
    if (side === -1) nodes.pop(); else nodes.shift();
    const next = encodeReportRichDocument(doc);
    if (pure) group.report_document = { version: 1, value: next };
    else updateReportTextRun(group, run!.ids, next);
  }
  return true;
}
