/** Scoped repair of template 9 / draft 45. Dry-run by default; refuses live edits. */
import { pool } from '../server/src/db.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const apply = process.argv.includes('--apply');
const client = await pool.connect();
try {
  await client.query('BEGIN');
  // Prevent a new lease being acquired between the safety check and commit.
  if (apply) await client.query('LOCK TABLE edit_leases IN SHARE ROW EXCLUSIVE MODE');
  const { rows } = await client.query("SELECT v.*,t.name FROM report_template_versions v JOIN report_templates t ON t.id=v.template_id WHERE v.id=45 AND v.template_id=9 AND v.status='draft' AND t.template_kind='cover' FOR UPDATE OF v");
  if (rows.length !== 1) throw Error('目标草稿已变化，停止更新');
  const original = rows[0];
  const groups = structuredClone(original.field_definitions);
  const photos = groups.find((g: any) => g.id === 'f100' && g.section_role === 'images');
  const info = groups.find((g: any) => g.id === 'f103');
  if (!photos || !info || !info.fields.some((f: any) => f.id === 'f104' && f.type === 'report_sample_table')) throw Error('目标分区结构已变化');
  const descriptions = groups.flatMap((g: any) => g.fields).filter((f: any) => f.id === 'f106' && f.type === 'report_sample_description_table');
  const textIndex = photos.fields.findIndex((f: any) => f.id === 'f105' && f.type === 'text');
  if (descriptions.length !== 1 || textIndex < 0) throw Error('目标描述字段已变化');
  for (const group of groups) group.fields = group.fields.filter((f: any) => f.id !== 'f106');
  photos.fields.splice(photos.fields.findIndex((f: any) => f.id === 'f105') + 1, 0, descriptions[0]);
  photos.label = '样品描述';
  console.log(JSON.stringify({ template: original.name, draft: 45, apply, sampleInfo: info.fields.map((f: any) => f.id), sampleDescription: photos.fields.map((f: any) => f.id) }));
  if (JSON.stringify(groups) === JSON.stringify(original.field_definitions)) console.log('已经更新，无需重复修改');
  else if (apply) {
    const lease = await client.query("SELECT 1 FROM edit_leases WHERE resource_type='report_template' AND resource_id='9' AND expires_at>now()");
    if (lease.rowCount) throw Error('模板正在编辑，请先结束编辑');
    if (original.typst_source != null) throw Error('模板存在自定义 Typst，需人工核对，停止自动更新');
    const folder = join(tmpdir(), 'demo-v1-template-backups'); mkdirSync(folder, { recursive: true, mode: 0o700 });
    const backup = join(folder, `cover-9-draft-45-${Date.now()}.json`);
    writeFileSync(backup, JSON.stringify(original, null, 2), { flag: 'wx', mode: 0o600 });
    await client.query('UPDATE report_template_versions SET field_definitions=$1::jsonb, updated_at=now() WHERE id=45', [JSON.stringify(groups)]);
    console.log(`备份：${backup}`);
  }
  await client.query(apply ? 'COMMIT' : 'ROLLBACK');
} catch (error) {
  await client.query('ROLLBACK'); console.error((error as Error).message); process.exitCode = 1;
} finally { client.release(); await pool.end(); }
