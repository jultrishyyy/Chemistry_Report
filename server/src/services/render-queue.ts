export class RenderBusyError extends Error {
  readonly status = 503;
  readonly code = 'RENDER_BUSY';
  constructor() { super('PDF 服务繁忙，请稍后重试'); }
}
export class RenderCancelledError extends Error {
  readonly code = 'RENDER_CANCELLED';
  constructor() { super('Preview request cancelled'); this.name = 'AbortError'; }
}

interface SharedTask {
  promise: Promise<unknown>;
  subscribers: number;
  persistent: boolean;
  cancelQueued?: () => void;
}

export function positiveInteger(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

/** Process-local admission control. Duplicate callers share work, not an extra queue slot. */
export class RenderQueue {
  private active = 0;
  private waiters: Array<{ start: () => void; timer: ReturnType<typeof setTimeout> }> = [];
  private pending = new Map<string, SharedTask>();
  private shared = 0;
  private rejected = 0;
  private cancelled = 0;
  constructor(private concurrency: number, private maxQueued: number, private waitMs: number) {
    if (![concurrency, maxQueued, waitMs].every(n => Number.isSafeInteger(n) && n > 0)) throw Error('Invalid render queue limits');
  }
  stats() { return { active: this.active, queued: this.waiters.length, shared: this.shared, rejected: this.rejected, cancelled: this.cancelled, concurrency: this.concurrency, maxQueued: this.maxQueued }; }
  /** Call after stopping HTTP/background producers; include running orphaned previews. */
  async drain(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending.values()].map(task => task.promise));
  }
  private acquire(task: SharedTask, key: string): Promise<void> {
    if (this.active < this.concurrency) { this.active++; return Promise.resolve(); }
    if (this.waiters.length >= this.maxQueued) { this.rejected++; return Promise.reject(new RenderBusyError()); }
    return new Promise((resolve, reject) => {
      const waiter = { start: () => { task.cancelQueued = undefined; resolve(); }, timer: undefined as unknown as ReturnType<typeof setTimeout> };
      task.cancelQueued = () => {
        const index = this.waiters.indexOf(waiter);
        if (index < 0) return;
        this.waiters.splice(index, 1);
        clearTimeout(waiter.timer);
        task.cancelQueued = undefined;
        if (this.pending.get(key) === task) this.pending.delete(key);
        this.cancelled++;
        reject(new RenderCancelledError());
      };
      waiter.timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index < 0) return;
        this.waiters.splice(index, 1);
        task.cancelQueued = undefined;
        this.rejected++;
        reject(new RenderBusyError());
      }, this.waitMs);
      this.waiters.push(waiter);
    });
  }
  private release() {
    const next = this.waiters.shift();
    if (next) { clearTimeout(next.timer); next.start(); }
    else this.active--;
  }
  private subscribe<T>(task: SharedTask, signal?: AbortSignal): Promise<T> {
    // Downloads and internal callers keep the task alive even if every preview leaves.
    if (!signal) { task.persistent = true; return task.promise as Promise<T>; }
    task.subscribers++;
    return new Promise<T>((resolve, reject) => {
      let finished = false;
      const finish = () => {
        if (finished) return false;
        finished = true;
        signal.removeEventListener('abort', abort);
        task.subscribers--;
        return true;
      };
      const abort = () => {
        if (!finish()) return;
        reject(new RenderCancelledError());
        if (!task.persistent && task.subscribers === 0) task.cancelQueued?.();
      };
      signal.addEventListener('abort', abort, { once: true });
      task.promise.then(value => { if (finish()) resolve(value as T); }, error => { if (finish()) reject(error); });
      if (signal.aborted) abort();
    });
  }
  run<T>(key: string, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(new RenderCancelledError());
    const existing = this.pending.get(key);
    if (existing) { this.shared++; return this.subscribe<T>(existing, signal); }
    const task: SharedTask = { promise: Promise.resolve(), subscribers: 0, persistent: false };
    task.promise = (async () => {
      await this.acquire(task, key);
      try { return await work(); } finally { this.release(); }
    })().finally(() => { if (this.pending.get(key) === task) this.pending.delete(key); });
    this.pending.set(key, task);
    return this.subscribe<T>(task, signal);
  }
}
