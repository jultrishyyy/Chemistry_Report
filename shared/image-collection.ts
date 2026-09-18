import type { FieldDefinition, FieldGroup } from './types';

/** 原始记录图片分区在 raw_data 中的动态集合。模板字段只负责提供初始图位。 */
export interface RecordImageCollectionItem {
  id: string;
  title: string;
  photo?: any;
  /** 初始来自哪个旧图片字段，用于继续同步旧格式。 */
  source_field_code?: string;
}

export interface RecordImageCollection {
  kind: 'image_collection';
  version: 1;
  source_group_id: string;
  source_field_codes: string[];
  items: RecordImageCollectionItem[];
}

export const imageCollectionKey = (groupId: string) => `__image_collection__::${groupId}`;

export function isRecordImageCollection(value: any): value is RecordImageCollection {
  return !!value && value.kind === 'image_collection' && Array.isArray(value.items);
}

/**
 * 读取本分区集合。优先按 group id；项目模板 group id 不同时，再按绑定字段 code
 * 在快照中寻找来源分区。这样旧项目模板无需立即增加新的分区绑定配置。
 */
export function findImageCollection(
  rawData: Record<string, any> | undefined,
  group: FieldGroup,
): RecordImageCollection | undefined {
  if (!rawData) return undefined;
  const direct = rawData[imageCollectionKey(group.image_source_group_id || group.id)];
  if (isRecordImageCollection(direct)) return direct;
  const sourceCodes = new Set(group.fields
    .filter(field => field.type === 'image')
    .map(field => field.image_source_code || field.code)
    .filter(Boolean));
  for (const value of Object.values(rawData)) {
    if (!isRecordImageCollection(value)) continue;
    if (value.source_field_codes?.some(code => sourceCodes.has(code))) return value;
  }
  return undefined;
}

/** 把旧的 field.code -> photo[] 数据无损投影成动态集合；尚未上传的模板图位也保留。 */
export function imageCollectionFromLegacy(group: FieldGroup, rawData: Record<string, any>): RecordImageCollection {
  const fields = group.fields.filter(field => field.type === 'image');
  const items: RecordImageCollectionItem[] = [];
  for (const field of fields) {
    // 项目模板的 image 字段常以 image_source_code 绑定原始记录照片；
    // 旧数据仍按来源 code 保存，不能只查项目字段自身的 code。
    const sourceCode = field.image_source_code || field.code;
    const photos = Array.isArray(rawData[field.code])
      ? rawData[field.code]
      : (Array.isArray(rawData[sourceCode]) ? rawData[sourceCode] : []);
    if (!photos.length) {
      items.push({ id: `${group.id}:${field.id}:empty`, title: field.label || '', source_field_code: sourceCode });
      continue;
    }
    photos.forEach((photo: any, index: number) => items.push({
      id: `${group.id}:${field.id}:${index}`,
      title: photos.length > 1 ? `${field.label || '图片'} ${index + 1}` : (field.label || ''),
      photo,
      source_field_code: sourceCode,
    }));
  }
  return {
    kind: 'image_collection',
    version: 1,
    source_group_id: group.id,
    source_field_codes: fields.map(field => field.image_source_code || field.code),
    items,
  };
}

/** PDF 渲染复用旧图位引擎时，把集合项转换成临时图片字段。 */
export function collectionItemFields(group: FieldGroup, collection: RecordImageCollection): FieldDefinition[] {
  const templates = group.fields.filter(field => field.type === 'image');
  return collection.items.map((item, index) => {
    const base = templates.find(field => (field.image_source_code || field.code) === item.source_field_code) || templates[0];
    return {
      ...(base || {}),
      id: item.id || `${group.id}:item:${index}`,
      code: item.id || `${group.id}:item:${index}`,
      type: 'image',
      label: item.title || '',
      // 仅供本次渲染读取，不会写回模板。
      image_photos: item.photo ? [item.photo] : [],
    } as FieldDefinition;
  });
}
