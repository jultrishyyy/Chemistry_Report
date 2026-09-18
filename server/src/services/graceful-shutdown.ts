interface ShutdownOptions {
  timeoutMs: number;
  drainHttp: () => Promise<void>;
  stopBackground: () => Promise<void>;
  drainRender: () => Promise<void>;
  closeDatabase: () => Promise<void>;
  forceClose: () => void;
  exit: (code: number) => void;
  report: (message: string) => void;
}
/** Stop admission immediately; preserve ordering and put a deadline around the entire drain. */
export function createGracefulShutdown(options: ShutdownOptions) {
  let stopping = false;
  let completion: Promise<void> | undefined;
  return {
    isStopping: () => stopping,
    stop(reason: string): Promise<void> {
      if (completion) return completion;
      stopping = true;
      options.report(`shutdown started: ${reason}`);
      completion = new Promise<void>(resolve => {
        let finished = false;
        const finish = (code: number) => {
          if (finished) return;
          finished = true; clearTimeout(timer); resolve(); options.exit(code);
        };
        const force = () => {
          try { options.forceClose(); }
          catch (error: any) { options.report(`force close failed: ${error?.message || error}`); }
          finally { finish(1); }
        };
        const timer = setTimeout(() => {
          options.report('shutdown deadline exceeded; in-flight work may be interrupted');
          force();
        }, options.timeoutMs);
        void (async () => {
          const results = await Promise.allSettled([
            Promise.resolve().then(options.drainHttp),
            Promise.resolve().then(options.stopBackground),
          ]);
          if (finished) return;
          if (results.some(result => result.status === 'rejected')) throw Error('HTTP or background drain failed');
          await options.drainRender();
          if (finished) return;
          await options.closeDatabase();
          if (!finished) options.report('shutdown completed');
          finish(0);
        })().catch(error => {
          if (finished) return;
          options.report(`shutdown failed: ${error?.message || error}`);
          force();
        });
      });
      return completion;
    },
  };
}
