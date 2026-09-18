/** Schedule from completion, so slow responses cannot pile up more requests. */
export function startSerialPolling(work: () => Promise<void>, delay: () => number) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    try { await work(); } catch { /* The caller owns user-facing error handling. */ }
    finally { if (!stopped) timer = setTimeout(tick, delay()); }
  };
  void tick();
  return () => { stopped = true; clearTimeout(timer); };
}
