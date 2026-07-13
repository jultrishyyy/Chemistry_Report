/**
 * 导出「默认 seed 模板」快照：把运行系统数据库里这几个真实模板的【当前生效版本】完整配置
 * （字段定义 / 布局 / 间距 / 图片设置 / 绑定）原样导出到：
 *   shared/seed-record-templates.data.ts   （原始记录：基础 + 密度 + 透光率 + 弯曲）
 *   shared/seed-report-templates.data.ts   （报告：首页 cover + 3 个项目 project）
 * seed 服务读这两个快照入库（见 services/seed-base-templates.ts / seed-report-templates.ts）。
 *
 * 用法（在开发机、连得上含真身的 cdr_demo）：  pnpm tsx scripts/dump-seed-templates.ts
 * 改了某个默认模板后重新跑本脚本即可让新服务器 seed 出最新版。只导出 archived_at IS NULL 的当前版本。
 *
 * ⚠️ 生成的 *.data.ts 是机器产物，请勿手改；要改内容＝在系统里改模板→重新导出。
 * 改这里的 RECORD_NAMES / REPORT_NAMES 即可调整“哪几个模板算默认 seed”。
 */
import pg from 'pg';
import { writeFileSync } from 'fs';
import { dbConfig } from '../config/index.js';

const { Pool } = pg;
const pool = new Pool({
  host: dbConfig.host, port: Number(dbConfig.port), database: dbConfig.database,
  user: dbConfig.user, password: dbConfig.password || undefined,
});

const SHARED = new URL('../shared', import.meta.url).pathname;

// 复制顺序固定（基础在前；项目按 密度/透光率/弯曲）。按 name 取 archived_at IS NULL 的当前版本。
const RECORD_NAMES = [
  '基础原始记录模板',
  '密度和相对密度试验原始记录',
  '透光率雾度试验原始记录',
  '塑料弯曲测试报告',
];
const REPORT_NAMES = [
  '标准检测报告首页',
  '密度试验项目报告',
  '透光率试验项目报告',
  '弯曲强度&弯曲模量',
];

async function main() {
  const recSnaps: any[] = [];
  for (const name of RECORD_NAMES) {
    const r = await pool.query(
      `SELECT t.name, t.source_file, cv.version_no, cv.field_definitions, cv.layout_options
         FROM record_templates t JOIN record_template_versions cv ON cv.id = t.current_version_id
        WHERE t.archived_at IS NULL AND t.name = $1 LIMIT 1`, [name]);
    if (!r.rows.length) throw new Error(`record template not found (active): ${name}`);
    const row = r.rows[0];
    recSnaps.push({
      name: row.name,
      version: row.version_no,
      source_file: row.source_file ?? '基础模板',
      layout_options: row.layout_options ?? {},
      groups: row.field_definitions ?? [],
    });
    console.log(`record ✓ ${name} (v${row.version_no}, ${row.field_definitions?.length} groups)`);
  }

  const repSnaps: any[] = [];
  for (const name of REPORT_NAMES) {
    const r = await pool.query(
      `SELECT t.name, t.template_kind, t.test_project_codes, rr.name AS linked_record_name,
              cv.field_definitions, cv.layout_options
         FROM report_templates t
         JOIN report_template_versions cv ON cv.id = t.current_version_id
         LEFT JOIN record_templates rr ON rr.id = t.linked_record_template_id
        WHERE t.archived_at IS NULL AND t.name = $1 LIMIT 1`, [name]);
    if (!r.rows.length) throw new Error(`report template not found (active): ${name}`);
    const row = r.rows[0];
    repSnaps.push({
      name: row.name,
      template_kind: row.template_kind,
      linked_record_name: row.linked_record_name ?? null,
      test_project_codes: row.test_project_codes ?? null,
      layout_options: row.layout_options ?? {},
      field_definitions: row.field_definitions ?? [],
    });
    console.log(`report ✓ ${name} (${row.template_kind} → ${row.linked_record_name ?? '-'}, ${row.field_definitions?.length} groups)`);
  }

  const header = (what: string) =>
`// ⚠️ 自动生成文件（GENERATED）——请勿手改。
// 内容＝从运行系统数据库导出的「${what}」当前生效版本的完整配置（字段定义/布局/间距/图片设置/绑定，逐字段一致）。
// 重新生成：pnpm tsx scripts/dump-seed-templates.ts（开发机连好含真身的 cdr_demo）。
`;
  // 用 JSON.parse(<字符串字面量>) 存：内容＝数据库 verbatim 快照（可能含类型里没有的遗留键，如 conclusion_field），
  // JSON.parse 返回 any → 赋给声明类型不触发字面量超属性检查，既保真又过 typecheck。
  const recJson = JSON.stringify(recSnaps, null, 2);
  writeFileSync(`${SHARED}/seed-record-templates.data.ts`,
    header('原始记录模板') +
    `import type { RecordTemplate } from './types';\n\n` +
    `export const RECORD_SEED_SNAPSHOTS: RecordTemplate[] = JSON.parse(${JSON.stringify(recJson)});\n`);

  const repJson = JSON.stringify(repSnaps, null, 2);
  writeFileSync(`${SHARED}/seed-report-templates.data.ts`,
    header('报告模板') +
    `import type { FieldGroup } from './types';\n\n` +
    `export interface ReportSeedSnapshot {\n` +
    `  name: string;\n  template_kind: 'cover' | 'project';\n  linked_record_name: string | null;\n` +
    `  test_project_codes: string[] | null;\n  layout_options: Record<string, unknown>;\n  field_definitions: FieldGroup[];\n}\n\n` +
    `export const REPORT_SEED_SNAPSHOTS: ReportSeedSnapshot[] = JSON.parse(${JSON.stringify(repJson)});\n`);

  console.log('\n✅ wrote shared/seed-record-templates.data.ts + shared/seed-report-templates.data.ts');
  await pool.end();
}
main().catch(err => { console.error(err); process.exit(1); });
