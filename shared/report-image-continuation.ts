import type { FieldDefinition, FieldGroup } from './types';
import { canEditContinuousText, continuousTextValue } from './report-continuous-text';
import { reportTextRuns, reportTextRunValue, updateReportTextRun } from './report-text-runs';
import { encodeReportRichDocument, readReportRichDocument } from './report-rich-document';
import { reportTextEndPosition } from './report-block-navigation';

/** Explicit continuation around an image collection, never inside its grid. */
export function continueImageSection(groups: FieldGroup[], groupId: string, direction: -1 | 1,
  ids: { group: string; field: string }, resolve: (field: FieldDefinition) => string): { groupId: string; id: string; position: number } | null {
  const index = groups.findIndex(group => group.id === groupId), source = groups[index];
  if (!source || source.section_role !== 'images' || source.fields.some(f => f.signature_line) || (source.module_span || 1) > 1) return null;
  const adjacent = groups[index + direction];
  if (adjacent && adjacent.parent_group_id === source.parent_group_id && !adjacent.fields.some(f => f.signature_line)) {
    const pure = canEditContinuousText(adjacent);
    const runs = reportTextRuns(adjacent);
    const run = direction === 1 ? runs.find(run => run.start === 0) : runs.find(run => run.start + run.ids.length === adjacent.fields.length);
    if (pure || run) {
      const value = pure ? continuousTextValue(adjacent, resolve) : reportTextRunValue(run!, resolve);
      const doc = readReportRichDocument(value), nodes = doc.content || (doc.content = []);
      const edge = direction === 1 ? nodes[0] : nodes.at(-1);
      if (edge?.type !== 'paragraph' || edge.content?.length) {
        if (direction === 1) nodes.unshift({ type: 'paragraph' }); else nodes.push({ type: 'paragraph' });
      }
      const next = encodeReportRichDocument(doc);
      if (next !== value) {
        if (pure) adjacent.report_document = { version: 1, value: next };
        else updateReportTextRun(adjacent, run!.ids, next);
      }
      return { groupId: adjacent.id, id: pure ? adjacent.fields[0].id : run!.ids[0], position: direction === 1 ? 1 : reportTextEndPosition(next) };
    }
  }
  if (groups.some(g => g.id === ids.group || g.fields.some(f => f.id === ids.field || f.code === ids.field))) return null;
  const field: FieldDefinition = { id: ids.field, code: ids.field, label: '', type: 'text', rich: true, hide_label: true,
    binding: { source: 'literal', text: encodeReportRichDocument({ type: 'doc', content: [{ type: 'paragraph' }] }) } };
  groups.splice(index + (direction === 1 ? 1 : 0), 0, { id: ids.group, label: '', hide_title: true, layout: 'vertical',
    parent_group_id: source.parent_group_id, fields: [field] });
  return { groupId: ids.group, id: ids.field, position: 1 };
}
