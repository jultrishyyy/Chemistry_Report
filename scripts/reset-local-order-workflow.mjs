// Explicit local-only maintenance. Keeps orders, samples and all configuration.
// Usage: node scripts/reset-local-order-workflow.mjs --apply
import pg from 'pg';
import { execFileSync } from 'node:child_process';
import { mkdirSync, chmodSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

if (!process.argv.includes('--apply')) throw new Error('Requires --apply; backs up before resetting localhost/cdr_demo.');
const backendPid = 91234;
const backupDir = `/private/tmp/lims-local-reset-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const deletedTables = ['report_audit_log', 'record_audit_log', 'rework_tickets', 'record_batch_items', 'reports', 'report_batches', 'record_data', 'record_batches', 'work_order_audit_log'];
const collaborationTables = ['collaboration_presence', 'edit_lease_requests', 'edit_leases', 'collaboration_events'];
const quote = s => `"${s.replaceAll('"', '""')}"`;
const client = new pg.Client({ host: 'localhost', port: 5432, database: 'cdr_demo', user: 'trish', connectionTimeoutMillis: 5000 });
let paused = false;
let committed = false;
const summary = { backupDir, deleted: {}, preserved: {} };
const hash = rows => createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const cleanPayload = payload => {
  const copy = structuredClone(payload);
  for (const sample of copy?.samples || []) for (const test of sample.test_infos || []) {
    delete test.linked_template_ids;
    delete test.linked_template_id;
    delete test.linked_record_id;
  }
  return copy;
};
try {
  const command = execFileSync('ps', ['-p', String(backendPid), '-o', 'command='], { encoding: 'utf8' });
  if (!command.includes('/Users/trish/Documents/work/3/code/demo_v1/server/node_modules/') || !command.includes('src/index.ts')) throw new Error('Backend identity changed; abort.');
  process.kill(backendPid, 'SIGSTOP');
  paused = true;
  await client.connect();
  const identity = (await client.query('SELECT current_database() AS db, host(inet_server_addr()) AS addr')).rows[0];
  if (identity.db !== 'cdr_demo' || !['::1', '127.0.0.1'].includes(identity.addr)) throw new Error('Not the authorized local database');
  const active = await client.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND (state<>'idle' OR xact_start IS NOT NULL)");
  if (active.rowCount) throw new Error('Other active database transactions; retry when idle.');
  mkdirSync(backupDir, { mode: 0o700 });
  const dump = `${backupDir}/cdr_demo-before-reset.dump`;
  execFileSync('pg_dump', ['-h', 'localhost', '-p', '5432', '-U', 'trish', '-d', 'cdr_demo', '-Fc', '-f', dump], { stdio: 'pipe' });
  chmodSync(dump, 0o600);
  execFileSync('pg_restore', ['--list', dump], { stdio: 'pipe' });
  console.log(`Backup verified: ${dump}`);
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout='5s'");
  const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r => r.tablename);
  await client.query(`LOCK TABLE ${tables.map(quote).join(',')} IN SHARE ROW EXCLUSIVE MODE`);
  const changed = new Set([...deletedTables, ...collaborationTables, 'work_orders', 'report_requisitions', 'external_task_state_deliveries']);
  const snapshots = new Map();
  for (const table of tables.filter(t => !changed.has(t))) {
    const rows = (await client.query(`SELECT to_jsonb(t) AS data FROM ${quote(table)} t ORDER BY to_jsonb(t)::text`)).rows;
    snapshots.set(table, hash(rows));
    summary.preserved[table] = rows.length;
  }
  const ordersBefore = (await client.query('SELECT * FROM work_orders ORDER BY order_no')).rows;
  const stableOrders = rows => rows.map(({ updated_at, ...r }) => ({ ...r, payload: cleanPayload(r.payload) }));
  const protectedCollaboration = new Map();
  for (const table of collaborationTables) {
    const rows = (await client.query(`SELECT to_jsonb(t) AS data FROM ${quote(table)} t WHERE resource_type NOT IN ('record_data','report_instance','record_batch') ORDER BY to_jsonb(t)::text`)).rows;
    protectedCollaboration.set(table, hash(rows));
    summary.deleted[table] = (await client.query(`DELETE FROM ${quote(table)} WHERE resource_type IN ('record_data','report_instance','record_batch')`)).rowCount;
  }
  if (tables.includes('external_task_state_deliveries')) summary.deleted.external_task_state_deliveries = (await client.query('DELETE FROM external_task_state_deliveries')).rowCount;
  for (const table of deletedTables) summary.deleted[table] = (await client.query(`DELETE FROM ${quote(table)}`)).rowCount;
  summary.requisitionsReset = (await client.query(`UPDATE report_requisitions SET report_id=NULL, status='pending', stale=false, match_result=NULL, delivery_status='none', delivered_at=NULL, delivery_error=NULL, record_state=NULL, last_modify_remark=NULL, template_selections='[]'::jsonb, generation_configured_at=NULL, generation_configured_by=NULL, updated_at=NOW()`)).rowCount;
  for (const order of ordersBefore) await client.query('UPDATE work_orders SET payload=$2::jsonb,updated_at=NOW() WHERE order_no=$1', [order.order_no, JSON.stringify(cleanPayload(order.payload))]);
  const ordersAfter = (await client.query('SELECT * FROM work_orders ORDER BY order_no')).rows;
  if (hash(stableOrders(ordersBefore)) !== hash(stableOrders(ordersAfter))) throw new Error('Order/sample preservation verification failed');
  for (const [table, fingerprint] of snapshots) {
    const rows = (await client.query(`SELECT to_jsonb(t) AS data FROM ${quote(table)} t ORDER BY to_jsonb(t)::text`)).rows;
    if (hash(rows) !== fingerprint) throw new Error(`Protected table changed: ${table}`);
  }
  for (const [table, fingerprint] of protectedCollaboration) {
    const rows = (await client.query(`SELECT to_jsonb(t) AS data FROM ${quote(table)} t WHERE resource_type NOT IN ('record_data','report_instance','record_batch') ORDER BY to_jsonb(t)::text`)).rows;
    if (hash(rows) !== fingerprint) throw new Error(`Template collaboration changed: ${table}`);
  }
  for (const table of deletedTables) if (Number((await client.query(`SELECT count(*) FROM ${quote(table)}`)).rows[0].count)) throw new Error(`Not empty: ${table}`);
  summary.ordersPreserved = ordersAfter.length;
  summary.samplesPreserved = ordersAfter.reduce((n, o) => n + (o.payload.samples?.length || 0), 0);
  summary.attachments = 'Physical files retained; no external callbacks invoked.';
  await client.query('COMMIT');
  committed = true;
  writeFileSync(`${backupDir}/reset-summary.json`, JSON.stringify(summary, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  if (!committed) await client.query('ROLLBACK').catch(() => {});
  console.error(committed ? 'Committed; subsequent step failed:' : 'Not committed; reset rolled back:', error.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
  if (paused) process.kill(backendPid, 'SIGCONT');
}
