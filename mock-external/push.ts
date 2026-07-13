/**
 * 模拟外部「递归智能」系统：推送一个委托单 + 完成取号（**不灌录入数据**，由你自己到实验室录入台录入）。
 *
 * 对齐《递归智能报告系统_对接接口规范》：
 *   - 接口 1.1 `POST /api/external/orders`   推委托单（样品 × 检测项目）
 *   - 接口 1.2 `POST /api/external/reports`  推取号报告（按拆分格式决定几份）
 *
 * 固定结构：样品A = 密度 + 弯曲强度/模量；样品B = 透光率。
 * 脚本会把对应的原始记录模板**预关联**到每个样品×项目（省去你手动关联），但**不录数据**。
 *
 * 用法（后端需在 :3001 运行，pnpm dev）：
 *   pnpm tsx mock-external/push.ts --mode=whole              # 整单出：1 份报告含全部样品×项目
 *   pnpm tsx mock-external/push.ts --mode=per-sample         # 按样品出：每个样品 1 份
 *   pnpm tsx mock-external/push.ts --mode=per-sample-project # 按样品按项目出：每个样品每个项目 1 份
 *   pnpm tsx mock-external/push.ts --reset                   # 只清理本模拟订单
 *
 * 推完后：① 到 /lab 进该订单录入台，逐个样品×项目录入数据并提交→审核通过；
 *        ② 到 /report 进该订单工作台「取号报告」面板生成报告。真实接口对接后本脚本即可弃用。
 */
import pg from 'pg';
import { dbConfig } from '../config/index.js';

const { Pool } = pg;
const pool = new Pool({
  host: dbConfig.host, port: Number(dbConfig.port), database: dbConfig.database,
  user: dbConfig.user, password: dbConfig.password || undefined,
});

const API = process.env.MOCK_API || 'http://localhost:3001/api';
const WEB = process.env.MOCK_WEB || 'http://localhost:5173';
const ORDER_NO = process.env.MOCK_ORDER || 'MOCK-EXT-001';

type SplitMode = 'whole' | 'per-sample' | 'per-sample-project';
function argMode(): SplitMode {
  const a = process.argv.find((x) => x.startsWith('--mode='));
  const v = (a ? a.slice('--mode='.length) : 'whole') as SplitMode;
  if (!['whole', 'per-sample', 'per-sample-project'].includes(v)) {
    throw new Error(`--mode 只能是 whole / per-sample / per-sample-project，收到：${v}`);
  }
  return v;
}

async function post(path: string, body: any) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Demo-User': encodeURIComponent('递归智能(模拟)') },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: any; try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  return data;
}
async function put(path: string, body: any) {
  const res = await fetch(`${API}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Demo-User': encodeURIComponent('递归智能(模拟)') },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PUT ${path} → ${res.status}: ${text}`);
  try { return JSON.parse(text); } catch { return text; }
}
async function get(path: string) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

/** 清理本模拟订单（按外键依赖顺序）。 */
async function reset() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`DELETE FROM report_requisitions WHERE order_no=$1`, [ORDER_NO]);
    await c.query(`DELETE FROM rework_tickets WHERE order_no=$1`, [ORDER_NO]);
    await c.query(`DELETE FROM report_audit_log WHERE report_id IN (SELECT id FROM reports WHERE order_no=$1)`, [ORDER_NO]);
    await c.query(`DELETE FROM reports WHERE order_no=$1`, [ORDER_NO]);
    await c.query(`DELETE FROM report_batches WHERE order_no=$1`, [ORDER_NO]);
    await c.query(`DELETE FROM record_data WHERE order_no=$1`, [ORDER_NO]);
    await c.query(`DELETE FROM work_orders WHERE order_no=$1`, [ORDER_NO]);
    await c.query('COMMIT');
    console.log(`[mock] 已清理模拟订单 ${ORDER_NO}`);
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}

/** 检测项目定义：项目名 + 用于匹配原始记录模板的关键字。 */
const PROJECTS = {
  density: { name: '密度', keyword: '密度' },
  flex: { name: '弯曲强度/模量', keyword: '弯曲' },
  light: { name: '透光率', keyword: '透光' },
} as const;
type ProjectKey = keyof typeof PROJECTS;

/** 订单结构：样品A 做密度+弯曲；样品B 做透光率。 */
const SAMPLES: { name: string; barcode: string; sortNo: string; model: string; projects: ProjectKey[] }[] = [
  { name: '样品A', barcode: `${ORDER_NO}-S1`, sortNo: '1#', model: 'PP-T20', projects: ['density', 'flex'] },
  { name: '样品B', barcode: `${ORDER_NO}-S2`, sortNo: '2#', model: 'EPDM-50', projects: ['light'] },
];

/** 按关键字找一个已审批的原始记录模板 id（用于预关联，方便你直接录入）。 */
async function resolveRecordTemplates(): Promise<Record<ProjectKey, number | null>> {
  const tpls: any[] = await get('/record-templates');
  const approved = tpls.filter((t) => t.current_status === 'approved');
  const find = (kw: string) => approved.find((t) => (t.name || '').includes(kw))?.id ?? null;
  return { density: find(PROJECTS.density.keyword), flex: find(PROJECTS.flex.keyword), light: find(PROJECTS.light.keyword) };
}

const HF = (sampleName: string) => ({
  CompanyName: '广电计量检测集团股份有限公司', CompanyNameEN: 'GRG METROLOGY & TEST GROUP CO., LTD.',
  CompanyAddress: '实验室地址：广东省广州市黄埔区科学城南翔二路31号',
  CompanyFax: '传真：+86-020-38698685 网址：http://www.grgtest.com', CompanyTel: '电话：4006020999',
  ReportRemark: '本报告结果仅对受测样品负责。', QualificationRemark: '注：本报告含 CMA / CNAS 资质标识（模拟）。',
  CheckCode: '900000', Language: '中文', SecondAuditeDate: '2026-06-14', SampleName: sampleName,
});

async function main() {
  const mode = argMode();
  if (process.argv.includes('--reset')) { await reset(); await pool.end(); return; }

  await reset(); // 干净重来

  const tplOf = await resolveRecordTemplates();
  for (const k of Object.keys(PROJECTS) as ProjectKey[]) {
    if (!tplOf[k]) console.warn(`[mock] 警告：未找到「${PROJECTS[k].keyword}」原始记录模板，该项目不会预关联，录入时请手动关联。`);
  }

  // ── 接口 1.1：推委托单 ──
  await post('/external/orders', {
    OrderNumber: ORDER_NO,
    CompanyName: '模拟客户（递归智能联调）', CompanyAddress: '广州市黄埔区科学城',
    SendDate: '2026-06-15T09:00:00', SaleName: '王树雪', JobNo: 'GDJL02859', Status: '正常',
    SampleList: SAMPLES.map((s) => ({
      SampleName: s.name, SampleSortNo: s.sortNo, BarCode: s.barcode, Model: s.model,
      TaskList: s.projects.map((p) => ({ ProjectName: PROJECTS[p].name, StandardNo: 'GB/T（模拟）', Leader: '穆阳阳' })),
    })),
  });
  console.log(`[mock] 接口 1.1：已推送委托单 ${ORDER_NO}（样品A=密度+弯曲强度/模量；样品B=透光率）`);

  // ── 预关联原始记录模板（不录数据）──
  let linked = 0;
  for (const s of SAMPLES) {
    for (const p of s.projects) {
      const tid = tplOf[p];
      if (!tid) continue;
      await put(`/work-orders/${encodeURIComponent(ORDER_NO)}/link`, { sample_id: s.barcode, test_name: PROJECTS[p].name, linked_template_id: tid, op: 'add' });
      linked++;
    }
  }
  console.log(`[mock] 已预关联 ${linked} 个 样品×项目 的原始记录模板（未录数据）`);

  // ── 接口 1.2：按拆分格式构造取号报告 ──
  const scopeSample = (s: typeof SAMPLES[number], ps: ProjectKey[]) =>
    ({ SampleName: s.name, SampleSortNo: s.sortNo, BarCode: s.barcode, Model: s.model, TaskList: ps.map((p) => ({ ProjectName: PROJECTS[p].name })) });

  const reportList: any[] = [];
  if (mode === 'whole') {
    const no = `${ORDER_NO}-ALL`;
    reportList.push({ SysNumber: no, ReportNumber: no, ...HF('整单'), SampleList: SAMPLES.map((s) => scopeSample(s, s.projects)) });
  } else if (mode === 'per-sample') {
    SAMPLES.forEach((s, i) => {
      const no = `${ORDER_NO}-S${i + 1}`;
      reportList.push({ SysNumber: no, ReportNumber: no, ...HF(s.name), SampleList: [scopeSample(s, s.projects)] });
    });
  } else { // per-sample-project
    SAMPLES.forEach((s, i) => s.projects.forEach((p, j) => {
      const no = `${ORDER_NO}-S${i + 1}-P${j + 1}`;
      reportList.push({ SysNumber: no, ReportNumber: no, ...HF(s.name), SampleList: [scopeSample(s, [p])] });
    }));
  }

  await post('/external/reports', { OrderNumber: ORDER_NO, ReportList: reportList });
  console.log(`[mock] 接口 1.2：已完成取号，推送 ${reportList.length} 份取号报告（格式：${mode}）`);

  console.log(`\n✅ 已推送委托单 + 完成取号（未录数据）。接下来：`);
  console.log(`   1) 录入：${WEB}/lab → 订单 ${ORDER_NO} → 逐个样品×项目录入数据 → 提交 → 审核通过`);
  console.log(`   2) 生成：${WEB}/report → 订单 ${ORDER_NO} → 工作台「取号报告」面板生成报告`);
  await pool.end();
}

main().catch((e) => { console.error('[mock] 失败：', e.message); pool.end(); process.exit(1); });
