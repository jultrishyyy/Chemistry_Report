/**
 * 基础信息模板 — 种子数据
 *
 * 这是每种原始记录几乎都会用到的通用字段集合：
 *   - 基本信息（服务编号、样品描述）
 *   - 检测方法（下拉 + 自定义）
 *   - 样品准备（下拉 + 自定义）
 *   - 预处理条件（variant_list: 标准处理 / 老化 / 热老化）
 *   - 试验环境（温度 + 湿度，inline）
 *   - 测试设备（可多选 + 自定义，device_ref）
 *
 * 运行: npx tsx scripts/seed-base-template.ts
 */

import pg from 'pg';
import { dbConfig } from '../config/index.js';
import { generateTypst } from '../shared/typst-generator.js';
import type { RecordTemplate, FieldDefinition, FieldGroup } from '../shared/types.js';

const { Pool } = pg;
const pool = new Pool({
  host: dbConfig.host,
  port: Number(dbConfig.port),
  database: dbConfig.database,
  user: dbConfig.user,
  password: dbConfig.password || undefined,
});

const BASE_INFO_TEMPLATE: RecordTemplate = {
  name: '【基础信息】通用原始记录字段',
  version: 1,
  source_file: '(seed-base-template)',
  groups: [
    // ========== 基本信息（唯一顶层分组，所有字段同层）==========
    {
      id: 'g_basic',
      label: '基本信息',
      layout: 'vertical',
      fields: [
        // --- 基础标识字段（与字段名同行）---
        { id: 'f_order_no', code: 'order_no', label: '服务编号', type: 'text', required: true },
        { id: 'f_sample_desc', code: 'sample_desc', label: '样品描述', type: 'text', required: true },

        // --- 检测方法（下拉 + 自定义，值与字段名同行）---
        {
          id: 'f_method', code: 'test_method', label: '检测方法',
          type: 'checkbox',
          options: [
            'GB/T 2410-2008',
            'GB/T 2410-2020',
            'ISO 13468-1:2019',
            'ISO 13468-2:2019',
            'ISO 14782:2021',
            'ASTM D1003-21',
            'ASTM D1044-19',
          ],
          allow_custom: true,
          description: '可多选；若标准未列出可在"其他"中填写',
        },

        // --- 样品准备 ---
        {
          id: 'f_prep', code: 'sample_preparation', label: '样品准备',
          type: 'select',
          options: ['注塑', '裁样', '原样'],
          allow_custom: true,
          description: '选择一种；如特殊情况可自定义',
        },

        // --- 预处理条件（variant_list：可多条，每条有子字段）---
        {
          id: 'f_pretreat',
          code: 'pretreatment',
          label: '预处理条件',
          type: 'variant_list',
          description: '可添加多条预处理步骤；子字段同行渲染，空间不足才换行',
          variants: [
            {
              id: 'standard',
              label: '标准环境预处理',
              render: 'inline_fields',
              separator: '，',
              fields: [
                { id: 'v1_temp', code: 'temp', label: '温度', type: 'number', unit: '℃', default_value: '23±2', removable: true },
                { id: 'v1_hum', code: 'humidity', label: '湿度', type: 'number', unit: '%RH', default_value: '50±5', removable: true },
                { id: 'v1_dur', code: 'duration', label: '时长', type: 'number', unit: 'h' },
                { id: 'v1_note', code: 'note', label: '备注', type: 'text', default_value: '', removable: true },
              ],
            },
            {
              id: 'heat_aging',
              label: '热老化',
              render: 'inline_fields',
              separator: '，',
              fields: [
                { id: 'v2_temp', code: 'temp', label: '温度', type: 'number', unit: '℃' },
                { id: 'v2_dur', code: 'duration', label: '时长', type: 'number', unit: 'h' },
                { id: 'v2_note', code: 'note', label: '备注', type: 'text', default_value: '', removable: true },
              ],
            },
            {
              id: 'humid_aging',
              label: '湿热老化',
              render: 'inline_fields',
              separator: '，',
              fields: [
                { id: 'v3_temp', code: 'temp', label: '温度', type: 'number', unit: '℃' },
                { id: 'v3_hum', code: 'humidity', label: '湿度', type: 'number', unit: '%RH' },
                { id: 'v3_dur', code: 'duration', label: '时长', type: 'number', unit: 'h' },
              ],
            },
            {
              id: 'aging_ref',
              label: '老化处理（引用另一份记录）',
              render: 'literal',
              literal_value: '老化处理（见老化处理原始记录）',
            },
            {
              id: 'none',
              label: '无需预处理',
              render: 'literal',
              literal_value: '无',
            },
          ],
        },

        // --- 试验环境（variant_list 的单条形式：温度+湿度同行，子字段可删）---
        {
          id: 'f_env',
          code: 'test_environment',
          label: '试验环境',
          type: 'variant_list',
          description: '温度/湿度同行；通常默认 23±2℃、50±5%RH',
          variants: [
            {
              id: 'env_std',
              label: '标准试验环境',
              render: 'inline_fields',
              separator: '，',
              fields: [
                { id: 'v_env_temp', code: 'temp', label: '温度', type: 'number', unit: '℃', default_value: '23±2', removable: true },
                { id: 'v_env_hum', code: 'humidity', label: '湿度', type: 'number', unit: '%RH', default_value: '50±5', removable: true },
              ],
            },
          ],
        },

        // --- 测试设备（可多选 + 自定义输入）---
        {
          id: 'f_devices', code: 'devices', label: '测试设备',
          type: 'device_ref',
          allow_custom: true,
          description: '可多选；输入设备编号/名称模糊匹配；未登记设备可自定义输入',
        },
      ],
    },
  ],
};

async function main() {
  const template = BASE_INFO_TEMPLATE;
  const typstSource = generateTypst(template);

  // upsert: 如果已有同名的就更新，否则插入
  const existing = await pool.query(
    "SELECT id FROM record_templates WHERE name = $1 AND source_file = '(seed-base-template)'",
    [template.name]
  );

  if (existing.rows.length > 0) {
    const id = existing.rows[0].id;
    await pool.query(
      `UPDATE record_templates
       SET field_definitions = $1, typst_source = $2, version = version + 1, updated_at = NOW()
       WHERE id = $3`,
      [JSON.stringify(template.groups), typstSource, id]
    );
    console.log(`✓ 基础信息模板已更新 (id=${id})`);
  } else {
    const result = await pool.query(
      `INSERT INTO record_templates (name, field_definitions, typst_source, source_file)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [template.name, JSON.stringify(template.groups), typstSource, template.source_file]
    );
    console.log(`✓ 基础信息模板已创建 (id=${result.rows[0].id})`);
  }

  const totalFields = countFields(template.groups);
  console.log(`  共 ${template.groups.length} 个分组, ${totalFields} 个顶层字段`);
  for (const g of template.groups) {
    console.log(`    [${g.layout}] ${g.label} — ${g.fields.length} 个字段`);
  }

  await pool.end();
}

function countFields(groups: FieldGroup[]): number {
  let count = 0;
  for (const g of groups) count += g.fields.length;
  return count;
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
