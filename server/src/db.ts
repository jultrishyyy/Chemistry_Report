/**
 * 共享数据库连接池（单一事实来源）。
 *
 * 此前每个路由各建一个 `new Pool(...)`（14 处），等于 14 套独立连接池、配置重复，
 * 且每池默认 max=10 → 高并发下可能打满 PostgreSQL 连接上限。改为全进程一个池：
 * 所有路由 `import { pool } from '../db.js'`，连接数集中受 `max` 控制。
 *
 * 池大小可经 DB_POOL_MAX 环境变量调整（默认 20，足够 200 人并发的短查询场景）。
 * 注意：这是长生命周期单例，**不要**在请求里调 pool.end()。
 */
import pg from 'pg';
import { dbConfig } from '../../config/index.js';

const { Pool } = pg;

export const pool = new Pool({
  host: dbConfig.host,
  port: Number(dbConfig.port),
  database: dbConfig.database,
  user: dbConfig.user,
  password: dbConfig.password || undefined,
  max: Number(process.env.DB_POOL_MAX || 20),
});

// 空闲客户端意外报错（如数据库重启）不应让整个进程崩溃。
pool.on('error', (err) => {
  console.error('[db] idle client error:', err.message);
});
