/** Scoped local maintenance: dry run by default. Never updates unrelated record snapshots. */
import { dbConfig } from '../config/index.ts';
import pg from '../server/node_modules/pg/lib/index.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { updateConclusionJudgment, judgmentChoiceValue } from '../shared/conclusion-judgment-default';
import { generateTypst } from '../shared/typst-generator';

const apply = process.argv.includes('--apply');
const allRecords = process.argv.includes('--all-records');
const db = new pg.Client({ ...dbConfig, port: Number(dbConfig.port) });
const note = '维护：判定要求改为单选（标准要求、客户要求，允许自定义），保留原内容及审核状态';
await db.connect();
try {
  await db.query('BEGIN');
  await db.query('LOCK TABLE record_templates, record_template_versions, record_data IN SHARE ROW EXCLUSIVE MODE');
  const templates = (await db.query('SELECT * FROM record_templates ORDER BY id')).rows;
  const versions = (await db.query('SELECT * FROM record_template_versions ORDER BY version_no')).rows;
  const records = (await db.query(allRecords ? "SELECT * FROM record_data ORDER BY id" : "SELECT * FROM record_data WHERE order_no='MOCK-EXT-002' AND audit_status='reviewed' ORDER BY id")).rows;
  const selected = new Set<number>(records.map(r => r.template_version_id));
  for (const t of templates) {
    if (t.current_version_id) selected.add(t.current_version_id);
    const latest = versions.filter(v => v.template_id === t.id).at(-1);
    if (latest) selected.add(latest.id);
  }
  for (const v of versions) if (['draft', 'pending', 'rejected'].includes(v.status)) selected.add(v.id);
  const changed = versions.filter(v => selected.has(v.id) && JSON.stringify(updateConclusionJudgment(v.field_definitions)) !== JSON.stringify(v.field_definitions));
  console.log(JSON.stringify({ apply, database: { host: dbConfig.host, database: dbConfig.database }, allRecords,
    totalTemplates: templates.length, totalRecords: records.length,
    selectedFieldTypes: versions.filter(v => selected.has(v.id)).flatMap(v => v.field_definitions.flatMap(g => g.fields)).reduce((counts, f) => { if (f.type === 'record_conclusion' || f.label === '判定要求' || f.conclusion_role === 'judgment_requirement') counts[f.type] = (counts[f.type] || 0) + 1; return counts; }, {}),
    templates: new Set(changed.filter(v => templates.some(t => t.id === v.template_id)).map(v => v.template_id)).size,
    changedVersions: changed.map(v => ({ id: v.id, template: v.template_id, status: v.status })), reviewedRecords: records.map(r => r.id) }, null, 2));
  if (apply && changed.length) {
    const backup = `.local-migrations/conclusion-judgment-${Date.now()}`;
    mkdirSync(backup, { recursive: true, mode: 0o700 });
    execFileSync('pg_dump', ['-h', String(dbConfig.host), '-p', String(dbConfig.port), '-U', String(dbConfig.user), '-d', String(dbConfig.database), '-Fc', '-f', `${backup}/before.dump`], { env: { ...process.env, ...(dbConfig.password ? { PGPASSWORD: dbConfig.password } : {}) } });
    writeFileSync(`${backup}/scope.json`, JSON.stringify({ templates, versions: versions.filter(v => selected.has(v.id)), records }, null, 2), { mode: 0o600 });
    console.log(`Backup: ${backup}`);
    const replacements = new Map<number, any>();
    const columns = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='record_template_versions' AND column_name NOT IN ('id','version_no','field_definitions','typst_source','change_summary','created_at','updated_at') ORDER BY ordinal_position")).rows.map(r => r.column_name);
    for (const v of changed) {
      const fields = updateConclusionJudgment(v.field_definitions);
      const t = templates.find(t => t.id === v.template_id);
      const source = generateTypst({ ...t, ...v, name: t.name, groups: fields } as any);
      const referenced = (await db.query('SELECT 1 FROM record_data WHERE template_version_id=$1 LIMIT 1', [v.id])).rowCount;
      if (!referenced && ['draft', 'pending', 'rejected'].includes(v.status)) {
        await db.query('UPDATE record_template_versions SET field_definitions=$2::jsonb,typst_source=$3,updated_at=now(),version_no=(SELECT MAX(version_no)+1 FROM record_template_versions WHERE template_id=$4) WHERE id=$1', [v.id, JSON.stringify(fields), source, v.template_id]);
        continue;
      }
      // Keep every old published snapshot intact, including snapshots used by other orders.
      const next = (await db.query(`INSERT INTO record_template_versions
        (${columns.join(',')},version_no,field_definitions,typst_source,change_summary)
        SELECT ${columns.join(',')}, (SELECT COALESCE(MAX(version_no),0)+1 FROM record_template_versions WHERE template_id=$2),$3::jsonb,$4,$5
        FROM record_template_versions WHERE id=$1 RETURNING *`, [v.id, v.template_id, JSON.stringify(fields), source, note])).rows[0];
      replacements.set(v.id, next);
      await db.query('UPDATE record_templates SET current_version_id=$2 WHERE current_version_id=$1', [v.id, next.id]);
    }
    for (const r of records) {
      const v = replacements.get(r.template_version_id);
      if (!v) continue;
      const old = versions.find(v => v.id === r.template_version_id);
      const raw = structuredClone(r.raw_data || {});
      const oldFields = old.field_definitions.flatMap(g => g.fields);
      for (const f of v.field_definitions.flatMap(g => g.fields)) {
        const prev = oldFields.find(p => p.id === f.id);
        if (prev && JSON.stringify(prev) !== JSON.stringify(f) && Object.hasOwn(raw, f.code)) raw[f.code] = judgmentChoiceValue(raw[f.code]);
      }
      await db.query('UPDATE record_data SET template_version_id=$2,template_version=$3,raw_data=$4::jsonb,current_version=current_version+1,updated_at=now() WHERE id=$1', [r.id, v.id, v.version_no, JSON.stringify(raw)]);
      await db.query(`INSERT INTO record_audit_log(record_id,order_no,action,actor_name,actor_role,note,version_no,data_snapshot,status_after)
        VALUES($1,$2,'update','系统维护','admin',$3,$4,$5::jsonb,$6)`, [r.id, r.order_no, note, r.current_version + 1, JSON.stringify({ ...raw, ...r.derived_data }), r.audit_status]);
    }
    writeFileSync(`${backup}/result.json`, JSON.stringify([...replacements].map(([old, v]) => ({ old, next: v.id, template: v.template_id })), null, 2), { mode: 0o600 });
  }
  await db.query(apply ? 'COMMIT' : 'ROLLBACK');
} catch (error) {
  await db.query('ROLLBACK');
  throw error;
} finally { await db.end(); }
