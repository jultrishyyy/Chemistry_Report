import type { Request, Response } from 'express';

/** Normal request-body completion is NOT a disconnect: listen to response close instead. */
export function previewSubscription(req: Request, res: Response) {
  if (req.get('X-Preview-Request') !== '1') return { signal: undefined, dispose: () => {} };
  const controller = new AbortController();
  const abort = () => controller.abort();
  const onClose = () => { if (!res.writableEnded) abort(); };
  req.once('aborted', abort);
  res.once('close', onClose);
  if (req.aborted || res.destroyed) abort();
  return { signal: controller.signal, dispose: () => {
    req.off('aborted', abort); res.off('close', onClose);
  } };
}
