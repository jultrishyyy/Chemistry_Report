import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Card, Input, Space, Tag, Button, Table, Modal, List, Empty, message,
  Drawer, Timeline, Alert, Tooltip, Radio, Collapse, Spin, Form, Divider, Segmented, Select, Checkbox,
  Descriptions,
} from 'antd';
import {
  SearchOutlined, EditOutlined, LinkOutlined, DisconnectOutlined,
  AuditOutlined, HistoryOutlined, ArrowLeftOutlined,
  PlusOutlined, MinusCircleOutlined, FormOutlined, ProfileOutlined, PictureOutlined,
  CheckCircleOutlined, RollbackOutlined, EyeOutlined, PaperClipOutlined,
  ApartmentOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import { useAuth } from '../../auth';
import { BRAND } from '../../theme';
import FlowSteps from '../../components/FlowSteps';
import ImageUploadPanel from '../../components/ImageUploadPanel';
import AttachmentManager from '../../components/AttachmentManager';
import PdfDownloadButton from '../../components/PdfDownloadButton';
import { downloadFilledRecordPdf } from '../../utils/pdfDownload';
import ReadonlyRecordViewer from '../../components/ReadonlyRecordViewer';
import TemplatePdfPreviewModal from '../../components/TemplatePdfPreviewModal';
import {
  type WorkOrder, type TemplateItem, type RecordRow, type RowVm,
  type AuditEvent, buildOrderRows, orderProgress, ACTION_LABEL, ACTION_COLOR, ACTION_HEX,
  computeDiff, stringify,
} from './order-shared';
import { isInteractiveRowTarget } from '../../utils/rowNavigation';
import { ProjectInfoInline } from './OrderProjectInfo';

const API = '/api';

const workflowIconStyle = {
  submit: { color: '#1677ff', borderColor: '#91caff', background: '#f0f7ff' },
  withdraw: { color: '#d46b08', borderColor: '#ffd591', background: '#fff7e6' },
  review: { color: '#389e0d', borderColor: '#b7eb8f', background: '#f6ffed' },
} as const;

const SOURCE_TAG: Record<string, { color: string; label: string }> = {
  external: { color: 'blue', label: '接口' },
  manual: { color: 'gold', label: '手动' },
};

const displayOrderValue = (value: unknown): React.ReactNode => {
  if (value === null || value === undefined || value === '') return <span style={{ color: '#a0a8b5' }}>—</span>;
  return String(value);
};

/** 接口时间不带时区，直接做可读化，避免浏览器按本地时区二次偏移。 */
const displayOrderDateTime = (value?: string): React.ReactNode => {
  if (!value) return displayOrderValue(value);
  return value.replace('T', ' ').replace(/\.\d+(?=Z?$)/, '').replace(/Z$/, '');
};

const displayOrderBoolean = (value?: boolean): React.ReactNode => {
  if (value === undefined || value === null) return displayOrderValue(value);
  return <Tag color={value ? 'green' : 'default'} style={{ margin: 0 }}>{value ? '是' : '否'}</Tag>;
};

/** 样品色块调色板（柔和、克制）；按样品顺序轮换分配，相邻样品颜色不同 */
const SAMPLE_PALETTE = [
  { bg: '#eef4ff', accent: '#1366d9' },
  { bg: '#eafaf0', accent: '#16a34a' },
  { bg: '#fff4e6', accent: '#d97706' },
  { bg: '#f4eefe', accent: '#7c3aed' },
  { bg: '#e6f7fb', accent: '#0891b2' },
  { bg: '#fdeef3', accent: '#db2777' },
];

/** 字段改动列表（高亮）：新增=蓝、删除=红删除线、修改=旧值红删除线 → 新值绿。多处复用（历史卡片 / 审核弹窗 / 审核记录）。 */
function DiffList({ diffs }: { diffs: ReturnType<typeof computeDiff> }) {
  if (!diffs.length) return <span style={{ fontSize: 12, color: '#8a93a3' }}>（与上一版无字段变化）</span>;
  return (
    <div style={{ fontSize: 12, fontFamily: 'monospace', lineHeight: 1.7 }}>
      {diffs.map((d, i) => (
        <div key={i} style={{ padding: '1px 0' }}>
          <Tag color={d.kind === 'added' ? 'blue' : d.kind === 'removed' ? 'red' : 'orange'} style={{ marginRight: 4 }}>
            {d.kind === 'added' ? '新增' : d.kind === 'removed' ? '删除' : '修改'}
          </Tag>
          <strong>{d.key}</strong>
          {d.kind === 'changed' && (
            <span>：<span style={{ color: '#cf1322', background: '#fff1f0', textDecoration: 'line-through', padding: '0 3px', borderRadius: 3 }}>{stringify(d.from)}</span>
              {' → '}<span style={{ color: '#16a34a', background: '#f6ffed', padding: '0 3px', borderRadius: 3 }}>{stringify(d.to)}</span></span>
          )}
          {d.kind === 'added' && <span>：<span style={{ color: '#16a34a', background: '#f6ffed', padding: '0 3px', borderRadius: 3 }}>{stringify(d.to)}</span></span>}
          {d.kind === 'removed' && <span>：<span style={{ color: '#cf1322', textDecoration: 'line-through' }}>{stringify(d.from)}</span></span>}
        </div>
      ))}
    </div>
  );
}

export default function LabOrderDetail() {
  const navigate = useNavigate();
  const { orderNo } = useParams<{ orderNo: string }>();
  const { user, has } = useAuth();
  const [order, setOrder] = useState<WorkOrder | null>(null);
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [linkModal, setLinkModal] = useState<{ sample_id: string; test_name: string; linkedIds: number[] } | null>(null);
  const [linkKeyword, setLinkKeyword] = useState('');
  const [bulkLinkOpen, setBulkLinkOpen] = useState(false);
  const [bulkTargetKeys, setBulkTargetKeys] = useState<string[]>([]);
  const [bulkTemplateId, setBulkTemplateId] = useState<number | undefined>();
  const [bulkLinking, setBulkLinking] = useState(false);
  const [bulkSearch, setBulkSearch] = useState('');
  const [methodGroups, setMethodGroups] = useState<any[]>([]);
  const [batchModal, setBatchModal] = useState<{ sampleId: string; sampleName: string; testName: string; batchId?: number | null } | null>(null);
  const [batchMethodIds, setBatchMethodIds] = useState<number[]>([]);
  const [batchExistingMethodIds, setBatchExistingMethodIds] = useState<number[]>([]);
  const [batchSharedProfile, setBatchSharedProfile] = useState<string | null>(null);
  const [batchCreating, setBatchCreating] = useState(false);

  const [auditDrawer, setAuditDrawer] = useState(false);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const [reviewModal, setReviewModal] = useState<{ row: RowVm } | null>(null);
  const [reviewBatch, setReviewBatch] = useState<any>(null);
  const [reviewRecordIds, setReviewRecordIds] = useState<number[]>([]);
  // 审核弹窗里展示「本次提交相对上一版的改动」（diff 高亮）
  const [reviewDiff, setReviewDiff] = useState<{ loading: boolean; diffs: ReturnType<typeof computeDiff>; hasPrev: boolean }>({ loading: false, diffs: [], hasPrev: false });
  const [reviewDecision, setReviewDecision] = useState<'approve' | 'reject'>('approve');
  const [reviewNote, setReviewNote] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);

  // 编辑订单结构
  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editForm] = Form.useForm();
  // 变更记录
  const [changeLogOpen, setChangeLogOpen] = useState(false);
  const [changeLog, setChangeLog] = useState<any[]>([]);
  const [changeLogLoading, setChangeLogLoading] = useState(false);
  // 单独上传图片
  const [imageModal, setImageModal] = useState<{ templateId: number; sampleId: string; sampleName: string; testName: string; readOnly?: boolean } | null>(null);
  // 通用附件（任意格式）弹窗：按 record_data id 上传/下载
  const [attachModal, setAttachModal] = useState<{
    recordId: number | null;
    templateId: number;
    sampleId: string;
    testName: string;
    subtitle: string;
    readOnly?: boolean;
  } | null>(null);
  // 只读查看（渲染后的原始记录）：已审核锁定的记录，或审核弹窗里预览待审核记录（hideReject=审核场景，退回走审核弹窗）
  const [viewRec, setViewRec] = useState<{ id: number; subtitle: string; hideReject?: boolean } | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<{ id: number; name: string } | null>(null);
  // 单条记录的历史版本（含旧版）：列表 + 逐版快照渲染
  const [verHistory, setVerHistory] = useState<{ recordId: number; subtitle: string } | null>(null);
  const [verFilter, setVerFilter] = useState<string>('all');   // 按操作筛选：all/submit/update/review/reject
  const [verEvents, setVerEvents] = useState<AuditEvent[]>([]);
  const [verLoading, setVerLoading] = useState(false);
  const [verView, setVerView] = useState<{ recordId: number; subtitle: string; snapshot: Record<string, any>; label: string } | null>(null);

  const fetchAll = async () => {
    if (!orderNo) return;
    setLoading(true);
    try {
      const [wo, tpls, recs, methods] = await Promise.all([
        axios.get(`${API}/work-orders/${orderNo}`),
        // 全量拉取（含未审核）：未审核模板在关联弹窗中【显示但禁选】并标注（比隐藏更不困惑）；
        // 可关联的仍只有 current_status='approved' 的（后端 /link op=add 也有 409 护栏）。
        axios.get(`${API}/record-templates`),
        axios.get(`${API}/record-data?order_no=${orderNo}`),
        axios.get(`${API}/test-methods/groups`),
      ]);
      setOrder(wo.data);
      setTemplates(tpls.data);
      setRecords(recs.data);
      setMethodGroups(methods.data || []);
    } catch (e: any) {
      if (e.response?.status === 404) setNotFound(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [orderNo]);

  const templateById = useMemo(() => {
    const m = new Map<number, TemplateItem>();
    for (const t of templates) m.set(t.id, t);
    return m;
  }, [templates]);

  const linkableTemplates = useMemo(
    () => templates.filter(t => !t.name.startsWith('基础')),
    [templates]
  );

  const rows = useMemo(
    () => order ? buildOrderRows(order, records, templateById) : [],
    [order, records, templateById]
  );

  /** 每个样品分配一个色块（按出现顺序轮换） */
  const sampleColor = useMemo(() => {
    const m = new Map<string, { bg: string; accent: string }>();
    (order?.payload.samples || []).forEach((s, i) => m.set(s.id, SAMPLE_PALETTE[i % SAMPLE_PALETTE.length]));
    return m;
  }, [order]);

  // 哪些已关联模板【确实含图片字段】——只对这些行显示「图片」按钮（列表接口不带字段定义，按需拉取判断）
  const [imgTplIds, setImgTplIds] = useState<Set<number>>(new Set());
  const [checkedTplIds, setCheckedTplIds] = useState<Set<number>>(new Set());
  useEffect(() => {
    const ids = Array.from(new Set(rows.map(r => r.linked_template_id).filter(Boolean))) as number[];
    const toCheck = ids.filter(id => !checkedTplIds.has(id));
    if (!toCheck.length) return;
    let cancelled = false;
    (async () => {
      const found = new Set<number>();
      await Promise.all(toCheck.map(async id => {
        try {
          const r = await axios.get(`${API}/record-templates/${id}`);
          const groups = r.data.field_definitions || [];
          if (groups.some((g: any) => (g.fields || []).some((f: any) => f.type === 'image'))) found.add(id);
        } catch { /* ignore */ }
      }));
      if (cancelled) return;
      setCheckedTplIds(prev => new Set([...prev, ...toCheck]));
      if (found.size) setImgTplIds(prev => new Set([...prev, ...found]));
    })();
    return () => { cancelled = true; };
  }, [rows, checkedTplIds]);

  /** 「测试项目」列 rowSpan：同一测试项目的多条关联行合并成一格 */
  const sampleRowSpan = (row: RowVm): number => {
    const i = rows.findIndex(r => r.key === row.key);
    if (i > 0 && rows[i - 1].sample_id === row.sample_id) return 0;
    let span = 1;
    for (let j = i + 1; j < rows.length && rows[j].sample_id === row.sample_id; j++) span++;
    return span;
  };

  const testRowSpan = (row: RowVm): number => {
    const i = rows.findIndex(r => r.key === row.key);
    if (i > 0 && rows[i - 1].test_key === row.test_key) return 0;
    let span = 1;
    for (let j = i + 1; j < rows.length && rows[j].test_key === row.test_key; j++) span++;
    return span;
  };

  // 进度按「样品×测试项目」格统计（一个格可能有多条关联行）
  const progress = useMemo(
    () => order ? orderProgress(order, records) : { testTotal: 0, linked: 0, recorded: 0, reviewed: 0, rejected: 0, sampleCount: 0 },
    [order, records]
  );

  // 被退回的原始记录 + 退回意见（外部退回会让多条记录带同一条意见 → 去重汇总到顶部横幅，主检一眼看清要改什么）
  const rejectedRecords = useMemo(() => records.filter(r => r.audit_status === 'rejected'), [records]);
  const rejectNotes = useMemo(
    () => Array.from(new Set(rejectedRecords.map(r => (r.reject_note || '').trim()).filter(Boolean))),
    [rejectedRecords],
  );

  const openLinkModal = (sample_id: string, test_name: string, linkedIds: number[]) => {
    if (!has('record.entry')) {
      message.warning('当前账号没有录入权限，只能查看关联关系');
      return;
    }
    setLinkKeyword('');
    setLinkModal({ sample_id, test_name, linkedIds });
  };

  /** 给某测试项目添加一个关联模板（op=add，可多次） */
  const addLink = async (template_id: number) => {
    if (!linkModal || !orderNo) return;
    if (!has('record.entry')) { message.warning('当前账号没有录入权限'); return; }
    try {
      await axios.put(`${API}/work-orders/${orderNo}/link`, {
        sample_id: linkModal.sample_id,
        test_name: linkModal.test_name,
        linked_template_id: template_id,
        op: 'add',
      });
      message.success('关联成功');
      setLinkModal(null);
      fetchAll();
    } catch (e: any) {
      message.error('操作失败：' + (e.response?.data?.error || e.message));
    }
  };

  const openMethodBatch = async (row: RowVm) => {
    if (!has('record.entry')) { message.warning('当前账号没有录入权限'); return; }
    setBatchMethodIds([]);
    setBatchExistingMethodIds([]);
    setBatchSharedProfile(null);
    const batchId = row.record?.record_batch_id || null;
    setBatchModal({ sampleId: row.sample_id, sampleName: row.sample_name, testName: row.test_name, batchId });
    if (batchId) {
      try {
        const detail = (await axios.get(`${API}/record-batches/${batchId}`)).data;
        setBatchExistingMethodIds((detail.items || []).map((item: any) => Number(item.method_scheme_id)));
        setBatchSharedProfile(String(detail.shared_profile_code || 'default'));
      } catch (error: any) { message.error(error?.response?.data?.error || '现有批次加载失败'); }
    }
  };

  const createMethodBatch = async () => {
    if (!batchModal || !orderNo || !batchMethodIds.length) return;
    setBatchCreating(true);
    try {
      const selected = methodGroups.flatMap(group => group.methods || []).filter((method: any) => batchMethodIds.includes(method.id));
      const groupIds = new Set(selected.map((method: any) => method.group_id).filter(Boolean));
      const response = batchModal.batchId
        ? await axios.post(`${API}/record-batches/${batchModal.batchId}/methods`, { method_scheme_ids: batchMethodIds })
        : await axios.post(`${API}/record-batches`, {
            order_no: orderNo,
            sample_external_id: batchModal.sampleId,
            test_item_name: batchModal.testName,
            template_group_id: groupIds.size === 1 ? [...groupIds][0] : undefined,
            method_scheme_ids: batchMethodIds,
          });
      const batchId = batchModal.batchId || response.data.id;
      const detail = (await axios.get(`${API}/record-batches/${batchId}`)).data;
      message.success(batchModal.batchId
        ? `已向批次追加 ${batchMethodIds.length} 种测试方法`
        : `已创建多方法录入批次，共 ${detail.items?.length || batchMethodIds.length} 份原始记录`);
      setBatchModal(null); setBatchMethodIds([]); await fetchAll();
      const first = detail.items?.find((item: any) => batchMethodIds.includes(Number(item.method_scheme_id))) || detail.items?.[0];
      if (first) {
        const params = new URLSearchParams({
          id: String(first.record_data_id), template_id: String(first.record_template_id), order_no: orderNo,
          sample_id: batchModal.sampleId, sample_name: batchModal.sampleName, test_name: batchModal.testName,
        });
        navigate(`/lab/record?${params.toString()}`);
      }
    } catch (error: any) {
      message.error(error?.response?.data?.error || '创建多方法录入批次失败');
    } finally { setBatchCreating(false); }
  };

  /** 从某测试项目移除一个关联模板（op=remove）——同时删除该模板在本项目下的【全部】录入数据（草稿/待审核/被退回），
   *  使重新关联是干净的空白新录入。已审核通过(reviewed)的记录后端 409 拒绝解除（按钮也已禁用）。 */
  const removeLink = (sample_id: string, test_name: string, template_id: number) => {
    if (!orderNo) return;
    if (!has('record.entry')) { message.warning('当前账号没有录入权限'); return; }
    Modal.confirm({
      title: '解除关联',
      content: '解除关联将同时删除该原始记录在本项目下已录入的全部数据（含草稿、待审核、被退回），且不可恢复；重新关联后将是全新的空白录入。确定解除吗？',
      okText: '解除关联',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          const res = await axios.put(`${API}/work-orders/${orderNo}/link`, {
            sample_id, test_name, linked_template_id: template_id, op: 'remove',
          });
          const removed = res.data?.removed_records || 0;
          message.success(removed > 0 ? `已解除关联，并删除 ${removed} 条录入数据` : '已解除关联');
          fetchAll();
        } catch (e: any) {
          message.error('操作失败：' + (e.response?.data?.error || e.message));
        }
      },
    });
  };

  const goRecord = (row: RowVm) => {
    if (!row.linked_template_id || !orderNo) return;
    // 有录入权限且记录未锁定 → 编辑；其余身份留在列表页，用弹窗预览。
    const canEdit = !!user && has('record.entry') && row.record?.audit_status !== 'reviewed';
    if (!canEdit) {
      if (row.record) {
        setViewRec({ id: row.record.id, subtitle: `${row.sample_name} · ${row.test_name}` });
      } else {
        setPreviewTemplate({
          id: row.linked_template_id,
          name: row.linked_template_name || `原始记录模板 #${row.linked_template_id}`,
        });
      }
      return;
    }
    const params = new URLSearchParams({
      template_id: String(row.linked_template_id),
      order_no: orderNo,
      sample_id: row.sample_id,
      sample_name: row.sample_name,
      test_name: row.test_name,
    });
    if (row.record) params.set('id', String(row.record.id));
    navigate(`/lab/record?${params.toString()}`);
  };

  const handleReview = async (row: RowVm) => {
    if (!row.record) return;
    if (!user || !has('record.review')) { message.warning('当前角色无审核权限'); return; }
    // 允许自审：主检可审核自己的记录（取消"主检与审核人不能为同一人"前端拦截）
    setReviewDecision('approve');
    setReviewNote('');
    setReviewBatch(null);
    setReviewRecordIds([row.record.id]);
    setReviewModal({ row });
    // 取该记录版本快照，算「待审版相对上一版」的字段改动，供审核员看清这次改了什么
    setReviewDiff({ loading: true, diffs: [], hasPrev: false });
    try {
      const [auditResponse, batchResponse] = await Promise.all([
        axios.get(`${API}/audit-log?record_id=${row.record.id}`),
        row.record.record_batch_id
          ? axios.get(`${API}/record-batches/${row.record.record_batch_id}`).catch(() => null)
          : Promise.resolve(null),
      ]);
      if (batchResponse?.data) {
        setReviewBatch(batchResponse.data);
        setReviewRecordIds((batchResponse.data.items || [])
          .filter((item: any) => item.audit_status === 'pending')
          .map((item: any) => Number(item.record_data_id)));
      }
      const evs = (auditResponse.data || []).filter((e: AuditEvent) => e.data_snapshot && Object.keys(e.data_snapshot).length > 0);
      // 接口按时间倒序：evs[0]=最新(待审版)，evs[1]=上一版
      const curr = evs[0]?.data_snapshot || null;
      const prev = evs[1]?.data_snapshot || null;
      setReviewDiff({ loading: false, diffs: computeDiff(prev, curr), hasPrev: !!prev });
    } catch {
      setReviewDiff({ loading: false, diffs: [], hasPrev: false });
    }
  };

  const submitReview = async () => {
    if (!reviewModal?.row?.record) return;
    if (reviewDecision === 'reject' && !reviewNote.trim()) {
      message.warning('退回必须填写备注');
      return;
    }
    if (reviewModal.row.record.record_batch_id && !reviewRecordIds.length) {
      message.warning('请至少选择一份需要审核的原始记录'); return;
    }
    setReviewSubmitting(true);
    try {
      const record = reviewModal.row.record;
      const reviewUrl = record.record_batch_id
        ? `${API}/record-batches/${record.record_batch_id}/review`
        : `${API}/record-data/${record.id}/review`;
      const reviewResponse = await axios.post(reviewUrl, {
        decision: reviewDecision,
        note: reviewNote.trim() || undefined,
        ...(record.record_batch_id ? { record_data_ids: reviewRecordIds } : {}),
      });
      message.success(record.record_batch_id
        ? (reviewDecision === 'approve' ? `所选 ${reviewRecordIds.length} 份原始记录已审核通过` : `所选 ${reviewRecordIds.length} 份原始记录已退回`)
        : (reviewDecision === 'approve' ? '审核通过' : '已退回'));
      if (reviewDecision === 'approve') {
        const updates = Array.isArray(reviewResponse.data?.task_state_updates) ? reviewResponse.data.task_state_updates : [];
        const warnings = updates.filter((item: any) => ['failed', 'missing_task_id', 'mock'].includes(item?.status));
        if (warnings.length) {
          const first = warnings[0];
          message.warning(first.status === 'mock'
            ? '当前为演示模式，材料任务完工状态尚未发送到外部系统'
            : `本地审核已通过，但外部任务状态尚未更新：${first.error || '已进入后台重试'}`,
          );
        }
      }
      setReviewModal(null); setReviewBatch(null); setReviewRecordIds([]);
      fetchAll();
    } catch (e: any) {
      message.error('审核失败：' + (e.response?.data?.error || e.message));
    } finally {
      setReviewSubmitting(false);
    }
  };

  const submitRecord = async (record: RecordRow) => {
    try {
      await axios.post(record.record_batch_id
        ? `${API}/record-batches/${record.record_batch_id}/submit`
        : `${API}/record-data/${record.id}/submit`);
      message.success(record.record_batch_id ? '本批次全部原始记录已提交审核' : '已提交审核');
      fetchAll();
    } catch (e: any) {
      message.error('提交失败：' + (e.response?.data?.error || e.message));
    }
  };

  const withdrawRecord = async (record: RecordRow) => {
    try {
      await axios.post(record.record_batch_id
        ? `${API}/record-batches/${record.record_batch_id}/withdraw`
        : `${API}/record-data/${record.id}/withdraw`);
      message.success(record.record_batch_id ? '本批次全部原始记录已撤回' : '已撤回，回到草稿');
      fetchAll();
    } catch (e: any) {
      message.error('撤回失败：' + (e.response?.data?.error || e.message));
    }
  };

  /** 尚未录入的项目在真正选择附件时才创建草稿，避免仅打开附件弹窗就制造空记录。 */
  const ensureAttachmentRecord = async (): Promise<number | null> => {
    if (!attachModal || !orderNo || attachModal.readOnly) return attachModal?.recordId || null;
    if (attachModal.recordId) return attachModal.recordId;
    try {
      const res = await axios.post(`${API}/record-data`, {
        template_id: attachModal.templateId,
        raw_data: {},
        derived_data: {},
        ad_hoc_fields: [],
        order_no: orderNo,
        sample_external_id: attachModal.sampleId,
        test_item_name: attachModal.testName,
        status: 'draft',
      });
      const id = Number(res.data?.id);
      if (!Number.isFinite(id)) throw new Error('创建草稿后未返回记录编号');
      setAttachModal(prev => prev ? { ...prev, recordId: id } : prev);
      await fetchAll();
      return id;
    } catch (e: any) {
      message.error('创建附件草稿失败：' + (e.response?.data?.error || e.message));
      return null;
    }
  };

  const openAuditDrawer = async () => {
    if (!orderNo) return;
    setAuditDrawer(true);
    setAuditLoading(true);
    try {
      const r = await axios.get(`${API}/audit-log?order_no=${orderNo}`);
      setAuditEvents(r.data);
    } finally {
      setAuditLoading(false);
    }
  };

  const openVersionHistory = async (recordId: number, subtitle: string) => {
    setVerHistory({ recordId, subtitle });
    setVerFilter('all');
    setVerEvents([]);
    setVerLoading(true);
    try {
      const r = await axios.get(`${API}/audit-log?record_id=${recordId}`);
      setVerEvents(r.data || []);
    } catch (e: any) {
      message.error('加载历史版本失败：' + (e.response?.data?.error || e.message));
    } finally {
      setVerLoading(false);
    }
  };

  const openEdit = () => {
    if (!order) return;
    if (!has('record.entry')) {
      message.warning('当前账号没有录入权限，不能修改订单');
      return;
    }
    editForm.setFieldsValue({
      samples: (order.payload.samples || []).map(s => ({
        id: s.id,
        name: s.name,
        test_infos: (s.test_infos || []).map(t => ({ _orig_name: t.name, name: t.name, standard: t.standard || '' })),
      })),
    });
    setEditOpen(true);
  };

  const submitEdit = async () => {
    if (!orderNo) return;
    let values: any;
    try { values = await editForm.validateFields(); }
    catch { return; }
    setEditSaving(true);
    try {
      const res = await axios.put(`${API}/work-orders/${orderNo}/structure`, {
        samples: (values.samples || []).map((s: any) => ({
          id: s.id || undefined,
          name: s.name,
          test_infos: (s.test_infos || []).map((t: any) => ({
            _orig_name: t._orig_name || undefined,
            name: t.name,
            standard: t.standard || undefined,
          })),
        })),
      });
      if (res.data?.no_change) message.info('未检测到改动');
      else message.success('已保存：' + (res.data?.summary || '订单已更新'));
      setEditOpen(false);
      fetchAll();
    } catch (e: any) {
      const blocked: string[] | undefined = e.response?.data?.blocked;
      if (blocked?.length) {
        Modal.error({
          title: '部分修改被拦截，未保存',
          width: 560,
          content: (
            <ul style={{ paddingLeft: 18, marginTop: 8 }}>
              {blocked.map((b, i) => <li key={i} style={{ marginBottom: 4 }}>{b}</li>)}
            </ul>
          ),
        });
      } else {
        message.error('保存失败：' + (e.response?.data?.error || e.message));
      }
    } finally {
      setEditSaving(false);
    }
  };

  const openChangeLog = async () => {
    if (!orderNo) return;
    setChangeLogOpen(true);
    setChangeLogLoading(true);
    try {
      const r = await axios.get(`${API}/work-orders/${orderNo}/audit-log`);
      setChangeLog(r.data);
    } finally {
      setChangeLogLoading(false);
    }
  };

  const filteredLinkable = useMemo(() => {
    const linked = new Set(linkModal?.linkedIds || []);
    const k = linkKeyword.trim().toLowerCase();
    return linkableTemplates.filter(t =>
      !linked.has(t.id) && (!k || t.name.toLowerCase().includes(k))
    );
  }, [linkableTemplates, linkKeyword, linkModal]);

  const bulkTargets = useMemo(() => (order?.payload.samples || []).flatMap(sample =>
    (sample.test_infos || []).map(test => ({ key: `${sample.id}\u0000${test.name}`, sampleId: sample.id, sampleName: sample.name, testName: test.name }))), [order]);
  const bulkGroups = useMemo(() => {
    const keyword = bulkSearch.trim().toLowerCase();
    const groups = new Map<string, { sampleId: string; sampleName: string; items: typeof bulkTargets }>();
    for (const target of bulkTargets) {
      const sampleMatched = target.sampleName.toLowerCase().includes(keyword) || target.sampleId.toLowerCase().includes(keyword);
      const projectMatched = target.testName.toLowerCase().includes(keyword);
      if (keyword && !sampleMatched && !projectMatched) continue;
      const group = groups.get(target.sampleId) || { sampleId: target.sampleId, sampleName: target.sampleName, items: [] };
      group.items.push(target); groups.set(target.sampleId, group);
    }
    return [...groups.values()];
  }, [bulkTargets, bulkSearch]);
  const openBulkLink = () => {
    setBulkTargetKeys(bulkTargets.map(target => target.key));
    setBulkTemplateId(undefined);
    setBulkSearch('');
    setBulkLinkOpen(true);
  };
  const submitBulkLink = async () => {
    if (!orderNo || !bulkTemplateId || !bulkTargetKeys.length) return;
    setBulkLinking(true);
    try {
      const result = await axios.post(`${API}/work-orders/${encodeURIComponent(orderNo)}/bulk-link`, {
        targets: bulkTargets.filter(target => bulkTargetKeys.includes(target.key)).map(target => ({ sample_id: target.sampleId, test_name: target.testName })), template_id: bulkTemplateId,
      });
      const data = result.data || {};
      message.success(`已关联 ${data.total || bulkTargetKeys.length} 个样品/项目；新建 ${data.created || 0} 条独立草稿${data.skipped ? `，跳过 ${data.skipped} 条已有记录` : ''}`);
      setBulkLinkOpen(false);
      await fetchAll();
    } catch (e: any) {
      message.error('批量关联失败：' + (e.response?.data?.error || e.message));
    } finally { setBulkLinking(false); }
  };

  const statusBadge = (color: string, bg: string, text: string) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: 20, background: bg, color, fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />{text}
    </span>
  );
  const renderStatus = (r: RowVm) => {
    if (!r.linked_template_id) return statusBadge('#9aa6b8', '#f1f3f7', '未关联');
    if (!r.record) return statusBadge('#667085', '#eef2f8', '待录入');
    if (r.record.cancelled_at) return statusBadge('#7c3aed', '#f3e8ff', '取消检测');
    if (r.record.audit_status === 'draft') return statusBadge('#2563eb', '#eef4ff', '草稿');
    if (r.record.audit_status === 'reviewed') return statusBadge('#16a34a', '#eafaf0', '已审核');
    if (r.record.audit_status === 'rejected') return statusBadge('#dc2626', '#fdecec', '已退回');
    return statusBadge('#d97706', '#fff5e6', '待审核');
  };

  if (loading) return <Spin style={{ margin: '120px auto', display: 'block' }} />;
  if (notFound || !order) {
    return (
      <div style={{ padding: 24 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/lab')} style={{ marginBottom: 16 }}>返回订单列表</Button>
        <Empty description={`未找到委托单 ${orderNo}`} />
      </div>
    );
  }

  const src = SOURCE_TAG[order.source || 'external'] || SOURCE_TAG.external;
  const orderMeta = order.payload.meta || {};

  return (
    <div style={{ padding: 24 }}>
      {!user && (
        <Alert
          type="warning" showIcon style={{ marginBottom: 16 }}
          message="请先登录后再进行录入或审核操作"
          description="点击右上角「登录」按钮选择身份。主检负责录入数据，审核员负责审核。"
        />
      )}

      <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/lab')}
        style={{ marginBottom: 10, paddingLeft: 0, color: '#667085' }}>返回订单列表</Button>

      <Card size="small" style={{ marginBottom: 16, borderColor: '#e8ecf3' }}
        styles={{ body: { padding: '14px 18px' } }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span style={{ width: 4, height: 38, borderRadius: 3, background: BRAND }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 700, color: '#1f2733' }}>{order.order_no}</span>
              <Tag color={src.color} style={{ margin: 0 }}>{src.label}</Tag>
            </div>
            <div style={{ fontSize: 12, color: '#8a93a3', marginTop: 4 }}>
              {order.customer_name || '—'} · 样品 {order.payload.samples?.length || 0} · 测试项目 {progress.testTotal} · 接收 {order.received_at?.slice(0, 10) || '—'}
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <FlowSteps steps={[
            { label: '关联', done: progress.linked, total: progress.testTotal },
            { label: '录入', done: progress.recorded, total: progress.testTotal },
            { label: '审核', done: progress.reviewed, total: progress.testTotal },
          ]} />
          <Space size={8}>
            <Tooltip title={has('record.entry') ? '编辑订单结构' : '当前账号没有录入权限'}>
              <Button icon={<FormOutlined />} disabled={!has('record.entry')} onClick={openEdit}>编辑订单</Button>
            </Tooltip>
            <Tooltip title="为多个样品的同一测试项目批量关联模板，并分别创建独立草稿">
              <Button icon={<LinkOutlined />} disabled={!has('record.entry')} onClick={openBulkLink}>批量关联</Button>
            </Tooltip>
            <Button icon={<ProfileOutlined />} onClick={openChangeLog}>变更记录</Button>
            <Button icon={<HistoryOutlined />} onClick={openAuditDrawer}>审核记录</Button>
          </Space>
        </div>
      </Card>

      <Collapse
        style={{ marginBottom: 16, borderColor: '#e8ecf3', background: '#fff' }}
        items={[{
          key: 'order-info',
          label: (
            <Space size={8} wrap>
              <ProfileOutlined style={{ color: BRAND }} />
              <strong>委托单信息</strong>
              <span style={{ fontSize: 12, color: '#8a93a3', fontWeight: 400 }}>点击展开查看接口订单详情</span>
              {orderMeta.status && <Tag color="blue" style={{ margin: 0 }}>{orderMeta.status}</Tag>}
            </Space>
          ),
          children: (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <section>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#667085', marginBottom: 7 }}>基础与业务信息</div>
                <Descriptions size="small" bordered column={{ xs: 1, sm: 2, lg: 3 }} items={[
                  { key: 'order-no', label: '委托单号', children: displayOrderValue(order.order_no) },
                  { key: 'company', label: '委托单位', children: displayOrderValue(order.customer_name) },
                  { key: 'status', label: '委托单状态', children: displayOrderValue(orderMeta.status) },
                  { key: 'company-address', label: '委托单位地址', children: displayOrderValue(orderMeta.company_address) },
                  { key: 'sale-name', label: '业务员', children: displayOrderValue(orderMeta.sale_name) },
                  { key: 'job-no', label: '业务员工号', children: displayOrderValue(orderMeta.job_no) },
                  { key: 'buyer', label: '买家', children: displayOrderValue(orderMeta.buyer) },
                  { key: 'remark', label: '备注', children: displayOrderValue(orderMeta.remark) },
                  { key: 'complete-way', label: '完工方式', children: displayOrderValue(orderMeta.complete_way) },
                ]} />
              </section>

              <section>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#667085', marginBottom: 7 }}>委托与证书信息</div>
                <Descriptions size="small" bordered column={{ xs: 1, sm: 2 }} items={[
                  { key: 'authorites', label: '证书单位', children: displayOrderValue(orderMeta.authorites) },
                  { key: 'english-authorites', label: '英文证书单位', children: displayOrderValue(orderMeta.english_authorites) },
                  { key: 'authorites-address', label: '证书单位地址', children: displayOrderValue(orderMeta.authorites_address) },
                  { key: 'english-authorites-address', label: '英文证书单位地址', children: displayOrderValue(orderMeta.english_authorites_address) },
                ]} />
              </section>

              <section>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#667085', marginBottom: 7 }}>日期与报告要求</div>
                <Descriptions size="small" bordered column={{ xs: 1, sm: 2, lg: 3 }} items={[
                  { key: 'send-date', label: '送检日期', children: displayOrderDateTime(orderMeta.send_date || order.received_at) },
                  { key: 'time-required', label: '客户要求期限', children: displayOrderDateTime(orderMeta.time_required) },
                  { key: 'test-time-required', label: '检测要求期限', children: displayOrderDateTime(orderMeta.test_time_required) },
                  { key: 'report-deadline', label: '报告期限', children: displayOrderDateTime(orderMeta.report_deadline) },
                  { key: 'chinese-report', label: '中文报告', children: displayOrderBoolean(orderMeta.is_chinese_report) },
                  { key: 'english-report', label: '英文报告', children: displayOrderBoolean(orderMeta.is_english_report) },
                  { key: 'paper-report', label: '纸质报告', children: displayOrderBoolean(orderMeta.is_paper_report) },
                  { key: 'report-count', label: '报告数量', children: displayOrderValue(orderMeta.report_count) },
                  { key: 'other-report-count', label: '其他报告数量', children: displayOrderValue(orderMeta.other_report_count) },
                ]} />
              </section>
            </div>
          ),
        }]}
      />

      {/* 退回意见横幅：被退回（含外部退回到实验室）时，把退回意见显示在订单详情页顶部，主检据此修改 */}
      {rejectedRecords.length > 0 && (
        <Alert
          type="error" showIcon style={{ marginBottom: 16 }}
          message={`本单有 ${rejectedRecords.length} 条原始记录被退回，请按退回意见修改后重新提交审核`}
          description={
            rejectNotes.length > 0 ? (
              <div style={{ fontSize: 13 }}>
                <span style={{ color: '#8a93a3' }}>退回意见：</span>
                {rejectNotes.map((n, i) => (
                  <div key={i} style={{ marginTop: 2 }}>· {n}</div>
                ))}
              </div>
            ) : '退回未填写具体意见，请联系审核人 / 外部确认。'
          }
        />
      )}

      <Card size="small" style={{ borderColor: '#e8ecf3' }} title="样品与原始记录">
        <Table
          className="order-detail-table"
          dataSource={rows}
          size="small"
          rowKey="key"
          pagination={false}
          bordered
          scroll={{ x: 1430 }}
          rowClassName={(row) => row.linked_template_id ? 'clickable-detail-row' : ''}
          onRow={(row) => ({
            onClick: (event) => {
              if (row.linked_template_id && !isInteractiveRowTarget(event.target)) goRecord(row);
            },
            title: row.linked_template_id
              ? (has('record.entry') && row.record?.audit_status !== 'reviewed' && !row.record?.cancelled_at ? '点击进入录入/编辑' : '点击进入只读预览')
              : undefined,
          })}
          columns={[
            {
              title: '样品编号', dataIndex: 'sample_sort_no', width: 115, fixed: 'left' as const, align: 'center' as const,
              onCell: (row) => {
                const c = sampleColor.get(row.sample_id) || SAMPLE_PALETTE[0];
                return { rowSpan: sampleRowSpan(row), style: { background: c.bg, borderLeft: `3px solid ${c.accent}`, borderRight: '1px solid #c8d2df', verticalAlign: 'middle' } };
              },
              render: (_: any, r: RowVm) => {
                const c = sampleColor.get(r.sample_id) || SAMPLE_PALETTE[0];
                return <strong style={{ color: c.accent }}>{r.sample_sort_no || r.sample_id}</strong>;
              },
            },
            {
              title: '样品名称', dataIndex: 'sample_name', width: 185, fixed: 'left' as const,
              onCell: (row) => {
                const c = sampleColor.get(row.sample_id) || SAMPLE_PALETTE[0];
                return { rowSpan: sampleRowSpan(row), style: { background: c.bg, verticalAlign: 'middle' } };
              },
              render: (_: any, r: RowVm) => {
                const c = sampleColor.get(r.sample_id) || SAMPLE_PALETTE[0];
                const displayedNo = r.sample_sort_no || r.sample_id;
                return (
                  <Space direction="vertical" size={0}>
                    <strong style={{ color: c.accent }}>{r.sample_name}</strong>
                    {r.sample_barcode && r.sample_barcode !== displayedNo && (
                      <span style={{ fontSize: 11, color: '#9aa6b8' }}>条码：{r.sample_barcode}</span>
                    )}
                    {r.sample_model && <span style={{ fontSize: 11, color: '#9aa6b8' }}>型号：{r.sample_model}</span>}
                  </Space>
                );
              },
            },
            {
              title: '测试项目', dataIndex: 'test_name', width: 280,
              onCell: (row) => ({ rowSpan: testRowSpan(row), style: { background: '#fafbfd', verticalAlign: 'top' } }),
              render: (_: any, r: RowVm) => (
                <Space direction="vertical" size={3} align="start" style={{ width: '100%' }}>
                  <Space size={6} align="center">
                    <strong>{r.test_name}</strong>
                    <ProjectInfoInline test={r.test_info} />
                  </Space>
                  {r.standard && <Tag style={{ margin: 0 }}>{r.standard}</Tag>}
                  <div className="project-record-link-actions">
                    <span className="project-record-link-actions-label">原始记录</span>
                    <Tooltip title={r.test_linked_ids.length ? '为当前测试项目再关联一个原始记录模板' : '为当前测试项目关联原始记录模板'}>
                      <Button size="small" shape="circle" icon={<LinkOutlined />}
                        aria-label="关联原始记录模板" disabled={!has('record.entry')}
                        onClick={() => openLinkModal(r.sample_id, r.test_name, r.test_linked_ids)} />
                    </Tooltip>
                    <Tooltip title="按测试方法为当前测试项目批量关联原始记录模板">
                      <Button size="small" shape="circle" icon={<ApartmentOutlined />}
                        aria-label="按测试方法批量关联"
                        disabled={!has('record.entry') || !methodGroups.some(group => (group.methods || []).some((method: any) => method.enabled))}
                        onClick={() => openMethodBatch(r)} />
                    </Tooltip>
                  </div>
                </Space>
              ),
            },
            {
              title: '关联的原始记录', width: 230,
              render: (_: any, r: RowVm) => r.linked_template_id ? (
                <Space direction="vertical" size={4} align="start">
                  <Space size={2}>
                    <Tag color="green" style={{ margin: 0 }}>{r.linked_template_name || `模板 ${r.linked_template_id}`}</Tag>
                    <Button size="small" type="text" icon={<DisconnectOutlined />}
                      disabled={!has('record.entry') || r.record?.audit_status === 'reviewed' || !!r.record?.cancelled_at}
                      title={!has('record.entry')
                        ? '当前账号没有录入权限'
                        : r.record?.audit_status === 'reviewed'
                          ? '已审核通过，不可解除关联（需先从报告端退回原始记录）'
                          : '解除关联'}
                      onClick={() => removeLink(r.sample_id, r.test_name, r.linked_template_id!)} />
                  </Space>
                </Space>
              ) : (
                <Tag style={{ margin: 0, color: '#8a93a3' }}>未关联</Tag>
              ),
            },
            {
              title: '状态', width: 90, render: (_: any, r: RowVm) => renderStatus(r),
            },
            {
              title: '主检 / 审核', width: 180,
              render: (_: any, r: RowVm) => {
                if (!r.record) return <span style={{ color: '#bbb' }}>—</span>;
                return (
                  <Space direction="vertical" size={0}>
                    <span style={{ fontSize: 12 }}>
                      主检：<strong>{r.record.tester_name || '—'}</strong>
                      {r.record.tested_at && (
                        <span style={{ color: '#888', marginLeft: 4 }}>
                          {new Date(r.record.tested_at).toLocaleDateString()}
                        </span>
                      )}
                    </span>
                    <span style={{ fontSize: 12 }}>
                      审核：<strong>{r.record.reviewer_name || '—'}</strong>
                      {r.record.reviewed_at && (
                        <span style={{ color: '#888', marginLeft: 4 }}>
                          {new Date(r.record.reviewed_at).toLocaleDateString()}
                        </span>
                      )}
                    </span>
                  </Space>
                );
              },
            },
            {
              title: '内容操作', width: 220, fixed: 'right' as const,
              render: (_: any, r: RowVm) => {
                const recordExists = !!r.record;
                const templateLinked = !!r.linked_template_id;
                const imageEnabled = templateLinked && imgTplIds.has(r.linked_template_id!);
                const st = r.record?.audit_status;
                const isTester = has('record.entry');
                const isCancelled = !!r.record?.cancelled_at;
                const isLocked = st === 'reviewed' || isCancelled;
                const contentReadOnly = isLocked || !isTester;
                const entryTip = !templateLinked
                  ? '尚未关联原始记录模板，无法录入或预览'
                  : isLocked
                    ? (isCancelled ? `已取消检测${r.record?.cancel_reason ? `：${r.record.cancel_reason}` : ''}——打开只读预览` : '已审核通过，已锁定——打开只读预览')
                    : !isTester
                      ? '当前账号没有录入权限——打开只读预览'
                      : (recordExists ? '编辑原始记录数据' : '开始录入原始记录数据');
                const imageTip = !templateLinked
                  ? '尚未关联原始记录模板，无法管理图片'
                  : !imageEnabled
                    ? '关联的原始记录模板未配置图片字段'
                    : contentReadOnly
                      ? (isLocked ? `查看图片（${isCancelled ? '已取消检测' : '已审核锁定'}，不可修改或上传）` : '查看图片（当前账号没有录入权限）')
                      : '单独上传或拍照上传图片';
                return (
                  <Space size={4} className="table-row-actions">
                    <Tooltip title={entryTip}>
                      <Button size="small" type={contentReadOnly ? 'default' : 'primary'}
                        icon={contentReadOnly ? <EyeOutlined /> : <EditOutlined />}
                        disabled={!templateLinked} onClick={() => goRecord(r)}>
                        {contentReadOnly ? '预览' : (recordExists ? '编辑' : '录入')}
                      </Button>
                    </Tooltip>
                    <Tooltip title={imageTip}>
                      <Button size="small" icon={<PictureOutlined />} disabled={!imageEnabled}
                        onClick={() => setImageModal({
                          templateId: r.linked_template_id!,
                          sampleId: r.sample_id, sampleName: r.sample_name, testName: r.test_name,
                          readOnly: contentReadOnly,
                        })} />
                    </Tooltip>
                    {/* 附件入口对每个已关联项目都显示；尚无记录时，选择文件后再延迟创建草稿。 */}
                    <Tooltip title={!templateLinked
                      ? '尚未关联原始记录模板，无法管理附件'
                      : (contentReadOnly ? '查看或下载附件（只读）' : '上传或下载附件（任意格式）')}>
                      <Button size="small" icon={<PaperClipOutlined />} disabled={!templateLinked}
                        onClick={() => setAttachModal({
                          recordId: r.record?.id || null,
                          templateId: r.linked_template_id!,
                          sampleId: r.sample_id,
                          testName: r.test_name,
                          subtitle: `${r.sample_name} · ${r.test_name}`,
                          readOnly: contentReadOnly,
                        })} />
                    </Tooltip>
                    {/* 下载渲染后的原始记录 PDF（按锁定版本 + 已录数据） */}
                    <PdfDownloadButton disabled={!recordExists}
                      title={recordExists ? '下载渲染后的原始记录 PDF' : '尚未录入数据，无法下载原始记录 PDF'}
                      onDownload={() => downloadFilledRecordPdf(r.record!.id, `原始记录-${r.sample_name}-${r.test_name}`)} />
                    {/* 历史版本：看该记录所有版本（含旧版）的数据快照，可逐版渲染查看 */}
                    <Tooltip title={recordExists ? '查看该记录的所有历史版本（含旧版）' : '尚未录入数据，暂无历史版本'}>
                      <Button size="small" icon={<HistoryOutlined />} disabled={!recordExists}
                        onClick={() => openVersionHistory(r.record!.id, `${r.sample_name} · ${r.test_name}`)} />
                    </Tooltip>
                  </Space>
                );
              },
            },
            {
              title: '流程操作', width: 120, fixed: 'right' as const,
              render: (_: any, r: RowVm) => {
                const recordExists = !!r.record;
                const st = r.record?.audit_status;
                const isTester = has('record.entry');
                const isReviewer = has('record.review');
                const isAdministrator = !!user?.roles?.includes('admin');
                const isSubmitter = !!r.record && !!user && (
                  (!!r.record.submitted_by_job_no && r.record.submitted_by_job_no === user.job_no)
                  || (!r.record.submitted_by_job_no && (r.record.submitted_by_name || r.record.tester_name) === user.display_name)
                );
                const canSubmit = recordExists && isTester && !r.record?.cancelled_at && (st === 'draft' || st === 'rejected');
                const canWithdraw = recordExists && isTester && st === 'pending' && isSubmitter;
                const canReview = recordExists && isReviewer
                  && (st === 'pending' || (!!r.record?.record_batch_id && st === 'rejected'))
                  && (!isSubmitter || isAdministrator);
                return (
                  <Space size={4} className="table-row-actions table-workflow-actions">
                    {isTester && (
                      <>
                        <Tooltip title={canSubmit ? (r.record?.record_batch_id ? '一次提交本批次全部原始记录' : '提交审核') : '仅草稿或退回记录可提交'}>
                          <Button size="small" shape="circle" icon={<CheckCircleOutlined />} aria-label="提交审核"
                            style={canSubmit ? workflowIconStyle.submit : undefined} disabled={!canSubmit}
                            onClick={() => r.record && submitRecord(r.record)} />
                        </Tooltip>
                      <Tooltip title={canWithdraw ? '撤回后恢复为草稿' : isSubmitter ? '仅待审核记录可撤回' : '只有本次提交人可以撤回'}>
                          <Button size="small" shape="circle" icon={<RollbackOutlined />} aria-label="撤回审核"
                            style={canWithdraw ? workflowIconStyle.withdraw : undefined} disabled={!canWithdraw}
                            onClick={() => r.record && Modal.confirm({
                              title: '撤回审核？',
                              content: r.record?.record_batch_id
                                ? '撤回后，本批次的全部原始记录都将恢复为草稿。'
                                : '撤回后原始记录将恢复为草稿，可继续编辑并重新提交。',
                              okText: '确认撤回',
                              cancelText: '取消',
                              onOk: () => withdrawRecord(r.record!),
                            })}>
                          </Button>
                        </Tooltip>
                      </>
                    )}
                    {isReviewer && (
                      <Tooltip title={canReview ? (r.record?.record_batch_id ? '审核批次中的待审记录；也可将已通过记录整批退回' : (isSubmitter && isAdministrator ? '管理员可审核自己提交的记录' : '审核当前待审记录')) : isSubmitter ? '提交人不能审核自己提交的记录' : '仅待审核记录可审核'}>
                        <Button size="small" shape="circle" icon={<AuditOutlined />} aria-label="审核"
                          style={canReview ? workflowIconStyle.review : undefined} disabled={!canReview}
                          onClick={() => handleReview(r)} />
                      </Tooltip>
                    )}
                  </Space>
                );
              },
            },
          ]}
        />
      </Card>

      <Modal
        open={!!linkModal}
        title={linkModal ? `为 "${linkModal.test_name}" 关联原始记录模板` : ''}
        onCancel={() => setLinkModal(null)}
        footer={null}
        width={760}
      >
        {!!linkModal?.linkedIds.length && (
          <Alert type="info" showIcon style={{ marginBottom: 12 }}
            message={`该测试项目已关联 ${linkModal.linkedIds.length} 个模板，可继续添加（一个项目可关联多个原始记录）。`} />
        )}
        <Input
          autoFocus allowClear
          prefix={<SearchOutlined />}
          placeholder="按模板名搜索"
          value={linkKeyword}
          onChange={e => setLinkKeyword(e.target.value)}
          style={{ marginBottom: 12 }}
        />
        <List
          size="small" bordered
          dataSource={filteredLinkable}
          locale={{ emptyText: '没有可关联的模板' }}
          style={{ maxHeight: 360, overflowY: 'auto' }}
          renderItem={t => {
            const approved = t.current_status === 'approved';
            return (
              <List.Item actions={[
                approved
                  ? <Button key="pick" size="small" type="primary" onClick={() => addLink(t.id)}>关联</Button>
                  : <Tooltip key="pick" title="该模板还没有审核通过的生效版本，须先在「原始记录模板」中提交并通过审核">
                      <Button size="small" disabled>无法关联</Button>
                    </Tooltip>,
              ]}>
                <Space>
                  <strong style={approved ? undefined : { color: '#999' }}>{t.name}</strong>
                  <Tag>v{t.version}</Tag>
                  {!approved && <Tag color="orange">未审核通过</Tag>}
                </Space>
              </List.Item>
            );
          }}
        />
      </Modal>

      <Modal open={!!batchModal} title={batchModal?.batchId ? `向录入批次 #${batchModal.batchId} 追加测试方法` : '按测试方法批量关联原始记录'} width={760}
        onCancel={() => setBatchModal(null)} onOk={createMethodBatch} confirmLoading={batchCreating}
        okText="创建批次并开始录入" okButtonProps={{ disabled: !batchMethodIds.length }}>
        <Alert type="info" showIcon style={{ marginBottom: 12 }}
          message={batchModal ? `${batchModal.sampleName} · ${batchModal.testName}` : ''}
          description="每种方法生成一份独立原始记录，并使用各自关联的项目报告模板。公共字段可手动拉取，填充后各份记录独立保存，修改互不影响。" />
        <Collapse defaultActiveKey={methodGroups.filter(group => group.enabled).slice(0, 1).map(group => String(group.id))}
          items={methodGroups.filter(group => group.enabled).map(group => {
            const enabledMethods = (group.methods || []).filter((method: any) => method.enabled);
            const selectedProfiles = new Set([
              ...(batchSharedProfile ? [batchSharedProfile] : []),
              ...methodGroups.filter(other => (other.methods || []).some((method: any) => batchMethodIds.includes(method.id))).map(other => other.shared_profile_code),
            ]);
            const incompatible = selectedProfiles.size > 0 && !selectedProfiles.has(group.shared_profile_code);
            return {
              key: String(group.id),
              label: <Space wrap><b>{group.name}</b><Tag color="blue">公共信息共享</Tag><Tag>{enabledMethods.length} 种方法</Tag>{incompatible && <Tag color="warning">公共字段不兼容</Tag>}</Space>,
              children: <Checkbox.Group style={{ width: '100%' }} value={batchMethodIds}
                onChange={(values) => setBatchMethodIds(values.map(Number))}>
                <Space direction="vertical" style={{ width: '100%' }}>
                  {enabledMethods.map((method: any) => (
                    <Checkbox key={method.id} value={method.id}
                      disabled={batchExistingMethodIds.includes(Number(method.id)) || (incompatible && !batchMethodIds.includes(method.id))}>
                      <Space wrap><b>{method.method_name}</b>{method.standard && <Tag>{method.standard}</Tag>}
                        {batchExistingMethodIds.includes(Number(method.id)) && <Tag>已在批次</Tag>}
                        {method.recommended && <Tag color="green">同组推荐</Tag>}
                        <span style={{ color: '#8c8c8c' }}>{method.record_template_name}</span>
                        {!method.report_project_template_id && <Tag color="warning">尚未关联项目报告模板</Tag>}
                      </Space>
                    </Checkbox>
                  ))}
                </Space>
              </Checkbox.Group>,
            };
          })} />
      </Modal>

      <Modal open={bulkLinkOpen} title="批量关联同一原始记录模板" width={620}
        onCancel={() => setBulkLinkOpen(false)}
        okText="关联并创建草稿" cancelText="取消" confirmLoading={bulkLinking}
        okButtonProps={{ disabled: !bulkTemplateId || !bulkTargetKeys.length }} onOk={submitBulkLink}>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 5 }}>原始记录模板</div>
          <Select showSearch optionFilterProp="label" style={{ width: '100%' }} placeholder="搜索并选择已审核通过的模板" value={bulkTemplateId}
            options={linkableTemplates.filter(template => template.current_status === 'approved').map(template => ({ value: template.id, label: `${template.name} · v${template.version}` }))}
            onChange={setBulkTemplateId} />
        </div>
        <Input.Search allowClear placeholder="搜索样品或测试项目" value={bulkSearch} onChange={(event) => setBulkSearch(event.target.value)} style={{ marginBottom: 10 }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
          <span>样品与测试项目（{bulkTargetKeys.length}/{bulkTargets.length}）</span>
          <Checkbox checked={bulkTargetKeys.length === bulkTargets.length && bulkTargets.length > 0}
            indeterminate={bulkTargetKeys.length > 0 && bulkTargetKeys.length < bulkTargets.length}
            onChange={(event) => setBulkTargetKeys(event.target.checked ? bulkTargets.map(target => target.key) : [])}>全选</Checkbox>
        </div>
        <div style={{ maxHeight: 330, overflowY: 'auto', paddingRight: 2 }}>
          {bulkGroups.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未找到匹配的样品或测试项目" /> : bulkGroups.map(group => {
            const selectedCount = group.items.filter(item => bulkTargetKeys.includes(item.key)).length;
            const allChecked = selectedCount === group.items.length;
            return <div key={group.sampleId} style={{ marginBottom: 8, border: '1px solid #e6ebf2', borderRadius: 7, overflow: 'hidden', background: '#fff' }}>
              <div style={{ padding: '7px 10px', background: '#f5f8fc', borderBottom: '1px solid #e6ebf2', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Checkbox checked={allChecked} indeterminate={selectedCount > 0 && !allChecked}
                  onChange={(event) => setBulkTargetKeys(previous => {
                    const next = new Set(previous);
                    group.items.forEach(item => event.target.checked ? next.add(item.key) : next.delete(item.key));
                    return [...next];
                  })} />
                <strong style={{ fontSize: 13 }}>{group.sampleName}</strong><span style={{ color: '#98a2b3', fontSize: 11 }}>{group.sampleId}</span>
                <span style={{ marginLeft: 'auto', color: '#667085', fontSize: 11 }}>{selectedCount}/{group.items.length}</span>
              </div>
              <div style={{ padding: '5px 10px 7px 34px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                {group.items.map(item => <Checkbox key={item.key} checked={bulkTargetKeys.includes(item.key)}
                  onChange={(event) => setBulkTargetKeys(previous => event.target.checked ? [...new Set([...previous, item.key])] : previous.filter(key => key !== item.key))}>{item.testName}</Checkbox>)}
              </div>
            </div>;
          })}
        </div>
      </Modal>

      <Drawer
        open={auditDrawer}
        title={`审核记录 · ${order.order_no}`}
        onClose={() => setAuditDrawer(false)}
        width={620}
      >
        {auditLoading ? (
          <div style={{ color: '#888', padding: 16 }}>加载中…</div>
        ) : auditEvents.length === 0 ? (
          <Empty description="暂无审核事件" />
        ) : (
          <Timeline
            items={auditEvents.map((ev, i) => {
              const prevSameRecord = auditEvents.slice(i + 1).find(e => e.record_id === ev.record_id);
              const diff = computeDiff(prevSameRecord?.data_snapshot || null, ev.data_snapshot || null);
              return {
                color: ACTION_COLOR[ev.action] || 'gray',
                children: (
                  <Space direction="vertical" size={2} style={{ width: '100%' }}>
                    <Space size={6} wrap>
                      <Tag color={ACTION_COLOR[ev.action]}>{ACTION_LABEL[ev.action] || ev.action}</Tag>
                      <strong>{ev.actor_name}</strong>
                      {ev.actor_role && <Tag>{(ev.actor_role === 'reviewer' || ev.actor_role === 'test_supervisor') ? '审核' : '主检'}</Tag>}
                      {ev.version_no != null && <Tag color="purple">v{ev.version_no}</Tag>}
                      {ev.status_after && (
                        <Tag color={ev.status_after === 'reviewed' ? 'green' : ev.status_after === 'rejected' ? 'red' : ev.status_after === 'draft' ? 'blue' : 'orange'}>
                          {ev.status_after === 'reviewed' ? '已审核' : ev.status_after === 'rejected' ? '已退回' : ev.status_after === 'draft' ? '草稿' : '待审核'}
                        </Tag>
                      )}
                    </Space>
                    <span style={{ fontSize: 12, color: '#666' }}>
                      {ev.sample_external_id && `样品 ${ev.sample_external_id}`}
                      {ev.test_item_name && ` · ${ev.test_item_name}`}
                    </span>
                    {ev.note && (
                      <div style={{ fontSize: 12, padding: '4px 8px', background: ev.action === 'reject' ? '#fff1f0' : '#fafafa', borderRadius: 4 }}>
                        备注：{ev.note}
                      </div>
                    )}
                    <span style={{ fontSize: 11, color: '#999' }}>
                      {new Date(ev.created_at).toLocaleString()}
                    </span>
                    {(ev.action === 'submit' || ev.action === 'update') && diff.length > 0 && (
                      <Collapse
                        size="small" ghost
                        items={[{
                          key: 'diff',
                          label: <span style={{ fontSize: 12, color: '#666' }}>本次修改 {diff.length} 项</span>,
                          children: <DiffList diffs={diff} />,
                        }]}
                      />
                    )}
                  </Space>
                ),
              };
            })}
          />
        )}
      </Drawer>

      <Modal
        open={!!reviewModal}
        title={reviewModal ? `${reviewModal.row.record?.record_batch_id ? '批次审核' : '审核'} · ${reviewModal.row.sample_name} · ${reviewModal.row.test_name}` : ''}
        onCancel={() => { setReviewModal(null); setReviewBatch(null); setReviewRecordIds([]); }}
        onOk={submitReview}
        okText={reviewDecision === 'approve' ? '审核通过' : '退回主检'}
        okButtonProps={{ danger: reviewDecision === 'reject', loading: reviewSubmitting }}
        width={520}
      >
        {reviewModal?.row.record && (
          <div style={{ marginBottom: 12, padding: 12, background: '#fafafa', borderRadius: 4, fontSize: 13 }}>
            <div>主检：<strong>{reviewModal.row.record.tester_name}</strong> · {reviewModal.row.record.tested_at && new Date(reviewModal.row.record.tested_at).toLocaleString()}</div>
            <div>当前版本：v{reviewModal.row.record.current_version}</div>
            {user && <div>审核人：<strong>{user.display_name}</strong></div>}
            <Button size="small" type="primary" ghost icon={<EyeOutlined />} style={{ marginTop: 8 }}
              onClick={() => setViewRec({
                id: reviewModal.row.record!.id,
                subtitle: `${reviewModal.row.sample_name} · ${reviewModal.row.test_name}`,
                hideReject: true,
              })}>
              查看录入后的原始记录（渲染预览）
            </Button>
          </div>
        )}
        {reviewBatch?.items?.length > 0 && (
          <Alert type="info" showIcon style={{ marginBottom: 12 }}
            message={<Space wrap>
              <span>可整批审核，也可只选择部分原始记录</span>
              <Tag color="blue">本次选择 {reviewRecordIds.length} 份</Tag>
            </Space>}
            description={<div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
              {reviewBatch.items.map((item: any) => {
                const selectable = reviewDecision === 'approve'
                  ? item.audit_status === 'pending'
                  : ['pending', 'reviewed'].includes(item.audit_status);
                return <div key={item.record_data_id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Checkbox disabled={!selectable} checked={reviewRecordIds.includes(Number(item.record_data_id))}
                    onChange={(event) => setReviewRecordIds(previous => event.target.checked
                      ? [...new Set([...previous, Number(item.record_data_id)])]
                      : previous.filter(id => id !== Number(item.record_data_id)))} />
                  <Tag color={item.audit_status === 'reviewed' ? 'green' : item.audit_status === 'rejected' ? 'red' : 'blue'}>
                    {item.audit_status === 'reviewed' ? '已通过' : item.audit_status === 'rejected' ? '已退回' : '待审核'}
                  </Tag>
                  <span style={{ flex: 1 }}>{item.method_name || item.record_template_name}</span>
                  <Button size="small" icon={<EyeOutlined />} onClick={() => setViewRec({
                    id: item.record_data_id,
                    subtitle: `${reviewModal?.row.sample_name || ''} · ${item.method_name || item.record_template_name}`,
                    hideReject: true,
                  })}>预览</Button>
                </div>;
              })}
            </div>} />
        )}
        {/* 本次提交相对上一版的改动（diff 高亮）——审核员据此一眼看清这次改了什么 */}
        <div style={{ marginBottom: 12, padding: 12, background: '#fff', border: '1px solid #eef1f6', borderRadius: 4 }}>
          <div style={{ fontSize: 12, color: '#8a93a3', marginBottom: 6 }}>
            本次提交的改动{reviewDiff.hasPrev ? `（相对上一版，共 ${reviewDiff.diffs.length} 项）` : '（首次提交，无可对比的上一版）'}
          </div>
          {reviewDiff.loading
            ? <span style={{ fontSize: 12, color: '#999' }}>加载中…</span>
            : reviewDiff.hasPrev
              ? <DiffList diffs={reviewDiff.diffs} />
              : <span style={{ fontSize: 12, color: '#8a93a3' }}>这是该记录的第一版，没有上一版可对比。</span>}
        </div>
        <Radio.Group
          value={reviewDecision}
          onChange={(e) => {
            const decision = e.target.value as 'approve' | 'reject';
            setReviewDecision(decision);
            if (reviewBatch?.items) setReviewRecordIds((reviewBatch.items || [])
              .filter((item: any) => decision === 'approve' ? item.audit_status === 'pending' : ['pending', 'reviewed'].includes(item.audit_status))
              .map((item: any) => Number(item.record_data_id)));
          }}
          style={{ marginBottom: 12 }}
        >
          <Radio.Button value="approve">通过</Radio.Button>
          <Radio.Button value="reject">退回主检</Radio.Button>
        </Radio.Group>
        <Input.TextArea
          rows={4}
          value={reviewNote}
          onChange={(e) => setReviewNote(e.target.value)}
          placeholder={reviewDecision === 'reject' ? '退回必填：请说明需要主检修改的具体内容' : '可选：审核备注'}
        />
      </Modal>

      {/* ── 只读查看（渲染后的原始记录，按锁定版本渲染）：已审核记录 + 审核弹窗里预览待审核记录 ── */}
      <ReadonlyRecordViewer
        recordId={viewRec?.id ?? null}
        open={!!viewRec}
        subtitle={viewRec?.subtitle}
        hideReject={viewRec?.hideReject}
        onClose={() => setViewRec(null)}
        onRejected={fetchAll}
      />
      <TemplatePdfPreviewModal
        open={!!previewTemplate}
        kind="record"
        templateId={previewTemplate?.id ?? 0}
        templateName={previewTemplate?.name || ''}
        onClose={() => setPreviewTemplate(null)}
      />

      {/* ── 单条记录的历史版本（含旧版）：每版一条，可逐版渲染查看 ── */}
      <Drawer
        open={!!verHistory}
        title={verHistory ? `历史版本 · ${verHistory.subtitle}` : '历史版本'}
        onClose={() => setVerHistory(null)}
        width={560}
      >
        <Alert type="info" showIcon banner style={{ marginBottom: 12 }}
          message="该原始记录的全部版本（含被退回/修改前的旧版），最新在上。每次提交/更新/审核/退回都留一版数据快照，「本版改动」可展开看相对上一版的字段变化，点「查看此版本」按锁定模板版本渲染。" />
        {!verLoading && verEvents.length > 0 && (
          <Segmented size="small" style={{ marginBottom: 12 }} value={verFilter} onChange={(v) => setVerFilter(String(v))}
            options={[
              { label: `全部 (${verEvents.length})`, value: 'all' },
              { label: '提交', value: 'submit' },
              { label: '更新', value: 'update' },
              { label: '审核', value: 'review' },
              { label: '退回', value: 'reject' },
            ]} />
        )}
        {verLoading ? <Spin style={{ margin: '60px auto', display: 'block' }} />
          : verEvents.length === 0 ? <Empty description="暂无版本记录" />
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {verEvents.map((ev, idx) => {
                if (verFilter !== 'all' && ev.action !== verFilter) return null;
                const st = ev.status_after === 'reviewed' ? { t: '已审核', c: 'green' }
                  : ev.status_after === 'rejected' ? { t: '已退回', c: 'red' }
                  : ev.status_after === 'draft' ? { t: '草稿', c: 'blue' }
                  : ev.status_after ? { t: '待审核', c: 'orange' } : null;
                const accent = ACTION_HEX[ev.action] || '#d0d7e2';
                const isReject = ev.action === 'reject';
                const d = new Date(ev.created_at);
                const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                const hasSnap = ev.data_snapshot && Object.keys(ev.data_snapshot).length > 0;
                // 本版相对上一版（更老的一版，列表倒序故为 idx+1）的字段改动
                const vdiff = computeDiff(verEvents[idx + 1]?.data_snapshot || null, ev.data_snapshot || null);
                return (
                  <div key={ev.id} style={{ border: '1px solid #e8ecf3', borderLeft: `3px solid ${accent}`, borderRadius: 8, padding: '10px 12px', background: '#fff' }}>
                    {/* 头部：版本 + 操作 + 状态 + 查看此版本 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 15, color: '#1f2733' }}>v{ev.version_no ?? '?'}</span>
                      <Tag color={ACTION_COLOR[ev.action]} style={{ margin: 0 }}>{ACTION_LABEL[ev.action] || ev.action}</Tag>
                      {st && <Tag color={st.c} style={{ margin: 0 }}>{st.t}</Tag>}
                      <div style={{ flex: 1 }} />
                      {hasSnap && (
                        <Button size="small" type="primary" ghost icon={<EyeOutlined />}
                          onClick={() => verHistory && setVerView({
                            recordId: verHistory.recordId, subtitle: verHistory.subtitle,
                            snapshot: ev.data_snapshot!, label: `v${ev.version_no ?? '?'} · ${ACTION_LABEL[ev.action] || ev.action}`,
                          })}>查看此版本</Button>
                      )}
                    </div>
                    {/* 字段：操作人 / 日期 / 备注 */}
                    <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '5px 12px', fontSize: 12, alignItems: 'baseline' }}>
                      <span style={{ color: '#8a93a3' }}>操作人</span><span style={{ color: '#1f2733', fontWeight: 500 }}>{ev.actor_name || '—'}</span>
                      <span style={{ color: '#8a93a3' }}>日期</span><span style={{ color: '#555' }}>{dateStr}</span>
                      {ev.note && (<>
                        <span style={{ color: '#8a93a3' }}>备注</span>
                        <span style={{ color: isReject ? '#cf1322' : '#333', background: isReject ? '#fff1f0' : 'transparent', borderRadius: 4, padding: isReject ? '2px 6px' : 0 }}>{ev.note}</span>
                      </>)}
                    </div>
                    {/* 本版改动（相对上一版）——可展开看字段 diff */}
                    {vdiff.length > 0 && (
                      <Collapse size="small" ghost style={{ marginTop: 4 }}
                        items={[{
                          key: 'diff',
                          label: <span style={{ fontSize: 12, color: '#1366d9' }}>本版改动 {vdiff.length} 项</span>,
                          children: <DiffList diffs={vdiff} />,
                        }]} />
                    )}
                  </div>
                );
              })}
            </div>
          )}
      </Drawer>

      {/* 历史版本快照渲染（复用只读查看器的 snapshot 模式） */}
      <ReadonlyRecordViewer
        recordId={verView?.recordId ?? null}
        open={!!verView}
        subtitle={verView?.subtitle}
        snapshotData={verView?.snapshot ?? null}
        versionLabel={verView?.label}
        onClose={() => setVerView(null)}
      />

      {/* ── 单独上传图片（已审核＝只读查看） ── */}
      <Modal
        open={!!imageModal}
        title={imageModal?.readOnly ? '查看图片（只读）' : '上传图片'}
        footer={null}
        width={620}
        style={{ top: 24, maxWidth: 'calc(100vw - 24px)' }}
        styles={{ body: { maxHeight: 'calc(100vh - 150px)', overflowY: 'auto', overscrollBehavior: 'contain', paddingRight: 6 } }}
        onCancel={() => setImageModal(null)}
        destroyOnHidden
      >
        {imageModal && orderNo && (
          <ImageUploadPanel
            templateId={imageModal.templateId}
            orderNo={orderNo}
            sampleId={imageModal.sampleId}
            sampleName={imageModal.sampleName}
            testName={imageModal.testName}
            readOnly={imageModal.readOnly}
            onSaved={fetchAll}
          />
        )}
      </Modal>

      {/* ── 通用附件（任意格式）：与录入详情页底部同一出口（record_data.attachments） ── */}
      <Modal
        open={!!attachModal}
        title={attachModal ? `附件 · ${attachModal.subtitle}` : '附件'}
        footer={null}
        width={520}
        style={{ top: 24, maxWidth: 'calc(100vw - 24px)' }}
        styles={{ body: { maxHeight: 'calc(100vh - 150px)', overflowY: 'auto', overscrollBehavior: 'contain' } }}
        onCancel={() => setAttachModal(null)}
        destroyOnHidden
      >
        {attachModal && (
          <AttachmentManager recordId={attachModal.recordId} kind="file" listAll
            title="附件（含导入的 Excel，可随时下载）"
            readOnly={attachModal.readOnly}
            ensureRecordId={attachModal.readOnly ? undefined : ensureAttachmentRecord} />
        )}
      </Modal>

      {/* ── 编辑订单结构 ── */}
      <Drawer
        title={`编辑订单 · ${order.order_no}`}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        width={720}
        extra={
          <Space>
            <Button onClick={() => setEditOpen(false)}>取消</Button>
            <Button type="primary" loading={editSaving} onClick={submitEdit}>保存</Button>
          </Space>
        }
      >
        <Alert type="warning" showIcon style={{ marginBottom: 16 }}
          message="订单结构编辑不走审核流，但会留痕（变更记录可查）。"
          description="护栏：已录入数据的样品 / 测试项目不能删除（需先处理数据）；改测试项目名会自动同步已录数据。已关联的原始记录模板会保留。" />
        <Form form={editForm} layout="vertical">
          <Form.List name="samples">
            {(sampleFields, { add: addSample, remove: removeSample }) => (
              <>
                {sampleFields.map((sf, si) => (
                  <Card key={sf.key} size="small" style={{ marginBottom: 12 }}
                    title={`样品 ${si + 1}`}
                    extra={
                      <Button size="small" type="text" danger icon={<MinusCircleOutlined />}
                        onClick={() => removeSample(sf.name)}>删除样品</Button>
                    }
                  >
                    <Form.Item name={[sf.name, 'id']} hidden><Input /></Form.Item>
                    <Form.Item name={[sf.name, 'name']} label="样品名称 / 材质"
                      rules={[{ required: true, message: '请填写样品名称' }]}>
                      <Input placeholder="如 车门内饰板 / PP+EPDM" />
                    </Form.Item>

                    <Form.List name={[sf.name, 'test_infos']}>
                      {(testFields, { add: addTest, remove: removeTest }) => (
                        <>
                          <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>测试项目</div>
                          {testFields.map((tf) => (
                            <Space key={tf.key} align="start" style={{ display: 'flex', marginBottom: 8 }}>
                              <Form.Item name={[tf.name, '_orig_name']} hidden><Input /></Form.Item>
                              <Form.Item name={[tf.name, 'name']} style={{ marginBottom: 0 }}
                                rules={[{ required: true, message: '项目名' }]}>
                                <Input placeholder="测试项目名" style={{ width: 220 }} />
                              </Form.Item>
                              <Form.Item name={[tf.name, 'standard']} style={{ marginBottom: 0 }}>
                                <Input placeholder="检测标准（可选）" style={{ width: 240 }} />
                              </Form.Item>
                              <Button type="text" danger icon={<MinusCircleOutlined />}
                                onClick={() => removeTest(tf.name)} />
                            </Space>
                          ))}
                          <Button type="dashed" size="small" icon={<PlusOutlined />}
                            onClick={() => addTest({ name: '', standard: '' })} style={{ marginBottom: 4 }}>
                            添加测试项目
                          </Button>
                        </>
                      )}
                    </Form.List>
                  </Card>
                ))}
                <Button type="dashed" block icon={<PlusOutlined />}
                  onClick={() => addSample({ name: '', test_infos: [{ name: '', standard: '' }] })}>
                  添加样品
                </Button>
                <Divider style={{ margin: '16px 0 0' }} />
              </>
            )}
          </Form.List>
        </Form>
      </Drawer>

      {/* ── 变更记录 ── */}
      <Drawer
        title={`变更记录 · ${order.order_no}`}
        open={changeLogOpen}
        onClose={() => setChangeLogOpen(false)}
        width={560}
      >
        {changeLogLoading ? (
          <div style={{ color: '#888', padding: 16 }}>加载中…</div>
        ) : changeLog.length === 0 ? (
          <Empty description="暂无结构变更" />
        ) : (
          <Timeline
            items={changeLog.map((ev) => ({
              color: 'blue',
              children: (
                <Space direction="vertical" size={2} style={{ width: '100%' }}>
                  <Space size={6} wrap>
                    <strong>{ev.actor_name}</strong>
                    {ev.actor_role && <Tag>{(ev.actor_role === 'reviewer' || ev.actor_role === 'test_supervisor') ? '审核' : (ev.actor_role === 'tester' || ev.actor_role === 'test_engineer') ? '主检' : ev.actor_role}</Tag>}
                  </Space>
                  <div style={{ fontSize: 13 }}>{ev.summary}</div>
                  <span style={{ fontSize: 11, color: '#999' }}>{new Date(ev.created_at).toLocaleString()}</span>
                </Space>
              ),
            }))}
          />
        )}
      </Drawer>
    </div>
  );
}
