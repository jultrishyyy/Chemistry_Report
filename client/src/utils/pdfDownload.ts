/**
 * 列表行「下载 PDF」复用工具：把某个条目渲染成 PDF 并触发下载。
 *  - 原始记录模板：mock 数据预览（generateTypst + generateMockData）。
 *  - 录入记录（填好数据的原始记录）：按锁定版本 + raw/derived 数据渲染（同 ReadonlyRecordViewer）。
 *  - 报告模板：mock 上下文预览（injectReportFieldsIntoTypst）。
 *  - 生成的报告：直接取服务端已编译 PDF（GET /api/reports/:id/pdf）。
 * 编译走 TypstViewer 同一个 compileTypst（blob URL）。
 */
import axios from 'axios';
import { compileTypst } from '../components/TypstViewer/typst-compiler';
import {
  generateTypst, generateTypstWithData, injectReportFieldsIntoTypst, type ReportRenderCtx,
} from '../../../shared/typst-generator';
import { collectDeviceCodes, fetchDeviceMap } from './deviceMap';
import { generateMockData } from '../../../shared/mock-data';
import { createEmptyMatrixValue } from '../../../shared/matrix-flatten';
import type { RecordTemplate } from '../../../shared/types';

const API = '/api';

function triggerDownload(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Allow the browser to begin the download before releasing its private URL.
  if (url.startsWith('blob:')) window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const safe = (s: string) => (s || 'document').replace(/[\\/:*?"<>|]/g, '-');

/** 通用：把 typst 源编译成 PDF 并下载 */
export async function downloadCompiledPdf(source: string, filename: string) {
  const url = await compileTypst(source);
  triggerDownload(url, `${safe(filename)}.pdf`);
}

function ensureDataMatrixDefaults(template: RecordTemplate, d: Record<string, any>): Record<string, any> {
  const next = { ...d };
  for (const f of template.groups.flatMap(g => g.fields)) {
    if (f.type !== 'data_matrix' || !f.matrix) continue;
    if (!next[f.code] || typeof next[f.code] !== 'object' || !Array.isArray((next[f.code] as any).sample_ids)) {
      next[f.code] = createEmptyMatrixValue(f.matrix);
    }
  }
  return next;
}
function injectAuditFields(tmpl: RecordTemplate, base: Record<string, any>, row: any): Record<string, any> {
  const out = { ...base };
  for (const f of tmpl.groups.flatMap(g => g.fields)) {
    if (!f.semantic_role) continue;
    if (f.semantic_role === 'inspector') out[f.code] = row?.tester_name || '';
    else if (f.semantic_role === 'inspector_date') out[f.code] = row?.tested_at || '';
    else if (f.semantic_role === 'reviewer') out[f.code] = row?.reviewer_name || '';
    else if (f.semantic_role === 'reviewer_date') out[f.code] = row?.reviewed_at || '';
  }
  return out;
}

/** 默认读取当前生效版本；显式 versionId 可读取任意版本（仅用于只读 PDF 预览）。 */
async function resolveTemplateContent(
  base: any,
  apiBase: string,
  versionId?: number | string,
  allowWorkVersionFallback = false,
) {
  if (versionId != null) {
    const historical = (await axios.get(`${apiBase}/${base.id}/versions/${versionId}`)).data;
    if (!Array.isArray(historical.field_definitions)) throw new Error('该历史版本没有可预览的字段内容');
    return {
      groups: historical.field_definitions,
      layoutOptions: historical.layout_options || {},
      version: historical.version_no ?? base.version ?? 1,
    };
  }
  if (!Array.isArray(base.field_definitions) || base.current_version_id == null) {
    if (allowWorkVersionFallback) {
      const versions = ((await axios.get(`${apiBase}/${base.id}/versions`)).data || [])
        .sort((a: any, b: any) => Number(b.version_no) - Number(a.version_no));
      const work = versions.find((v: any) =>
        v.status === 'draft' || v.status === 'pending' || v.status === 'rejected') || versions[0];
      if (work) return resolveTemplateContent(base, apiBase, work.id, false);
    }
    throw new Error('该模板尚无已生效版本，暂时无法预览');
  }
  return {
    groups: base.field_definitions,
    layoutOptions: base.layout_options || {},
    version: base.current_version_no ?? base.version ?? 1,
  };
}

/** 原始记录模板预览 PDF blob URL（关闭预览时由调用方释放）。 */
export async function getRecordTemplatePreviewPdf(templateId: number | string, versionId?: number | string) {
  const base = (await axios.get(`${API}/record-templates/${templateId}`)).data;
  const resolved = await resolveTemplateContent(base, `${API}/record-templates`, versionId, true);
  const tmpl: RecordTemplate = {
    id: base.id, name: base.name, version: resolved.version,
    groups: resolved.groups, layout_options: resolved.layoutOptions,
  };
  return compileTypst(generateTypstWithData(tmpl, generateMockData(tmpl)));
}

/** 原始记录模板：mock 数据预览 PDF */
export async function downloadRecordTemplatePdf(templateId: number | string, filename: string) {
  triggerDownload(await getRecordTemplatePreviewPdf(templateId), `${safe(filename)}.pdf`);
}

/** 已录原始记录预览 PDF blob URL。 */
export async function getFilledRecordPreviewPdf(recordId: number | string) {
  const rd = (await axios.get(`${API}/record-data/${recordId}`)).data;
  const base = (await axios.get(`${API}/record-templates/${rd.template_id}`)).data;
  let groups: any[] = [];
  let layout: Record<string, any> = {};
  let version = base.version ?? 1;
  if (rd.template_version_id) {
    try {
      const v = (await axios.get(`${API}/record-templates/${rd.template_id}/versions/${rd.template_version_id}`)).data;
      if (v?.field_definitions) {
        groups = v.field_definitions;
        layout = v.layout_options || {};
        version = v.version_no ?? version;
      }
    } catch { /* 版本拉取失败再尝试当前生效版本 */ }
  }
  if (!groups.length) {
    const resolved = await resolveTemplateContent(base, `${API}/record-templates`);
    groups = resolved.groups;
    layout = resolved.layoutOptions;
    version = resolved.version;
  }
  const tmpl: RecordTemplate = { id: base.id, name: base.name, version, groups, layout_options: layout };
  const merged = { ...(rd.batch_shared_data || {}), ...(rd.raw_data || {}), ...(rd.derived_data || {}) };
  const data = injectAuditFields(tmpl, ensureDataMatrixDefaults(tmpl, merged), rd);
  const deviceMap = await fetchDeviceMap(collectDeviceCodes(tmpl, data));
  return compileTypst(generateTypstWithData(tmpl, data, { deviceMap }));
}

/** 录入记录（填好数据的原始记录）：按锁定版本渲染 PDF（与 ReadonlyRecordViewer 同口径） */
export async function downloadFilledRecordPdf(recordId: number | string, filename: string) {
  triggerDownload(await getFilledRecordPreviewPdf(recordId), `${safe(filename)}.pdf`);
}

// 报告模板预览用的最小 mock 上下文（结构预览，非真实数据；真实值出报告时按订单注入）
const REPORT_MOCK_CTX = {
  order: { order_no: 'C20250000000', customer_name: '示例客户', sample_name: '示例样品', received_at: '2025-01-01' },
  order_samples: [{ no: '1', name: '示例样品' }],
} as unknown as ReportRenderCtx;

/** 报告模板（首页/项目）：mock 上下文结构预览 PDF */
export async function getReportTemplatePreviewPdf(templateId: number | string, versionId?: number | string) {
  const base = (await axios.get(`${API}/report-templates/${templateId}`)).data;
  const resolved = await resolveTemplateContent(base, `${API}/report-templates`, versionId, true);
  const tpl: RecordTemplate = {
    id: base.id, name: base.name, version: resolved.version,
    groups: resolved.groups, layout_options: resolved.layoutOptions,
  };
  const src = injectReportFieldsIntoTypst(generateTypst(tpl), tpl, REPORT_MOCK_CTX);
  return compileTypst(src);
}

export async function downloadReportTemplatePdf(templateId: number | string, filename: string) {
  triggerDownload(await getReportTemplatePreviewPdf(templateId), `${safe(filename)}.pdf`);
}

export async function getGeneratedReportPreviewPdf(reportId: number | string) {
  const res = await axios.get(`${API}/reports/${reportId}/pdf`, { responseType: 'blob' });
  return URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
}

/** 生成的报告：服务端已编译 PDF，直接取 blob 下载 */
export async function downloadGeneratedReportPdf(reportId: number | string, filename: string) {
  triggerDownload(await getGeneratedReportPreviewPdf(reportId), `${safe(filename)}.pdf`);
}
