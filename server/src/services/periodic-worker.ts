/** No overlapping batches; stopping cancels timers and waits for the current batch. */
export function startPeriodicWorker(work: () => Promise<unknown>, onError: (error: unknown) => void, initialMs: number, intervalMs: number) {
  let stopped = false;
  let pending: Promise<void> | undefined;
  const run = () => {
    if (stopped || pending) return;
    pending = Promise.resolve().then(work).then(() => {}, onError).finally(() => { pending = undefined; });
  };
  const first = setTimeout(run, initialMs); first.unref();
  const interval = setInterval(run, intervalMs); interval.unref();
  return async () => { stopped = true; clearTimeout(first); clearInterval(interval); await pending; };
}
