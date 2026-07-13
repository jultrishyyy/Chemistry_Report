import type { RecordTemplate } from './types';
import { RECORD_SEED_SNAPSHOTS } from './seed-record-templates.data';

/**
 * 基础模板（base templates）：
 *  - 服务端启动 seed：把 seed=true 的条目写入 record_templates（按 name 幂等，已存在跳过、不覆盖用户改动）；
 *  - 客户端「新建模板」：目前 UI 只用 'blank'（空白）入口，其余 DB 模板作骨架走 clone_id，不再经这里。
 *
 * 内容来源：seed 的几个真实模板（基础 + 密度/透光率/弯曲）直接读
 * `shared/seed-record-templates.data.ts` 的【系统导出快照】——逐字段（含间距/图片/绑定/布局）与运行系统一致。
 * 要改默认模板内容＝在运行系统里改好对应模板后，重新导出快照（见 README 第三节 seed 说明），不要手改快照文件。
 *
 * 注意：所有字段 id 必须为字符串。
 */

export interface BaseTemplateEntry {
  key: string;
  /** 落库时使用的模板 name；同名模板已存在则跳过 seed。 */
  label: string;
  hint: string;
  /** true = 服务端启动 seed；false = 仅作"新建模板"入口（不入库）。 */
  seed: boolean;
  build: () => RecordTemplate;
}

/** 按 name 取一份快照的深拷贝（调用方可自由改动，不污染快照）。 */
function snapshot(name: string): RecordTemplate {
  const s = RECORD_SEED_SNAPSHOTS.find(x => x.name === name);
  if (!s) throw new Error(`[base-templates] 找不到原始记录快照：${name}（检查 shared/seed-record-templates.data.ts）`);
  return JSON.parse(JSON.stringify(s));
}

export const BASE_TEMPLATES: BaseTemplateEntry[] = [
  {
    key: 'base',
    label: '基础原始记录模板',
    hint: '通用原始记录骨架；启动 seed 入库',
    seed: true,
    build: () => snapshot('基础原始记录模板'),
  },
  {
    key: 'density',
    label: '密度和相对密度试验原始记录',
    hint: '密度试验原始记录（关联报告项目模板「密度试验项目报告」）',
    seed: true,
    build: () => snapshot('密度和相对密度试验原始记录'),
  },
  {
    key: 'transmittance',
    label: '透光率雾度试验原始记录',
    hint: '透光率试验原始记录（关联报告项目模板「透光率试验项目报告」）',
    seed: true,
    build: () => snapshot('透光率雾度试验原始记录'),
  },
  {
    key: 'flexural',
    label: '塑料弯曲测试报告',
    hint: '弯曲试验原始记录（关联报告项目模板「弯曲强度&弯曲模量」）',
    seed: true,
    build: () => snapshot('塑料弯曲测试报告'),
  },
  {
    key: 'blank',
    label: '空白模板',
    hint: '只有标题，分区自己加',
    seed: false,
    build: () => ({
      name: '新模板',
      version: 1,
      layout_options: {},
      groups: [],
    }),
  },
];
