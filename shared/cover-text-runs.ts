import type { FieldDefinition, RecordTemplate } from './types';
import { projectCoverDocument } from './cover-document';
import { coverStaticTextValue } from './cover-template-editing';
import { encodeReportRichDocument, storedReportRichDocument } from './report-rich-document';
import { reportBodyLayout, reportLengthPt } from './report-body-layout';

export interface CoverTextRun { groupId: string; ids: string[]; value: string; field: FieldDefinition }

/** Read-only view: only adjacent, equally styled ordinary text can share an editor. */
export function coverTextRuns(template: RecordTemplate): CoverTextRun[] {
  const projection = projectCoverDocument(template), runs: CoverTextRun[] = [];
  projection.sections.forEach((section, gi) => {
    const group = template.groups[gi];
    let run: CoverTextRun | undefined;
    section.blocks.forEach((block, fi) => {
      const field = group.fields[fi];
      const style = field.style || {};
      // Positioning and custom gaps must not disappear when field wrappers merge.
      const safeStyle = Object.keys(style).every(k => ['font', 'size', 'color', 'weight', 'italic', 'align'].includes(k));
      if (field.cover_configured_field || block.kind !== 'text' || !safeStyle || field.field_gap || field.label_style || field.value_style) { run = undefined; return; }
      const value = block.value!;
      let nodes = structuredClone(storedReportRichDocument(value)!.content || []);
      // Existing rich paragraphs already own their spacing. Plain fields inherit
      // the template's field gap explicitly when becoming document paragraphs.
      if (!field.rich) {
        const size = reportLengthPt(style.size || group.style?.size, 'pt') || reportBodyLayout(template.layout_options?.theme_config).size;
        const gap = reportLengthPt(group.style?.block_spacing, 'pt', size)
          ?? reportLengthPt(template.layout_options?.theme_config?.line_gap ?? '0.6em', 'em', size);
        if (gap == null || gap > 200) { run = undefined; return; }
        // Legacy hidden-label literals use multiline(): two newlines are a
        // paragraph break, not two soft line breaks. Preserve that distinction.
        const raw = field.binding?.source === 'literal' ? field.binding.text : field.binding ? undefined : String(field.default_value ?? '');
        if (field.hide_label && raw?.includes('\n\n')) {
          nodes = raw.split('\n\n').flatMap(text => storedReportRichDocument(coverStaticTextValue({ ...field, binding: { source: 'literal', text } }))!.content || []);
          // Typst's unchanged default par.spacing is 1.2em; the theme only
          // overrides leading. Rich paragraphs must carry this explicitly.
          nodes.forEach((node, index) => { node.attrs = { ...node.attrs, spaceBefore: index === 0 ? gap : 0, spaceAfter: index === nodes.length - 1 ? gap : size * 1.2 }; });
        } else {
          for (const node of nodes) if (node.type === 'paragraph') node.attrs = { ...node.attrs, spaceBefore: gap, spaceAfter: gap };
        }
        for (const node of nodes) if (node.type === 'paragraph') node.attrs = { ...node.attrs, templateSpacing: { spaceBefore: node.attrs?.spaceBefore, spaceAfter: node.attrs?.spaceAfter } };
      }
      if (run && JSON.stringify(run.field.style || {}) === JSON.stringify(style)) {
        run.ids.push(field.id);
        const doc = storedReportRichDocument(run.value)!;
        doc.content!.push(...nodes);
        run.value = encodeReportRichDocument(doc);
        run.field.binding = { source: 'literal', text: run.value };
      } else {
        const projectedValue = encodeReportRichDocument({ type: 'doc', content: nodes });
        run = { groupId: group.id, ids: [field.id], value: projectedValue,
          field: { ...structuredClone(field), type: 'text', label: '', hide_label: true, rich: true, unit: undefined, binding: { source: 'literal', text: projectedValue } } };
        runs.push(run);
      }
    });
  });
  return runs.filter(run => run.ids.length > 1).map(run => {
    const fields = template.groups.find(g => g.id === run.groupId)!.fields;
    const first = fields.find(f => f.id === run.ids[0])!, last = fields.find(f => f.id === run.ids.at(-1))!;
    const doc = storedReportRichDocument(run.value)!;
    // Legacy field gaps collapse at the containing block's edges. Rich text's
    // explicit edge paragraph spacing instead becomes padding in PDF output.
    // Only remove generated edge spacing, never spacing the user already set.
    const head = doc.content?.[0], tail = doc.content?.at(-1);
    if (!first.rich && head?.type === 'paragraph') head.attrs = { ...head.attrs, spaceBefore: 0 };
    if (!last.rich && tail?.type === 'paragraph') tail.attrs = { ...tail.attrs, spaceAfter: 0 };
    run.value = encodeReportRichDocument(doc);
    run.field.binding = { source: 'literal', text: run.value };
    return run;
  });
}

/** Commit only the selected run; keep a source snapshot for lossless provenance. */
export function commitCoverTextRun(template: RecordTemplate, groupId: string, ids: string[], expected: string, value: string, materializeForInsertion = false): RecordTemplate {
  const run = coverTextRuns(template).find(r => r.groupId === groupId && JSON.stringify(r.ids) === JSON.stringify(ids));
  if (!run || run.value !== expected) throw new Error('正文已变化，请重新选择后编辑');
  if (expected === value && !materializeForInsertion) return template;
  const doc = storedReportRichDocument(value);
  if (!doc || encodeReportRichDocument(doc) !== value) throw new Error('正文格式不受支持');
  const next = structuredClone(template), group = next.groups.find(g => g.id === groupId)!;
  const start = group.fields.findIndex(f => f.id === ids[0]);
  const original = group.fields.slice(start, start + ids.length);
  const field: FieldDefinition = { ...run.field, binding: { source: 'literal', text: value },
    cover_source_fields: original.flatMap(f => f.cover_source_fields || [f]) };
  group.fields.splice(start, ids.length, field);
  return next;
}

/** Materialize only the caret's run as part of an explicit insertion transaction. */
export function coverTextInsertionBase(template: RecordTemplate, groupId: string, fieldId: string, value: string): RecordTemplate {
  const run = coverTextRuns(template).find(r => r.groupId === groupId && r.ids[0] === fieldId);
  return run ? commitCoverTextRun(template, groupId, run.ids, value, value, true) : template;
}
