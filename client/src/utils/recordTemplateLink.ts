import axios from 'axios';
import type { RecordTemplate } from '../../../shared/types';

/**
 * 拉取原始记录模板的「有效字段结构」，供项目报告模板【关联 / 拉取 / 预览】使用。
 *
 * 取数优先级：当前生效版本（审核通过）→ 若无生效版本（存量模板常见：全量重置为未审核后
 * current_version_id 为 null，字段只在草稿里），回退到最新草稿的字段结构。
 * 否则拉取/预览会拿到空字段（`GET /:id` 只 JOIN 生效版本，无生效版本时 field_definitions=null）。
 */
export async function fetchRecordTemplateForLink(id: number): Promise<RecordTemplate> {
  const r = (await axios.get(`/api/record-templates/${id}`)).data;
  let groups = r.field_definitions || [];
  let version = r.current_version_no ?? r.version;
  let layoutOptions = r.layout_options || {};
  if ((!groups || !groups.length) && r.open_draft?.id) {
    try {
      const dv = (await axios.get(`/api/record-templates/${id}/versions/${r.open_draft.id}`)).data;
      if (Array.isArray(dv.field_definitions) && dv.field_definitions.length) {
        groups = dv.field_definitions;
        version = dv.version_no ?? version;
        layoutOptions = dv.layout_options || layoutOptions;
      }
    } catch { /* 拉草稿失败则保持空，调用方自行提示 */ }
  }
  return { id: r.id, name: r.name, version, groups, layout_options: layoutOptions };
}
