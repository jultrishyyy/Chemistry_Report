import axios from 'axios';
import type { FieldDefinition } from '../../../shared/types';

/** Keep template logos lossless, including PNG transparency. */
export async function uploadCoverImage(file: File, templateId?: string | number): Promise<NonNullable<FieldDefinition['static_images']>[number]> {
  if (!/\.(png|jpe?g|gif|webp)$/i.test(file.name)) throw new Error('请选择 PNG、JPG、GIF 或 WebP 图片');
  if (file.size > 30 * 1024 * 1024) throw new Error('图片不能超过 30 MB');
  const form = new FormData();
  form.append('file', file);
  form.append('template_id', String(templateId || 'draft'));
  const { data } = await axios.post('/api/template-assets/upload?template_kind=report', form);
  if (!data?.id || !data?.rel_path) throw new Error('上传结果缺少图片信息，请重试');
  return { ...data, display_width_cm: 4 };
}
