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
    else if (f.semantic_role === 'inspector_date') out[f.code] = row?.tested_at ? new Date(row.tested_at).toLocaleDateString() : '';
    else if (f.semantic_role === 'reviewer') out[f.code] = row?.reviewer_name || '';
    else if (f.semantic_role === 'reviewer_date') out[f.code] = row?.reviewed_at ? new Date(row.reviewed_at).toLocaleDateString() : '';
  }
  return out;
}

/** 原始记录模板：mock 数据预览 PDF */
export async function downloadRecordTemplatePdf(templateId: number | string, filename: string) {
  const base = (await axios.get(`${API}/record-templates/${templateId}`)).data;
  const tmpl: RecordTemplate = {
    id: base.id, name: base.name, version: base.version,
    groups: base.field_definitions, layout_options: base.layout_options || {},
  };
  await downloadCompiledPdf(generateTypstWithData(tmpl, generateMockData(tmpl)), filename);
}

/** 录入记录（填好数据的原始记录）：按锁定版本渲染 PDF（与 ReadonlyRecordViewer 同口径） */
export async function downloadFilledRecordPdf(recordId: number | string, filename: string) {
  const rd = (await axios.get(`${API}/record-data/${recordId}`)).data;
  const base = (await axios.get(`${API}/record-templates/${rd.template_id}`)).data;
  let groups = base.field_definitions;
  let layout = base.layout_options || {};
  if (rd.template_version_id) {
    try {
      const v = (await axios.get(`${API}/record-templates/${rd.template_id}/versions/${rd.template_version_id}`)).data;
      if (v?.field_definitions) { groups = v.field_definitions; layout = v.layout_options || {}; }
    } catch { /* 版本拉取失败用 base 兜底 */ }
  }
  const tmpl: RecordTemplate = { id: base.id, name: base.name, version: base.version, groups, layout_options: layout };
  const merged = { ...(rd.raw_data || {}), ...(rd.derived_data || {}) };
  const data = injectAuditFields(tmpl, ensureDataMatrixDefaults(tmpl, merged), rd);
  // 「测试设备」反查设备名称 → 显示「设备名称：管理编号」（记录只存管理编号数组）。
  const deviceMap = await fetchDeviceMap(collectDeviceCodes(tmpl, data));
  await downloadCompiledPdf(generateTypstWithData(tmpl, data, { deviceMap }), filename);
}

// 报告模板预览用的最小 mock 上下文（结构预览，非真实数据；真实值出报告时按订单注入）
const REPORT_MOCK_CTX = {
  order: { order_no: 'C20250000000', customer_name: '示例客户', sample_name: '示例样品', received_at: '2025-01-01' },
  order_samples: [{ no: '1', name: '示例样品' }],
} as unknown as ReportRenderCtx;

/** 报告模板（首页/项目）：mock 上下文结构预览 PDF */
export async function downloadReportTemplatePdf(templateId: number | string, filename: string) {
  const base = (await axios.get(`${API}/report-templates/${templateId}`)).data;
  const tpl: RecordTemplate = {
    id: base.id, name: base.name, version: base.version,
    groups: base.field_definitions, layout_options: base.layout_options || {},
  };
  const src = injectReportFieldsIntoTypst(generateTypst(tpl), tpl, REPORT_MOCK_CTX);
  await downloadCompiledPdf(src, filename);
}

/** 生成的报告：服务端已编译 PDF，直接取 blob 下载 */
export async function downloadGeneratedReportPdf(reportId: number | string, filename: string) {
  const res = await axios.get(`${API}/reports/${reportId}/pdf`, { responseType: 'blob' });
  const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
  triggerDownload(url, `${safe(filename)}.pdf`);
}
