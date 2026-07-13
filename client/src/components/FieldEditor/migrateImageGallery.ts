import type { FieldGroup, FieldDefinition } from '../../../../shared/types';

/**
 * 存量兼容·纯函数：把旧的 `report_image_gallery` 图片分区就地迁成【image 字段分区 + group.image_layout】，
 * 让记录/项目模板 + 生成报告三处图片分区都统一走新模型（image 字段 + 分区级版式）。
 *  - 每个 gallery item → 一个 image 字段，`image_source_code`=原 `source_field_code`、label 保留；
 *  - 自动模式(无 items) 用 `source_field_codes` 建字段；
 *  - `group.image_layout` = gallery 配置（标题模式/每行/尺寸/单数独占/共用标题/跨页表头）；gal.caption→下方备注；
 *  - 稳定 code(item.id / `img_<src>`)，重复加载不 churn；照片键不变（record_raw_data[source_field_code] 继续命中）。
 * 已是 image 字段分区（无 gallery 字段）＝原样返回，幂等。
 */
export function migrateGalleryGroup(g: FieldGroup): FieldGroup {
  if (g.section_role !== 'images') return g;
  const gal = g.fields.find(f => f.type === 'report_image_gallery');
  if (!gal) return g;
  const cfg: any = (gal as any).image_gallery || {};
  const items: any[] = Array.isArray(cfg.items) ? cfg.items : [];
  const codes: string[] = Array.isArray(cfg.source_field_codes) ? cfg.source_field_codes : [];
  const mk = (id: string, label: string, src?: string): FieldDefinition =>
    ({ id, code: id, label, type: 'image', ...(src ? { image_source_code: src } : {}) } as FieldDefinition);
  const imgFields = items.length
    ? items.map((it, i) => mk(it.id || `img_${it.source_field_code || i}`, it.label ?? '', it.source_field_code))
    : codes.map((src) => mk(`img_${src}`, '', src));
  const image_layout: any = {
    title_mode: cfg.title_mode || 'per', cols: cfg.cols, width_cm: cfg.width_cm, height_cm: cfg.height_cm,
    solo: cfg.solo, shared_title: cfg.shared_title, header_follow: cfg.header_follow,
    ...(gal.caption ? { caption: gal.caption } : {}),
  };
  return { ...g, image_layout, fields: [...g.fields.filter(f => f !== gal), ...imgFields] };
}

/** 对一组分区逐个迁移（幂等）。 */
export function migrateGalleryGroups(groups: FieldGroup[]): FieldGroup[] {
  return (groups || []).map(migrateGalleryGroup);
}
