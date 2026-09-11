import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card, Input, Space, Tag, Button, Table, Empty, message, Alert,
  Drawer, Form, DatePicker, Divider, Popconfirm,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, ArrowRightOutlined, MinusCircleOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import { useAuth } from '../../auth';
import { BRAND } from '../../theme';
import PageHeader from '../../components/PageHeader';
import FlowSteps from '../../components/FlowSteps';
import OrderSearchBar from '../../components/OrderSearchBar';
import { ListPageSizeControl, useListPagination } from '../../hooks/useListPagination';
import {
  type WorkOrder, type TemplateItem, type RecordRow, type OrderSearchCriteria,
  type OrderSortKey,
  orderProgress, filterOrders, deriveOrderStatus,
} from './order-shared';

const API = '/api';

const SOURCE_TAG: Record<string, { color: string; label: string }> = {
  external: { color: 'blue', label: '接口' },
  manual: { color: 'gold', label: '手动' },
};
const ORDER_SORT_OPTIONS = [
  { value: 'received_desc', label: '最近接收优先' },
  { value: 'received_asc', label: '最早接收优先' },
  { value: 'priority', label: '待处理优先' },
  { value: 'progress_asc', label: '录入完成度低优先' },
  { value: 'order_asc', label: '委托单号升序' },
  { value: 'order_desc', label: '委托单号降序' },
];
const receivedTime = (value?: string | null) => {
  const ts = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(ts) ? ts : 0;
};

export default function LabTaskList() {
  const navigate = useNavigate();
  const { user, has } = useAuth();
  const canEnterData = has('record.entry');
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [search, setSearch] = useState<OrderSearchCriteria>({});
  const [sortKey, setSortKey] = useState<OrderSortKey>('received_desc');
  const [loading, setLoading] = useState(true);
  const { pagination, pageSize, setPageSize } = useListPagination(`${sortKey}:${JSON.stringify(search)}`);

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm();

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [wo, tpls, recs] = await Promise.all([
        axios.get(`${API}/work-orders`),
        axios.get(`${API}/record-templates`),
        axios.get(`${API}/record-data`),
      ]);
      setOrders(wo.data);
      setTemplates(tpls.data);
      setRecords(recs.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  const templateById = useMemo(() => {
    const m = new Map<number, TemplateItem>();
    for (const t of templates) m.set(t.id, t);
    return m;
  }, [templates]);

  const filteredOrders = useMemo(() => {
    const result = [...filterOrders(orders, records, templateById, search)];
    const latestFirst = (a: WorkOrder, b: WorkOrder) =>
      receivedTime(b.received_at) - receivedTime(a.received_at)
      || b.order_no.localeCompare(a.order_no, 'zh-CN');
    const priority: Record<string, number> = {
      rejected: 0, pending: 1, recording: 2, unlinked: 3, empty: 4, reviewed: 5,
    };
    result.sort((a, b) => {
      if (sortKey === 'received_asc') {
        return receivedTime(a.received_at) - receivedTime(b.received_at)
          || a.order_no.localeCompare(b.order_no, 'zh-CN');
      }
      if (sortKey === 'order_asc') return a.order_no.localeCompare(b.order_no, 'zh-CN');
      if (sortKey === 'order_desc') return b.order_no.localeCompare(a.order_no, 'zh-CN');
      if (sortKey === 'priority') {
        const pa = priority[deriveOrderStatus(a, records, templateById).key] ?? 99;
        const pb = priority[deriveOrderStatus(b, records, templateById).key] ?? 99;
        return pa - pb || latestFirst(a, b);
      }
      if (sortKey === 'progress_asc') {
        const ap = orderProgress(a, records, templateById);
        const bp = orderProgress(b, records, templateById);
        const ar = ap.testTotal > 0 ? ap.recorded / ap.testTotal : 1;
        const br = bp.testTotal > 0 ? bp.recorded / bp.testTotal : 1;
        return ar - br || latestFirst(a, b);
      }
      return latestFirst(a, b);
    });
    return result;
  }, [orders, records, templateById, search, sortKey]);

  // 顶部 KPI 概览（也作为状态快捷筛选）
  const kpis = useMemo(() => {
    let unrecorded = 0, pending = 0, reviewed = 0, rejected = 0;
    for (const o of orders) {
      const p = orderProgress(o, records, templateById);
      if (p.linked - p.recorded > 0) unrecorded++;
      if (p.pending > 0) pending++;
      if (p.testTotal > 0 && p.reviewed === p.testTotal) reviewed++;
      if (p.rejected > 0) rejected++;
    }
    return { total: orders.length, unrecorded, pending, reviewed, rejected };
  }, [orders, records, templateById]);

  const kpiItems: { key: string; label: string; value: number; color: string; status?: OrderSearchCriteria['status'] }[] = [
    { key: 'total', label: '委托单总数', value: kpis.total, color: '#1f2733' },
    { key: 'unrecorded', label: '待录入', value: kpis.unrecorded, color: '#667085', status: 'unrecorded' },
    { key: 'pending', label: '待审核', value: kpis.pending, color: '#d97706', status: 'pending' },
    { key: 'reviewed', label: '整单已审核', value: kpis.reviewed, color: '#16a34a', status: 'reviewed' },
    { key: 'rejected', label: '有退回', value: kpis.rejected, color: '#dc2626', status: 'rejected' },
  ];

  const openCreate = () => {
    form.setFieldsValue({
      order_no: '', customer_name: '', received_at: null,
      samples: [{ name: '', test_infos: [{ name: '', standard: '' }] }],
    });
    setCreateOpen(true);
  };

  const submitCreate = async () => {
    let values: any;
    try { values = await form.validateFields(); }
    catch { return; }
    setCreating(true);
    try {
      const payload = {
        order_no: values.order_no.trim(),
        customer_name: values.customer_name?.trim() || undefined,
        received_at: values.received_at ? values.received_at.format('YYYY-MM-DD') : undefined,
        samples: (values.samples || []).map((s: any) => ({
          name: s.name,
          test_infos: (s.test_infos || []).map((t: any) => ({ name: t.name, standard: t.standard || undefined })),
        })),
      };
      const res = await axios.post(`${API}/work-orders`, payload);
      message.success('订单已创建');
      setCreateOpen(false);
      await fetchAll();
      navigate(`/lab/order/${encodeURIComponent(res.data.order_no)}`);
    } catch (e: any) {
      message.error('创建失败：' + (e.response?.data?.error || e.message));
    } finally {
      setCreating(false);
    }
  };

  const deleteOrder = async (order_no: string) => {
    try {
      await axios.delete(`${API}/work-orders/${encodeURIComponent(order_no)}`);
      message.success('已删除订单及其关联数据');
      fetchAll();
    } catch (e: any) {
      message.error('删除失败：' + (e.response?.data?.error || e.message));
    }
  };

  return (
    <div style={{ padding: 24 }}>
      {!user && (
        <Alert
          type="warning" showIcon style={{ marginBottom: 16 }}
          message="请先登录后再进行录入或审核操作"
          description="点击右上角「登录」按钮选择身份。主检负责录入数据，审核员负责审核。"
        />
      )}

      <PageHeader
        title="实验室录入工作台"
        subtitle="按委托单录入实验数据并送审。点订单进入详情页关联原始记录 / 录入 / 审核。接口未对接前可「新建订单」手动建单。"
        extra={
          <Button type="primary" icon={<PlusOutlined />} disabled={!canEnterData}
            title={canEnterData ? '新建订单' : '当前账号没有录入权限'} onClick={openCreate}>新建订单</Button>
        }
      />

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {kpiItems.map(it => {
          const active = it.status ? search.status === it.status : !search.status;
          return (
            <div key={it.key}
              onClick={() => setSearch(s => ({ ...s, status: it.status && search.status === it.status ? undefined : it.status }))}
              style={{
                flex: '1 1 150px', minWidth: 150, cursor: 'pointer', userSelect: 'none',
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
        value={search}
        onChange={setSearch}
        total={orders.length}
        shown={filteredOrders.length}
        sortValue={sortKey}
        onSortChange={(value) => setSortKey(value as OrderSortKey)}
        sortOptions={ORDER_SORT_OPTIONS}
      />
      <div style={{ display: 'flex', marginBottom: 8 }}>
        <ListPageSizeControl value={pageSize} onChange={setPageSize} />
      </div>

      <Table
        dataSource={filteredOrders}
        rowKey="order_no"
        loading={loading}
        pagination={pagination}
        locale={{ emptyText: <Empty description={orders.length ? '无匹配订单' : '暂无委托单，点「新建订单」手动建单'} /> }}
        onRow={(o) => ({ onClick: () => navigate(`/lab/order/${encodeURIComponent(o.order_no)}`), style: { cursor: 'pointer' } })}
        columns={[
          {
            title: '委托单号', dataIndex: 'order_no', width: 170,
            render: (v: string, o: WorkOrder) => {
              const src = SOURCE_TAG[o.source || 'external'] || SOURCE_TAG.external;
              return (
                <Space size={6}>
                  <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{v}</span>
                  <Tag color={src.color} style={{ margin: 0 }}>{src.label}</Tag>
                </Space>
              );
            },
          },
          { title: '客户', dataIndex: 'customer_name', width: 200, render: (v: string) => v || <span style={{ color: '#bbb' }}>—</span> },
          {
            title: '样品 / 项目', width: 120,
            render: (_: any, o: WorkOrder) => {
              const p = orderProgress(o, records, templateById);
              return <span style={{ fontSize: 12, color: '#666' }}>样品 {p.sampleCount} · 项目 {p.testTotal}</span>;
            },
          },
          { title: '接收日期', dataIndex: 'received_at', width: 110, render: (v: string) => v ? v.slice(0, 10) : '—' },
          {
            title: '状态', width: 90,
            render: (_: any, o: WorkOrder) => {
              const st = deriveOrderStatus(o, records, templateById);
              return <Tag color={st.color} style={{ margin: 0 }}>{st.label}</Tag>;
            },
          },
          {
            title: '进度（关联 / 录入 / 审核）', width: 280,
            render: (_: any, o: WorkOrder) => {
              const p = orderProgress(o, records, templateById);
              return (
                <Space size={8} align="center">
                  <FlowSteps size="small" steps={[
                    { label: '关联', done: p.linked, total: p.testTotal },
                    { label: '录入', done: p.recorded, total: p.testTotal },
                    { label: '审核', done: p.reviewed, total: p.testTotal },
                  ]} />
                  {p.rejected > 0 && <Tag color="red" style={{ margin: 0 }}>{p.rejected} 项退回</Tag>}
                </Space>
              );
            },
          },
          {
            title: '操作', width: 170,
            render: (_: any, o: WorkOrder) => (
              <Space size={4} onClick={(e) => e.stopPropagation()}>
                <Button size="small" type="primary" icon={<ArrowRightOutlined />}
                  onClick={() => navigate(`/lab/order/${encodeURIComponent(o.order_no)}`)}>
                  进入详情
                </Button>
                <Popconfirm
                  title="删除该订单？"
                  description="将连同其录入记录 / 报告 / 审核记录一并删除，不可恢复。"
                  okText="删除" okButtonProps={{ danger: true }} cancelText="取消"
                  disabled={!canEnterData}
                  onConfirm={() => deleteOrder(o.order_no)}
                >
                  <Button size="small" danger icon={<DeleteOutlined />} disabled={!canEnterData}
                    title={canEnterData ? '删除订单' : '当前账号没有录入权限'} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      {/* ── 新建订单 ── */}
      <Drawer
        title="新建委托单（手动）"
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        width={680}
        extra={
          <Space>
            <Button onClick={() => setCreateOpen(false)}>取消</Button>
            <Button type="primary" loading={creating} onClick={submitCreate}>创建</Button>
          </Space>
        }
      >
        <Alert type="info" showIcon style={{ marginBottom: 16 }}
          message="手动建单与接口传入的单完全同构，可正常关联原始记录、录入、审核、出报告。" />
        <Form form={form} layout="vertical">
          <Space size={16} style={{ display: 'flex' }} align="start">
            <Form.Item name="order_no" label="委托单号" rules={[{ required: true, message: '请填写单号' }]} style={{ flex: 1 }}>
              <Input placeholder="如 C202512086592" />
            </Form.Item>
            <Form.Item name="customer_name" label="客户名称" style={{ flex: 1 }}>
              <Input placeholder="如 奇瑞汽车股份有限公司" />
            </Form.Item>
            <Form.Item name="received_at" label="接收日期">
              <DatePicker style={{ width: 160 }} />
            </Form.Item>
          </Space>

          <Divider style={{ margin: '4px 0 16px' }}>样品与测试项目</Divider>

          <Form.List name="samples">
            {(sampleFields, { add: addSample, remove: removeSample }) => (
              <>
                {sampleFields.map((sf, si) => (
                  <Card key={sf.key} size="small" style={{ marginBottom: 12 }}
                    title={`样品 ${si + 1}`}
                    extra={
                      <Button size="small" type="text" danger icon={<MinusCircleOutlined />}
                        disabled={sampleFields.length <= 1} onClick={() => removeSample(sf.name)}>
                        删除样品
                      </Button>
                    }
                  >
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
                              <Form.Item name={[tf.name, 'name']} style={{ marginBottom: 0 }}
                                rules={[{ required: true, message: '项目名' }]}>
                                <Input placeholder="测试项目名，如 燃烧特性" style={{ width: 220 }} />
                              </Form.Item>
                              <Form.Item name={[tf.name, 'standard']} style={{ marginBottom: 0 }}>
                                <Input placeholder="检测标准（可选），如 ISO 3795:1989" style={{ width: 240 }} />
                              </Form.Item>
                              <Button type="text" danger icon={<MinusCircleOutlined />}
                                disabled={testFields.length <= 1} onClick={() => removeTest(tf.name)} />
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
              </>
            )}
          </Form.List>
        </Form>
      </Drawer>
    </div>
  );
}
