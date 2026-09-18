import express from 'express';
import cors from 'cors';
import { resolve, dirname } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { integrationsProfile, printConfig } from '../../config/index.js';
import { pool, poolPolicy } from './db.js';
import { createReadinessProbe } from './services/readiness.js';
import { requestMetrics } from './services/request-metrics.js';
import { getRenderQueueStats, getMemoryCacheStats, getDiskCacheStats, drainRenderQueue } from './services/typst-compiler.js';
import { createGracefulShutdown } from './services/graceful-shutdown.js';
import { positiveInteger } from './services/render-queue.js';
import { log } from './logger.js';
import { requestLogger, apiNotFound, errorHandler } from './middleware.js';
import typstRouter from './routes/typst.js';
import recordTemplatesRouter from './routes/record-templates.js';
import recordDataRouter from './routes/record-data.js';
import reportTemplatesRouter from './routes/report-templates.js';
import hostManufacturersRouter from './routes/host-manufacturers.js';
import mappingsRouter from './routes/mappings.js';
import reportsRouter from './routes/reports.js';
import proposalsRouter from './routes/proposals.js';
import excelImportRouter from './routes/excel-import.js';
import equipmentRouter from './routes/equipment.js';
import imagesRouter from './routes/images.js';
import workOrdersRouter from './routes/work-orders.js';
import auditLogRouter from './routes/audit-log.js';
import reworkRouter from './routes/rework.js';
import externalRouter from './routes/external.js';
import authRouter, { requirePermission } from './routes/auth.js';
import templateAssetsRouter from './routes/template-assets.js';
import collaborationRouter from './routes/collaboration.js';
import testMethodsRouter from './routes/test-methods.js';
import reportProjectFamiliesRouter from './routes/report-project-families.js';
import recordBatchesRouter from './routes/record-batches.js';
import { seedBaseTemplates } from './services/seed-base-templates.js';
import { seedReportTemplates } from './services/seed-report-templates.js';
import { seedWorkOrders } from './services/seed-work-orders.js';
import { seedMockBySample } from './services/seed-mock-by-sample.js';
import { startTaskStateDeliveryRetryWorker } from './services/external-task-state.js';
import { servePrecompressedAssets } from './services/static-assets.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '0.0.0.0';
let shutdown: ReturnType<typeof createGracefulShutdown> | undefined;

app.use(cors());
app.use((req, res, next) => {
  if (shutdown?.isStopping() && req.path !== '/api/health') {
    res.set({ 'Retry-After': '5', Connection: 'close', 'Cache-Control': 'no-store' })
      .status(503).json({ error: '系统正在更新，请稍后重试', status: 'stopping' });
    return;
  }
  next();
});
app.use(express.json({ limit: '10mb' }));
app.use(requestLogger);  // 请求日志（结构化，健康检查除外）

// Fixed, bundled font assets only; never expose arbitrary filesystem paths.
const reportFontFiles = new Set(['Fangsong.ttf', '仿宋_GB2312.ttf', 'Kaiti.ttf', 'SimHei.ttf',
  'arial.ttf', 'arialbd.ttf', 'ariali.ttf', 'arialbi.ttf', 'times.ttf', 'timesbd.ttf', 'timesi.ttf', 'timesbi.ttf']);
app.get('/api/report-fonts/:file', (req, res) => {
  if (!reportFontFiles.has(req.params.file)) { res.sendStatus(404); return; }
  res.sendFile(req.params.file, { root: resolve(__dirname, '../../fonts'), maxAge: '1d', dotfiles: 'deny' });
});

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    integrations_profile: integrationsProfile,
    report_meta_source: integrationsProfile === 'server' ? 'external_interface' : 'mock',
  });
});

// Liveness above remains independent of database availability. Do not restart-loop on DB outages.
const checkReadiness = createReadinessProbe(pool);
app.get('/api/ready', async (_req, res) => {
  const result = await checkReadiness();
  if (shutdown?.isStopping()) { res.set('Cache-Control', 'no-store').status(503).json({ status: 'stopping' }); return; }
  res.set('Cache-Control', 'no-store').status(result.status === 'ready' ? 200 : 503).json(result);
});
app.get('/api/operations/metrics', requirePermission('user.manage'), (_req, res) => {
  res.set('Cache-Control', 'no-store').json({
    timestamp: new Date().toISOString(), uptime_seconds: process.uptime(),
    process_memory_bytes: process.memoryUsage(), cpu_microseconds_since_start: process.cpuUsage(),
    requests: requestMetrics.snapshot(),
    database: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount,
      max: poolPolicy.max, connection_timeout_ms: poolPolicy.connectionTimeoutMillis },
    render_queue: getRenderQueueStats(), memory_cache: getMemoryCacheStats(), disk_cache: getDiskCacheStats(),
  });
});

app.use('/api/auth', authRouter);  // 登录(5.1 接缝) + 本地 RBAC(用户/角色/权限)
app.use('/api/typst', typstRouter);
app.use('/api/record-templates', recordTemplatesRouter);
app.use('/api/record-data', recordDataRouter);
app.use('/api/report-templates', reportTemplatesRouter);
app.use('/api/host-manufacturers', hostManufacturersRouter);
app.use('/api/mappings', mappingsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/proposals', proposalsRouter);
app.use('/api/excel-import', excelImportRouter);
app.use('/api/equipment', equipmentRouter);
app.use('/api/images', imagesRouter);
app.use('/api/template-assets', templateAssetsRouter);
app.use('/api/collaboration', collaborationRouter);
app.use('/api/test-methods', testMethodsRouter);
app.use('/api/report-project-families', reportProjectFamiliesRouter);
app.use('/api/record-batches', recordBatchesRouter);
app.use('/api/work-orders', workOrdersRouter);
app.use('/api/audit-log', auditLogRouter);
app.use('/api', reworkRouter);  // /api/rework* + /api/orders/:order_no/timeline
app.use('/api/external', externalRouter);  // 接收外部推送：1.1 委托单 / 1.2·1.3 报告（P2）

// 未匹配的 /api/* → 统一 JSON 404（放在所有 /api 路由之后、静态托管之前）
app.use(apiNotFound);

// Serve frontend build (production mode)
const clientDist = resolve(__dirname, '../../client/dist');
if (existsSync(clientDist)) {
  const clientAssets = resolve(clientDist, 'assets');
  app.use('/assets', servePrecompressedAssets(clientAssets));
  app.use('/assets', express.static(clientAssets, { index: false, maxAge: '1y', immutable: true,
    setHeaders: res => { res.setHeader('Vary', 'Accept-Encoding'); } }));
  app.use(express.static(clientDist, { index: false, maxAge: '1h', setHeaders: (res, path) => {
    if (path.endsWith('/index.html')) res.setHeader('Cache-Control', 'no-cache');
  } }));
  app.get(/^\/(?!api).*/, (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(resolve(clientDist, 'index.html'));
  });
  log.info('[static] serving frontend', { dir: clientDist });
} else {
  log.warn('[static] frontend not built yet (run: cd client && pnpm build); skipping static serve');
}

// 兜底错误处理：必须注册在最后
app.use(errorHandler);

printConfig();
const stopTaskStateWorker = startTaskStateDeliveryRetryWorker();

// 启动 seed 复用共享连接池（不再单建临时池）；共享池是长生命周期单例，跑完不 end()
const seedCompletion = integrationsProfile === 'demo' ? Promise.all([
  // 报告模板 seed 必须紧跟原始记录之后（project 按原始记录 name 反查关联 id），故串在同一条链上
  seedBaseTemplates(pool)
    .then(() => seedReportTemplates(pool))
    .catch(err => console.error('[seed] templates failed:', err)),
  seedWorkOrders(pool).catch(err => console.error('[seed] work orders failed:', err)),
])
  // 演示用「按样品出」订单：需模板已 seed（匹配项目模板）+ 源单存在，故放在最后跑
  .then(() => seedMockBySample(pool).catch(err => console.error('[seed] mock by-sample failed:', err))) : Promise.resolve();

const server = app.listen(PORT, HOST, () => {
  log.info('server running', { url: `http://${HOST}:${PORT}` });
});
shutdown = createGracefulShutdown({
  timeoutMs: positiveInteger(process.env.SHUTDOWN_TIMEOUT_MS, 60000),
  drainHttp: () => new Promise<void>((resolveDrain, reject) => {
    server.close(error => {
      if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
      else resolveDrain();
    });
    server.closeIdleConnections();
  }),
  stopBackground: async () => { await Promise.all([stopTaskStateWorker(), seedCompletion]); },
  drainRender: drainRenderQueue,
  closeDatabase: () => pool.end(),
  forceClose: () => server.closeAllConnections(),
  exit: code => process.exit(code),
  report: message => log.info('lifecycle', { message }),
});
process.on('SIGTERM', () => { void shutdown!.stop('SIGTERM'); });
process.on('SIGINT', () => { void shutdown!.stop('SIGINT'); });
