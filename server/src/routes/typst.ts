import { Router, Request, Response } from 'express';
import { compileTypst, queryTypstPositions, getCacheSize, getRenderQueueStats, getMemoryCacheStats, getDiskCacheStats } from '../services/typst-compiler.js';
import { RenderBusyError } from '../services/render-queue.js';
import { previewSubscription } from '../services/preview-subscription.js';

const router = Router();

router.post('/compile', async (req: Request, res: Response) => {
  const { source } = req.body;

  if (!source || typeof source !== 'string') {
    res.status(400).json({ error: 'Missing or invalid "source" field' });
    return;
  }

  const subscription = previewSubscription(req, res);
  try {
    const result = await compileTypst(source, subscription.signal);
    if (subscription.signal?.aborted) return;
    res.set({
      'Content-Type': 'application/pdf',
      'X-Compile-Duration-Ms': String(result.duration_ms),
      'X-Cache-Size': String(getCacheSize()),
    });
    res.send(result.pdf);
  } catch (err: any) {
    if (subscription.signal?.aborted) return;
    if (err instanceof RenderBusyError) { res.set('Retry-After', '3').status(503).json({ error: err.message, message: err.message }); return; }
    res.status(422).json({
      error: 'Compilation failed',
      message: err.message || String(err),
      line: err.line,
      column: err.column,
    });
  } finally { subscription.dispose(); }
});

/** 编辑器 ⇄ PDF 双向跳转：取回 <__fepos__> 位置标记（kind/code/page/y[pt]）。
 *  与 /compile 同一 source 调用——typst 排版确定性保证两者位置一致。 */
router.post('/query', async (req: Request, res: Response) => {
  const { source } = req.body;
  if (!source || typeof source !== 'string') {
    res.status(400).json({ error: 'Missing or invalid "source" field' });
    return;
  }
  const subscription = previewSubscription(req, res);
  try {
    const markers = await queryTypstPositions(source, subscription.signal);
    if (subscription.signal?.aborted) return;
    res.json({ markers });
  } catch (err: any) {
    if (subscription.signal?.aborted) return;
    if (err instanceof RenderBusyError) { res.set('Retry-After', '3').status(503).json({ error: err.message, message: err.message }); return; }
    res.status(422).json({ error: 'Query failed', message: err.message || String(err) });
  } finally { subscription.dispose(); }
});

router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', cache_size: getCacheSize(), render_queue: getRenderQueueStats(), memory_cache: getMemoryCacheStats(), disk_cache: getDiskCacheStats() });
});

export default router;
