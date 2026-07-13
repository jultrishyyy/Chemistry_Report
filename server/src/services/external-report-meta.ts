/**
 * 报告页眉页脚元数据外部接口（mock 接缝）。
 *
 * 业务含义：每份报告的页眉/页脚要印一组"机构级元数据"——检验码、报告编号、签发日期、
 * 公司名称地址电话、资质备注等。这组数据由外部系统**按订单号生成并回传**，我们填进 PDF。
 *
 * 当前：返回写死的一组 mock（与 external-orders.ts 同套路，便于全流程测试）。
 * 真实接入：把 fetchReportMeta 函数体换成对外部系统的 HTTP 调用（请求 order_no，拿回 ReportMeta），
 * 其余（reports.ts 注入 + 主题渲染 + content_doc 快照）完全不动。
 * 接口契约见根目录《待实现内容.md》第 6 节。
 */
import type { ReportMeta } from '../../../shared/types.js';
import { headerFooterConfig } from '../../../config/index.js';

/**
 * 按订单号取报告页眉页脚元数据（取号前的【示例】）。
 * 公司名称/地址/电话/资质备注/签发日期等示例文本读 `config/header-footer.json` 的 sample_meta（可自行编辑）；
 * 报告编号/校验码示例仍按订单号派生（便于肉眼核对联动）。
 * 取号后由接口 1.2（ReportNumber/CheckCode）真实回填，不走本函数——真实接入只需替换函数体。
 */
export async function fetchReportMeta(order_no: string): Promise<ReportMeta> {
  const sm: Record<string, any> = headerFooterConfig.sample_meta || {};
  const suffix = order_no.slice(-4) || '0000';
  return {
    verify_code: `GDJL-${suffix}`,
    report_no: `WT${order_no}`,
    cover_report_no: `WT${order_no}-00`,
    issue_date: sm.issue_date ?? '2026-06-08',
    company_name: sm.company_name ?? '广电计量检测（集团）股份有限公司 化学检测中心',
    report_note: sm.report_note ?? '本报告仅对来样负责。',
    qualification_note: sm.qualification_note ?? 'CMA  CNAS  资质认定证书编号 0000000000000',
    company_address: sm.company_address ?? '广州市黄埔区开创大道无线电大厦',
    fax: sm.fax ?? '020-00000000',
    phone: sm.phone ?? '020-12345678',
    website: sm.website ?? 'www.grgtest.com',
    // ⚠️ 客户（委托单位）名称/地址【故意不给默认值】：这是【每报告】数据，只能由接口 1.2 取号推送
    // （buildReportMetaFromReq 从 CustomerName/CustomerAddress 映射）。接口没推就留空 → 报告里渲染成 '—'，
    // 绝不回退成"奇瑞汽车"那类示例值（乱填成错误委托方）。若首页要"始终有委托单位"，应绑「委托单字段 → 委托单位」(order.customer_name)。
  };
}
