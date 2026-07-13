/**
 * 把复刻好的「首页模板」(scripts/front-template.ts) upsert 进数据库。
 *
 * 目标 = report_templates 里 template_kind='cover' 的首页模板（结论汇总页）。
 * 更新「当前版本」(report_template_versions @ current_version_id) 的 field_definitions + layout_options，
 * 并同步刷新 base 表镜像列（读路径用 current version；base 镜像保持一致）。
 *
 * 安全：默认 DRY-RUN（只打印将要做什么）；加 --apply 才真正写库（不可逆）。
 *   用法：
 *     pnpm tsx scripts/upsert-front-template.ts                 # dry-run，列出候选
 *     pnpm tsx scripts/upsert-front-template.ts --id 7 --apply  # 写入 id=7 的首页模板
 *     pnpm tsx scripts/upsert-front-template.ts --create --apply # 库里没有 cover 模板时新建
 *
 * 字体：模板存「仿宋」(FangSong_GB2312)——生产环境需安装该字体。
 */
import pg from 'pg';
import { dbConfig } from '../config/index';
import { buildFrontTemplate } from './front-template';

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const valOf = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const APPLY = has('--apply');
const CREATE = has('--create');
const TARGET_ID = valOf('--id') ? Number(valOf('--id')) : undefined;
const FONT = valOf('--font') || '仿宋';

const tpl = buildFrontTemplate(FONT);
const fieldDefs = JSON.stringify(tpl.groups);
const layout = JSON.stringify(tpl.layout_options || {});

const { Pool } = pg;
const pool = new Pool({
  host: dbConfig.host, port: Number(dbConfig.port), database: dbConfig.database,
  user: dbConfig.user, password: dbConfig.password || undefined,
});

async function main() {
  console.log(`[upsert] DB ${dbConfig.host}/${dbConfig.database} | font=${FONT} | ${APPLY ? 'APPLY (写库)' : 'DRY-RUN (不写)'}`);
  console.log(`[upsert] 模板 groups=${tpl.groups.length}, layout keys=${Object.keys(tpl.layout_options || {}).join(',')}`);

  const covers = await pool.query(
    `SELECT id, name, current_version_id FROM report_templates WHERE template_kind = 'cover' ORDER BY id`
  );
  console.log(`[upsert] 库中 template_kind='cover' 的首页模板：`);
  covers.rows.forEach((r: any) => console.log(`         id=${r.id}  name=${r.name}  current_version_id=${r.current_version_id}`));

  let target = TARGET_ID
    ? covers.rows.find((r: any) => r.id === TARGET_ID)
    : (covers.rows.length === 1 ? covers.rows[0] : undefined);

  if (!target && CREATE) {
    if (!APPLY) { console.log('[upsert] DRY-RUN：将新建一个 cover 首页模板（加 --apply 才执行）'); return; }
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const t = await c.query(
        `INSERT INTO report_templates (name, source_file, template_kind) VALUES ($1, $2, 'cover') RETURNING id`,
        [tpl.name, '复刻样例']
      );
      const tid = t.rows[0].id;
      const v = await c.query(
        `INSERT INTO report_template_versions (template_id, version_no, field_definitions, layout_options, status, author_name)
         VALUES ($1, 1, $2::jsonb, $3::jsonb, 'approved', 'upsert-script') RETURNING id`,
        [tid, fieldDefs, layout]
      );
      await c.query(`UPDATE report_templates SET current_version_id = $1 WHERE id = $2`, [v.rows[0].id, tid]);
      await c.query('COMMIT');
      console.log(`[upsert] ✅ 已新建首页模板 id=${tid}, version id=${v.rows[0].id}`);
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    return;
  }

  if (!target) {
    console.error(`[upsert] ✗ 未确定目标：${covers.rows.length === 0 ? '库里没有 cover 模板（加 --create 新建）' : '有多个，请用 --id N 指定'}`);
    process.exitCode = 1; return;
  }

  console.log(`[upsert] 目标首页模板：id=${target.id} name=${target.name} current_version_id=${target.current_version_id}`);
  if (!APPLY) { console.log(`[upsert] DRY-RUN：将新建一个 approved 版本并指向它（旧版本 id=${target.current_version_id} 保留为 superseded，可回滚）。加 --apply 执行`); return; }

  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    // 新建 approved 版本（保留旧版本 → 可回滚），翻指针——不就地覆盖，写库可逆
    const v = await c.query(
      `INSERT INTO report_template_versions (template_id, version_no, field_definitions, layout_options, status, author_name, change_summary)
       VALUES ($1, COALESCE((SELECT MAX(version_no) FROM report_template_versions WHERE template_id=$1),0)+1, $2::jsonb, $3::jsonb, 'approved', 'upsert-script', '复刻样例「测试报告」前两页') RETURNING id, version_no`,
      [target.id, fieldDefs, layout]
    );
    if (target.current_version_id) {
      await c.query(`UPDATE report_template_versions SET status='superseded' WHERE id=$1 AND status='approved'`, [target.current_version_id]);
    }
    // 翻指针（读路径只读 current version；base 表无 field_definitions/layout_options 列）
    await c.query(
      `UPDATE report_templates SET current_version_id=$1, updated_at=NOW() WHERE id=$2`,
      [v.rows[0].id, target.id]
    );
    await c.query('COMMIT');
    console.log(`[upsert] ✅ 已更新首页模板 id=${target.id} → 新版本 v${v.rows[0].version_no} (id=${v.rows[0].id})；旧版本 id=${target.current_version_id} 保留 superseded（可回滚）`);
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}

main().catch(e => { console.error('[upsert] 失败:', e.message); process.exitCode = 1; })
  .finally(() => pool.end());
