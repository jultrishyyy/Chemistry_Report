import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function summarize(rows, elapsedMs) {
  const good = rows.filter(r => r.ok);
  const times = good.map(r => r.ms).sort((a, b) => a - b);
  const percentile = p => times.length ? times[Math.ceil(times.length * p) - 1] : null;
  return { requests: rows.length, successes: good.length, errors: rows.length - good.length,
    successRps: good.length / (elapsedMs / 1000), elapsedMs,
    p50: percentile(.5), p95: percentile(.95), p99: percentile(.99),
    max: times.length ? times[times.length - 1] : null,
    statusCounts: rows.reduce((a,r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {}),
    bytesMin: rows.length ? Math.min(...rows.map(r => r.bytes)) : null,
    bytesMax: rows.length ? Math.max(...rows.map(r => r.bytes)) : null,
    itemCounts: [...new Set(rows.map(r => r.items).filter(n => n != null))] };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const base = new URL(process.env.PERF_BASE_URL || 'http://172.19.10.12:5173');
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw Error('Invalid base URL');
  const durationMs = 10000, timeoutMs = 5000, rateCap = 5;
  const targets = [
    { path: '/api/health', label: '健康接口（不代表业务容量）', kind: 'health' },
    { path: '/', label: '首页 HTML（不含 JS、字体或浏览器执行）', kind: 'html' },
    { path: '/api/work-orders', label: '委托单列表（数据库只读）', kind: 'array' },
  ];
  async function request(target) {
    const start = performance.now();
    try {
      const response = await fetch(new URL(target.path, base), {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: { 'Accept': target.kind === 'html' ? 'text/html' : 'application/json' },
      });
      const body = await response.text();
      let valid = false, items;
      if (target.kind === 'html') valid = /<html[\s>]/i.test(body);
      else {
        try {
          const data = JSON.parse(body);
          valid = target.kind === 'array' ? Array.isArray(data) : data.status === 'ok';
          if (Array.isArray(data)) items = data.length;
        } catch { /* Invalid response is a failed request. */ }
      }
      return { ok: response.ok && valid, status: String(response.status),
        ms: performance.now() - start, bytes: Buffer.byteLength(body), items };
    } catch (error) {
      return { ok: false, status: error.name, ms: performance.now() - start, bytes: 0 };
    }
  }
  const report = { startedAt: new Date().toISOString(), base: base.origin,
    client: { node: process.version, platform: process.platform, arch: process.arch },
    policy: { durationMs, timeoutMs, rateCap, concurrencyCaps: [1, 2, 5],
      note: 'Sequential scenarios, globally paced at <=5 starts/s. No authentication impersonation or writes.' },
    results: [], stoppedReason: null };
  let interrupted = false;
  process.on('SIGINT', () => { interrupted = true; });
  outer: for (const target of targets) {
    const preflight = await request(target);
    if (!preflight.ok) { report.stoppedReason = `预检失败 ${target.path}: ${preflight.status}`; break; }
    for (const concurrency of [1, 2, 5]) {
      const rows = [], active = new Set();
      let maxActive = 0;
      const start = performance.now();
      while (performance.now() - start < durationMs && !interrupted) {
        if (active.size < concurrency) {
          const p = request(target).then(row => rows.push(row)).finally(() => active.delete(p));
          active.add(p);
          maxActive = Math.max(maxActive, active.size);
        }
        await sleep(1000 / rateCap);
        if (rows.filter(r => !r.ok).length >= 3 || rows.filter(r => r.ms > 2000).length >= 3) {
          report.stoppedReason = '保护停止：至少3次错误或至少3次响应超过2秒'; break;
        }
      }
      await Promise.all(active);
      const result = { target: target.path, label: target.label, concurrencyCap: concurrency,
        observedMaxInFlight: maxActive, ...summarize(rows, performance.now() - start) };
      report.results.push(result);
      console.log(JSON.stringify(result));
      if (interrupted) report.stoppedReason = '用户中止';
      if (report.stoppedReason) break outer;
      await sleep(1000);
    }
  }
  report.finishedAt = new Date().toISOString();
  const out = new URL('../perf-results/', import.meta.url);
  await mkdir(out, { recursive: true });
  const id = report.startedAt.replace(/[:.]/g, '-');
  await writeFile(new URL(`${id}.json`, out), JSON.stringify(report, null, 2));
  const fmt = n => n == null ? '无成功样本' : n.toFixed(2);
  const md = `# LIMS 内网只读性能基线报告\n\n` +
    `时间：${report.startedAt} ～ ${report.finishedAt}\n\n目标：${report.base}\n\n` +
    `客户端：${process.platform}/${process.arch}，Node ${process.version}。每档10秒，上限5请求/秒，超时5秒；预检不计入统计。延迟从发请求到完整读取并校验响应，包含内网开销，P95仅统计成功请求。\n\n` +
    `| 场景 | 并发上限 | 实际最大在途 | 请求/成功/失败 | 成功请求/秒 | P50 ms | P95 ms | P99 ms | 响应字节范围 |\n|---|---:|---:|---|---:|---:|---:|---:|---|\n` +
    report.results.map(r => `| ${r.label} | ${r.concurrencyCap} | ${r.observedMaxInFlight} | ${r.requests}/${r.successes}/${r.errors} | ${fmt(r.successRps)} | ${fmt(r.p50)} | ${fmt(r.p95)} | ${fmt(r.p99)} | ${r.bytesMin}–${r.bytesMax} |`).join('\n') +
    `\n\n## 数据规模\n\n` + report.results.filter(r => r.itemCounts.length).map(r => `- ${r.target}，并发上限${r.concurrencyCap}：返回记录数 ${r.itemCounts.join('、')}。`).join('\n') +
    `\n\n## 结论与限制\n\n停止原因：${report.stoppedReason || '按计划结束'}。\n\n` +
    `本次是限速、短时、只读基线，不是极限压测。并发上限不等于实际并发，也不等于在线用户数。实际吞吐受客户端5请求/秒上限约束，不能据此宣称服务器最大吞吐或最大并发。\n\n` +
    `没有执行保存、Excel导入、PDF编译、图片上传或任何外部接口操作；没有收集服务器CPU、内存、磁盘、数据库监控。因此不能评价这些业务容量、资源效率或长期稳定性。首页测试只读取HTML，不模拟浏览器完整加载。空列表结果不能代表大数据量查询。约50个样本/档的P99仅供参考。\n\n` +
    `下一步：在独立压测实例使用脱敏数据与有效测试账号，禁用真实外部回传；同步采集CPU/内存/磁盘与数据库指标，对查询、保存和不同页数/图片数的PDF分别进行阶梯负载与30–60分钟稳定性测试，再确定满足约定P95/失败率目标的可持续容量。\n`;
  await writeFile(new URL(`${id}.md`, out), md);
  console.log(`Report: ${new URL(`${id}.md`, out).pathname}`);
  if (report.stoppedReason) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.message); process.exitCode = 1; });
