/**
 * 报告页眉页脚元数据外部接口（mock 接缝）。
 *
 * 业务含义：每份报告的页眉/页脚要印一组"机构级元数据"——检验码、报告编号、签发日期、
 * 公司名称地址电话、资质备注等。这组数据由外部系统**按订单号生成并回传**，我们填进 PDF。
 *
 * demo：fetchReportMeta 返回示例数据，便于模板预览和全流程演示。
 * server：resolveReportMeta 只接受接口 1.2 PushReportInfos 已入库的数据，不调用本函数、也不回退示例。
 * 接口契约见根目录《待实现内容.md》第 6 节。
 */
import type { ReportMeta } from '../../../shared/types.js';
import { headerFooterConfig, integrationsProfile } from '../../../config/index.js';

/**
 * 正式环境没有接口数据时使用的空对象。
 *
 * 这里故意不提供任何机构名称、资质或报告备注默认值：server 模式下这些内容
 * 必须来自 PushReportInfos，缺失就保持为空，不能把演示证书号写进正式报告。
 */
function emptyReportMeta(): ReportMeta {
  return {
    verify_code: '',
    report_no: '',
    cover_report_no: '',
    issue_date: '',
    company_name: '',
    report_note: '',
    qualification_note: '',
    company_address: '',
    fax: '',
    phone: '',
    website: '',
  };
}

/**
 * 按订单号取报告页眉页脚元数据（取号前的【示例】）。
 * 公司名称/地址/电话/资质备注/签发日期等示例文本读 `config/header-footer.json` 的 sample_meta（可自行编辑）；
 * 报告编号/校验码示例仍按订单号派生（便于肉眼核对联动）。
 * 取号后由接口 1.2（ReportNumber/CheckCode）真实回填，不走本函数。
 */
export async function fetchReportMeta(order_no: string): Promise<ReportMeta> {
  const sm: Record<string, any> = headerFooterConfig.sample_meta || {};
  const suffix = order_no.slice(-4) || '0000';
  return {
    verify_code: `GDJL-${suffix}`,
    report_no: `WT${order_no}`,
    cover_report_no: `WT${order_no}-00`,
    issue_date: sm.issue_date ?? '2026-06-08',
    company_name: sm.company_name ?? '广电计量检测集团股份有限公司',
    report_note: sm.report_note ?? '本报告仅对来样负责。',
    qualification_note: sm.qualification_note ?? 'CMA  CNAS  资质认定证书编号 0000000000000',
    company_address: sm.company_address ?? '广东省广州市番禺区创运路8号',
    fax: sm.fax ?? '+86-020-38698685',
    phone: sm.phone ?? '4006020999',
    website: sm.website ?? 'http://www.grgtest.com',
    // ⚠️ 客户（委托单位）名称/地址【故意不给默认值】：这是【每报告】数据，只能由接口 1.2 取号推送
    // （buildReportMetaFromReq 从 CustomerName/CustomerAddress 映射）。接口没推就留空 → 报告里渲染成 '—'，
    // 绝不回退成"奇瑞汽车"那类示例值（乱填成错误委托方）。若首页要"始终有委托单位"，应绑「委托单字段 → 委托单位」(order.customer_name)。
  };
}

/**
 * 解析最终用于报告的接口元数据。
 * - server：完全使用接口 1.2 推送值；没有推送的字段保持空白。
 * - demo：无接口记录时用 header-footer.json 的 sample_meta 预览；有接口记录后完整采用接口值（包括空值）。
 */
export async function resolveReportMeta(
  order_no: string,
  pushedMeta?: ReportMeta | null,
): Promise<ReportMeta> {
  // Once interface 1.2 supplied a report record it is the complete source of truth, including
  // explicit empty strings. Falling back to demo remarks here made an empty ReportRemark /
  // QualificationRemark appear as unrelated sample text in the signature area.
  if (pushedMeta) return { ...emptyReportMeta(), ...pushedMeta };

  if (integrationsProfile === 'server') {
    return emptyReportMeta();
  }

  return fetchReportMeta(order_no);
}
