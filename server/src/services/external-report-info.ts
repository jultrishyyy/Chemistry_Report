/**
 * 报告取号信息（接口 1.2 PushReportInfos）解析 + 匹配引擎。
 *
 * 1.2 推送整单的 ReportList[]——每条 = 一份报告（取号结果），带报告编号 + 检验码 +
 * 页眉页脚全套 + 报告范围（SampleList/TaskList）。本模块：
 *   - parseReportInfos：把 PascalCase JSON 规范化为 report_requisitions 行（含 header_footer/scope）。
 *   - buildReportMetaFromReq：把一行 requisition 组装成 ReportMeta（按语种选中/英文，供页眉页脚）。
 *   - matchRequisitionScope：按【样品名 + 项目名】回查录入侧 record_data / 关联报告模板，
 *     算出每个"样品×项目"格子的匹配状态（matched / needs_record / unmatched）+ 候选 assignments。
 *
 * 关联锚点 = 样品名 + 项目名（接口 1.1 与 1.2 一致）。能对应则自动拉取、对应不上只标记不报错。
 * 见《待实现内容.md》第 6 节（6.0a–6.0e）。
 */
import pg from 'pg';
import { parseSampleList } from './external-orders.js';
import type { ReportMeta, ReportReqMatchEntry, ReportReqMatchAssignment } from '../../../shared/types.js';

const s = (v: any): string | undefined => {
  if (v === null || v === undefined) return undefined;
  const t = String(v).trim();
  return t === '' ? undefined : t;
};
/** 把 ISO8601（可能含 T 时分秒）截断为 YYYY-MM-DD；空值返回 undefined。接口 1.2/1.3 签发日期共用。 */
export const dateOnly = (v: any): string | undefined => {
  const str = s(v);
  if (!str) return undefined;
  const m = str.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : str;
};

/** 一行待 upsert 的取号单（接口 1.2 ReportList 的一条） */
export interface ParsedRequisition {
  order_no: string;
  sys_number: string;
  report_number: string;
  check_code?: string;
  language?: string;
  sample_name?: string;
  issue_date?: string;
  /** 页眉页脚稳定字段（公司/客户/备注/资质 + 中英文）；报告号/检验码/签发日期走列，不在这里 */
  header_footer: Partial<ReportMeta>;
  scope: { samples: any[] };
  warnings: string[];
}

/**
 * 解析接口 1.2 PushReportInfos JSON（{ OrderNumber, ReportList:[...] }）为多行 ParsedRequisition。
 */
export function parseReportInfos(raw: any): { requisitions: ParsedRequisition[]; warnings: string[] } {
  if (!raw || typeof raw !== 'object') throw new Error('报告数据为空或格式错误');
  const order_no = s(raw.OrderNumber);
  if (!order_no) throw new Error('OrderNumber（委托单号）不能为空');
  const list = Array.isArray(raw.ReportList) ? raw.ReportList : [];
  if (!list.length) throw new Error('ReportList 为空（没有报告取号信息）');

  const warnings: string[] = [];
  const requisitions: ParsedRequisition[] = list.map((r: any) => {
    const sys_number = s(r?.SysNumber) || s(r?.ReportNumber);
    if (!sys_number) throw new Error('SysNumber / ReportNumber 不能同时为空');
    const { samples, warnings: w } = parseSampleList(r?.SampleList);
    w.forEach((m) => warnings.push(`报告 ${sys_number}：${m}`));
    const header_footer: Partial<ReportMeta> = {
      language: s(r?.Language),
      company_name: s(r?.CompanyName),
      company_name_en: s(r?.CompanyNameEN),
      company_address: s(r?.CompanyAddress),
      company_address2: s(r?.CompanyAddress2),
      company_address_en: s(r?.CompanyAddressEN),
      company_address2_en: s(r?.CompanyAddress2EN),
      fax: s(r?.CompanyFax),
      fax_en: s(r?.CompanyFaxEN),
      phone: s(r?.CompanyTel),
      phone_en: s(r?.CompanyTelEN),
      report_note: s(r?.ReportRemark),
      report_note_en: s(r?.ReportRemarkEN),
      qualification_note: s(r?.QualificationRemark),
      qualification_note_en: s(r?.QualificationRemarkEN),
      customer_name: s(r?.CustomerName),
      customer_address: s(r?.CustomerAddress),
    };
    return {
      order_no,
      sys_number: sys_number!,
      report_number: s(r?.ReportNumber) || sys_number!,
      check_code: s(r?.CheckCode),
      language: s(r?.Language),
      sample_name: s(r?.SampleName),
      issue_date: dateOnly(r?.SecondAuditeDate),
      header_footer,
      scope: { samples },
    };
  });
  return { requisitions, warnings };
}

/** 该报告是否英文（按 Language 判定）。 */
function isEnglish(language?: string | null): boolean {
  const l = (language || '').toLowerCase();
  return l.includes('英') || l.includes('en');
}

/**
 * 把一行 requisition（DB 行或 ParsedRequisition）组装成 ReportMeta（供 buildReportTypst/页眉页脚）。
 * 报告号/检验码/签发日期来自列（可被 1.3 改号）；公司/客户/备注按语种选中/英文。
 */
export function buildReportMetaFromReq(req: {
  report_number: string; check_code?: string | null; issue_date?: string | null;
  language?: string | null; header_footer?: Partial<ReportMeta> | null;
}): ReportMeta {
  const hf = req.header_footer || {};
  const en = isEnglish(req.language);
  const pick = (zh?: string, env?: string) => (en ? (env || zh) : zh) || '';
  return {
    verify_code: req.check_code || '',
    report_no: req.report_number,
    cover_report_no: req.report_number,
    issue_date: req.issue_date || '',
    company_name: pick(hf.company_name, hf.company_name_en),
    company_address: pick(hf.company_address, hf.company_address_en),
    fax: pick(hf.fax, hf.fax_en),
    phone: pick(hf.phone, hf.phone_en),
    report_note: pick(hf.report_note, hf.report_note_en),
    qualification_note: pick(hf.qualification_note, hf.qualification_note_en),
    website: hf.website,         // 1.2 的网址通常已并入 fax 文本；缺省不单独渲染
    // 保留全量字段（中英文 + 客户），便于实例编辑器/留痕
    language: req.language || undefined,
    company_name_en: hf.company_name_en,
    company_address2: hf.company_address2,
    company_address_en: hf.company_address_en,
    company_address2_en: hf.company_address2_en,
    fax_en: hf.fax_en,
    phone_en: hf.phone_en,
    report_note_en: hf.report_note_en,
    qualification_note_en: hf.qualification_note_en,
    customer_name: hf.customer_name,
    customer_address: hf.customer_address,
  };
}

/**
 * 匹配引擎：把报告范围 scope（样品×项目）回查录入侧 record_data / 关联报告模板。
 *
 * 对每个"样品×项目"格子：
 *   - 样品名 → 委托单 work_orders.payload.samples（取 sample_external_id）；找不到 → unmatched。
 *   - 项目名 → 该样品的 record_data（sample_external_id + test_item_name）；优先 reviewed。
 *       有 record_data → matched（每条 record_data 一个 assignment，含反查的项目报告模板）；
 *       无 record_data 但样品/项目在单内 → needs_record；
 *       项目名在单内 test_infos 都找不到 → unmatched。
 *   - 项目报告模板：report_templates(kind=project) 中 linked_record_template_id === record_data.template_id。
 */
export async function matchRequisitionScope(
  pool: pg.Pool, order_no: string, scope: { samples: any[] } | null | undefined,
  savedSelections: Array<{
    scope_key?: string;
    record_data_id?: number;
    project_template_id?: number;
    project_template_version_id?: number | null;
  }> = [],
): Promise<ReportReqMatchEntry[]> {
  const samples = Array.isArray(scope?.samples) ? scope!.samples : [];
  if (!samples.length) return [];

  // 委托单样品：名 → {id, test_infos}
  const wo = await pool.query('SELECT payload FROM work_orders WHERE order_no = $1', [order_no]);
  const orderSamples: any[] = Array.isArray(wo.rows[0]?.payload?.samples) ? wo.rows[0].payload.samples : [];
  const orderSampleByName = new Map<string, any>();
  for (const os of orderSamples) if (os?.name) orderSampleByName.set(os.name, os);
  const orderSampleById = new Map<string, any>();
  for (const os of orderSamples) if (os?.id != null) orderSampleById.set(String(os.id), os);

  // 录入数据：按 (sample_external_id, test_item_name) 分桶
  const rd = await pool.query(
    'SELECT rd.id, rd.template_id, rd.sample_external_id, rd.test_item_name, rd.audit_status, rt.name AS record_template_name FROM record_data rd LEFT JOIN record_templates rt ON rt.id=rd.template_id WHERE rd.order_no = $1 AND rd.cancelled_at IS NULL',
    [order_no],
  );
  const recByKey = new Map<string, any[]>();
  for (const r of rd.rows) {
    const k = `${r.sample_external_id}||${r.test_item_name}`;
    (recByKey.get(k) || recByKey.set(k, []).get(k)!).push(r);
  }

  // 项目报告模板：record_template_id → 全部候选。
  // 只取【当前生效版本已审核通过】的项目模板——未审核通过的不参与匹配，不会被自动用于生成
  // （否则会生成出结构不完整/无法编辑的报告）。
  const pt = await pool.query(
    `SELECT t.id, t.name, t.linked_record_template_id,
            CASE WHEN pf.id IS NOT NULL THEN pf.host_manufacturer_id ELSE t.host_manufacturer_id END AS host_manufacturer_id,t.updated_at,
            cv.id AS version_id, cv.version_no, cv.layout_options
       FROM report_templates t
     LEFT JOIN report_project_template_families pf ON pf.id=t.report_project_family_id
     JOIN report_template_versions cv ON cv.id = t.current_version_id AND cv.status = 'approved'
     WHERE t.template_kind = 'project' AND t.archived_at IS NULL AND t.linked_record_template_id IS NOT NULL
     ORDER BY t.name, t.id`,
  );
  const projByRecTpl = new Map<number, any[]>();
  for (const row of pt.rows) {
    const list = projByRecTpl.get(row.linked_record_template_id) || [];
    list.push({
      id: row.id,
      name: row.name,
      version_id: row.version_id,
      version_no: row.version_no,
      project_name: row.layout_options?.project_name || null,
      host_manufacturer_id: row.host_manufacturer_id || null,
      updated_at: row.updated_at || null,
    });
    projByRecTpl.set(row.linked_record_template_id, list);
  }
  const savedByKey = new Map(savedSelections.map(x => [
    `${x.scope_key || ''}::${Number(x.record_data_id)}`,
    x,
  ]));
  // 取号接口的默认范围可以在后续被扩展为整单范围；扩展后 scope_key 的序号可能变化。
  // 同一原始记录的已选项目模板仍应被带回，避免用户重新选择。
  const savedByRecordId = new Map(savedSelections
    .filter(x => Number.isFinite(Number(x.record_data_id)))
    .map(x => [Number(x.record_data_id), x]));

  const out: ReportReqMatchEntry[] = [];
  for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex++) {
    const smp = samples[sampleIndex];
    const sampleName = smp?.name || '';
    // 名称可能重复或后续被修改；整单候选优先按稳定的外部样品 ID 关联。
    const sampleIdFromScope = smp?.id ?? smp?.sample_external_id;
    const orderSample = sampleIdFromScope != null
      ? orderSampleById.get(String(sampleIdFromScope)) || orderSampleByName.get(sampleName)
      : orderSampleByName.get(sampleName);
    const tests = smp?.test_infos || [];
    for (let testIndex = 0; testIndex < tests.length; testIndex++) {
      const t = tests[testIndex];
      const projectName = t?.name || '';
      const scopeKey = `s${sampleIndex + 1}:t${testIndex + 1}`;
      if (!orderSample) {
        out.push({ scope_key: scopeKey, sample_name: sampleName, project_name: projectName, sample_external_id: null, status: 'unmatched', note: '委托单中找不到该样品（可能已删除/改名）', assignments: [] });
        continue;
      }
      const sampleId = orderSample.id;
      const inOrder = (orderSample.test_infos || []).some((ot: any) => ot?.name === projectName);
      const recs = recByKey.get(`${sampleId}||${projectName}`) || [];
      if (!recs.length) {
        out.push({
          scope_key: scopeKey,
          sample_name: sampleName, project_name: projectName, sample_external_id: sampleId,
          status: inOrder ? 'needs_record' : 'unmatched',
          note: inOrder ? '该项目尚无录入数据' : '委托单该样品下找不到此项目（可能已删除/改名）',
          assignments: [],
        });
        continue;
      }
      // 有 record_data：优先 reviewed 排前
      const orderTest = (orderSample.test_infos || []).find((test: any) => test.name === projectName);
      const methodIds = orderTest?.linked_template_ids || (orderTest?.linked_template_id ? [orderTest.linked_template_id] : []);
      const methodOrder = (id: number) => { const index = methodIds.map(Number).indexOf(Number(id)); return index < 0 ? methodIds.length + Number(id) : index; };
      recs.sort((a, b) => {
        const methodDifference = methodOrder(a.template_id) - methodOrder(b.template_id);
        if (methodDifference) return methodDifference;
        const reviewedOrder = Number(b.audit_status === 'reviewed') - Number(a.audit_status === 'reviewed');
        return reviewedOrder || Number(b.id) - Number(a.id);
      });
      const assignments: ReportReqMatchAssignment[] = recs.map((r) => {
        const candidates = projByRecTpl.get(r.template_id) || [];
        const saved = savedByKey.get(`${scopeKey}::${Number(r.id)}`)
          || savedByRecordId.get(Number(r.id));
        // 匹配保留有效的人工选择；未选择时由生成流程按首页主机厂和候选顺序决定默认模板。
        const selected = saved
          ? candidates.find(c => Number(c.id) === Number(saved.project_template_id))
          : undefined;
        return {
          record_data_id: r.id,
          record_data_status: r.audit_status,
          record_template_id: r.template_id,
          record_template_name: r.record_template_name,
          project_template_id: selected?.id ?? null,
          project_template_version_id: selected?.version_id ?? null,
          project_template_candidates: candidates,
        };
      });
      const anyReviewed = recs.some((r) => r.audit_status === 'reviewed');
      const reviewedAssignments = assignments.filter(a => a.record_data_status === 'reviewed');
      const anyCandidates = reviewedAssignments.some(a => (a.project_template_candidates?.length || 0) > 0);
      const needsChoice = reviewedAssignments.some(a =>
        (a.project_template_candidates?.length || 0) > 0 && a.project_template_id == null);
      out.push({
        scope_key: scopeKey,
        sample_name: sampleName, project_name: projectName, sample_external_id: sampleId,
        status: 'matched',
        note: !anyReviewed ? '已找到录入数据，但尚未审核通过'
          : !anyCandidates ? '项目报告模板未审核通过或未配置，暂不能生成'
          : needsChoice ? '生成时自动使用默认项目模板，也可展开改选'
          : undefined,
        assignments,
      });
    }
  }
  return out;
}
