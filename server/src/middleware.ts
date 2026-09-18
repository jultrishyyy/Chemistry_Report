/**
 * 通用 HTTP 中间件：请求日志 / 统一 404 / 兜底错误处理。
 * 在 index.ts 按顺序挂载（requestLogger 在路由前，apiNotFound + errorHandler 在路由后）。
 */
import type { Request, Response, NextFunction } from 'express';
import { log } from './logger.js';
import { requestMetrics } from './services/request-metrics.js';

/** 请求日志：每个请求结束时记 method/path/status/耗时。健康检查不刷屏。 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  if (['/api/health', '/api/ready', '/api/operations/metrics', '/api/typst/health'].includes(req.path)) return next();
  const start = Date.now();
  const finish = requestMetrics.start();
  res.once('close', () => { if (!res.writableFinished) finish(res.statusCode, Date.now() - start, true); });
  res.on('finish', () => {
    finish(res.statusCode, Date.now() - start);
    log.info('req', {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      ms: Date.now() - start,
    });
  });
  next();
}

/** 未匹配的 /api 路由 → 统一 JSON 404（而非 Express 默认 HTML）。挂在所有 /api 路由之后、静态托管之前。 */
export function apiNotFound(req: Request, res: Response, next: NextFunction): void {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ ok: false, error: 'Not Found', path: req.originalUrl });
    return;
  }
  next();
}

/**
 * 兜底错误处理：捕获路由里未处理的异常。Express 5 会把 async 路由的 reject 自动转到这里，
 * 因此即使某个 await 抛错没被 try/catch 接住，也不会让请求悬挂或进程异常——而是记日志 + 返回统一 JSON。
 * 必须是四参数签名，且注册在所有路由/中间件的最后。
 */
export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction): void {
  log.error('unhandled', {
    method: req.method,
    path: req.originalUrl,
    msg: err?.message || String(err),
  });
  if (res.headersSent) return;        // 已开始发响应（如 PDF 流）就不能再改状态码
  // 请求体 JSON 解析失败（express.json 抛 SyntaxError，status=400）→ 明确告知调用方是请求格式问题，而非服务器内部错误
  const isBodyParse = err?.type === 'entity.parse.failed'
    || (err instanceof SyntaxError && (err as SyntaxError & { status?: number }).status === 400);
  if (isBodyParse) { res.status(400).json({ ok: false, error: '请求体 JSON 解析失败' }); return; }
  // 其余未捕获异常一律服务器内部错误（不泄露内部细节，详情见服务端日志）。统一 {ok:false,error} 形态。
  res.status(err?.status || 500).json({ ok: false, error: 'Internal Server Error' });
}
