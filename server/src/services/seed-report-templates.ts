import pg from 'pg';
import { REPORT_BASE_TEMPLATES } from '../../../shared/report-base-templates.js';

/**
 * 启动时把 REPORT_BASE_TEMPLATES 里 seed=true 的报告模板写入 report_templates。
 * 已按 name 存在则跳过（不覆盖用户改动）。
 *
 * 与 record 同构（migration 017 后 base 表只存元数据）：seed 创建 base 行 +
 * v1=approved 版本（report_template_versions）并翻指针到 v1。
 *
 * ⚠️ 必须在 seedBaseTemplates() 之后调用：project 模板的 linked_record_template_id
 *   通过原始记录模板 name 反查，依赖原始记录模板已先 seed。
 */
export async function seedReportTemplates(pool: pg.Pool): Promise<void> {
  for (const entry of REPORT_BASE_TEMPLATES) {
    if (!entry.seed) continue;

    const existing = await pool.query(
      'SELECT id FROM report_templates WHERE name = $1 LIMIT 1',
      [entry.name]
    );
    if (existing.rows.length) {
      console.log(`[seed] skip report "${entry.name}" (already exists, id=${existing.rows[0].id})`);
      continue;
    }

    // project 模板按原始记录模板 name 反查关联 id（cover 不需要）
    let linkedRecordId: number | null = null;
    if (entry.template_kind === 'project' && entry.linked_record_name) {
      const rec = await pool.query(
        'SELECT id FROM record_templates WHERE name = $1 AND archived_at IS NULL ORDER BY id LIMIT 1',
        [entry.linked_record_name]
      );
      if (!rec.rows.length) {
        console.warn(`[seed] skip report "${entry.name}" (linked record template "${entry.linked_record_name}" not found — seed records first)`);
        continue;
      }
      linkedRecordId = rec.rows[0].id;
    }

    const built = entry.build();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO report_templates
           (name, source_file, template_kind, test_project_codes, linked_record_template_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [entry.name, '基础模板', entry.template_kind, entry.test_project_codes || null, linkedRecordId]
      );
      const tplId = inserted.rows[0].id;
      const v1 = await client.query(
        `INSERT INTO report_template_versions
           (template_id, version_no, field_definitions, layout_options, typst_source,
            status, author_name, reviewer_name, reviewed_at, change_summary)
         VALUES ($1, 1, $2::jsonb, $3::jsonb, $4, 'approved', $5, $5, NOW(), $6) RETURNING id`,
        [
          tplId,
          JSON.stringify(built.groups),
          JSON.stringify(built.layout_options || {}),
          '', // 报告 typst 在生成时由 buildReportTypst 按字段定义实时构建，模板版本不预存源码
          '系统种子',
          '初始版本（系统启动 seed）',
        ]
      );
      await client.query(
        `UPDATE report_templates SET current_version_id = $1 WHERE id = $2`,
        [v1.rows[0].id, tplId]
      );
      await client.query('COMMIT');
      console.log(`[seed] inserted report "${entry.name}" (id=${tplId}, kind=${entry.template_kind}, linked=${linkedRecordId ?? '-'}, v1)`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}
