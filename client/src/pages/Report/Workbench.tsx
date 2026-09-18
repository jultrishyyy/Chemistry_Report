/**
 * 报告详情页（取号驱动）
 *
 * 从委托单列表点「操作」进入。落地展示订单详细信息 + 录入进度 + 「编辑首页」入口，
 * 不直接进首页预览。报告如何拆分（整单/按样品/按项目）由【外部取号】决定，不在本系统选。
 *
 *   - 取号前：查看订单信息 / 录入进度 / 只读原始记录；点「编辑首页」编辑首页实例（样品信息/结论值、
 *     字段增删改、表格样式——order 级首页草稿，取号后 carry 到每份报告）。
 *   - 取号后：每个报告编号一条目（显示样品/项目）；按已有的对应样品·项目·原始记录直接生成
 *     → 进实例编辑器（预览 + 换样品/项目 + 改字段/排版）。
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Card, Select, Button, Tag, message, Alert, Space, Empty, Tooltip, Popconfirm, Checkbox, Input,
  Drawer, Timeline, Descriptions,
} from 'antd';
import {
  FileTextOutlined,
  DownloadOutlined, ReloadOutlined, ArrowLeftOutlined,
  HistoryOutlined, EditOutlined, SendOutlined, EyeOutlined,
  DownOutlined, RightOutlined, SettingOutlined, RollbackOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import ReadonlyRecordViewer from '../../components/ReadonlyRecordViewer';
import RecordProgressPanel from '../../components/RecordProgressPanel';
import PdfPreviewModal from '../../components/PdfPreviewModal';
import TemplatePdfPreviewModal from '../../components/TemplatePdfPreviewModal';
import { getGeneratedReportPreviewPdf } from '../../utils/pdfDownload';
import { useAuth } from '../../auth';
import { isInteractiveRowTarget } from '../../utils/rowNavigation';
import { availableReportAssignments } from '../../../../shared/report-generation-selection';
import { preferredReportTemplate } from '../../../../shared/report-template-preference';

const API = '/api';

interface WorkOrder {
  order_no: string;
  customer_name: string;
  received_at: string;
  payload: {
    samples: { id: string; name: string; test_infos: { name: string; standard?: string; linked_template_id?: number | null; linked_template_ids?: number[] }[] }[];
    meta?: Record<string, any>;
  };
}

interface RecordRow {
  id: number;
  template_id: number;
  template_version: number;
  submitted_at: string;
  order_no?: string | null;
  sample_external_id?: string | null;
  test_item_name?: string | null;
  audit_status?: string | null;
  reject_note?: string | null;
}

interface ReportTemplateRow {
  id: number;
  name: string;
  template_kind: 'cover' | 'project';
  linked_record_template_id?: number | null;
  /** 当前生效版本状态；非 'approved'（含无生效版本）＝未审核通过，下拉中禁选 */
  current_status?: string | null;
  /** 当前生效版本的字段分区数；0＝空/旧版模板（无结构化 content_doc），选用时禁选（否则生成出无法编辑的报告） */
  current_field_group_count?: number;
  host_manufacturer_id?: number | null;
  host_manufacturer_name?: string | null;
}


/** 取号报告匹配结果（接口 1.2，后端 external-report-info 算出） */
interface ReqMatchEntry {
  scope_key: string;
  method_name?: string;
  base_scope_key?: string;
  sample_name: string;
  project_name: string;
  sample_external_id?: string | null;
  /** 由报告编号接口给出的默认勾选；整单候选中未标记的项目默认不纳入。 */
  default_enabled?: boolean;
  status: 'matched' | 'needs_record' | 'unmatched';
  note?: string;
  assignments: {
    record_data_id: number;
    record_data_status?: string;
    record_template_id?: number;
    project_template_id?: number | null;
    project_template_version_id?: number | null;
    project_template_candidates?: {
      id: number;
      name: string;
      version_id: number;
      version_no: number;
      project_name?: string | null;
      host_manufacturer_id?: number | null;
      updated_at?: string | null;
    }[];
  }[];
}
interface ReportRequisitionRow {
  id: number;
  order_no: string;
  report_number: string;
  check_code?: string | null;
  language?: string | null;
  sample_name?: string | null;
  status: 'pending' | 'generated';
  stale?: boolean;
  report_id?: number | null;
  delivery_status?: 'none' | 'sent' | 'failed';
  match_result?: ReqMatchEntry[] | null;
  /** 接口 1.3：外部审核状态（原始字符串，草稿/审核中/审核通过/审核不通过）/ 最近退回备注 */
  record_state?: string | null;
  last_modify_remark?: string | null;
  /** 报告外部状态机（来自 reports.external_status，经取号单 report_id join）：审核通过=external_approved */
  external_status?: 'none' | 'submitted_external' | 'external_approved' | 'external_revision' | null;
  /** 文员侧锁：实验室数据退回(data_entry)未重审通过前为 true，禁用重新生成/编辑/送审 */
  data_rework_open?: boolean;
  /** 报告退回(scope=report)：在原报告上编辑修改（非重生成）。有值＝该报告处于退回修改态，退回意见展示在本条目下方 */
  report_rework?: { id: number; reason?: string | null; suggestion?: string | null } | null;
  template_selections?: Array<{
    scope_key: string; enabled?: boolean; record_data_id?: number; project_template_id?: number;
    project_template_version_id?: number | null;
  }>;
  generation_configured_at?: string | null;
  generation_configured_by?: string | null;
}

/** 报告历史版本（GET /api/reports/:id/versions） */
interface ReportVersionRow {
  id: number;
  report_no?: string | null;
  version: number;
  generated_at?: string | null;
  generated_by?: string | null;
  edited?: boolean;
  is_current: boolean;
}

/** 把含时间的日期值截成 YYYY-MM-DD（非日期串原样返回） */
const fmtDate = (v: any): string => {
  const s = v == null ? '' : String(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : s;
};

/** 订单信息面板展示的接口 1.1 字段（payload.meta 里的键 → 中文标签）。
 *  long=长文本整行跨列；date=按 YYYY-MM-DD 显示。 */
const ORDER_META_LABELS: { key: string; label: string; long?: boolean; date?: boolean }[] = [
  { key: 'company_address', label: '委托单位地址', long: true },
  { key: 'send_date', label: '送检日期', date: true },
  { key: 'time_required', label: '客户要求期限', date: true },
  { key: 'test_time_required', label: '检测要求期限', date: true },
  { key: 'report_deadline', label: '报告期限', date: true },
  { key: 'authorites', label: '证书单位' },
  { key: 'authorites_address', label: '证书单位地址', long: true },
  { key: 'sale_name', label: '业务员' },
  { key: 'job_no', label: '业务员工号' },
  { key: 'buyer', label: '买家' },
  { key: 'status', label: '委托单状态' },
  { key: 'report_count', label: '报告数量' },
  { key: 'complete_way', label: '完工方式' },
  { key: 'remark', label: '备注', long: true },
];

export default function ReportWorkbench() {
  const navigate = useNavigate();
  const { has } = useAuth();
  const canEditReports = has('report.generate');
  const { orderNo } = useParams<{ orderNo: string }>();
  const [order, setOrder] = useState<WorkOrder | null>(null);
  const orderHeader = order
    ? { order_no: order.order_no, customer_name: order.customer_name, sample_name: (order.payload?.samples || []).map(s => s.name).join(' / ') || '—', received_at: order.received_at }
    : { order_no: orderNo || '', customer_name: '—', sample_name: '—', received_at: '—' };
  const [coverTemplates, setCoverTemplates] = useState<ReportTemplateRow[]>([]);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [coverId, setCoverId] = useState<number | undefined>();
  const [openingCover, setOpeningCover] = useState(false);
  const [previewCover, setPreviewCover] = useState<{ id: number; name: string } | null>(null);
  const [previewReport, setPreviewReport] = useState<{ id: number; name: string } | null>(null);
  // 报告端只读查看原始记录
  const [viewerRec, setViewerRec] = useState<{ id: number; subtitle: string } | null>(null);

  const openGeneratedReport = (req: ReportRequisitionRow) => {
    if (!req.report_id) return;
    const editable = canEditReports && canSend(req);
    if (editable) navigate(`/report/edit?id=${req.report_id}`);
    else setPreviewReport({ id: req.report_id, name: req.report_number || `报告 #${req.report_id}` });
  };

  // ── 取号报告（接口 1.2 PushReportInfos）：报告编号 + 范围由外部决定，本系统只补齐每格的样品/项目/原始记录 ──
  const [requisitions, setRequisitions] = useState<ReportRequisitionRow[]>([]);
  const [selectingTemplate, setSelectingTemplate] = useState('');
  const [configuringReq, setConfiguringReq] = useState<number | null>(null);
  const [rescopingReq, setRescopingReq] = useState<number | null>(null);
  const [scopeEnabled, setScopeEnabled] = useState<Record<string, boolean>>({});
  const [scopeSearch, setScopeSearch] = useState<Record<number, string>>({});
  const [collapsedSamples, setCollapsedSamples] = useState<Set<string>>(new Set());
  const [expandedReqs, setExpandedReqs] = useState<Set<number>>(new Set());
  const toggleReq = (id: number) => setExpandedReqs(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  const loadRequisitions = useCallback(() => {
    if (!orderNo) return;
    axios.get(`${API}/external/requisitions?order_no=${orderNo}`).then(r => setRequisitions(r.data || [])).catch(() => {});
  }, [orderNo]);
  useEffect(() => { loadRequisitions(); }, [loadRequisitions]);

  // 报告退回(scope=report)的退回意见已就近展示在每份报告条目下方（req.report_rework），不再单设底部面板。

  // 1. 初始加载
  useEffect(() => {
    if (!orderNo) return;
    Promise.all([
      // 全量拉取（含未审核）：未审核模板在下拉中【显示但禁选】并标注，比直接隐藏更不困惑；
      // 可选用的仍只有 current_status='approved' 的（默认值/生成 fallback 也只取 approved）。
      axios.get(`${API}/report-templates?kind=cover`),
      axios.get(`${API}/record-data?order_no=${orderNo}`),
      axios.get(`${API}/work-orders/${orderNo}`),
    ]).then(([cv, rd, wo]) => {
      setCoverTemplates(cv.data);
      setRecords(rd.data);
      setOrder(wo.data);
      const firstApproved = (cv.data as any[]).find(t => t.current_status === 'approved' && t.current_field_group_count > 0);
      if (firstApproved) setCoverId(firstApproved.id);
    }).catch(() => message.error('加载失败'));
  }, [orderNo]);

  // 退回原始记录后刷新录入进度（记录状态会变「已退回」）
  const reloadRecords = useCallback(() => {
    if (!orderNo) return;
    axios.get(`${API}/record-data?order_no=${orderNo}`).then(rd => setRecords(rd.data)).catch(() => {});
  }, [orderNo]);

  // 本单已生成的报告（取号生成后在这里点"编辑字段/排版"）
  const [, setExistingReports] = useState<any[]>([]);
  const loadReports = useCallback(() => {
    if (!orderNo) return;
    axios.get(`${API}/reports?order_no=${orderNo}`).then(r => setExistingReports(r.data || [])).catch(() => {});
  }, [orderNo]);
  useEffect(() => { loadReports(); }, [loadReports]);

  // 全订单时间线（rework 工单 + 录入审计 + 报告审计，按时间合并）
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [timelineEvents, setTimelineEvents] = useState<any[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const openTimeline = useCallback(() => {
    if (!orderNo) return;
    setTimelineOpen(true);
    setTimelineLoading(true);
    axios.get(`${API}/orders/${orderNo}/timeline`)
      .then(r => setTimelineEvents(r.data.events || []))
      .catch(() => message.error('时间线加载失败'))
      .finally(() => setTimelineLoading(false));
  }, [orderNo]);

  // 「编辑首页」：创建/打开本订单的首页草稿（cover-only 实例）→ 进 InstanceEditor 编辑实例内容（值/字段/表格/样式）。
  const openCoverDraft = async () => {
    if (!coverId) { message.warning('请先选择首页模板'); return; }
    setOpeningCover(true);
    try {
      const res = await axios.post(`${API}/reports/cover-draft`, {
        order_no: orderHeader.order_no, cover_template_id: coverId,
      });
      navigate(`/report/edit?id=${res.data.report_id}`);
    } catch (e: any) {
      message.error('打开首页编辑失败：' + (e.response?.data?.error || e.message));
    } finally { setOpeningCover(false); }
  };

  // 「应用到已取号报告」：无需打开编辑器，直接把当前首页草稿应用到本单的取号报告。
  //  - 已生成的报告：立即重渲染套用（apply-cover，服务端会拦掉已送审/数据锁定的报告）；
  //  - 尚未生成的取号报告：无需处理——生成时会自动套用当前首页草稿（external 生成 carry）。
  const [applyingCover, setApplyingCover] = useState(false);
  const applyCoverToRequisitions = async () => {
    if (!coverId) { message.warning('请先选择首页模板'); return; }
    setApplyingCover(true);
    try {
      // 确保存在首页草稿（已编辑过的同模板草稿会被复用、不覆盖手改）
      await axios.post(`${API}/reports/cover-draft`, { order_no: orderHeader.order_no, cover_template_id: coverId });
      const genRes = await axios.get(`${API}/reports`, { params: { order_no: orderHeader.order_no } });
      const list = (genRes.data || []) as any[];
      const eligible = list.filter(r => r.external_status !== 'submitted_external' && !r.data_rework_open);
      const pendingCount = requisitions.filter(r => !r.report_id).length;
      if (!eligible.length) {
        message.info(pendingCount
          ? `暂无可应用的已生成报告；${pendingCount} 份取号报告将在生成时自动套用当前首页`
          : '暂无可应用的报告（已送审报告需先由外部退回后才能改首页）');
        return;
      }
      const res = await axios.post(`${API}/reports/apply-cover`, {
        order_no: orderHeader.order_no, report_ids: eligible.map(r => r.id),
      });
      message.success(`已应用到 ${res.data.applied} 份已取号报告`
        + (pendingCount ? `；另有 ${pendingCount} 份将在生成时自动套用` : ''));
      // 服务端跳过的报告（已送审 / 数据退回锁定）明确告知原因，避免看起来像"没生效"
      const failed = ((res.data.results || []) as any[]).filter(r => !r.ok);
      if (failed.length) message.warning(`${failed.length} 份报告未应用：${failed[0].error}`, 6);
      loadRequisitions(); loadReports();
    } catch (e: any) {
      message.error('应用失败：' + (e.response?.data?.error || e.message));
    } finally { setApplyingCover(false); }
  };

  // ── 取号报告：点击生成，采用当前范围内可用的记录和模板 ──
  // 数据退回(data_entry)意见：因不确定具体改哪条记录，汇总展示在「数据录入进度」下方（去重）。
  const dataReworkNotes = Array.from(new Set(
    records.filter(r => r.audit_status === 'rejected' && r.reject_note).map(r => r.reject_note as string),
  ));

  const selectionFor = (req: ReportRequisitionRow, scopeKey: string) =>
    (req.template_selections || []).find(s => String(s.scope_key) === String(scopeKey));

  const scopeIsEnabled = (req: ReportRequisitionRow, scopeKey: string) => {
    const local = scopeEnabled[`${req.id}:${scopeKey}`];
    if (local !== undefined) return local;
    const saved = selectionFor(req, scopeKey);
    if (saved) return saved.enabled !== false;
    return (req.match_result || []).find(m => String(m.scope_key) === String(scopeKey))?.default_enabled !== false;
  };

  const generationChoices = (req: ReportRequisitionRow) => (req.match_result || []).map(entry => ({
    ...selectionFor(req, entry.scope_key), scope_key: entry.scope_key,
    enabled: scopeIsEnabled(req, entry.scope_key),
  }));
  const buildAssignments = (req: ReportRequisitionRow) => availableReportAssignments(
    req.match_result || [], generationChoices(req),
    coverTemplates.find(t => Number(t.id) === Number(usableCoverId()))?.host_manufacturer_id,
  );

  const saveTemplateSelection = async (
    req: ReportRequisitionRow,
    entry: ReqMatchEntry,
    recordDataId: number,
    projectTemplateId: number,
  ) => {
    const key = `${req.id}:${entry.scope_key}:${recordDataId}`;
    setSelectingTemplate(key);
    try {
      const { data } = await axios.put(`${API}/external/requisitions/${req.id}/template-selection`, {
        scope_key: entry.scope_key,
        record_data_id: recordDataId,
        project_template_id: projectTemplateId,
      });
      setRequisitions(prev => prev.map(r =>
        r.id === req.id ? { ...r, match_result: data.match_result, template_selections: data.template_selections,
          generation_configured_at: null, generation_configured_by: null } : r));
      message.success('项目模板已确认，将按该模板拉取原始记录数据');
    } catch (e: any) {
      message.error('模板选择保存失败：' + (e.response?.data?.error || e.message));
    } finally {
      setSelectingTemplate('');
    }
  };

  /** 首页模板有主机厂时，同一原始记录的同主机厂项目模板作为首选；用户仍可在下拉中改选。 */
  const preferredCandidate = (assignment: ReqMatchEntry['assignments'][number]) => {
    const candidates = assignment?.project_template_candidates || [];
    const factoryId = coverTemplates.find(t => Number(t.id) === Number(usableCoverId()))?.host_manufacturer_id;
    return preferredReportTemplate(candidates, factoryId) || candidates[0];
  };

  /** 按当前已有的记录和模板直接生成，暂缺的样品／项目自动跳过。 */
  const generateRequisition = async (req: ReportRequisitionRow) => {
    const cover = usableCoverId();
    if (!cover) { message.warning('请先选择已生效的首页模板'); return; }
    if (!buildAssignments(req).length) { message.warning('当前范围暂无可生成的已审核记录和生效项目模板'); return; }
    setConfiguringReq(req.id);
    try {
      const generated = await axios.post(`${API}/external/requisitions/generate`, {
        order_no: orderHeader.order_no, cover_template_id: cover,
        items: [{ requisition_id: req.id, assignments: generationChoices(req) }],
      });
      const result = generated.data?.reports?.find((x: any) => x.requisition_id === req.id);
      if (!result?.ok || !result?.report_id) throw new Error(result?.error || '报告生成失败');
      message.success('报告已按当前可用的样品和项目生成');
      loadRequisitions(); loadReports();
      navigate(`/report/edit?id=${result.report_id}`);
    } catch (e: any) {
      message.error('生成失败：' + (e.response?.data?.error || e.message));
    } finally { setConfiguringReq(null); }
  };

  /** 已生成报告在工作台改选范围后，与编辑器“调整样品/项目”走同一 rescope 接口。 */
  const applyGeneratedScope = async (req: ReportRequisitionRow) => {
    if (!req.report_id) return;
    const assignments = buildAssignments(req).map(({ record_data_id, project_template_id, enabled }) => ({ record_data_id, project_template_id, enabled }));
    if (!assignments.some(item => item.enabled)) { message.warning('请至少勾选一个已审核项目'); return; }
    setRescopingReq(req.id);
    try {
      await axios.post(`${API}/reports/${req.report_id}/rescope`, { assignments });
      message.success('已将工作台选择同步到本报告');
      loadRequisitions(); loadReports();
    } catch (e: any) {
      message.error('应用范围失败：' + (e.response?.data?.error || e.message));
    } finally { setRescopingReq(null); }
  };

  /** 取号单收起行展示的样品名（去重，「；」拼接） */
  const reqSampleSummary = (req: ReportRequisitionRow) => {
    const names = Array.from(new Set((req.match_result || []).map(m => m.sample_name).filter(Boolean)));
    return names.length ? names.join('；') : '—';
  };

  /**
   * 该报告当前是否「可编辑 + 可送审」：
   *  - 必须已生成、未被数据锁(data_rework_open)、不在自动重生成中(stale 且非报告退回)。
   *  - 报告退回(report_rework)→ 即使之前已送审，也重新可编辑+送审（仅这一份）。
   *  - 否则：仅未送审(none/failed)才可送审；已送审=终态，不可再操作。
   */
  const canSend = (r: ReportRequisitionRow): boolean => {
    if (!(r.status === 'generated' && r.report_id)) return false;
    if (r.data_rework_open) return false;
    const inRevision = !!r.report_rework;
    if (!inRevision && r.stale) return false;         // 正在按新数据自动重生成
    return inRevision || r.delivery_status !== 'sent';
  };

  /** 取号单单一状态标签 */
  const reqStatus = (req: ReportRequisitionRow): { label: string; color: string } => {
    if (req.data_rework_open) return { label: '退回修改（数据）', color: 'volcano' };
    if (req.report_rework) return { label: '退回修改（报告）', color: 'volcano' };
    if (req.external_status === 'external_approved') return { label: '外部审核通过', color: 'success' };
    if (req.stale) return { label: '重新生成中…', color: 'orange' };
    if (req.delivery_status === 'sent') return { label: '已送审', color: 'cyan' };
    if (req.delivery_status === 'failed') return { label: '送审失败', color: 'red' };
    if (req.status === 'generated' && req.report_id) return { label: '待送审', color: 'green' };
    return { label: buildAssignments(req).length ? '可生成报告' : '暂无可生成项目', color: 'default' };
  };

  /** 生成可用的首页模板：选中的（下拉只允许选 approved 且非空）或第一个已审核通过且有内容的。 */
  const usableCoverId = () => coverId ?? coverTemplates.find(t => t.current_status === 'approved' && (t.current_field_group_count ?? 0) > 0)?.id;

  // 点击生成即采用可用范围；展开条目可选调范围和模板。

  // 报告历史版本（退回修改→重新生成会保留旧版）
  const [historyFor, setHistoryFor] = useState<ReportRequisitionRow | null>(null);
  const [historyRows, setHistoryRows] = useState<ReportVersionRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const openHistory = async (req: ReportRequisitionRow) => {
    if (!req.report_id) return;
    setHistoryFor(req); setHistoryRows([]); setHistoryLoading(true);
    try {
      const r = await axios.get(`${API}/reports/${req.report_id}/versions`);
      setHistoryRows(r.data || []);
    } catch (e: any) {
      message.error('加载历史版本失败：' + (e.response?.data?.error || e.message));
    } finally { setHistoryLoading(false); }
  };

  // 回传递归智能（接口 1.4）
  const [delivering, setDelivering] = useState<number | null>(null);
  const [withdrawing, setWithdrawing] = useState<number | null>(null);
  const deliverRequisition = async (req: ReportRequisitionRow) => {
    setDelivering(req.id);
    try {
      await axios.post(`${API}/external/requisitions/${req.id}/deliver`);
      message.success(`报告 ${req.report_number} 已送审`);
      loadRequisitions();
    } catch (e: any) {
      message.error('送审失败：' + (e.response?.data?.error || e.message));
    } finally { setDelivering(null); }
  };
  // 全部送审：只送「可送审」的报告（未送审的，或被退回需重新送审的）。全部送审后均变终态。
  const deliverAll = async (reqs: ReportRequisitionRow[]) => {
    const todo = reqs.filter(canSend);
    if (!todo.length) { message.info('没有可送审的报告（均已送审或正在重新生成）'); return; }
    setDelivering(-1);
    try {
      for (const r of todo) { await axios.post(`${API}/external/requisitions/${r.id}/deliver`).catch(() => {}); }
      message.success(`已送审 ${todo.length} 份报告`);
      loadRequisitions();
    } finally { setDelivering(null); }
  };
  const canWithdrawDelivery = (req: ReportRequisitionRow) =>
    canEditReports
    && req.delivery_status === 'sent'
    && req.external_status !== 'external_approved'
    && req.external_status !== 'external_revision'
    && !!req.report_id;
  const withdrawDelivery = async (req: ReportRequisitionRow) => {
    setWithdrawing(req.id);
    try {
      const { data } = await axios.post(`${API}/external/requisitions/${req.id}/withdraw-delivery`);
      message.success(`报告 ${req.report_number} 已撤回送审`);
      if (data?.warning) message.info(data.warning, 6);
      loadRequisitions();
      loadReports();
    } catch (e: any) {
      message.error('撤回失败：' + (e.response?.data?.error || e.message));
    } finally {
      setWithdrawing(null);
    }
  };

  // 订单信息面板：payload.meta（接口 1.1 扩展字段）有值的才显示；日期截断、长文本整行
  const orderMetaRows = ORDER_META_LABELS
    .map(({ key, label, long, date }) => {
      const raw = order?.payload?.meta?.[key];
      return { label, long: !!long, value: date ? fmtDate(raw) : raw };
    })
    .filter(r => r.value !== undefined && r.value !== null && r.value !== '');

  return (
    <div style={{ height: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column' }}>
      {/* 顶部委托单信息 */}
      <Card size="small" style={{ margin: 12, marginBottom: 0, background: '#fafafa' }}>
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space>
            <Button size="small" type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/report')}>
              返回委托单列表
            </Button>
            <span style={{ color: '#888' }}>委托单号</span>
            <strong style={{ fontFamily: 'monospace' }}>{orderHeader.order_no}</strong>
            <Tag color="orange">Demo · 模拟数据</Tag>
            <span style={{ color: '#666', fontSize: 12 }}>
              客户：{orderHeader.customer_name} ｜ 样品：{orderHeader.sample_name} ｜ 接收：{fmtDate(orderHeader.received_at)}
            </span>
          </Space>
          <Button size="small" icon={<HistoryOutlined />} onClick={openTimeline}>订单时间线</Button>
        </Space>
      </Card>

      {/* 单列详情：订单信息 + 录入进度 + 首页入口 + 取号报告条目 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        <div style={{ maxWidth: 920, margin: '0 auto' }}>

          {/* ── 订单信息（接口 1.1 委托单字段，只读）── */}
          <Card size="small" title="订单信息" style={{ marginBottom: 12 }}
            extra={<span style={{ color: '#999', fontSize: 12 }}>接口推送，只读</span>}>
            <Descriptions size="small" column={2} bordered
              styles={{
                label: { width: 104, padding: '5px 10px', whiteSpace: 'nowrap', verticalAlign: 'top' },
                content: { padding: '5px 10px', wordBreak: 'break-word' },
              }}>
              <Descriptions.Item label="委托单位">{orderHeader.customer_name}</Descriptions.Item>
              <Descriptions.Item label="接收日期">{fmtDate(orderHeader.received_at)}</Descriptions.Item>
              {orderMetaRows.map(r => (
                <Descriptions.Item key={r.label} label={r.label} span={r.long ? 2 : 1}>{String(r.value)}</Descriptions.Item>
              ))}
            </Descriptions>
          </Card>

          {/* ── 录入进度：本单全部 样品×测试项目 + 状态 + 只读查看原始记录 ── */}
          <Card size="small" title="数据录入进度" style={{ marginBottom: 12 }}>
            {order
              ? <RecordProgressPanel
                  samples={order.payload?.samples || []}
                  records={records}
                  onView={(id, subtitle) => setViewerRec({ id, subtitle })}
                />
              : <Empty description="加载中…" />}
            {/* 数据退回(data_entry)意见：不确定具体改哪条记录，统一展示在所有原始记录下方 */}
            {dataReworkNotes.length > 0 && (
              <Alert type="warning" showIcon style={{ marginTop: 10 }}
                message="实验室数据已退回主检重录，待重新审核通过后报告将按新数据自动重新生成"
                description={<div style={{ fontSize: 12 }}>退回意见：{dataReworkNotes.map((n, i) => (
                  <div key={i}>· {n}</div>
                ))}</div>} />
            )}
          </Card>

          {/* ── 首页：选模板 + 编辑首页实例（取号前可编辑，取号后 carry 到每份报告）── */}
          {/* 首页仅在【本单所有报告都已生成且已送审、进入终态】后才锁定；只要还有报告待生成 / 待送审 /
              被退回，就仍可编辑首页。旧逻辑用 !some(canSend) 判定，会把"取号后尚未生成(待数据录入)"
              误判为"均已送审"而错误锁定并提示"报告均已送审"——这里改为 every(已送审终态)。 */}
          {(() => {
            const coverLocked = requisitions.length > 0 && requisitions.every(r =>
              r.status === 'generated' && !!r.report_id && r.delivery_status === 'sent'
              && !r.report_rework && !r.stale && !r.data_rework_open);
            return (
          <Card size="small" title="报告首页" style={{ marginBottom: 12 }}>
            <Space direction="vertical" style={{ width: '100%' }} size={8}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 240px' }}>
                  <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>首页模板</div>
                  <Select style={{ width: '100%' }} value={coverId} onChange={setCoverId} disabled={coverLocked}
                    options={coverTemplates.map(t => {
                      if (t.current_status !== 'approved') return { value: t.id, label: `${t.name}（未审核通过，无法选用）`, disabled: true };
                      if (!(t.current_field_group_count && t.current_field_group_count > 0)) return { value: t.id, label: `${t.name}（模板无内容/旧版，无法用于生成）`, disabled: true };
                      return { value: t.id, label: t.name };
                    })}
                    placeholder="选择首页模板" />
                </div>
              </div>
              <Space wrap>
                <Button type="primary" ghost={!canEditReports} icon={canEditReports ? <FileTextOutlined /> : <EyeOutlined />} loading={openingCover}
                  disabled={!coverId || (canEditReports && coverLocked)}
                  onClick={canEditReports
                    ? openCoverDraft
                    : () => {
                        const template = coverTemplates.find(t => t.id === coverId);
                        if (coverId) setPreviewCover({ id: coverId, name: template?.name || `首页模板 #${coverId}` });
                      }}>
                  {canEditReports ? '编辑首页' : '预览首页模板'}
                </Button>
                <Tooltip title="不打开编辑器，直接把当前首页应用到本单已取号的报告：已生成的立即套用，尚未生成的会在生成时自动套用当前首页。">
                  <Button icon={<SettingOutlined />} loading={applyingCover}
                    disabled={!canEditReports || !coverId || coverLocked || requisitions.length === 0} onClick={applyCoverToRequisitions}>
                    应用到已取号报告
                  </Button>
                </Tooltip>
              </Space>
              <div style={{ fontSize: 12, color: '#999' }}>
                {coverLocked
                  ? '报告均已送审，首页已锁定不可编辑；如需修改请等待外部退回该报告后再改。'
                  : '「编辑首页」打开首页实例编辑器，可改样品信息/结论等填入内容、增删改字段、调表格样式。这份首页是本订单的草稿，取号后会套用到每份报告（结构/样式/手改值带过去，结论与样品按各报告范围重算）。「应用到已取号报告」可在改完后直接把首页推到已取号报告，无需再进编辑器。'}
              </div>
            </Space>
          </Card>
          ); })()}

          {/* ── 报告：每份报告一条目（编号/状态/样品），展开调整样品×项目；点击即可生成 ── */}
          {requisitions.length > 0 ? (
            <Card size="small" style={{ marginBottom: 12 }}
              title={<Space size={6}><FileTextOutlined />报告（{requisitions.length} 份）</Space>}
              extra={
                <Space size={6}>
                  <Button size="small" icon={<ReloadOutlined />} onClick={loadRequisitions}>刷新</Button>
                  <Button size="small" type="primary" icon={<SendOutlined />} loading={delivering === -1}
                    disabled={!canEditReports || !requisitions.some(canSend)}
                    onClick={() => deliverAll(requisitions)}>全部送审</Button>
                </Space>
              }>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 10 }}>
                点击“生成报告”即可按当前已有的样品和项目生成，暂缺记录或模板的项目自动跳过。展开条目可调整范围和模板。
              </div>
              {requisitions.map(req => {
                const generated = req.status === 'generated' && !!req.report_id;
                const locked = !!req.data_rework_open;
                const editable = canEditReports && canSend(req);
                const st = reqStatus(req);
                const expanded = expandedReqs.has(req.id);
                // 展开内容：按样品分组列出 样品·测试项目（来自 match_result，只读）
                const bySample = new Map<string, { label: string; entries: ReqMatchEntry[] }>();
                for (const m of (req.match_result || [])) {
                  // 名称可能重复，优先按外部样品 id 分组，避免勾选一个样品误影响同名样品。
                  const key = m.sample_external_id || m.sample_name;
                  const group = bySample.get(key) || { label: m.sample_name, entries: [] };
                  group.entries.push(m);
                  bySample.set(key, group);
                }
                const query = (scopeSearch[req.id] || '').trim().toLowerCase();
                const visibleGroups = Array.from(bySample.entries()).map(([sampleKey, group]) => {
                  const sampleHit = group.label.toLowerCase().includes(query);
                  const entries = !query || sampleHit ? group.entries : group.entries.filter(entry =>
                    entry.project_name.toLowerCase().includes(query));
                  return { sampleKey, group: { ...group, entries } };
                }).filter(({ group }) => group.entries.length);
                return (
                  <div
                    key={req.id}
                    style={{ border: '1px solid #eef1f6', borderRadius: 8, marginBottom: 10, overflow: 'hidden' }}
                  >
                    {/* 收起行：编号 + 状态 + 样品（；） + 操作 */}
                    <div
                      className={generated ? 'clickable-report-entry' : undefined}
                      onClick={(event) => {
                        if (generated && !isInteractiveRowTarget(event.target)) {
                          openGeneratedReport(req);
                        }
                      }}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#fafcff', flexWrap: 'wrap' }}
                    >
                      <Button type="text" size="small" style={{ padding: '0 4px' }} onClick={() => toggleReq(req.id)}>
                        {expanded ? <DownOutlined /> : <RightOutlined />}
                      </Button>
                      <Tag color="gold" style={{ fontFamily: 'monospace', margin: 0 }}>{req.report_number}</Tag>
                      <Tag color={st.color} style={{ margin: 0 }}>{st.label}</Tag>
                      <span style={{ fontSize: 12, color: '#555', flex: 1, minWidth: 120 }}>
                        样品：{reqSampleSummary(req)}
                      </span>
                      {generated ? (
                        <div className="row-action-strip">
                          {req.delivery_status === 'sent' && !req.report_rework && !req.stale && !locked &&
                            <Tag color="cyan" style={{ margin: '0 2px 0 0', fontSize: 11 }}>已送外部·待回执</Tag>}
                          <span className="row-action-cluster">
                          {/* 内容操作：编辑/查看、历史、下载始终归为一组。 */}
                          {editable ? (
                            <Button size="small" icon={<EditOutlined />} onClick={() => navigate(`/report/edit?id=${req.report_id}`)}>编辑</Button>
                          ) : (
                            <Button size="small" type="primary" ghost icon={<EyeOutlined />}
                              onClick={() => openGeneratedReport(req)}>查看</Button>
                          )}
                          {/* 次操作：历史 / PDF —— 收敛成低调的图标按钮，避免一排大按钮太挤 */}
                          <Tooltip title="历史版本（各版本只读查看/下载 PDF）">
                            <Button size="small" type="text" icon={<HistoryOutlined />} onClick={() => openHistory(req)} /></Tooltip>
                          <Tooltip title="下载本报告 PDF">
                            <Button size="small" type="text" icon={<DownloadOutlined />}
                              onClick={() => window.open(`${API}/reports/${req.report_id}/pdf`, '_blank')} /></Tooltip>
                          </span>
                          {/* 流程操作独立在右侧，视觉上与内容编辑区分。 */}
                          {(editable || canWithdrawDelivery(req)) && (
                            <span className="row-workflow-cluster">
                              {editable && (
                                <Button size="small" type="primary" icon={<SendOutlined />} loading={delivering === req.id}
                                  onClick={() => deliverRequisition(req)}>送审</Button>
                              )}
                              {canWithdrawDelivery(req) && (
                                <Popconfirm
                                  title="确认撤回送审？"
                                  description="撤回后报告将恢复为待送审，可继续编辑、重新生成或再次送审。"
                                  okText="撤回"
                                  cancelText="取消"
                                  onConfirm={() => withdrawDelivery(req)}
                                >
                                  <Button size="small" icon={<RollbackOutlined />}
                                    loading={withdrawing === req.id}>撤回送审</Button>
                                </Popconfirm>
                              )}
                            </span>
                          )}
                        </div>
                      ) : (
                        <Button size="small" type="primary" icon={<SettingOutlined />}
                          disabled={!canEditReports || locked || !buildAssignments(req).length}
                          loading={configuringReq === req.id}
                          onClick={() => generateRequisition(req)}>
                          生成报告
                        </Button>
                      )}
                    </div>
                    {locked && (
                      <div style={{ fontSize: 11, color: '#d4380d', background: '#fff7f5', padding: '4px 12px', borderTop: '1px solid #ffe7e0' }}>
                        实验室数据已退回主检重录{req.last_modify_remark ? `（${req.last_modify_remark}）` : ''}；待数据重新审核通过后自动解锁、重新生成（抓新数据）并重新送审。
                      </div>
                    )}
                    {/* 报告退回(scope=report)：退回意见就近展示在本报告条目下方，文员「编辑」改报告后「送审」 */}
                    {req.report_rework && !locked && (
                      <div style={{ fontSize: 12, color: '#ad4e00', background: '#fff7e6', padding: '6px 12px', borderTop: '1px solid #ffe7ba' }}>
                        <strong>外部退回·请修改本报告</strong>
                        {(req.report_rework.suggestion || req.report_rework.reason)
                          ? <span>：{req.report_rework.suggestion || req.report_rework.reason}</span>
                          : null}
                        <span style={{ color: '#999' }}>　（点「编辑」修改后「送审」重新回传外部）</span>
                      </div>
                    )}
                    {/* 展开行：样品 × 测试项目 */}
                    {expanded && (
                      <div style={{ padding: '6px 12px 8px', borderTop: '1px solid #eef2f8' }}>
                        {req.check_code && <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>检验码 {req.check_code}{req.record_state ? ` · 外部状态：${req.record_state}` : ''}</div>}
                        <Input.Search
                          allowClear
                          value={scopeSearch[req.id] || ''}
                          onChange={event => setScopeSearch(prev => ({ ...prev, [req.id]: event.target.value }))}
                          placeholder="搜索样品或测试项目"
                          style={{ maxWidth: 420, margin: '2px 0 8px' }}
                        />
                        {bySample.size === 0 && <div style={{ fontSize: 12, color: '#999' }}>本订单暂无样品或测试项目</div>}
                        {bySample.size > 0 && visibleGroups.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未找到匹配的样品或测试项目" />}
                        <div style={{
                          // 大订单只滚动候选列表，避免整张报告卡片被样品/项目撑得过高。
                          maxHeight: 'min(50vh, 420px)', overflowY: 'auto', overscrollBehavior: 'contain',
                          scrollbarGutter: 'stable', paddingRight: 4,
                        }}>
                        {visibleGroups.map(({ sampleKey, group }) => {
                          const entries = group.entries;
                          const collapseKey = `${req.id}:${sampleKey}`;
                          const collapsed = collapsedSamples.has(collapseKey);
                          const selectable = entries.filter(entry => entry.status === 'matched'
                            && entry.assignments.some(a => a.record_data_status === 'reviewed'));
                          const selectedCount = selectable.filter(entry => scopeIsEnabled(req, entry.scope_key)).length;
                          const allSelected = selectable.length > 0 && selectedCount === selectable.length;
                          const partiallySelected = selectedCount > 0 && !allSelected;
                          const setSampleEnabled = (enabled: boolean) => {
                            setScopeEnabled(prev => {
                              const next = { ...prev };
                              selectable.forEach(entry => { next[`${req.id}:${entry.scope_key}`] = enabled; });
                              return next;
                            });
                            setRequisitions(prev => prev.map(row => row.id === req.id
                              ? { ...row, generation_configured_at: null, generation_configured_by: null }
                              : row));
                          };
                          return (
                          <div key={sampleKey} style={{ marginBottom: 4 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#555', fontWeight: 500, padding: '2px 0' }}>
                              <Tooltip title={selectable.length ? `选择样品“${group.label}”的全部可用项目` : '该样品暂无可纳入的已审核项目'}>
                                <Checkbox
                                  aria-label={`选择样品 ${group.label}`}
                                  checked={allSelected}
                                  indeterminate={partiallySelected}
                                  disabled={!canEditReports || !selectable.length}
                                  onChange={(event) => setSampleEnabled(event.target.checked)}
                                />
                              </Tooltip>
                              <span onClick={() => setCollapsedSamples(prev => {
                                const next = new Set(prev); if (next.has(collapseKey)) next.delete(collapseKey); else next.add(collapseKey); return next;
                              })} style={{ cursor: 'pointer', userSelect: 'none' }}>
                                {collapsed ? '▸' : '▾'}　{group.label}
                              </span>
                              <span style={{ color: '#999', fontWeight: 400 }}>（{selectedCount}/{selectable.length || entries.length}）</span>
                            </div>
                            {!collapsed && entries.map(entry => {
                              const savedSelection = selectionFor(req, entry.scope_key);
                              const assignment = entry.assignments.find(a => a.record_data_status === 'reviewed' && Number(a.record_data_id) === Number(savedSelection?.record_data_id))
                                || entry.assignments.find(a => a.record_data_status === 'reviewed')
                                || entry.assignments[0];
                              const candidates = assignment?.project_template_candidates || [];
                              const savingKey = `${req.id}:${entry.scope_key}:${assignment?.record_data_id}`;
                              const selectedCandidate = candidates.find(c => c.id === assignment?.project_template_id);
                              const recommendedCandidate = assignment ? preferredCandidate(assignment) : undefined;
                              const enabled = scopeIsEnabled(req, entry.scope_key);
                              return (
                                <div key={entry.scope_key} style={{
                                  display: 'grid', opacity: enabled ? 1 : 0.55,
                                  gridTemplateColumns: '28px minmax(130px, 1fr) minmax(260px, 420px) auto',
                                  alignItems: 'center', gap: 8, padding: '6px 0 6px 8px',
                                  fontSize: 12, borderBottom: '1px solid #f5f6f8',
                                }}>
                                  <Checkbox
                                    aria-label={`选择项目 ${entry.project_name}`}
                                    checked={enabled}
                                    disabled={!canEditReports || entry.status !== 'matched' || !entry.assignments.some(a => a.record_data_status === 'reviewed')}
                                    onChange={(event) => {
                                      setScopeEnabled(prev => ({ ...prev, [`${req.id}:${entry.scope_key}`]: event.target.checked }));
                                      setRequisitions(prev => prev.map(row => row.id === req.id
                                        ? { ...row, generation_configured_at: null, generation_configured_by: null }
                                        : row));
                                    }}
                                  />
                                  <span style={{ color: '#333' }}>{entry.project_name}{entry.method_name && <span style={{ display: 'block', color: '#888' }}>{entry.method_name}</span>}</span>
                                  {entry.status === 'matched' && assignment ? (
                                    <Select
                                      size="small"
                                      showSearch
                                      optionFilterProp="label"
                                      value={assignment.project_template_id ?? recommendedCandidate?.id}
                                      placeholder={recommendedCandidate ? `推荐：${recommendedCandidate.name}` : (candidates.length ? '请选择项目模板' : '没有已生效的关联模板')}
                                      // 已生成报告也允许先调整项目模板；点击「应用范围到本报告」后再统一重算明细页。
                                      // 先前把 generated 且非 stale 的条目禁用，导致“调整范围”能勾选、模板却无法选择。
                                      disabled={!canEditReports || !enabled || !candidates.length}
                                      loading={selectingTemplate === savingKey}
                                      onChange={(value) => saveTemplateSelection(req, entry, assignment.record_data_id, value)}
                                      options={candidates.map(c => ({
                                        value: c.id,
                                        label: `${c.name} · v${c.version_no}${c.project_name ? ` · ${c.project_name}` : ''}${recommendedCandidate?.id === c.id ? '（默认）' : ''}`,
                                      }))}
                                    />
                                  ) : (
                                    <span style={{ color: '#d48806' }}>{entry.note || '未匹配原始记录'}</span>
                                  )}
                                  <Space size={4}>
                                    {selectedCandidate && (
                                      <Tooltip title="预览所选项目模板">
                                        <Button size="small" type="text" icon={<EyeOutlined />}
                                          onClick={() => setPreviewCover({ id: selectedCandidate.id, name: selectedCandidate.name })} />
                                      </Tooltip>
                                    )}
                                    {entry.status === 'matched'
                                      ? <Tag color={assignment?.project_template_id ? 'green' : 'orange'} style={{ margin: 0 }}>
                                          {assignment?.project_template_id ? '已选择' : recommendedCandidate ? '默认模板' : '暂无模板'}
                                        </Tag>
                                      : <Tag color="orange" style={{ margin: 0 }}>待补充</Tag>}
                                  </Space>
                                </div>
                              );
                            })}
                          </div>
                          );
                        })}
                        </div>
                        {!generated && (
                          <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 10 }}>
                            <Button type="primary" icon={<SettingOutlined />} loading={configuringReq === req.id}
                              disabled={!canEditReports || locked}
                              onClick={() => generateRequisition(req)}>
                              生成报告
                            </Button>
                          </div>
                        )}
                        {generated && (
                          <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 10 }}>
                            <Popconfirm
                              title="应用新的样品/项目范围？"
                              description="会按新范围重算报告；项目明细页的手动文字修改将重置，首页结构、图片和样式保留。"
                              okText="应用"
                              cancelText="取消"
                              onConfirm={() => applyGeneratedScope(req)}
                            >
                              <Button type="primary" icon={<SettingOutlined />} loading={rescopingReq === req.id} disabled={!canEditReports || locked}>
                                应用范围到本报告
                              </Button>
                            </Popconfirm>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </Card>
          ) : (
            <Alert type="info" showIcon style={{ marginBottom: 12 }}
              message="尚未收到报告编号"
              description="报告编号与范围由外部系统下发。收到后系统会匹配已审核通过的原始记录；生成时自动采用可用项目模板，也可展开改选。在此之前可先编辑首页、查看录入进度与只读原始记录。" />
          )}

          {/* 报告退回(scope=report)的退回意见与处理已就近在每份报告条目内；不再单设底部「外部返工」面板。 */}

        </div>
      </div>

      <ReadonlyRecordViewer
        recordId={viewerRec?.id ?? null}
        open={!!viewerRec}
        subtitle={viewerRec?.subtitle}
        onClose={() => setViewerRec(null)}
        onRejected={reloadRecords}
      />

      <Drawer
        title={`订单时间线 · ${orderHeader.order_no}`}
        open={timelineOpen}
        onClose={() => setTimelineOpen(false)}
        width="46%"
      >
        <Alert type="info" showIcon banner style={{ marginBottom: 16 }}
          message="自始至终谁在哪个阶段、因为什么、改了哪里——退回工单 + 录入审计 + 报告审计按时间合并。" />
        {timelineLoading
          ? <Empty description="加载中…" />
          : timelineEvents.length === 0
            ? <Empty description="暂无事件" />
            : (
              <Timeline
                items={timelineEvents.map(e => ({
                  color: e.type === 'rework' ? 'red' : e.type === 'report_audit' ? 'blue' : 'green',
                  children: (
                    <div>
                      <div style={{ fontWeight: 500 }}>{e.title}</div>
                      {e.detail && <div style={{ fontSize: 12, color: '#555' }}>{e.detail}</div>}
                      <div style={{ fontSize: 11, color: '#999' }}>
                        {e.actor || '—'}{e.role ? `（${e.role}）` : ''} · {e.ts ? new Date(e.ts).toLocaleString() : ''}
                        {e.status ? ` · ${e.status}` : ''}
                      </div>
                    </div>
                  ),
                }))}
              />
            )}
      </Drawer>

      {/* ── 报告历史版本：退回修改→重新生成保留的旧版，可逐版下载 PDF ── */}
      <Drawer
        title={historyFor ? `历史版本 · ${historyFor.report_number}` : '历史版本'}
        open={!!historyFor}
        onClose={() => setHistoryFor(null)}
        width="40%"
      >
        <Alert type="info" showIcon banner style={{ marginBottom: 16 }}
          message="每次退回修改后重新生成都会保留旧版本（数据快照随当时生成固化），可逐版查看/下载 PDF。" />
        {historyLoading
          ? <Empty description="加载中…" />
          : historyRows.length === 0
            ? <Empty description="暂无历史版本" />
            : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {historyRows.map(v => {
                  const accent = v.is_current ? '#16a34a' : '#d0d7e2';
                  const d = v.generated_at ? new Date(v.generated_at) : null;
                  const dateStr = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '—';
                  return (
                    <div key={v.id} style={{ border: '1px solid #e8ecf3', borderLeft: `3px solid ${accent}`, borderRadius: 8, padding: '10px 12px', background: '#fff' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 15, color: '#1f2733' }}>v{v.version}</span>
                        {v.is_current ? <Tag color="green" style={{ margin: 0 }}>当前版本</Tag> : <Tag style={{ margin: 0 }}>历史版本</Tag>}
                        {v.edited && <Tag color="blue" style={{ margin: 0 }}>已编辑</Tag>}
                        <div style={{ flex: 1 }} />
                        <Button size="small" type="primary" ghost icon={<DownloadOutlined />}
                          onClick={() => setPreviewReport({
                            id: v.id,
                            name: `${v.report_no || historyFor?.report_number || `报告 #${v.id}`} · v${v.version}`,
                          })}>查看此版本 PDF</Button>
                      </div>
                      <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '5px 12px', fontSize: 12, alignItems: 'baseline' }}>
                        <span style={{ color: '#8a93a3' }}>报告编号</span><span style={{ fontFamily: 'monospace', color: '#1f2733' }}>{v.report_no || `#${v.id}`}</span>
                        <span style={{ color: '#8a93a3' }}>生成人</span><span style={{ color: '#1f2733', fontWeight: 500 }}>{v.generated_by || '—'}</span>
                        <span style={{ color: '#8a93a3' }}>日期</span><span style={{ color: '#555' }}>{dateStr}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
      </Drawer>
      <TemplatePdfPreviewModal
        open={!!previewCover}
        kind="report"
        templateId={previewCover?.id ?? 0}
        templateName={previewCover?.name || ''}
        onClose={() => setPreviewCover(null)}
      />
      <PdfPreviewModal
        open={!!previewReport}
        title={`预览 · ${previewReport?.name || ''}`}
        reloadKey={previewReport?.id}
        loadPdf={() => getGeneratedReportPreviewPdf(previewReport!.id)}
        downloadName={`${previewReport?.name || '报告'}.pdf`}
        onClose={() => setPreviewReport(null)}
      />
    </div>
  );
}
