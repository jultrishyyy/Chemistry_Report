import type { FieldDefinition, FieldGroup, StyleOverride } from './types';
import { encodeReportRichDocument } from './report-rich-document';

/** Convert supported report-only captions into independently editable prose, idempotently. */
export function detachReportFigureNotes(input: FieldGroup[]): FieldGroup[] {
  const groups = structuredClone(input);
  const captionBody = (text: string) => text.trim().replace(/^(?:备注|注)\s*[:：]\s*/, '');
  const used = new Set(groups.flatMap(g => [g.id, ...g.fields.flatMap(f => [f.id, f.code])]));
  const id = (base: string) => { let result = base, i = 1; while (used.has(result)) result = `${base}_${i++}`; used.add(result); return result; };
  const note = (base: string, text: string, caption: boolean, style?: StyleOverride, gap?: string, above = false): FieldDefinition => {
    const code = id(base);
    const value = caption ? `备注：${captionBody(text)}` : text;
    const distance = gap && /^\d+(?:\.\d+)?$/.test(gap) ? `${gap}pt` : gap;
    return { id: code, code, type: 'text', label: '', hide_label: true, rich: true,
      style: { ...(caption ? { size: '9pt' } : {}), ...style,
        ...(distance ? { [above ? 'space_after' : 'space_before']: distance } : {}) },
      binding: { source: 'literal', text: encodeReportRichDocument({ type: 'doc', content: value.split('\n').map(line => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })) }) } };
  };
  const result: FieldGroup[] = [];
  let protectedUntil = -1;
  groups.forEach((group, index) => {
    if ((group.module_span || 1) > 1) protectedUntil = Math.max(protectedUntil, index + group.module_span! - 1);
    if (index <= protectedUntil || group.fields.some(f => f.signature_line) || group.layout !== 'vertical' || group.report_document) { result.push(group); return; }
    const inherited = { font: group.style?.font, color: group.style?.color };
    if (group.section_role === 'images') {
      const layout = group.image_layout;
      // Preserve title/note ordering in legacy mixed picture sections; they keep their editor.
      if (group.fields.some(f => f.type !== 'image') || (group.label && !group.hide_title && layout?.top_label?.trim())) { result.push(group); return; }
      const sibling = (field: FieldDefinition): FieldGroup => ({ id: id(`${field.id}_group`), label: '', hide_title: true, layout: 'vertical', parent_group_id: group.parent_group_id, fields: [field] });
      if (layout?.top_label?.trim()) {
        const before = sibling(note(`${group.id}_above_note`, layout.top_label, false, { ...inherited, ...(group.style?.size ? { size: group.style.size } : {}), ...layout.top_label_style }, layout.top_label_gap, true));
        if (group.page_break_before) { before.page_break_before = true; delete group.page_break_before; }
        result.push(before);
        delete layout.top_label;
      }
      result.push(group);
      if (layout?.caption && captionBody(layout.caption).trim()) {
        result.push(sibling(note(`${group.id}_below_note`, layout.caption, true, { ...inherited, ...layout.caption_style }, layout.caption_gap)));
        delete layout.caption;
      }
      return;
    }
    group.fields = group.fields.flatMap(field => {
      if (!field.caption || !captionBody(field.caption).trim() || !['image', 'free_grid', 'data_matrix', 'report_result_table', 'report_equipment_table', 'report_sample_table', 'report_sample_description_table', 'report_conclusion_table', 'report_photo_table', 'report_image_gallery'].includes(field.type)) return [field];
      const above = field.caption_position === 'above';
      const paragraph = note(`${field.id}_${above ? 'above' : 'below'}_note`, field.caption, true, { ...inherited, ...field.caption_style }, field.caption_gap, above);
      if (above && field.page_break_before) { paragraph.page_break_before = true; delete field.page_break_before; }
      delete field.caption;
      delete field.caption_gap;
      delete field.caption_style;
      delete field.caption_position;
      return above ? [paragraph, field] : [field, paragraph];
    });
    result.push(group);
  });
  return result;
}
