/**
 * 演示触发：模拟递归智能【推送】两个入站接口，灌入一套可端到端 review 的数据。
 *
 * 用法：
 *   pnpm tsx scripts/demo-recursive-push.ts          # 灌入演示数据（可重复运行，先清后建）
 *   pnpm tsx scripts/demo-recursive-push.ts --reset  # 只清理演示数据
 *
 * 做了什么（对齐《递归智能接口文档》1.1 / 1.2）：
 *   1) 接口 1.1 PushOrderInfos：POST /api/external/orders 建演示委托单 DEMO-DG-001
 *      （2 个样品 / 各 1 个测试项目；含订单级 meta + 分单字段，可在报告映射里绑定）。
 *   2) 模拟"录入已完成并审核"：克隆一条 透光率 原始记录（template 15·当前版本）到
 *      演示订单的样品1·透光，审核态 reviewed —— 让取号报告 1 立即 matched 可生成。
 *      （样品2·气味性 故意不录入，演示 needs_record；另造一个对不上的报告，演示 unmatched）
 *   3) 接口 1.2 PushReportInfos：POST /api/external/reports 推 3 份取号报告，
 *      覆盖 matched / needs_record / unmatched 三种匹配状态。
 *
 * 依赖：后端已在 :3001 运行（pnpm dev）。真实接口对接后本脚本即可弃用。
 */
import pg from 'pg';
import { dbConfig } from '../config/index.js';

const { Pool } = pg;
const pool = new Pool({
  host: dbConfig.host,
  port: Number(dbConfig.port),
  database: dbConfig.database,
  user: dbConfig.user,
  password: dbConfig.password || undefined,
});

const API = process.env.DEMO_API || 'http://localhost:3001/api';
const ORDER_NO = 'DEMO-DG-001';
const S1_BARCODE = 'DEMO-DG-001-S1';   // 样品1 条码（= sample_external_id）
const S2_BARCODE = 'DEMO-DG-001-S2';   // 样品2 条码

async function post(path: string, body: any) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Demo-User': encodeURIComponent('文员小李') }, body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: any; try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  return data;
}
async function get(path: string) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

/** 清理演示数据（按外键依赖顺序）。 */
async function reset() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`DELETE FROM report_requisitions WHERE order_no=$1`, [ORDER_NO]);
    await c.query(`DELETE FROM rework_tickets WHERE order_no=$1`, [ORDER_NO]);  // FK report_id→reports，须先删
    await c.query(`DELETE FROM report_audit_log WHERE report_id IN (SELECT id FROM reports WHERE order_no=$1)`, [ORDER_NO]);
    await c.query(`DELETE FROM reports WHERE order_no=$1`, [ORDER_NO]);
    await c.query(`DELETE FROM report_batches WHERE order_no=$1`, [ORDER_NO]);
    await c.query(`DELETE FROM record_data WHERE order_no=$1`, [ORDER_NO]);
    await c.query(`DELETE FROM work_orders WHERE order_no=$1`, [ORDER_NO]);
    await c.query('COMMIT');
    console.log(`[demo] 已清理演示数据 ${ORDER_NO}`);
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}

/** 克隆一条 透光率 原始记录到演示订单样品1·透光，审核态 reviewed（模拟录入+审核完成）。 */
async function seedReviewedRecord() {
  const src = await pool.query(
    `SELECT raw_data, derived_data, template_id, template_version, template_version_id
       FROM record_data
      WHERE template_id=15 AND template_version_id=(SELECT current_version_id FROM record_templates WHERE id=15)
      ORDER BY id LIMIT 1`,
  );
  const fallback = src.rows.length ? src.rows[0]
    : (await pool.query(`SELECT raw_data, derived_data, template_id, template_version, template_version_id FROM record_data WHERE template_id=15 ORDER BY id LIMIT 1`)).rows[0];
  if (!fallback) { console.warn('[demo] 未找到可克隆的 template 15 记录，跳过录入模拟（取号报告 1 将显示 needs_record）'); return; }

  await pool.query(
    `INSERT INTO record_data
       (template_id, template_version, raw_data, derived_data, order_no, sample_external_id, test_item_name,
        tester_name, tested_at, reviewer_name, reviewed_at, audit_status, current_version, template_version_id, submitted_at)
     VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7,$8,NOW(),$9,NOW(),'reviewed',1,$10,NOW())`,
    [fallback.template_id, fallback.template_version, JSON.stringify(fallback.raw_data || {}), JSON.stringify(fallback.derived_data || {}),
     ORDER_NO, S1_BARCODE, '透光', '张工', '王主管', fallback.template_version_id],
  );
  console.log('[demo] 已模拟样品1·透光 的已审原始记录（reviewed）');
}

/** P-Flow-2：生成+回传报告1，再模拟外部回执 needs_revision，制造一条"外部返工"待文员处理。 */
async function simulateFeedback() {
  const reqs: any[] = await get(`/external/requisitions?order_no=${ORDER_NO}`);
  const r1 = reqs.find((r: any) => r.report_number === `${ORDER_NO}-1`);
  if (!r1) { console.warn('[demo] 未找到取号报告 1，跳过外部回执'); return; }
  const m = (r1.match_result || [])[0];
  if (!m || m.status !== 'matched' || !m.assignments?.length) { console.warn('[demo] 取号报告 1 未匹配到记录，跳过'); return; }

  let reportId = r1.report_id;
  if (!reportId) {
    const covers: any[] = await get('/report-templates?kind=cover');
    const coverId = covers[0]?.id;
    const a = m.assignments[0];
    const gen = await post('/external/requisitions/generate', {
      order_no: ORDER_NO, cover_template_id: coverId,
      items: [{ requisition_id: r1.id, assignments: [{ record_data_id: a.record_data_id, project_template_id: a.project_template_id }] }],
    });
    reportId = gen.reports?.[0]?.report_id;
    console.log('[demo] 已生成报告 1（report_id', reportId, '，compiled', gen.reports?.[0]?.compiled, '）');
  }
  await post(`/external/requisitions/${r1.id}/deliver`, {});
  console.log('[demo] 已回传报告 1（接口 1.4）');
  const fb = await post('/external/report-feedback', {
    order_no: ORDER_NO, report_no: `${ORDER_NO}-1`, decision: 'needs_revision',
    suggestions: [{ field: '结论', text: '请核对透光率判定依据，结论表述需与标准一致' }],
    external_ref: 'EXT-FB-0001',
  });
  console.log('[demo] 已模拟外部回执 needs_revision → 生成外部返工工单 #', fb.ticket?.id);
}

async function main() {
  if (process.argv.includes('--reset')) { await reset(); await pool.end(); return; }

  await reset(); // 干净重来

  // ── 接口 1.1 PushOrderInfos ──
  await post('/external/orders', {
    OrderNumber: ORDER_NO,
    CompanyName: '演示客户（递归智能联调）',
    CompanyAddress: '广州市黄埔区科学城',
    SendDate: '2026-06-15T09:00:00',
    SaleName: '王树雪', JobNo: 'GDJL02859', Buyer: '演示买家', Status: '正常',
    SampleList: [
      { SampleName: '透光样品', SampleSortNo: '0#', BarCode: S1_BARCODE, TaskList: [
        { ProjectName: '透光', StandardNo: 'GB/T 2410', TestMothed: '透光率雾度法', TestCondition: '常温', Leader: '穆阳阳', SampleDescription: '透明板材' },
      ] },
      { SampleName: '气味样品', SampleSortNo: '1#', BarCode: S2_BARCODE, TaskList: [
        { ProjectName: '气味性', StandardNo: 'PV 3900', Leader: '穆阳阳' },
      ] },
    ],
  });
  console.log('[demo] 接口 1.1：已推送委托单', ORDER_NO);

  // ── 模拟录入完成（让取号报告 1 立即 matched）──
  await seedReviewedRecord();

  // ── 接口 1.2 PushReportInfos（3 份，覆盖三种匹配状态）──
  const hf = (n: string) => ({
    CompanyName: '广电计量检测集团股份有限公司', CompanyNameEN: 'GRG METROLOGY & TEST GROUP CO., LTD.',
    CompanyAddress: '实验室地址：广东省广州市黄埔区科学城南翔二路31号',
    CompanyFax: '传真：+86-020-38698685 网址：http://www.grgtest.com', CompanyTel: '电话：4006020999',
    ReportRemark: '本报告结果仅对受测样品负责。', QualificationRemark: '注：CMA / CNAS 资质。',
    SampleName: n,
  });
  await post('/external/reports', {
    OrderNumber: ORDER_NO,
    ReportList: [
      // matched：样品1·透光 已有 reviewed 记录 → 自动拉取，可直接生成
      { SysNumber: `${ORDER_NO}-1`, ReportNumber: `${ORDER_NO}-1`, CheckCode: '900001', Language: '中文', SecondAuditeDate: '2026-06-14',
        ...hf('透光样品'), SampleList: [{ SampleName: '透光样品', BarCode: S1_BARCODE, TaskList: [{ ProjectName: '透光' }] }] },
      // needs_record：样品2·气味性 在单内但未录入 → 标记待录入/选取
      { SysNumber: `${ORDER_NO}-2`, ReportNumber: `${ORDER_NO}-2`, CheckCode: '900002', Language: '中文',
        ...hf('气味样品'), SampleList: [{ SampleName: '气味样品', BarCode: S2_BARCODE, TaskList: [{ ProjectName: '气味性' }] }] },
      // unmatched：报告范围里的样品/项目在委托单里找不到（模拟删样品/改名）→ 文员手选
      { SysNumber: `${ORDER_NO}-3`, ReportNumber: `${ORDER_NO}-3`, CheckCode: '900003', Language: '中文',
        ...hf('已撤样品'), SampleList: [{ SampleName: '已撤样品', TaskList: [{ ProjectName: '老化试验' }] }] },
    ],
  });
  console.log('[demo] 接口 1.2：已推送 3 份取号报告（matched / needs_record / unmatched）');

  if (process.argv.includes('--feedback')) {
    await simulateFeedback();
    console.log('\n✅ 已附加 P-Flow-2 演示：报告 1 已生成+回传，并收到外部"需修改"回执（工作台「外部返工」面板可见）。');
  } else {
    console.log('\n✅ 演示数据已就绪。打开前端 /report，进入委托单', ORDER_NO, '的工作台「取号报告」面板查看。');
    console.log('   （加 --feedback 可顺带演示外部回执触发的退回闭环）');
  }
  await pool.end();
}

main().catch((e) => { console.error('[demo] 失败：', e.message); process.exit(1); });
