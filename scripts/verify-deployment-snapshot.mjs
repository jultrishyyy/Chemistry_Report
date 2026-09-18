#!/usr/bin/env node
/** Restore the transferable dump into a temporary database and verify key data. */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = name => {
  const path = resolve(root, 'config', name);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
};
const baseDb = readJson('database.json');
const db = {
  host: process.env.SNAPSHOT_DB_HOST || baseDb.host || 'localhost',
  port: Number(process.env.SNAPSHOT_DB_PORT || baseDb.port || 5432),
  database: process.env.SNAPSHOT_DB_NAME || baseDb.database,
  user: process.env.SNAPSHOT_DB_USER || baseDb.user,
  password: process.env.SNAPSHOT_DB_PASSWORD || undefined,
};
const verifyDb = `cdr_snapshot_verify_${process.pid}`;
const dump = resolve(root, 'seed-data', 'cdr_demo.dump');
const env = { ...process.env, ...(db.password ? { PGPASSWORD: String(db.password) } : {}) };
const connectionArgs = ['-h', String(db.host), '-p', String(db.port), '-U', String(db.user)];

try {
  execFileSync('createdb', [...connectionArgs, verifyDb], { env, stdio: 'inherit' });
  execFileSync('pg_restore', [
    '--exit-on-error', '--no-owner', '--no-privileges',
    ...connectionArgs,
    '-d', verifyDb, dump,
  ], { env, stdio: 'inherit' });
  const sql = `SELECT json_build_object(
    'record_templates',(SELECT count(*) FROM record_templates),
    'report_templates',(SELECT count(*) FROM report_templates),
    'work_orders',(SELECT count(*) FROM work_orders),
    'record_data',(SELECT count(*) FROM record_data),
    'reports',(SELECT count(*) FROM reports),
    'users',(SELECT count(*) FROM users));`;
  const counts = execFileSync('psql', [...connectionArgs, '-d', verifyDb, '-Atqc', sql], { env, encoding: 'utf8' }).trim();
  console.log(JSON.stringify({ snapshot: 'ok', counts: JSON.parse(counts) }, null, 2));
} finally {
  execFileSync('dropdb', [...connectionArgs, '--if-exists', '--force', verifyDb], { env, stdio: 'ignore' });
}
