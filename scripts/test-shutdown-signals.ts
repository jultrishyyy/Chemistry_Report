import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
async function run(mode: 'normal' | 'deadline') {
  const child = fork(fileURLToPath(new URL('./fixtures/shutdown-smoke.ts', import.meta.url)), [mode], {
    execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  const events: string[] = []; let stderr = '';
  child.stderr?.on('data', data => { stderr += data; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 8000);
  try {
    const result = await new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
      child.on('error', reject);
      child.on('message', message => {
        events.push(String(message));
        if (message === 'ready') child.kill('SIGTERM');
        if (message === 'draining' && mode === 'normal') {
          child.kill('SIGTERM'); child.send('complete');
        }
      });
      child.on('exit', (code, signal) => resolve({ code, signal }));
    });
    assert.equal(result.signal, null, stderr);
    assert.equal(result.code, mode === 'normal' ? 0 : 1, stderr);
    if (mode === 'normal') {
      assert.equal(events.filter(event => event === 'draining').length, 1);
      assert.ok(events.indexOf('render-drained') < events.indexOf('database-closed'));
      assert.ok(events.includes('database-closed')); assert.ok(!events.includes('forced'));
    } else {
      assert.ok(events.includes('forced')); assert.ok(!events.includes('database-closed'));
    }
  } finally { clearTimeout(timer); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
}
await run('normal'); await run('deadline');
console.log('Real Node signal smoke: repeated SIGTERM drains once; deadline exits with failure');
