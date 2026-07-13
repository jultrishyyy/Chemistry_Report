/**
 * ⚠️ 已废弃（DEPRECATED）——请勿运行。
 * 报告模板的默认 seed 现由后端启动自动完成：
 *   server/src/services/seed-report-templates.ts ← shared/report-base-templates.ts（首页 + 3 项目，按 name 幂等）。
 * 本脚本停留在 migration 017 之前：直接往 report_templates 的 field_definitions 列写入，而 017 已删除该列、
 * 报告生成只读 report_template_versions.current_version_id；它还会 `DELETE FROM reports` 且硬编码 record id=9，
 * 跑起来要么报错要么写出渲染读不到的数据。保留仅作历史参考。
 *
 * 一次性 seed 报告模板：标准首页（对齐参考样张）+ 密度项目（关联 record_template id=9）
 */
import pg from 'pg';
import { dbConfig } from '../config/index.js';

const { Pool } = pg;
const pool = new Pool({
  host: dbConfig.host,
  port: Number(dbConfig.port),
  database: dbConfig.database,
  user: dbConfig.user,
  password: dbConfig.password || undefined,
});

const RECORD_TPL_ID = 9; // 基础原始记录模板

// ─── 首页模板（对齐参考样张：测试报告 C202512086592-01）────────────────
const coverGroups = [
  {
    id: 'cg_cover',
    label: '封面',
    layout: 'vertical',
    hide_title: true,
    fields: [
      { id: 'cf_pad1', code: 'cover_spacer1', label: ' ', type: 'text', hide_label: true,
        binding: { source: 'literal', text: ' ' } },
      { id: 'cf_org', code: 'cover_org', label: '机构', type: 'text', hide_label: true,
        binding: { source: 'literal', text: '广电计量' } },
      { id: 'cf_title', code: 'cover_title', label: '检测报告', type: 'text', hide_label: true,
        binding: { source: 'literal', text: '检测报告' } },
      { id: 'cf_subtitle', code: 'cover_sub', label: '副标题', type: 'text', hide_label: true,
        binding: { source: 'literal', text: 'TEST REPORT' } },
      { id: 'cf_no', code: 'cover_no', label: '报告编号', type: 'text',
        binding: { source: 'report_meta', key: 'cover_report_no' } },
    ],
  },
  {
    id: 'cg_meta',
    label: '基本信息',
    layout: 'vertical',
    page_break_before: true,
    fields: [
      { id: 'cf_no2',     code: 'report_no',    label: '报告编号',   type: 'text',
        binding: { source: 'report_meta', key: 'report_no' } },
      { id: 'cf_verify',  code: 'verify_code',  label: '检验码',     type: 'text',
        binding: { source: 'report_meta', key: 'verify_code' } },
      { id: 'cf_cust',    code: 'customer',     label: '委托方',     type: 'text',
        binding: { source: 'order', key: 'customer_name' } },
      { id: 'cf_addr',    code: 'cust_addr',    label: '委托方地址', type: 'text',
        binding: { source: 'order', key: 'company_address' } },
      { id: 'cf_sample',  code: 'sample_name',  label: '样品名称',   type: 'text',
        binding: { source: 'order', key: 'sample_name' } },
      { id: 'cf_brand',   code: 'brand',        label: '商标',       type: 'text',
        binding: { source: 'literal', text: '/' } },
      { id: 'cf_pdate',   code: 'prod_date',    label: '生产日期',   type: 'text',
        binding: { source: 'literal', text: '/' } },
      { id: 'cf_factory', code: 'factory',      label: '生产单位',   type: 'text',
        binding: { source: 'literal', text: '/' } },
      { id: 'cf_recv',    code: 'received_at',  label: '接收日期',   type: 'text',
        binding: { source: 'order', key: 'received_at' } },
      { id: 'cf_period',  code: 'test_period',  label: '检测周期',   type: 'text',
        binding: { source: 'literal', text: '/' } },
      { id: 'cf_desc',    code: 'sample_desc',  label: '样品描述',   type: 'textarea',
        binding: { source: 'literal', text: '详见样品照片' } },
      { id: 'cf_note',    code: 'general_note', label: '一般情况说明', type: 'textarea',
        binding: { source: 'literal', text: '/' } },
      { id: 'cf_drafter', code: 'drafter',      label: '编制',       type: 'text',
        binding: { source: 'literal', text: ' ' } },
      { id: 'cf_review',  code: 'reviewer',     label: '审核',       type: 'text',
        binding: { source: 'literal', text: ' ' } },
      { id: 'cf_approve', code: 'approver',     label: '批准',       type: 'text',
        binding: { source: 'literal', text: ' ' } },
      { id: 'cf_rdate',   code: 'report_date',  label: '报告日期',   type: 'text',
        binding: { source: 'report_meta', key: 'issue_date' } },
    ],
  },
  {
    id: 'cg_concl',
    label: '检测结论',
    layout: 'vertical',
    page_break_before: true,
    hide_title: true,
    fields: [
      {
        id: 'cf_concl',
        code: 'conclusion_table',
        label: '检测结论',
        type: 'report_conclusion_table',
        conclusion_table: { columns: ['index', 'project', 'result'], show_title: true, title_text: '检测结论' },
      },
    ],
  },
];

// ─── 密度试验项目报告（对齐参考样张第一个项目"密度"）────────────────────
// 关联的原始记录模板 id=9 — 基础原始记录模板
// 字段映射：
//   检测方法 ← record_field test_method (checkbox 类型)
//   浸渍液 ← record_field sample_prep (作为 demo 代替)
//   浸渍液温度 ← record_cell result_matrix · 行0 · col_1
//   检测结果 → 表格 (项目|标准要求|测试结果|结论)
//     测试结果 ← record_summary result_matrix · sum_1779032508052 (结论汇总行)
//     注意：实际项目中可创建独立的"平均值"summary row 来更精确
//   设备表 → 自动从 devices(device_ref) + equipment_library
//   图片表 → 自动从 photos_before / during / after
const projectGroups = [
  {
    id: 'pg_intro',
    label: '密度',
    layout: 'vertical',
    page_break_before: true,
    fields: [
      { id: 'pf_intro', code: 'project_intro', label: '检测说明', type: 'textarea',
        hide_label: true,
        binding: { source: 'literal',
          text: '根据GB/T 1033.1-2008《塑料 非泡沫塑料密度的测定 第1部分：浸渍法、液体比重瓶法和滴定法》对样品进行密度检测。' } },
    ],
  },
  {
    id: 'pg_method',
    label: '检测方法与试验条件',
    layout: 'table',
    columns: ['项目', '内容'],
    fields: [
      { id: 'pf_method',  code: 'test_method', label: '检测方法', type: 'text',
        binding: { source: 'record_field', field_code: 'test_method' } },
      { id: 'pf_liquid',  code: 'liquid',     label: '浸渍液',   type: 'text',
        binding: { source: 'record_field', field_code: 'sample_prep' } },
      { id: 'pf_temp',    code: 'liquid_temp', label: '浸渍液温度', type: 'text', unit: '℃',
        binding: { source: 'record_cell', matrix_code: 'result_matrix', sample_idx: 0, param_code: 'col_1' } },
      { id: 'pf_env',     code: 'test_env',   label: '试验环境',  type: 'text',
        binding: { source: 'record_field', field_code: 'test_env' } },
    ],
  },
  {
    id: 'pg_result',
    label: '检测结果',
    layout: 'vertical',
    fields: [
      {
        id: 'pf_result',
        code: 'result_table',
        label: '检测结果',
        type: 'report_result_table',
        result_table: {
          columns: [
            { id: 'col_item',     label: '项目' },
            { id: 'col_standard', label: '标准要求' },
            { id: 'col_result',   label: '测试结果 (g/cm³)' },
            { id: 'col_concl',    label: '结论' },
          ],
          rows: [
            { id: 'r1', label: '', is_conclusion: true, conclusion_col_id: 'col_concl' },
          ],
          cells: [
            { rowId: 'r1', colId: 'col_item',     binding: { source: 'literal', text: '密度' } },
            { rowId: 'r1', colId: 'col_standard', binding: { source: 'literal', text: '≥ 0.90' } },
            { rowId: 'r1', colId: 'col_result',
              binding: { source: 'record_cell', matrix_code: 'result_matrix', sample_idx: 0, param_code: 'col_3' } },
            { rowId: 'r1', colId: 'col_concl',
              binding: { source: 'record_summary', matrix_code: 'result_matrix', row_id: 'sum_1779032508052' } },
          ],
        },
      },
    ],
  },
  {
    id: 'pg_equip',
    label: '试验设备',
    layout: 'vertical',
    fields: [
      {
        id: 'pf_equip',
        code: 'equipment_table',
        label: '试验设备',
        type: 'report_equipment_table',
        equipment_table: { columns: ['name', 'model', 'asset_code', 'calibration'] },
      },
    ],
  },
  {
    id: 'pg_images',
    label: '试样照片',
    layout: 'vertical',
    page_break_before: true,
    fields: [
      {
        id: 'pf_imgs',
        code: 'image_gallery',
        label: '试样照片',
        type: 'report_image_gallery',
        image_gallery: {},
      },
    ],
  },
];

const coverLayoutOptions = {
  theme_config: {
    section_style: 'center-bold',
    paragraph_gap: 1.0,
    line_gap: 0.7,
  },
};

const projectLayoutOptions = {
  theme_config: {
    section_style: 'left-bold',
    paragraph_gap: 0.8,
    line_gap: 0.6,
  },
};

async function main() {
  // 删除依赖
  await pool.query('DELETE FROM reports');
  await pool.query(
    "DELETE FROM report_templates WHERE name IN ($1, $2, $3)",
    ['标准检测报告首页', '示例项目报告（密度）', '密度试验项目报告']
  );

  const cover = await pool.query(
    `INSERT INTO report_templates
       (name, template_kind, field_definitions, layout_options, typst_source, placeholders, required_test_projects)
     VALUES ($1, 'cover', $2::jsonb, $3::jsonb, '', '[]'::jsonb, '[]'::jsonb)
     RETURNING id`,
    ['标准检测报告首页', JSON.stringify(coverGroups), JSON.stringify(coverLayoutOptions)]
  );
  console.log(`[seed] cover created: id=${cover.rows[0].id}`);

  const project = await pool.query(
    `INSERT INTO report_templates
       (name, template_kind, linked_record_template_id, field_definitions, layout_options, typst_source, placeholders, required_test_projects)
     VALUES ($1, 'project', $2, $3::jsonb, $4::jsonb, '', '[]'::jsonb, '[]'::jsonb)
     RETURNING id`,
    ['密度试验项目报告', RECORD_TPL_ID, JSON.stringify(projectGroups), JSON.stringify(projectLayoutOptions)]
  );
  console.log(`[seed] project created: id=${project.rows[0].id}`);

  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
