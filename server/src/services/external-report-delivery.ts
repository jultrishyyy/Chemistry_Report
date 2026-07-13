/**
 * 报告回传外部系统（接口 1.4）—— 出站 SOAP 客户端。
 *
 * 业务含义：本系统（报告系统）生成报告 PDF 后，作为 **SOAP 客户端** 调用业务系统（WCF）的
 * 报告回传方法回传 PDF。
 *
 * ⚠️ 方法/参数以业务系统 **WSDL 为准**（http://172.18.0.97:8003/lab/chemistry）：
 *   信封传入 **三个**字符串参数 = `sysNumber`（报告 SysNumber）+ `file`（PDF 标准 Base64，无前缀/换行）
 *   + `jobNo`（委托单业务员工号 JobNo）。**少 jobNo 业务系统会拒收**（之前只传两参 → 对方收不到）。
 *   SOAPAction = `http://tempuri.org/IChemistryService/PushReportFile`，SOAP 1.1。
 *   方法名 / 三个参数标签名 / namespace / action 全可配，以对方 WSDL 为准，改 config 不改码。
 *
 * 协议：SOAP over HTTP(S)。默认 SOAP 1.1（text/xml + SOAPAction），可配 1.2（application/soap+xml）。
 * 配置在 config/report-delivery.json + report-delivery.local.json + DELIVERY_* 环境变量：
 *   soap_endpoint     业务系统 SOAP 端点 URL（**空＝mock，不真发只返回成功** → 对方收不到，生产必须配成
 *                     http://172.18.0.97:8003/lab/chemistry）
 *   method            方法名（默认 PushReportFile）
 *   param_id_name / param_file_name / param_jobno_name  三个入参标签名（默认 sysNumber / file / jobNo）
 *   target_namespace  方法所在命名空间（以业务系统 WSDL 为准；.NET 常见 http://tempuri.org/）
 *   soap_action       SOAPAction（空则取 {namespace 去尾斜杠}/Method）
 *   soap_version      '1.1'（默认）| '1.2'
 *   timeout_ms        超时（PDF 较大，默认 30s）
 *
 * 调用方 routes/external.ts 的 POST /requisitions/:id/deliver：submitReportToDiGui(sysNumber, base64, jobNo)。
 */
import { deliveryConfig } from '../../../config/index.js';

export interface DeliverResult {
  ok: boolean;
  /** 外部回执（SOAP 返回的字符串 / 其中的 ref，用于追溯） */
  ref?: string;
  error?: string;
}

/** SOAP 方法名（业务系统 WSDL：回传报告文件 = PushReportFile）。可配。 */
const METHOD = String(deliveryConfig.method || 'PushReportFile');
/** 三个字符串入参的标签名（业务系统 WSDL：sysNumber + file + jobNo）。可配，适配不同服务命名。 */
const PARAM_ID = String(deliveryConfig.param_id_name || 'sysNumber');
const PARAM_FILE = String(deliveryConfig.param_file_name || 'file');
/** 业务员工号（委托单 JobNo）的标签名——业务系统据此对账/归档，缺它会拒收。 */
const PARAM_JOBNO = String(deliveryConfig.param_jobno_name || 'jobNo');
/** 端点：优先 report-delivery 配置；兼容旧环境变量 DIGUI_ACCEPT_REPORT_URL。空＝mock。 */
const ENDPOINT = String(deliveryConfig.soap_endpoint || process.env.DIGUI_ACCEPT_REPORT_URL || '');
const NAMESPACE = String(deliveryConfig.target_namespace || 'http://tempuri.org/');
const SOAP_VERSION = String(deliveryConfig.soap_version || '1.1');
const TIMEOUT_MS = Number(deliveryConfig.timeout_ms || 30000);
/** SOAPAction：配了用配的，否则 {namespace 去尾斜杠}/Method（注意 WCF 实为 {ns}/I{Service}/{Method}，须显式配）。 */
const SOAP_ACTION = String(deliveryConfig.soap_action || `${NAMESPACE.replace(/\/+$/, '')}/${METHOD}`);

function xmlEscape(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function xmlUnescape(v: string): string {
  return v.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
/** 取某标签内文本（忽略命名空间前缀）。 */
function pickTag(xml: string, tag: string): string | undefined {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${tag}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, 'i'));
  return m ? m[1] : undefined;
}

/** 构造 SOAP 信封。三个字符串入参：{PARAM_ID}=报告 SysNumber、{PARAM_FILE}=PDF Base64、{PARAM_JOBNO}=业务员工号。 */
function buildEnvelope(sysNumber: string, pdfBase64: string, jobNo: string): string {
  const body =
    `<${METHOD} xmlns="${NAMESPACE}">` +
    `<${PARAM_ID}>${xmlEscape(sysNumber)}</${PARAM_ID}>` +
    `<${PARAM_FILE}>${pdfBase64}</${PARAM_FILE}>` +
    `<${PARAM_JOBNO}>${xmlEscape(jobNo)}</${PARAM_JOBNO}>` +
    `</${METHOD}>`;
  if (SOAP_VERSION === '1.2') {
    return `<?xml version="1.0" encoding="utf-8"?>` +
      `<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
      `<soap12:Body>${body}</soap12:Body></soap12:Envelope>`;
  }
  return `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<soap:Body>${body}</soap:Body></soap:Envelope>`;
}

/**
 * 把一份报告 PDF 回传业务系统（接口 1.4，SOAP）。
 * @param sysNumber  报告取号单的系统编号 SysNumber
 * @param pdfBase64  报告 PDF 的 Base64 字符串（SOAP file 参数）
 * @param jobNo      委托单业务员工号 JobNo（SOAP jobNo 参数）；缺它业务系统会拒收
 */
export async function submitReportToDiGui(sysNumber: string, pdfBase64: string, jobNo = ''): Promise<DeliverResult> {
  if (!sysNumber) return { ok: false, error: 'SysNumber 为空' };
  if (!pdfBase64) return { ok: false, error: '报告文件为空' };
  if (!jobNo) console.warn(`[external-delivery] ⚠️ SysNumber=${sysNumber} 的 jobNo 为空——业务系统可能拒收（检查委托单业务员工号 JobNo）`);

  // ── mock：未配置 SOAP 端点时只校验并返回成功（便于全流程演示/联调）──
  if (!ENDPOINT) {
    console.log(`[external-delivery] (mock) 回传报告 SysNumber=${sysNumber} jobNo=${jobNo || '(空)'}，PDF ${pdfBase64.length} 字节(base64)`);
    return { ok: true, ref: `MOCK-${sysNumber}` };
  }

  // ── 真实接入：SOAP over HTTP ──
  const envelope = buildEnvelope(sysNumber, pdfBase64, jobNo);
  const headers: Record<string, string> =
    SOAP_VERSION === '1.2'
      ? { 'Content-Type': `application/soap+xml; charset=utf-8; action="${SOAP_ACTION}"` }
      : { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${SOAP_ACTION}"` };

  try {
    const resp = await fetch(ENDPOINT, {
      method: 'POST', headers, body: envelope, signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await resp.text();
    // SOAP Fault（1.1 faultstring / 1.2 Reason>Text）→ 失败
    const fault = pickTag(text, 'faultstring') || pickTag(text, 'Text');
    if (fault) return { ok: false, error: `SOAP Fault: ${xmlUnescape(fault.trim())}` };
    if (!resp.ok) return { ok: false, error: `业务系统返回 HTTP ${resp.status}${text ? `：${text.slice(0, 200)}` : ''}` };
    // 取方法返回值 AcceptReportFromDiGuiResult（string）作为回执
    const resultRaw = pickTag(text, `${METHOD}Result`);
    const result = resultRaw != null ? xmlUnescape(resultRaw.trim()) : '';
    let ref: string | undefined = result || undefined;
    try { const j = JSON.parse(result); if (j && (j.ref || j.Ref)) ref = j.ref || j.Ref; } catch { /* 非 JSON，原样作回执 */ }
    return { ok: true, ref };
  } catch (e: any) {
    const isTimeout = e?.name === 'TimeoutError' || /aborted|timeout/i.test(String(e?.message));
    console.error('[external-delivery] 回传失败:', e?.message || e);
    return { ok: false, error: isTimeout ? '回传业务系统超时' : `无法连接业务系统 SOAP 端点（${e?.message || e}）` };
  }
}
