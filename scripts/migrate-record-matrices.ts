/** Default read-only preflight. --apply creates versioned replacements and a private recovery snapshot. */
import pg from 'pg';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { dbConfig } from '../config/index.ts';
import { migrateMatrixGroups } from '../shared/migrate-matrix-to-free-grid.ts';
import { projectLegacyMatrices } from '../shared/legacy-matrix-bridge.ts';
import { buildRecordFieldIndex, validateReportBindings } from '../shared/binding-integrity.ts';
import { buildFieldDefaults } from '../shared/matrix-flatten.ts';
import { generateTypst } from '../shared/typst-generator.ts';
import assert from 'node:assert/strict';
import { verifyMatrixMigration } from '../shared/verify-matrix-migration.ts';

const apply = process.argv.includes('--apply');
const pool = new pg.Pool({ ...dbConfig, connectionTimeoutMillis: 5000 });
async function main() {
  const client = await pool.connect();
  try {
    await client.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
    const verifyIndex = process.argv.indexOf('--verify-backup');
    if (verifyIndex >= 0) {
      assert.ok(!apply, '备份核验必须只读');
      const path = process.argv[verifyIndex + 1];
      assert.ok(path, '缺少备份路径');
      const backup = JSON.parse(await readFile(path, 'utf8'));
      const receipt = JSON.parse(await readFile(`${path}.receipt.json`, 'utf8'));
      for (const item of receipt.replacements) {
        const prior = backup.snapshots.find((p: any) => p.snapshot.id === item.old_version);
        const old = (await client.query('SELECT * FROM record_template_versions WHERE id=$1', [item.old_version])).rows[0];
        const next = (await client.query('SELECT * FROM record_template_versions WHERE id=$1', [item.new_version])).rows[0];
        assert.deepEqual(old.field_definitions, prior.snapshot.field_definitions, '历史模板内容不可变');
        assert.deepEqual(old.layout_options, prior.snapshot.layout_options, '历史版式不可变');
        assert.equal(old.typst_source, prior.snapshot.typst_source, '历史 PDF 源码不可变');
        assert.deepEqual(next.field_definitions, migrateMatrixGroups(prior.snapshot.field_definitions).groups, '落库内容与校验内容一致');
        assert.equal(next.status, item.status);
        if (prior.current_version_id === item.old_version) {
          const base = (await client.query('SELECT current_version_id FROM record_templates WHERE id=$1', [item.template])).rows[0];
          assert.equal(base.current_version_id, item.new_version);
        }
      }
      await client.query('ROLLBACK');
      console.log(JSON.stringify({ verifiedVersions: receipt.replacements.length, historicalSnapshotsUnchanged: true, savedConversionsMatch: true }));
      return;
    }
    if (apply) await client.query('LOCK TABLE record_templates, record_template_versions IN SHARE ROW EXCLUSIVE MODE');
    const records = (await client.query(`SELECT t.id template_id,t.name,t.current_version_id,to_jsonb(v) snapshot
      FROM record_templates t JOIN record_template_versions v ON v.template_id=t.id
      WHERE t.archived_at IS NULL AND (v.id=t.current_version_id OR v.status IN ('draft','pending'))
      ORDER BY t.id, CASE WHEN v.id=t.current_version_id THEN 0 ELSE 1 END,v.id`)).rows;
    const plans: any[] = [];
    for (const r of records) {
      const v = r.snapshot;
      const converted = migrateMatrixGroups(v.field_definitions || []);
      if (!converted.count) continue;
      if (v.status === 'pending') throw new Error(`${r.name}: 版本正在审核，停止迁移`);
      if (v.typst_source?.trim()) {
        // The record editor always saves generateTypst(template), and regenerates from groups on load.
        if (!v.typst_source.startsWith('#import "@local/record-theme:0.1.0": *\n')) throw new Error(`${r.name}: 未识别的手写 Typst 模板`);
      }
      const index = buildRecordFieldIndex(converted.groups);
      const template: any = { groups: converted.groups };
      const raw = buildFieldDefaults(template);
      const projected = projectLegacyMatrices(template, raw);
      for (const f of converted.groups.flatMap(g => g.fields)) if (f.legacy_matrix) {
        assert.ok(index.freeGrids.has(f.code) && index.matrices.has(f.code), '新旧映射索引同时有效');
        assert.equal(projected.raw[f.code].sample_ids.length, f.legacy_matrix.config.default_sample_count);
        for (const p of f.legacy_matrix.config.parameters) assert.equal(f.free_table!.cells[f.legacy_matrix.parameter_headers[p.code]], p.label);
      }
      const comparisons = verifyMatrixMigration(v.field_definitions, converted.groups);
      const typst = generateTypst({ ...template, name: r.name, layout_options: v.layout_options || {} });
      if (process.argv.includes('--verify-pdf') || apply) {
        const compiled = spawnSync('typst', ['compile', '--root', resolve('.'), '--package-path', resolve('typst-packages'), '-', '-'], { input: typst, maxBuffer: 20 * 1024 * 1024 });
        assert.equal(compiled.status, 0, `${r.name}: PDF 编译失败 ${compiled.stderr?.toString()}`);
        assert.equal(compiled.stdout.subarray(0, 5).toString(), '%PDF-');
      }
      plans.push({ ...r, converted: converted.groups, typst, comparisons, count: converted.count });
    }
    const reportDependencies = (await client.query(`SELECT id,name,linked_record_template_id,current_version_id FROM report_templates
      WHERE archived_at IS NULL AND linked_record_template_id=ANY($1::int[]) ORDER BY id`, [[...new Set(plans.map(p => p.template_id))]])).rows;
    const reportVersions = (await client.query(`SELECT t.id,t.name,t.linked_record_template_id,v.id vid,v.field_definitions,v.layout_options
      FROM report_templates t JOIN report_template_versions v ON v.template_id=t.id
      WHERE t.id=ANY($1::int[]) AND (v.id=t.current_version_id OR v.status IN ('draft','pending'))`, [reportDependencies.map(r => r.id)])).rows;
    let mappingChecks = 0;
    const existingMappingWarnings: any[] = [];
    for (const report of reportVersions) for (const plan of plans.filter(p => p.template_id === report.linked_record_template_id)) {
      const prior = validateReportBindings(report.field_definitions, plan.snapshot.field_definitions, report.layout_options?.conclusions);
      const after = validateReportBindings(report.field_definitions, plan.converted, report.layout_options?.conclusions);
      assert.deepEqual(after, prior, `${report.name}: 迁移不能新增或改变映射错误`);
      mappingChecks++;
      if (prior.length) existingMappingWarnings.push({ report: report.id, version: report.vid, recordVersion: plan.snapshot.id, count: prior.length });
    }
    const summary: any = { mode: apply ? 'apply' : 'dry-run', database: dbConfig.database,
      templates: new Set(plans.map(p => p.template_id)).size, versions: plans.length, tables: plans.reduce((n, p) => n + p.count, 0),
      valueComparisons: plans.reduce((n, p) => n + p.comparisons, 0),
      mappingChecks, existingMappingWarnings,
      items: plans.map(p => ({ template: p.template_id, name: p.name, old_version: p.snapshot.id, status: p.snapshot.status, tables: p.count })),
      reportDependencies, mappingStrategy: '旧映射只读兼容索引；不改报告模板或历史记录' };
    if (apply && plans.length) {
      const directory = resolve('.local-migrations'); await mkdir(directory, { recursive: true, mode: 0o700 });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const path = resolve(directory, `matrix-free-grid-${stamp}.json`);
      await writeFile(path, JSON.stringify({ summary, snapshots: plans.map(({ converted, ...p }) => p) }, null, 2), { mode: 0o600, flag: 'wx' });
      summary.backup = path; summary.replacements = [];
      for (const p of plans) {
        const v = p.snapshot;
        const next = (await client.query(`INSERT INTO record_template_versions
          (template_id,version_no,field_definitions,layout_options,typst_source,status,author_name,change_summary,controlled_no,controlled_issue_date,controlled_effective_date)
          VALUES ($1,(SELECT COALESCE(MAX(version_no),0)+1 FROM record_template_versions WHERE template_id=$1),$2::jsonb,$3::jsonb,$9,$4,'matrix-free-grid-migration',$5,$6,$7,$8)
          RETURNING id,version_no`, [p.template_id, JSON.stringify(p.converted), JSON.stringify(v.layout_options || {}), v.status,
            `旧数据表格迁移为自由表格；来源版本 ${v.id}；保留旧报告映射兼容索引`, v.controlled_no, v.controlled_issue_date, v.controlled_effective_date, p.typst])).rows[0];
        await client.query("UPDATE record_template_versions SET status='superseded' WHERE id=$1", [v.id]);
        if (v.id === p.current_version_id) await client.query('UPDATE record_templates SET current_version_id=$1,updated_at=NOW() WHERE id=$2', [next.id, p.template_id]);
        await client.query(`INSERT INTO template_audit_log (template_kind,template_id,version_id,action,actor_name,detail)
          VALUES ('record',$1,$2,'migrate_matrix_to_free_grid','matrix-free-grid-migration',$3::jsonb)`,
          [p.template_id, next.id, JSON.stringify({ old_version: v.id, table_count: p.count, backup: path, user_authorized: true })]);
        summary.replacements.push({ template: p.template_id, old_version: v.id, new_version: next.id, status: v.status });
      }
      // Write receipt before commit so failure to save recovery information aborts the transaction.
      await writeFile(`${path}.receipt.json`, JSON.stringify(summary, null, 2), { mode: 0o600, flag: 'wx' });
    }
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
