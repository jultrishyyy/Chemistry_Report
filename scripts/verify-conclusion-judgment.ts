/** Read-only verification of the scoped conclusion maintenance. */
import { dbConfig } from '../config/index.ts';
import pg from '../server/node_modules/pg/lib/index.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { judgmentChoiceValue, updateConclusionJudgment } from '../shared/conclusion-judgment-default.ts';

const allRecords = process.argv.includes('--all-records');
const db = new pg.Client({ ...dbConfig, port: Number(dbConfig.port) });
await db.connect();
try {
  await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const templates = (await db.query('SELECT * FROM record_templates ORDER BY id')).rows;
  const versions = (await db.query('SELECT * FROM record_template_versions ORDER BY version_no')).rows;
  const records = (await db.query(allRecords ? "SELECT * FROM record_data ORDER BY id" : "SELECT * FROM record_data WHERE order_no='MOCK-EXT-002' AND audit_status='reviewed' ORDER BY id")).rows;
  const selected = new Set(records.map(r => r.template_version_id));
  for (const template of templates) {
    if (template.current_version_id) selected.add(template.current_version_id);
    const latest = versions.filter(v => v.template_id === template.id).at(-1);
    if (latest) selected.add(latest.id);
  }
  for (const v of versions) if (['draft', 'pending', 'rejected'].includes(v.status)) selected.add(v.id);
  let fields = 0;
  for (const version of versions.filter(v => selected.has(v.id))) {
    assert.deepEqual(version.field_definitions, updateConclusionJudgment(version.field_definitions), `版本 ${version.id} 判定要求尚未更新`);
    fields += version.field_definitions.flatMap(g => g.fields).filter(f => f.conclusion_role === 'judgment_requirement' || f.label === '判定要求').length;
  }
  const backupPath = process.argv.slice(2).find(arg => !arg.startsWith('--'));
  if (backupPath) {
    const before = JSON.parse(readFileSync(backupPath, 'utf8'));
    assert.deepEqual(records.map(r => r.id), before.records.map(r => r.id));
    for (const record of records) {
      const old = before.records.find(r => r.id === record.id);
      const oldVersion = before.versions.find(v => v.id === old.template_version_id);
      const updated = updateConclusionJudgment(oldVersion.field_definitions).flatMap(g => g.fields);
      const previous = oldVersion.field_definitions.flatMap(g => g.fields);
      const expected = structuredClone(old.raw_data);
      for (const field of updated) {
        const prev = previous.find(f => f.id === field.id);
        if (JSON.stringify(field) !== JSON.stringify(prev) && Object.hasOwn(expected, field.code)) expected[field.code] = judgmentChoiceValue(expected[field.code]);
      }
      assert.deepEqual(record.raw_data, expected, `记录 ${record.id} 原值`);
      for (const key of Object.keys(old)) {
        if (['raw_data', 'template_version_id', 'template_version', 'current_version', 'updated_at'].includes(key)) continue;
        assert.deepEqual(JSON.parse(JSON.stringify(record[key])), old[key], `记录 ${record.id} ${key}`);
      }
    }
  }
  console.log(JSON.stringify({ templates: templates.length, checkedVersions: selected.size, judgmentFields: fields,
    reviewedRecords: records.map(r => ({ id: r.id, status: r.audit_status, templateVersion: r.template_version })),
    originalValuesAndAuditMetadataPreserved: !!backupPath, pendingChanges: 0 }, null, 2));
  await db.query('ROLLBACK');
} finally { await db.end(); }
