// Isolated signal test: no network listener, database, files or real external deliveries.
import { createGracefulShutdown } from '../../server/src/services/graceful-shutdown.js';
let complete!: () => void;
const inFlight = new Promise<void>(resolve => { complete = resolve; });
const send = (event: string) => process.send?.(event);
const shutdown = createGracefulShutdown({
  timeoutMs: process.argv[2] === 'deadline' ? 50 : 3000,
  drainHttp: () => { send('draining'); return inFlight; },
  stopBackground: async () => { send('background-stopped'); },
  drainRender: async () => { send('render-drained'); },
  closeDatabase: async () => { send('database-closed'); },
  forceClose: () => { send('forced'); },
  exit: code => process.exit(code), report: () => {},
});
process.on('message', message => { if (message === 'complete') complete(); });
process.on('SIGTERM', () => { void shutdown.stop('SIGTERM'); });
process.on('SIGINT', () => { void shutdown.stop('SIGINT'); });
send('ready');
