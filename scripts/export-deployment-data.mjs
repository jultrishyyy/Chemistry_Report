#!/usr/bin/env node
/** Export the current local database and uploaded files into a transferable seed snapshot. */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'seed-data');
mkdirSync(out, { recursive: true });

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
const env = { ...process.env, ...(db.password ? { PGPASSWORD: String(db.password) } : {}) };
const nextDump = resolve(out, 'cdr_demo.dump.next');
const dump = resolve(out, 'cdr_demo.dump');

rmSync(nextDump, { force: true });
execFileSync('pg_dump', [
  '-h', String(db.host || 'localhost'), '-p', String(db.port || 5432),
  '-U', String(db.user), '-d', String(db.database), '-Fc',
  '--no-owner', '--no-privileges', '-f', nextDump,
], { env, stdio: 'inherit' });
execFileSync('pg_restore', ['--list', nextDump], { stdio: 'ignore' });
renameSync(nextDump, dump);

const uploadRoot = resolve(root, process.env.SNAPSHOT_UPLOADS_DIR || '../data');
const legacyRoot = resolve(root, process.env.SNAPSHOT_LEGACY_UPLOADS_DIR || 'server/uploads');
const archive = (source, target, { preserveIfMissing = false } = {}) => {
  const sourceHasEntries = existsSync(source) && readdirSync(source).length > 0;
  if (!sourceHasEntries && preserveIfMissing && existsSync(target)) {
    console.log(`源目录不存在或为空，保留已有归档：${target}`);
    return;
  }
  if (!existsSync(source)) mkdirSync(source, { recursive: true });
  rmSync(target, { force: true });
  execFileSync('tar', ['-czf', target, '--exclude=.DS_Store', '-C', source, '.'], {
    stdio: 'inherit', env: { ...process.env, LC_ALL: 'C' },
  });
};
archive(uploadRoot, resolve(out, 'uploads.tar.gz'));
archive(legacyRoot, resolve(out, 'legacy-uploads.tar.gz'), { preserveIfMissing: true });

const manifest = {
  exported_at: new Date().toISOString(),
  source_database: db.database,
  database_dump_bytes: statSync(dump).size,
  uploads_bytes: statSync(resolve(out, 'uploads.tar.gz')).size,
  legacy_uploads_bytes: statSync(resolve(out, 'legacy-uploads.tar.gz')).size,
  restore_target: 'PostgreSQL 16 / cdr_report',
};
writeFileSync(resolve(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`部署快照已导出到 ${out}`);
