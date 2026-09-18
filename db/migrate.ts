import pg from 'pg';
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { dbConfig, integrationsProfile } from '../config/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(__dirname, 'migrations');

const { Pool } = pg;

async function run() {
  const pool = new Pool({
    host: dbConfig.host,
    port: Number(dbConfig.port),
    database: dbConfig.database,
    user: dbConfig.user,
    password: dbConfig.password || undefined,
  });

  const client = await pool.connect();

  try {
    await client.query("SELECT set_config('cdr.integrations_profile', $1, false)", [integrationsProfile]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR NOT NULL UNIQUE,
        applied_at TIMESTAMP DEFAULT NOW()
      )
    `);

    const applied = await client.query('SELECT name FROM _migrations ORDER BY id');
    const appliedSet = new Set(applied.rows.map((r: any) => r.name));

    const files = readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      if (appliedSet.has(file)) {
        console.log(`[skip] ${file}`);
        continue;
      }
      const sql = readFileSync(resolve(migrationsDir, file), 'utf-8');
      console.log(`[run]  ${file}`);
      await client.query(sql);
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
    }

    console.log('[done] All migrations applied.');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => {
  console.error('[migration error]', err);
  process.exit(1);
});
