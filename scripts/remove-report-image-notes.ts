import { pool } from '../server/src/db';
import { removeLegacyImageNotes } from '../shared/report-detached-notes';
import { renderContentDoc, diffContentDocValues } from '../shared/typst-generator';
const number = process.argv[2];
if (!number) throw new Error('Report number required');
const apply = process.argv.includes('--apply');
const db = await pool.connect();
try {
  await db.query('BEGIN');
  const { rows } = await db.query(`SELECT r.id,r.content_doc,r.content_doc_original,r.external_status,r.version,q.delivery_status
    FROM reports r JOIN report_requisitions q ON q.report_id=r.id WHERE q.report_number=$1 FOR UPDATE OF r`, [number]);
  if (rows.length !== 1) throw new Error('Expected exactly one current report');
  const row = rows[0];
  if (row.delivery_status === 'sent' || ![null, 'none'].includes(row.external_status)) throw new Error('Report is locked');
  const clean = (doc: any) => !doc ? doc : { ...doc,
    cover: { ...doc.cover, groups: removeLegacyImageNotes(doc.cover.groups) },
    projects: doc.projects.map((p: any) => ({ ...p, groups: removeLegacyImageNotes(p.groups) })) };
  const next = clean(row.content_doc);
  const removed = row.content_doc.projects.flatMap((p: any, i: number) => p.groups.filter((g: any) => !next.projects[i].groups.some((n: any) => n.id === g.id)).map((g: any) => ({ project: p.title, id: g.id })));
  const changed = JSON.stringify(next) !== JSON.stringify(row.content_doc);
  console.log(JSON.stringify({ report: number, id: row.id, changed, removed, apply }));
  if (apply && changed) {
    const source = renderContentDoc(next);
    await db.query('UPDATE reports SET content_doc=$2::jsonb, content_doc_original=$3::jsonb, final_typst=$4, edited=true, version=version+1 WHERE id=$1',
      [row.id, JSON.stringify(next), JSON.stringify(clean(row.content_doc_original)), source]);
    await db.query('INSERT INTO report_audit_log (report_id,action,actor_name,diff,note) VALUES ($1,$2,$3,$4::jsonb,$5)',
      [row.id, 'edit', 'Codex', JSON.stringify(diffContentDocValues(row.content_doc,next)), '按用户要求清除历史图片备注及其自动生成段落，保留其它报告编辑']);
  }
  await db.query(apply ? 'COMMIT' : 'ROLLBACK');
} catch(error) { await db.query('ROLLBACK'); throw error; }
finally { db.release(); await pool.end(); }
