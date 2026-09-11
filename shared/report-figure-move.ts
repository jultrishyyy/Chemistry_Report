import type { FieldGroup } from './types';
import { canEditContinuousText } from './report-continuous-text';

/** Stable-ID moves within one report section; never split signatures or compound modules. */
export function moveReportFigure(groups: FieldGroup[], sourceId: string, targetGroupId: string, targetFieldId: string | undefined, after: boolean, newGroupId: string): boolean {
  const si = groups.findIndex(g => g.fields.some(f => f.id === sourceId));
  const ti = groups.findIndex(g => g.id === targetGroupId);
  if (si < 0 || ti < 0) return false;
  const source = groups[si], target = groups[ti];
  const protectedIndex = (index: number) => groups.some((g, i) => i <= index && i + (g.module_span || 1) > index && ((g.module_span || 1) > 1 || g.fields.some(f => f.signature_line)));
  if (protectedIndex(si) || protectedIndex(ti) || source.parent_group_id !== target.parent_group_id) return false;
  const field = source.fields.find(f => f.id === sourceId)!;
  if (!['image', 'free_grid', 'report_result_table', 'report_equipment_table', 'report_sample_table', 'report_sample_description_table', 'report_conclusion_table', 'report_photo_table', 'report_image_gallery'].includes(field.type)) return false;
  if (source.section_role === 'images' || source.image_layout) {
    if (si === ti) return false;
    groups.splice(si, 1);
    groups.splice(groups.indexOf(target) + (after ? 1 : 0), 0, source);
    return true;
  }
  if (targetFieldId === sourceId) return false;
  if (source.report_document || source.layout !== 'vertical' || target.layout !== 'vertical') return false;
  source.fields.splice(source.fields.indexOf(field), 1);
  if (target.report_document || canEditContinuousText(target) || target.section_role === 'images' || target.image_layout) {
    groups.splice(groups.indexOf(target) + (after ? 1 : 0), 0, { id: newGroupId, label: '', hide_title: true, layout: 'vertical', parent_group_id: target.parent_group_id, fields: [field] });
  } else {
    const at = target.fields.findIndex(f => f.id === targetFieldId);
    target.fields.splice(at < 0 ? target.fields.length : at + (after ? 1 : 0), 0, field);
  }
  if (source !== target && !source.fields.length && (!source.label || source.hide_title)) groups.splice(groups.indexOf(source), 1);
  return true;
}
