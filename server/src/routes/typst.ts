import { Router, Request, Response } from 'express';
import { compileTypst, queryTypstPositions, getCacheSize } from '../services/typst-compiler.js';

const router = Router();

router.post('/compile', async (req: Request, res: Response) => {
  const { source } = req.body;

  if (!source || typeof source !== 'string') {
    res.status(400).json({ error: 'Missing or invalid "source" field' });
    return;
  }

  try {
    const result = await compileTypst(source);
    res.set({
      'Content-Type': 'application/pdf',
      'X-Compile-Duration-Ms': String(result.duration_ms),
      'X-Cache-Size': String(getCacheSize()),
    });
    res.send(result.pdf);
  } catch (err: any) {
    res.status(422).json({
      error: 'Compilation failed',
      message: err.message || String(err),
      line: err.line,
      column: err.column,
    });
  }
});

/** 编辑器 ⇄ PDF 双向跳转：取回 <__fepos__> 位置标记（kind/code/page/y[pt]）。
 *  与 /compile 同一 source 调用——typst 排版确定性保证两者位置一致。 */
router.post('/query', async (req: Request, res: Response) => {
  const { source } = req.body;
  if (!source || typeof source !== 'string') {
    res.status(400).json({ error: 'Missing or invalid "source" field' });
    return;
  }
  try {
    const markers = await queryTypstPositions(source);
    res.json({ markers });
  } catch (err: any) {
    res.status(422).json({ error: 'Query failed', message: err.message || String(err) });
  }
});

router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', cache_size: getCacheSize() });
});

export default router;
