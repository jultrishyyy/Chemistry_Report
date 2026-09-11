import type { FieldDefinition, FieldGroup, StyleOverride } from './types';
import type { RecordImageCollection } from './image-collection';
import { reportImageTitleStyle } from './report-image-title-style';

export interface ReportImagePreviewModel {
  title: string; captionLabel?: string; caption?: string; cols: number; width: number; height: number;
  solo: 'first' | 'last'; seamless: boolean;
  titleStyle?: StyleOverride; insetX?: number; insetY?: number; titleInsetY?: number;
  aboveText?: string; belowText?: string;
  items: Array<{ title: string; photo?: any; titleStyle?: StyleOverride }>;
}
const size = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
export function reportPreviewPhotoSrc(photo: any): string | undefined {
  if (typeof photo?.url === 'string' && photo.url) return photo.url;
  if (typeof photo?.rel_path === 'string' && photo.rel_path && !photo.rel_path.startsWith('/') && !photo.rel_path.includes('..')) return `/api/images/file?p=${encodeURIComponent(photo.rel_path)}`;
  return typeof photo?.server_path === 'string' ? photo.server_path : undefined;
}
const layout = (cfg: any, cols = 2) => ({ cols: Math.max(1, Math.min(12, Math.floor(size(cfg.cols, cols)))), width: size(cfg.width_cm, 7), height: size(cfg.height_cm, 6),
  solo: cfg.solo === 'last' ? 'last' as const : 'first' as const, seamless: cfg.seamless !== false });

/** Read-only projection matching the renderer's shared/per/automatic photo selection. */
export function reportImagePreview(field: FieldDefinition, ctx: any = {}): ReportImagePreviewModel {
  const image = field.type === 'image', gallery = field.type === 'report_image_gallery';
  const cfg: any = image ? { title_mode: field.image_title_mode, cols: field.image_cols, width_cm: field.image_size?.width_cm,
    height_cm: field.image_size?.height_cm, solo: field.image_solo, seamless: field.image_seamless, photos: field.image_photos, items: field.image_items }
    : gallery ? field.image_gallery || {} : field.photo_table || {};
  const model: ReportImagePreviewModel = { ...layout(cfg, image ? 1 : 2), title: '', items: [],
    titleStyle: reportImageTitleStyle(field, image && cfg.title_mode !== 'per' ? field.label_style : undefined),
    insetX: (image ? field.image_inset_x : cfg.inset_x) ?? (image ? field.image_table_style?.inset_pt : cfg.inset_pt) ?? 6,
    insetY: (image ? field.image_inset_y : cfg.inset_y) ?? (image ? field.image_table_style?.inset_pt : cfg.inset_pt) ?? 6,
    titleInsetY: (image ? field.image_title_inset_y : cfg.title_inset_y) ?? 10,
    ...(!gallery && !image ? { captionLabel: cfg.caption_label, caption: cfg.caption_text } : {}) };
  if (gallery) {
    if (!ctx?.linked_record_template) return model;
    const fields: FieldDefinition[] = (ctx.linked_record_template.groups || []).flatMap((g: FieldGroup) => g.fields || []).filter((f: FieldDefinition) => f.type === 'image');
    const raw = ctx.record_raw_data || {};
    const photos = (code: string) => Array.isArray(raw[code]) ? raw[code] : [];
    if (cfg.items?.length) {
      const shared = cfg.title_mode === 'shared';
      model.title = shared ? cfg.shared_title || '' : '';
      model.items = cfg.items.map((item: any) => ({ title: shared || item.hide_label ? '' : item.label ?? fields.find(f => f.code === item.source_field_code)?.label ?? '', photo: photos(item.source_field_code)[0],
        titleStyle: reportImageTitleStyle(field, fields.find(f => f.code === item.source_field_code)?.label_style) }));
    } else {
      model.items = fields.filter(f => !cfg.source_field_codes?.length || cfg.source_field_codes.includes(f.code)).flatMap(f => {
        const list = photos(f.code);
        return (list.length ? list : [undefined]).map((photo: any, index: number) => ({ photo, titleStyle: reportImageTitleStyle(field, f.label_style),
          title: f.hide_label || !f.label ? '' : list.length > 1 ? `${f.label} ${index + 1}` : f.label }));
      });
    }
  } else if (cfg.title_mode === 'per') {
    model.items = (cfg.items || []).map((item: any) => ({ title: item.label || '', photo: item.photos?.[0] }));
  } else {
    model.title = image ? field.hide_label ? '' : field.label || '' : cfg.header || '';
    model.items = (Array.isArray(cfg.photos) ? cfg.photos : []).map((photo: any) => ({ title: '', photo }));
  }
  return model;
}

export function reportCollectionPreview(group: FieldGroup, collection: RecordImageCollection): ReportImagePreviewModel {
  const cfg = group.image_layout || {};
  const shared = cfg.title_mode === 'shared';
  return { ...layout(cfg), title: shared ? cfg.shared_title || '' : '', aboveText: cfg.top_label, belowText: cfg.caption,
    titleStyle: cfg.label_style,
    insetX: cfg.inset_x ?? group.fields.find(field => field.type === 'image')?.image_table_style?.inset_pt ?? 6,
    insetY: cfg.inset_y ?? group.fields.find(field => field.type === 'image')?.image_table_style?.inset_pt ?? 6,
    titleInsetY: cfg.title_inset_y ?? 10,
    items: collection.items.map(item => ({ title: shared ? '' : item.title || '', photo: item.photo })) };
}
