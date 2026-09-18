import { imageCollectionKey } from './image-collection';

/** Image fields are allowed in ordinary sections, not only section_role=images. */
export function reportImageKeys(section: any): Set<string> {
  const keys = new Set<string>();
  for (const group of section?.groups || []) {
    const fields = group.fields || [];
    if (group.section_role === 'images' || fields.some((f: any) => ['image', 'report_image_gallery', 'report_photo_table'].includes(f.type))) keys.add(imageCollectionKey(group.id));
    for (const field of fields) {
      if (['image', 'report_photo_table'].includes(field.type)) {
        keys.add(field.code);
        if (field.image_source_code) keys.add(field.image_source_code);
      }
      if (field.type === 'report_image_gallery') {
        (field.image_gallery?.source_field_codes || []).forEach((code: string) => keys.add(code));
        (field.image_gallery?.items || []).forEach((item: any) => { if (item.source_field_code) keys.add(item.source_field_code); });
      }
    }
  }
  return keys;
}
export function pickReportImageData(section: any): Record<string, any> {
  const raw = section?.ctx?.record_raw_data || {};
  const keys = reportImageKeys(section);
  const output: Record<string, any> = {};
  for (const [key, value] of Object.entries(raw)) {
    const collection = value as any;
    if (keys.has(key) || (key.startsWith('__image_collection__::') && collection?.source_field_codes?.some((code: string) => keys.has(code)))) output[key] = structuredClone(value);
  }
  return output;
}
