import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Card, Input, Space, Tag, Button, Table, Modal, List, Empty, message,
  Drawer, Timeline, Alert, Tooltip, Radio, Collapse, Spin, Form, Divider, Segmented,
} from 'antd';
import {
  SearchOutlined, EditOutlined, LinkOutlined, DisconnectOutlined,
  AuditOutlined, HistoryOutlined, ArrowLeftOutlined,
  PlusOutlined, MinusCircleOutlined, FormOutlined, ProfileOutlined, PictureOutlined,
  CheckCircleOutlined, RollbackOutlined, EyeOutlined, PaperClipOutlined,
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
import {
  type WorkOrder, type TemplateItem, type RecordRow, type RowVm,
  type AuditEvent, buildOrderRows, orderProgress, ACTION_LABEL, ACTION_COLOR, ACTION_HEX,
  computeDiff, stringify,
} from './order-shared';

const API = '/api';

const SOURCE_TAG: Record<string, { color: string; label: string }> = {
  external: { color: 'blue', label: '接口' },
  manual: { color: 'gold', label: '手动' },
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

  const [auditDrawer, setAuditDrawer] = useState(false);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const [reviewModal, setReviewModal] = useState<{ row: RowVm } | null>(null);
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
  const [attachModal, setAttachModal] = useState<{ recordId: number; subtitle: string; readOnly?: boolean } | null>(null);
  // 只读查看（渲染后的原始记录）：已审核锁定的记录，或审核弹窗里预览待审核记录（hideReject=审核场景，退回走审核弹窗）
  const [viewRec, setViewRec] = useState<{ id: number; subtitle: string; hideReject?: boolean } | null>(null);
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
      const [wo, tpls, recs] = await Promise.all([
        axios.get(`${API}/work-orders/${orderNo}`),
        // 全量拉取（含未审核）：未审核模板在关联弹窗中【显示但禁选】并标注（比隐藏更不困惑）；
        // 可关联的仍只有 current_status='approved' 的（后端 /link op=add 也有 409 护栏）。
        axios.get(`${API}/record-templates`),
        axios.get(`${API}/record-data?order_no=${orderNo}`),
      ]);
      setOrder(wo.data);
      setTemplates(tpls.data);
      setRecords(recs.data);
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
  const testRowSpan = (row: RowVm): number => {
    const i = rows.findIndex(r => r.key === row.key);
    if (i > 0 && rows[i - 1].test_key === row.test_key) return 0;
    let span = 1;
    for (let j = i + 1; j < rows.length && rows[j].test_key === row.test_key; j++) span++;
    return span;
  };

  /** 是否是某测试项目关联行里的最后一行（用于只在最后一行下方放「关联另一个」） */
  const isLastOfTest = (row: RowVm): boolean => {
    const i = rows.findIndex(r => r.key === row.key);
    return i === rows.length - 1 || rows[i + 1].test_key !== row.test_key;
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
    setLinkKeyword('');
    setLinkModal({ sample_id, test_name, linkedIds });
  };

  /** 给某测试项目添加一个关联模板（op=add，可多次） */
  const addLink = async (template_id: number) => {
    if (!linkModal || !orderNo) return;
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

  /** 从某测试项目移除一个关联模板（op=remove）——同时删除该模板在本项目下的【全部】录入数据（草稿/待审核/被退回），
   *  使重新关联是干净的空白新录入。已审核通过(reviewed)的记录后端 409 拒绝解除（按钮也已禁用）。 */
  const removeLink = (sample_id: string, test_name: string, template_id: number) => {
    if (!orderNo) return;
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
    if (!user) { message.warning('请先登录'); return; }
    // 已审核（锁定）记录＝只读「详情」，任何角色都可打开查看；未锁定的「编辑/录入」仍限主检
    const isReviewed = row.record?.audit_status === 'reviewed';
    if (!isReviewed && !has('record.entry')) { message.warning('当前角色无录入权限'); return; }
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
    setReviewModal({ row });
    // 取该记录版本快照，算「待审版相对上一版」的字段改动，供审核员看清这次改了什么
    setReviewDiff({ loading: true, diffs: [], hasPrev: false });
    try {
      const r = await axios.get(`${API}/audit-log?record_id=${row.record.id}`);
      const evs = (r.data || []).filter((e: AuditEvent) => e.data_snapshot && Object.keys(e.data_snapshot).length > 0);
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
    setReviewSubmitting(true);
    try {
      await axios.post(`${API}/record-data/${reviewModal.row.record.id}/review`, {
        decision: reviewDecision,
        note: reviewNote.trim() || undefined,
      });
      message.success(reviewDecision === 'approve' ? '审核通过' : '已退回');
      setReviewModal(null);
      fetchAll();
    } catch (e: any) {
      message.error('审核失败：' + (e.response?.data?.error || e.message));
    } finally {
      setReviewSubmitting(false);
    }
  };

  const submitRecord = async (recordId: number) => {
    try {
      await axios.post(`${API}/record-data/${recordId}/submit`);
      message.success('已提交审核');
      fetchAll();
    } catch (e: any) {
      message.error('提交失败：' + (e.response?.data?.error || e.message));
    }
  };

  const withdrawRecord = async (recordId: number) => {
    try {
      await axios.post(`${API}/record-data/${recordId}/withdraw`);
      message.success('已撤回，回到草稿');
      fetchAll();
    } catch (e: any) {
      message.error('撤回失败：' + (e.response?.data?.error || e.message));
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

  const statusBadge = (color: string, bg: string, text: string) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: 20, background: bg, color, fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />{text}
    </span>
  );
  const renderStatus = (r: RowVm) => {
    if (!r.linked_template_id) return statusBadge('#9aa6b8', '#f1f3f7', '未关联');
    if (!r.record) return statusBadge('#667085', '#eef2f8', '待录入');
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
            <Button icon={<FormOutlined />} onClick={openEdit}>编辑订单</Button>
            <Button icon={<ProfileOutlined />} onClick={openChangeLog}>变更记录</Button>
            <Button icon={<HistoryOutlined />} onClick={openAuditDrawer}>审核记录</Button>
          </Space>
        </div>
      </Card>

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

      <Card size="small" style={{ borderColor: '#e8ecf3' }}>
        <Table
          dataSource={rows}
          size="small"
          rowKey="key"
          pagination={false}
          bordered
          columns={[
            {
              title: '样品', dataIndex: 'sample_name', width: 200,
              onCell: (row, index) => {
                const i = index ?? 0;
                if (i > 0 && rows[i - 1].sample_id === row.sample_id) return { rowSpan: 0 };
                let span = 1;
                for (let j = i + 1; j < rows.length && rows[j].sample_id === row.sample_id; j++) span++;
                const c = sampleColor.get(row.sample_id) || SAMPLE_PALETTE[0];
                return { rowSpan: span, style: { background: c.bg, borderLeft: `3px solid ${c.accent}`, verticalAlign: 'top' } };
              },
              render: (_: any, r: RowVm) => {
                const c = sampleColor.get(r.sample_id) || SAMPLE_PALETTE[0];
                return (
                  <Space direction="vertical" size={0}>
                    <strong style={{ color: c.accent }}>{r.sample_name}</strong>
                    <span style={{ fontSize: 11, color: '#9aa6b8' }}>{r.sample_id}</span>
                  </Space>
                );
              },
            },
            {
              title: '测试项目', dataIndex: 'test_name', width: 160,
              onCell: (row) => ({ rowSpan: testRowSpan(row), style: { background: '#fafbfd', verticalAlign: 'top' } }),
              render: (_: any, r: RowVm) => (
                <Space direction="vertical" size={4} align="start">
                  <strong>{r.test_name}</strong>
                  {r.standard && <Tag style={{ margin: 0 }}>{r.standard}</Tag>}
                </Space>
              ),
            },
            {
              title: '关联的原始记录', width: 260,
              render: (_: any, r: RowVm) => r.linked_template_id ? (
                <Space direction="vertical" size={4} align="start">
                  <Space size={2}>
                    <Tag color="green" style={{ margin: 0 }}>{r.linked_template_name || `模板 ${r.linked_template_id}`}</Tag>
                    <Button size="small" type="text" icon={<DisconnectOutlined />}
                      disabled={r.record?.audit_status === 'reviewed'}
                      title={r.record?.audit_status === 'reviewed' ? '已审核通过，不可解除关联（需先从报告端退回原始记录）' : '解除关联'}
                      onClick={() => removeLink(r.sample_id, r.test_name, r.linked_template_id!)} />
                  </Space>
                  {isLastOfTest(r) && (
                    <Button size="small" type="link" icon={<PlusOutlined />} style={{ padding: 0, fontSize: 12, height: 'auto' }}
                      onClick={() => openLinkModal(r.sample_id, r.test_name, r.test_linked_ids)}>
                      关联另一个
                    </Button>
                  )}
                </Space>
              ) : (
                <Button size="small" icon={<LinkOutlined />}
                  onClick={() => openLinkModal(r.sample_id, r.test_name, r.test_linked_ids)}>
                  搜索并关联
                </Button>
              ),
            },
            {
              title: '主检 / 审核', width: 200,
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
            { title: '状态', width: 90, render: (_: any, r: RowVm) => renderStatus(r) },
            {
              title: '操作', width: 220,
              render: (_: any, r: RowVm) => {
                const recordExists = !!r.record;
                const st = r.record?.audit_status;
                const isTester = has('record.entry');
                const isReviewer = has('record.review');
                const isLocked = st === 'reviewed';
                return (
                  <Space size={4} wrap>
                    {isLocked ? (
                      <Tooltip title="已审核通过，已锁定——打开只读详情（左侧编辑器 + 右侧 PDF，不可修改）">
                        <Button size="small" icon={<EyeOutlined />}
                          onClick={() => goRecord(r)}>
                          详情
                        </Button>
                      </Tooltip>
                    ) : (
                      <Tooltip title={!user ? '请先登录' : !has('record.entry') ? '仅主检可录入' : ''}>
                        <Button
                          size="small" type="primary" icon={<EditOutlined />}
                          disabled={!r.linked_template_id || !isTester}
                          onClick={() => goRecord(r)}
                        >
                          {recordExists ? '编辑' : '录入'}
                        </Button>
                      </Tooltip>
                    )}
                    {r.linked_template_id && imgTplIds.has(r.linked_template_id) && (
                      <Tooltip title={isLocked ? '查看图片（已审核锁定，不可修改/上传）' : '单独上传 / 拍照上传图片'}>
                        <Button
                          size="small" icon={<PictureOutlined />}
                          onClick={() => setImageModal({
                            templateId: r.linked_template_id!,
                            sampleId: r.sample_id, sampleName: r.sample_name, testName: r.test_name,
                            readOnly: isLocked,
                          })}
                        />
                      </Tooltip>
                    )}
                    {/* 附件（任意格式）：上传图片旁边；与录入详情页底部同一出口（record_data.attachments）。仅已有记录可用 */}
                    {recordExists && (
                      <Tooltip title="上传 / 下载附件（任意格式）">
                        <Button size="small" icon={<PaperClipOutlined />}
                          onClick={() => setAttachModal({ recordId: r.record!.id, subtitle: `${r.sample_name} · ${r.test_name}`, readOnly: isLocked })} />
                      </Tooltip>
                    )}
                    {/* 下载渲染后的原始记录 PDF（按锁定版本 + 已录数据） */}
                    {recordExists && (
                      <PdfDownloadButton title="下载渲染后的原始记录 PDF"
                        onDownload={() => downloadFilledRecordPdf(r.record!.id, `原始记录-${r.sample_name}-${r.test_name}`)} />
                    )}
                    {/* 历史版本：看该记录所有版本（含旧版）的数据快照，可逐版渲染查看 */}
                    {recordExists && (
                      <Tooltip title="查看该记录的所有历史版本（含旧版）">
                        <Button size="small" icon={<HistoryOutlined />}
                          onClick={() => openVersionHistory(r.record!.id, `${r.sample_name} · ${r.test_name}`)} />
                      </Tooltip>
                    )}
                    {/* 主检：草稿/被退回 → 提交审核；待审核 → 撤回 */}
                    {recordExists && isTester && (st === 'draft' || st === 'rejected') && (
                      <Button size="small" icon={<CheckCircleOutlined />}
                        onClick={() => submitRecord(r.record!.id)}>提交审核</Button>
                    )}
                    {recordExists && isTester && st === 'pending' && (
                      <Button size="small" icon={<RollbackOutlined />}
                        onClick={() => withdrawRecord(r.record!.id)}>撤回</Button>
                    )}
                    {/* 审核员：待审核 → 审核 */}
                    {recordExists && isReviewer && st === 'pending' && (
                      <Button size="small" icon={<AuditOutlined />}
                        onClick={() => handleReview(r)}>审核</Button>
                    )}
                    {st === 'reviewed' && <Tag color="green" style={{ margin: 0 }}>v{r.record?.current_version}</Tag>}
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
        width={620}
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
        title={reviewModal ? `审核 · ${reviewModal.row.sample_name} · ${reviewModal.row.test_name}` : ''}
        onCancel={() => setReviewModal(null)}
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
          onChange={(e) => setReviewDecision(e.target.value)}
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
        title={imageModal?.readOnly ? '查看图片（已锁定）' : '上传图片'}
        footer={null}
        width={620}
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
        onCancel={() => setAttachModal(null)}
        destroyOnHidden
      >
        {attachModal && (
          <AttachmentManager recordId={attachModal.recordId} kind="file" listAll
            title="附件（含导入的 Excel，可随时下载）" readOnly={attachModal.readOnly} />
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
