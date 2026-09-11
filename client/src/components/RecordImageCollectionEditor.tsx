import { message } from 'antd';
import type { FieldGroup } from '../../../shared/types';
import type { RecordImageCollection } from '../../../shared/image-collection';
import { prepareImageForUpload } from '../utils/imageProcessing';
import ImageListEditor from './ImageListEditor';
import axios from 'axios';

interface Props {
  group: FieldGroup;
  collection: RecordImageCollection;
  onChange: (value: RecordImageCollection) => void;
  uploadCtx?: { orderNo?: string; recordDir?: string };
  readOnly?: boolean;
  reportMode?: boolean;
  onItemFocus?: (itemIndex: number, itemId: string, sourceFieldCode?: string) => void;
}

/** 数据录入与订单直接上传共用的图片分区列表。 */
export default function RecordImageCollectionEditor({
  group,
  collection,
  onChange,
  uploadCtx,
  readOnly = false,
  reportMode = false,
  onItemFocus,
}: Props) {
  const firstCode = group.fields.find(field => field.type === 'image')?.code;
  const createItem = () => {
    const id = globalThis.crypto?.randomUUID?.() || `image_${Date.now()}_${collection.items.length}`;
    return { id, title: `图片${collection.items.length + 1}`, source_field_code: firstCode };
  };
  const uploadAt = async (index: number, file: File) => {
    const item = collection.items[index];
    const fd = new FormData();
    const prepared = await prepareImageForUpload(file);
    fd.append('file', prepared);
    if (uploadCtx?.orderNo) fd.append('order_no', uploadCtx.orderNo);
    if (uploadCtx?.recordDir) fd.append('record_dir', uploadCtx.recordDir);
    fd.append('field_name', item.title || `图片${index + 1}`);
    try {
      const response = await axios.post('/api/images/upload', fd);
      return response.data;
    } catch (error: any) {
      message.error(`上传失败：${error.message || ''}`);
    }
    return undefined;
  };
  return <ImageListEditor
    reportMode={reportMode}
    items={collection.items}
    onChange={items => onChange({ ...collection, items })}
    onUpload={uploadAt}
    onCreate={createItem}
    readOnly={readOnly}
    defaultDisplaySize={{ widthCm: group.image_layout?.width_cm ?? 7, heightCm: group.image_layout?.height_cm ?? 6 }}
    onItemFocus={(index, item) => onItemFocus?.(index, item.id, item.source_field_code)}
    help="可增加、删除、改名和调整顺序；项目报告会拉取本分区的全部图片。"
  />;
}
