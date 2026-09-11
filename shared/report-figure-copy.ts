import type { FieldDefinition, FieldGroup } from './types';
import { editReportTable } from './report-editable-table';
import { findImageCollection, imageCollectionFromLegacy } from './image-collection';
import { reportImagePreview } from './report-image-preview';

/** Copy displayed report data, never carry live bindings into a different project. */
export function snapshotReportFigure(original: FieldDefinition, group: FieldGroup, ctx: any): FieldDefinition | null {
  let field = structuredClone(original);
  if (['free_grid', 'report_result_table', 'report_equipment_table', 'report_sample_table', 'report_sample_description_table', 'report_conclusion_table'].includes(field.type)) {
    editReportTable(field, ctx, () => {});
    if (field.free_table) { delete field.free_table.cell_bindings; delete field.free_table.cell_formulas; }
  } else if (group.section_role === 'images') {
    const raw = ctx?.record_raw_data || {};
    const collection = findImageCollection(raw, group) || imageCollectionFromLegacy(group, raw);
    const cfg = group.image_layout || {};
    field = { id: original.id, code: original.code, type: 'image', label: cfg.shared_title || '', hide_label: cfg.title_mode !== 'shared',
      image_layout: 'compact', image_title_mode: cfg.title_mode === 'shared' ? 'shared' : 'per', image_cols: cfg.cols,
      image_size: { width_cm: cfg.width_cm, height_cm: cfg.height_cm }, image_solo: cfg.solo, image_seamless: cfg.seamless,
      image_inset_x: cfg.inset_x, image_inset_y: cfg.inset_y, image_title_inset_y: cfg.title_inset_y,
      style: structuredClone(group.style), label_style: structuredClone(original.label_style),
      report_image_title_style: structuredClone(cfg.label_style),
      image_photos: collection.items.map(item => item.photo).filter(Boolean),
      image_items: collection.items.map(item => ({ id: item.id, label: item.title, photos: item.photo ? [item.photo] : [] })) };
  } else if (field.type === 'report_image_gallery') {
    const model = reportImagePreview(original, ctx);
    field = { ...field, type: 'image', image_layout: 'compact', image_title_mode: model.title ? 'shared' : 'per', label: model.title, hide_label: !model.title,
      image_cols: model.cols, image_size: { width_cm: model.width, height_cm: model.height }, image_solo: model.solo, image_seamless: model.seamless,
      image_photos: model.items.map(item => item.photo).filter(Boolean),
      image_items: model.items.map((item, i) => ({ id: String(i), label: item.title, photos: item.photo ? [item.photo] : [] })) };
  } else if (field.type === 'image') {
    if (!field.image_photos && !field.image_items) {
      const photos = ctx?.record_raw_data?.[field.image_source_code || field.code];
      if (!Array.isArray(photos)) return null;
      field.image_photos = structuredClone(photos);
    }
    delete field.image_source_code;
    delete field.binding;
  } else if (field.type !== 'report_photo_table') return null;
  return structuredClone(field);
}

export function instantiateReportFigure(snapshot: FieldDefinition, code: string): FieldDefinition {
  const field = structuredClone(snapshot); field.id = code; field.code = code;
  delete field.page_break_before;
  field.image_items?.forEach((item, i) => { item.id = `${code}_item_${i}`; });
  field.image_photos?.forEach((item: any, i: number) => { if (item && typeof item === 'object') item.id = `${code}_photo_${i}`; });
  return field;
}
