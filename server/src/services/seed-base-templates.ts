import pg from 'pg';
import { BASE_TEMPLATES } from '../../../shared/base-templates.js';
import { generateTypst } from '../../../shared/typst-generator.js';

/**
 * 启动时把 BASE_TEMPLATES 里 seed=true 的模板写入 record_templates。
 * 已按 name 存在则跳过（不覆盖用户改动）。
 *
 * migration 017 后：base 表只存元数据，字段定义全在 record_template_versions。
 * seed 创建 base 行 + v1=approved 版本，并翻指针到 v1。
 */
export async function seedBaseTemplates(pool: pg.Pool): Promise<void> {
  for (const entry of BASE_TEMPLATES) {
    if (!entry.seed) continue;
    const tpl = entry.build();
    const existing = await pool.query(
      'SELECT id FROM record_templates WHERE name = $1 LIMIT 1',
      [tpl.name]
    );
    if (existing.rows.length) {
      console.log(`[seed] skip "${tpl.name}" (already exists, id=${existing.rows[0].id})`);
      continue;
    }
    const typstSource = generateTypst(tpl);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO record_templates (name, version, source_file)
         VALUES ($1, $2, $3) RETURNING id`,
        [tpl.name, tpl.version || 1, tpl.source_file || null]
      );
      const tplId = inserted.rows[0].id;
      const v1 = await client.query(
        `INSERT INTO record_template_versions
           (template_id, version_no, field_definitions, layout_options, typst_source,
            status, author_name, reviewer_name, reviewed_at, change_summary)
         VALUES ($1, 1, $2::jsonb, $3::jsonb, $4, 'approved', $5, $5, NOW(), $6) RETURNING id`,
        [
          tplId,
          JSON.stringify(tpl.groups),
          JSON.stringify(tpl.layout_options || {}),
          typstSource,
          '系统种子',
          '初始版本（系统启动 seed）',
        ]
      );
      await client.query(
        `UPDATE record_templates SET current_version_id = $1 WHERE id = $2`,
        [v1.rows[0].id, tplId]
      );
      await client.query('COMMIT');
      console.log(`[seed] inserted "${tpl.name}" (id=${tplId}, v1)`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}
