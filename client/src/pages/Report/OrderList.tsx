/**
 * 报告生成 — 委托单列表
 *
 * 路由：/report
 * 数据源：GET /api/work-orders（演示阶段 seed 几张 mock 单）+ /external/requisition-counts
 * 聚合每单取号/生成/送审/退回状态。UI 对齐「实验室录入」列表：KPI 统计卡 + 高级搜索
 * （OrderSearchBar，含按状态搜索）+ 状态列；不再有左侧展开「进度」列。
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Tag, Space, Button, Empty, Modal, List, message } from 'antd';
import { ThunderboltOutlined, EditOutlined, DownloadOutlined, EyeOutlined } from '@ant-design/icons';
import axios from 'axios';
import PageHeader from '../../components/PageHeader';
import FlowSteps from '../../components/FlowSteps';
import OrderSearchBar from '../../components/OrderSearchBar';
import { BRAND } from '../../theme';
import { type OrderSearchCriteria, type OrderSortKey } from '../../pages/Lab/order-shared';
import { downloadGeneratedReportPdf } from '../../utils/pdfDownload';
import { getGeneratedReportPreviewPdf } from '../../utils/pdfDownload';
import { useAuth } from '../../auth';
import { isInteractiveRowTarget } from '../../utils/rowNavigation';
import PdfPreviewModal from '../../components/PdfPreviewModal';
import { ListPageSizeControl, useListPagination } from '../../hooks/useListPagination';

const API = '/api';

/** 报告侧订单派生状态：退回修改 > 审核通过 > 已送审 > 已生成 > 待生成 > 未取号。 */
type ReportStatusKey = 'revision' | 'approved' | 'delivered' | 'generated' | 'pending_gen' | 'unrequisitioned';
function deriveReportStatus(r: RowVm): { key: ReportStatusKey; label: string; color: string } {
  if (r.requisition_revision > 0 || r.requisition_data_rework > 0) return { key: 'revision', label: '退回修改', color: 'red' };
  if (r.requisition_total > 0 && r.requisition_approved === r.requisition_total)
    return { key: 'approved', label: '审核通过', color: 'success' };
  if (r.requisition_total > 0 && r.requisition_generated === r.requisition_total && r.requisition_delivered === r.requisition_total)
    return { key: 'delivered', label: '已送审', color: 'cyan' };
  if (r.requisition_generated > 0) return { key: 'generated', label: r.requisition_generated < r.requisition_total ? '部分生成' : '已生成', color: 'green' };
  if (r.requisition_total > 0) return { key: 'pending_gen', label: '待生成', color: 'orange' };
  return { key: 'unrequisitioned', label: '未取号', color: 'default' };
}

/** 报告侧状态搜索下拉项（OrderSearchBar 用） */
const REPORT_STATUS_OPTIONS = [
  { value: 'unrequisitioned', label: '未取号' },
  { value: 'pending_gen', label: '待生成' },
  { value: 'generated', label: '已生成 / 部分生成' },
  { value: 'revision', label: '退回修改' },
  { value: 'delivered', label: '已送审' },
  { value: 'approved', label: '审核通过' },
];
const ORDER_SORT_OPTIONS = [
  { value: 'received_desc', label: '最近接收优先' },
  { value: 'received_asc', label: '最早接收优先' },
  { value: 'priority', label: '待处理优先' },
  { value: 'progress_asc', label: '报告完成度低优先' },
  { value: 'order_asc', label: '委托单号升序' },
  { value: 'order_desc', label: '委托单号降序' },
];
const receivedTime = (value?: string | null) => {
  const ts = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(ts) ? ts : 0;
};

interface TestInfo { name: string; standard?: string; linked_template_id?: number | null; linked_template_ids?: number[]; }
const linkedIdsOf = (t: TestInfo): number[] =>
  Array.isArray(t.linked_template_ids) ? t.linked_template_ids
    : (typeof t.linked_template_id === 'number' ? [t.linked_template_id] : []);
interface Sample { id: string; name: string; test_infos: TestInfo[]; }
interface WorkOrder {
  order_no: string;
  customer_name: string;
  received_at: string;
  payload: { samples: Sample[] };
}

interface RecordRow {
  id: number;
  template_id: number;
  order_no?: string | null;
  sample_external_id?: string | null;
  test_item_name?: string | null;
  audit_status?: string | null;
  tester_name?: string | null;
  reviewer_name?: string | null;
}

interface RowVm {
  order_no: string;
  customer_name: string;
  sample_summary: string;
  received_at: string;
  test_total: number;
  linked_count: number;
  recorded_count: number;
  reports_count: number;
  requisition_total: number;
  requisition_generated: number;
  requisition_delivered: number;
  requisition_approved: number;
  requisition_revision: number;
  requisition_data_rework: number;
}

export default function ReportOrderList() {
  const navigate = useNavigate();
  const { has } = useAuth();
  const canEditReports = has('report.generate');
  const [previewReport, setPreviewReport] = useState<{ id: number; name: string } | null>(null);
  const openReport = (id: number, name?: string) => {
    if (canEditReports) navigate(`/report/edit?id=${id}`);
    else setPreviewReport({ id, name: name || `报告 #${id}` });
  };
  const [rows, setRows] = useState<RowVm[]>([]);
  const [loading, setLoading] = useState(true);
  // 保留记录用于按主检/审核人搜索
  const [records, setRecords] = useState<RecordRow[]>([]);
  // 已生成报告列表 Modal
  const [reportsModal, setReportsModal] = useState<{ order_no: string; list: any[] } | null>(null);
  // 高级搜索（含按状态）
  const [search, setSearch] = useState<OrderSearchCriteria>({});
  const [sortKey, setSortKey] = useState<OrderSortKey>('received_desc');
  const { pagination, pageSize, setPageSize } = useListPagination(`${sortKey}:${JSON.stringify(search)}`);

  const kpis = useMemo(() => {
    const acc = { total: rows.length, unrequisitioned: 0, pending_gen: 0, generated: 0, revision: 0, delivered: 0, approved: 0 };
    for (const r of rows) {
      const k = deriveReportStatus(r).key;
      if (k === 'unrequisitioned') acc.unrequisitioned++;
      else if (k === 'pending_gen') acc.pending_gen++;
      else if (k === 'generated') acc.generated++;
      else if (k === 'revision') acc.revision++;
      else if (k === 'delivered') acc.delivered++;
      else if (k === 'approved') acc.approved++;
    }
    return acc;
  }, [rows]);

  const kpiItems: { key: string; label: string; value: number; color: string; status?: ReportStatusKey }[] = [
    { key: 'total', label: '委托单总数', value: kpis.total, color: '#1f2733' },
    { key: 'unrequisitioned', label: '未取号', value: kpis.unrequisitioned, color: '#667085', status: 'unrequisitioned' },
    { key: 'pending_gen', label: '待生成', value: kpis.pending_gen, color: '#d97706', status: 'pending_gen' },
    { key: 'generated', label: '已生成', value: kpis.generated, color: '#16a34a', status: 'generated' },
    { key: 'revision', label: '退回修改', value: kpis.revision, color: '#dc2626', status: 'revision' },
    { key: 'delivered', label: '已送审', value: kpis.delivered, color: '#0891b2', status: 'delivered' },
    { key: 'approved', label: '审核通过', value: kpis.approved, color: '#15803d', status: 'approved' },
  ];

  const filteredRows = useMemo(() => {
    const kw = search.keyword?.trim().toLowerCase();
    const from = search.range?.[0] ? new Date(search.range[0]) : null;
    const to = search.range?.[1] ? new Date(search.range[1]) : null;
    const tester = search.tester?.trim().toLowerCase();
    const reviewer = search.reviewer?.trim().toLowerCase();
    const result = rows.filter(r => {
      if (kw && !(r.order_no.toLowerCase().includes(kw)
        || (r.customer_name || '').toLowerCase().includes(kw)
        || (r.sample_summary || '').toLowerCase().includes(kw))) return false;
      if (from || to) {
        const d = r.received_at ? new Date(r.received_at) : null;
        if (!d) return false;
        if (from && d < from) return false;
        if (to && d > to) return false;
      }
      if (tester || reviewer) {
        const recs = records.filter(rec => rec.order_no === r.order_no);
        if (tester && !recs.some(x => (x.tester_name || '').toLowerCase().includes(tester))) return false;
        if (reviewer && !recs.some(x => (x.reviewer_name || '').toLowerCase().includes(reviewer))) return false;
      }
      if (search.status && deriveReportStatus(r).key !== search.status) return false;
      return true;
    });
    const latestFirst = (a: RowVm, b: RowVm) =>
      receivedTime(b.received_at) - receivedTime(a.received_at)
      || b.order_no.localeCompare(a.order_no, 'zh-CN');
    const priority: Record<ReportStatusKey, number> = {
      revision: 0,
      pending_gen: 1,
      unrequisitioned: 2,
      generated: 3,
      delivered: 4,
      approved: 5,
    };
    result.sort((a, b) => {
      if (sortKey === 'received_asc') {
        return receivedTime(a.received_at) - receivedTime(b.received_at)
          || a.order_no.localeCompare(b.order_no, 'zh-CN');
      }
      if (sortKey === 'order_asc') return a.order_no.localeCompare(b.order_no, 'zh-CN');
      if (sortKey === 'order_desc') return b.order_no.localeCompare(a.order_no, 'zh-CN');
      if (sortKey === 'priority') {
        return priority[deriveReportStatus(a).key] - priority[deriveReportStatus(b).key]
          || latestFirst(a, b);
      }
      if (sortKey === 'progress_asc') {
        const ar = a.requisition_total > 0 ? a.requisition_generated / a.requisition_total : 0;
        const br = b.requisition_total > 0 ? b.requisition_generated / b.requisition_total : 0;
        return ar - br || latestFirst(a, b);
      }
      return latestFirst(a, b);
    });
    return result;
  }, [rows, records, search, sortKey]);

  const openReportsModal = async (order_no: string) => {
    try {
      const r = await axios.get(`${API}/reports?order_no=${order_no}`);
      setReportsModal({ order_no, list: r.data || [] });
    } catch { setReportsModal({ order_no, list: [] }); }
  };

  useEffect(() => {
    (async () => {
      try {
        const [wo, recs, reqCounts] = await Promise.all([
          axios.get(`${API}/work-orders`),
          axios.get(`${API}/record-data`),
          axios.get(`${API}/external/requisition-counts`).catch(() => ({ data: {} })),
        ]);
        const orders: WorkOrder[] = wo.data || [];
        const records: RecordRow[] = recs.data || [];
        const reqMap: Record<string, { total: number; generated: number; delivered?: number; approved?: number; revision?: number; data_rework?: number }> = reqCounts.data || {};
        setRecords(records);

        const result: RowVm[] = [];
        for (const o of orders) {
          const samples = o.payload?.samples || [];
          const allTests = samples.flatMap(s => s.test_infos || []);
          const linkedCount = allTests.filter(t => linkedIdsOf(t).length > 0).length;
          // 按「样品×测试项目」格统计已录入：该格有任一原始记录即算已录
          const recordedCount = samples.reduce((acc, s) => acc + (s.test_infos || []).filter(t =>
            records.some(r => r.order_no === o.order_no && r.sample_external_id === s.id && r.test_item_name === t.name)
          ).length, 0);
          let reportsCount = 0;
          try {
            const r = await axios.get(`${API}/reports?order_no=${o.order_no}`);
            reportsCount = (r.data || []).length;
          } catch { /* noop */ }
          result.push({
            order_no: o.order_no,
            customer_name: o.customer_name,
            sample_summary: samples.map(s => s.name).join(' / ') || '—',
            received_at: o.received_at,
            test_total: allTests.length,
            linked_count: linkedCount,
            recorded_count: recordedCount,
            reports_count: reportsCount,
            requisition_total: reqMap[o.order_no]?.total || 0,
            requisition_generated: reqMap[o.order_no]?.generated || 0,
            requisition_delivered: reqMap[o.order_no]?.delivered || 0,
            requisition_approved: reqMap[o.order_no]?.approved || 0,
            requisition_revision: reqMap[o.order_no]?.revision || 0,
            requisition_data_rework: reqMap[o.order_no]?.data_rework || 0,
          });
        }
        setRows(result);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div style={{ padding: 24 }}>
      <PageHeader
        title="生成报告 · 委托单列表"
        subtitle="选一张委托单进入工作台选模板生成报告。按状态可快速定位需取号 / 待生成 / 退回修改的单。"
      />

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {kpiItems.map(it => {
          const active = it.status ? search.status === it.status : !search.status;
          return (
            <div key={it.key}
              onClick={() => setSearch(s => ({ ...s, status: it.status && search.status === it.status ? undefined : it.status }))}
              style={{
                flex: '1 1 140px', minWidth: 140, cursor: 'pointer', userSelect: 'none',
                background: '#fff', borderRadius: 10, padding: '12px 16px',
                border: `1px solid ${active && it.status ? BRAND : '#e8ecf3'}`,
                boxShadow: active && it.status ? '0 0 0 2px rgba(19,102,217,0.08)' : '0 1px 2px rgba(16,24,40,0.03)',
                transition: 'border-color .15s, box-shadow .15s',
              }}>
              <div style={{ fontSize: 12, color: '#8a93a3' }}>{it.label}</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: it.color, marginTop: 2, lineHeight: 1.1 }}>{it.value}</div>
            </div>
          );
        })}
      </div>

      <OrderSearchBar
        value={search} onChange={setSearch} total={rows.length} shown={filteredRows.length}
        statusOptions={REPORT_STATUS_OPTIONS}
        keywordPlaceholder="单号 / 客户 / 样品"
        showPeople={false}
        sortValue={sortKey}
        onSortChange={(value) => setSortKey(value as OrderSortKey)}
        sortOptions={ORDER_SORT_OPTIONS}
      />
      <div style={{ display: 'flex', marginBottom: 8 }}>
        <ListPageSizeControl value={pageSize} onChange={setPageSize} />
      </div>

      <Table
        dataSource={filteredRows}
        rowKey="order_no"
        loading={loading}
        pagination={pagination}
        locale={{ emptyText: <Empty description={rows.length ? '无匹配订单' : '暂无委托单'} /> }}
        onRow={(r) => ({ onClick: () => navigate(`/report/order/${r.order_no}`), style: { cursor: 'pointer' } })}
        columns={[
          {
            title: '委托单号', dataIndex: 'order_no', width: 160,
            render: (v) => <span style={{ fontFamily: 'monospace' }}>{v}</span>,
          },
          { title: '客户', dataIndex: 'customer_name', width: 200 },
          { title: '样品', dataIndex: 'sample_summary' },
          { title: '接收日期', dataIndex: 'received_at', width: 110, render: (v: string) => v ? v.slice(0, 10) : '—' },
          {
            title: '状态', width: 96,
            render: (_, r) => {
              const st = deriveReportStatus(r);
              return <Tag color={st.color} style={{ margin: 0 }}>{st.label}</Tag>;
            },
          },
          {
            title: '测试项目进度', width: 240,
            render: (_, r) => (
              <FlowSteps size="small" steps={[
                { label: '关联', done: r.linked_count, total: r.test_total },
                { label: '录入', done: r.recorded_count, total: r.test_total },
              ]} />
            ),
          },
          {
            title: '取号报告', width: 110,
            render: (_, r) => r.requisition_total > 0
              ? <Tag color="gold">{r.requisition_total} 份{r.requisition_generated > 0 ? ` · 已出 ${r.requisition_generated}` : ''}</Tag>
              : <Tag>未取号</Tag>,
          },
          {
            title: '已生成报告', width: 120,
            render: (_, r) => r.reports_count > 0
              ? <Button size="small" type="link" style={{ padding: 0 }} onClick={(e) => { e.stopPropagation(); openReportsModal(r.order_no); }}>
                  <Tag color="green" style={{ cursor: 'pointer' }}>{r.reports_count} 份 · 查看</Tag>
                </Button>
              : <Tag>0</Tag>,
          },
          {
            title: '操作', width: 120,
            render: (_, r) => (
              <Space onClick={(e) => e.stopPropagation()}>
                <Button size="small" type="primary" icon={<ThunderboltOutlined />}
                  onClick={() => navigate(`/report/order/${r.order_no}`)}>
                  进入
                </Button>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        open={!!reportsModal}
        title={`已生成报告 · ${reportsModal?.order_no || ''}`}
        footer={null}
        onCancel={() => setReportsModal(null)}
        width={620}
      >
        <List
          dataSource={reportsModal?.list || []}
          locale={{ emptyText: <Empty description="暂无报告" /> }}
          renderItem={(rp: any) => (
            <List.Item
              className="clickable-report-entry"
              style={{ cursor: 'pointer' }}
              onClick={(event) => {
                if (!isInteractiveRowTarget(event.target)) openReport(rp.id, rp.report_no);
              }}
              actions={[
                <Button key="edit" size="small" type="link" icon={canEditReports ? <EditOutlined /> : <EyeOutlined />}
                  onClick={() => openReport(rp.id, rp.report_no)}>{canEditReports ? '结构化编辑' : '预览'}</Button>,
                <Button key="pdf" size="small" type="link" icon={<DownloadOutlined />}
                  onClick={() => downloadGeneratedReportPdf(rp.id, rp.report_no || `报告-${rp.id}`).catch((e: any) => message.error('下载失败：' + (e?.message || '')))}>下载 PDF</Button>,
              ]}
            >
              <Space>
                <Tag color="blue" style={{ fontFamily: 'monospace' }}>{rp.report_no || `#${rp.id}`}</Tag>
                {rp.batch_id && <span style={{ fontSize: 12, color: '#888' }}>批次 {rp.batch_id}</span>}
                {rp.scope?.sample_label && <span style={{ fontSize: 12 }}>{rp.scope.sample_label}</span>}
                {rp.edited && <Tag color="orange">已编辑</Tag>}
              </Space>
            </List.Item>
          )}
        />
      </Modal>
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
