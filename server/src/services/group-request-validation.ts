import type { Request, Response, NextFunction } from 'express';
import { isDatabaseId } from '../../../shared/database-id.js';
import { VersionFlowError } from './template-versions.js';
import { log } from '../logger.js';

export function validateGroupResourceId(_req: Request, res: Response, next: NextFunction, value: string) {
  if (!isDatabaseId(value)) {
    res.status(400).json({ error: '项目信息已失效，请刷新页面后重试。' });
    return;
  }
  next();
}

export function groupOperationError(res: Response, error: unknown) {
  if (error instanceof VersionFlowError) {
    res.status(error.status || 400).json({ error: error.message });
    return;
  }
  log.error('group-operation', { msg: error instanceof Error ? error.message : String(error) });
  res.status(500).json({ error: '项目组操作暂时失败，请稍后重试。' });
}
