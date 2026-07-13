import type { FieldGroup } from './types';
import { REPORT_SEED_SNAPSHOTS } from './seed-report-templates.data';

/**
 * 报告基础模板（report base templates）：1 个首页(cover) + 3 个项目(project) 模板。
 *
 * 由服务端在启动时 seed 到 report_templates（server/src/services/seed-report-templates.ts），
 * 按 name 幂等（已存在跳过、不覆盖用户改动）。project 模板通过 linked_record_name 关联回
 * shared/base-templates.ts 里的原始记录模板（seed 时按 name 查 record_templates.id）。
 *
 * 内容来源：`shared/seed-report-templates.data.ts` 的【系统导出快照】——逐字段（含间距/图片/绑定/布局）
 * 与运行系统一致。要改默认内容＝在运行系统里改好对应报告模板后重新导出快照，不要手改快照文件。
 */

export interface ReportBaseTemplateEntry {
  /** 落库 name；同名已存在则跳过 seed。 */
  name: string;
  template_kind: 'cover' | 'project';
  /** project：关联的原始记录模板 name（seed 时按 name 查 id）。cover 为 undefined。 */
  linked_record_name?: string;
  /** 报告项目匹配用（写入 report_templates.test_project_codes）。 */
  test_project_codes?: string[];
  /** true = 服务端启动 seed。 */
  seed: boolean;
  build: () => { groups: FieldGroup[]; layout_options: Record<string, unknown> };
}

export const REPORT_BASE_TEMPLATES: ReportBaseTemplateEntry[] = REPORT_SEED_SNAPSHOTS.map(s => ({
  name: s.name,
  template_kind: s.template_kind,
  linked_record_name: s.linked_record_name ?? undefined,
  test_project_codes: s.test_project_codes ?? undefined,
  seed: true,
  // 深拷贝，避免 seed 时的 JSON.stringify 之外的调用方意外改动快照
  build: () => ({
    groups: JSON.parse(JSON.stringify(s.field_definitions)),
    layout_options: JSON.parse(JSON.stringify(s.layout_options || {})),
  }),
}));
