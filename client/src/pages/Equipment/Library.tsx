import { useState, useEffect, useCallback } from 'react';
import { Table, Input, Button, Space, Upload, message, Tag, Modal, Descriptions, Alert, Spin, Tooltip, Grid } from 'antd';
import { SearchOutlined, UploadOutlined, EyeOutlined, ReloadOutlined } from '@ant-design/icons';
import axios from 'axios';
import { ListPageSizeControl, useListPagination } from '../../hooks/useListPagination';

const API = '/api';

interface Equipment {
  id: number;
  asset_code: string;
  name: string;
  model?: string;
  factory_serial?: string;
  cert_no?: string;
  trace_date?: string;
  expire_date?: string;
  status?: string;
  category?: string;
  department?: string;
  raw_payload?: Record<string, unknown> | null;
}

function detailValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value !== 'object') return String(value);
  // Excel 富文本单元格保存在原始数据中，详情只展示文本内容。
  if ('richText' in value && Array.isArray(value.richText)) {
    return value.richText.map(part => String(part.text ?? '')).join('');
  }
  return JSON.stringify(value);
}

function EquipmentDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const screens = Grid.useBreakpoint();
  const [detail, setDetail] = useState<Equipment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await axios.get<Equipment>(`${API}/equipment/${id}`, { signal: controller.signal });
        if (!controller.signal.aborted) setDetail(res.data);
      } catch (e: unknown) {
        if (controller.signal.aborted) return;
        setError(axios.isAxiosError(e)
          ? e.response?.status === 404 ? '该设备不存在或已被删除' : e.response?.data?.error || e.message
          : e instanceof Error ? e.message : '请稍后重试');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [id, attempt]);

  const rawEntries = Object.entries(detail?.raw_payload || {});
  const entries = rawEntries.length ? rawEntries : detail ? Object.entries({
    管理编号: detail.asset_code,
    仪器名称: detail.name,
    仪器型号: detail.model,
    出厂编号: detail.factory_serial,
    证书编号: detail.cert_no,
    溯源日期: detail.trace_date,
    到期日期: detail.expire_date,
    状态: detail.status,
    设备类别: detail.category,
    所属部门: detail.department,
  }) : [];

  return (
    <Modal title="设备详情" open onCancel={onClose} footer={null} width={720}
      style={{ top: 24, paddingBottom: 24 }}
      styles={{ body: { maxHeight: 'calc(100dvh - 140px)', overflowY: 'auto', overscrollBehavior: 'contain' } }}>
      {loading ? (
        <div role="status" aria-label="正在加载设备详情" style={{ padding: 40, textAlign: 'center' }}><Spin /></div>
      ) : error ? (
        <Alert type="error" showIcon title="设备详情加载失败" description={error}
          action={<Button size="small" icon={<ReloadOutlined />} onClick={() => setAttempt(value => value + 1)}>重试</Button>} />
      ) : detail && (
        <>
          {!rawEntries.length && <Alert type="info" showIcon title="未保留 Excel 原始字段，以下为设备基本信息" style={{ marginBottom: 16 }} />}
          <Descriptions column={screens.sm ? 2 : 1} size="small" bordered
            style={{ overflowWrap: 'anywhere' }}
            styles={{
              label: { width: screens.sm ? '20%' : 96 },
              content: { width: screens.sm ? '30%' : undefined, whiteSpace: 'pre-wrap' },
            }}
            items={entries.map(([label, value]) => ({ key: label, label, children: detailValue(value) }))} />
        </>
      )}
    </Modal>
  );
}

export default function EquipmentLibrary() {
  const [items, setItems] = useState<Equipment[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const { pagination, current: page, setCurrent: setPage, pageSize, setPageSize } = useListPagination(keyword);
  const [uploading, setUploading] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/equipment`, {
        params: { keyword, limit: pageSize, offset: (page - 1) * pageSize },
      });
      setItems(res.data.items);
      setTotal(res.data.total);
    } catch (e: any) {
      message.error('加载失败：' + (e.message || ''));
    } finally {
      setLoading(false);
    }
  }, [keyword, page, pageSize]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const handleUpload = async (file: File) => {
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await axios.post(`${API}/equipment/import`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      const { inserted, updated, skipped, total_rows } = res.data;
      message.success(`导入完成：新增 ${inserted}，更新 ${updated}，跳过 ${skipped}（共 ${total_rows} 行）`);
      setPage(1);
      fetchList();
    } catch (e: any) {
      message.error('导入失败：' + (e.response?.data?.error || e.message));
    } finally {
      setUploading(false);
    }
    return false;
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>设备库</h2>
        <Space>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="按管理编号、仪器名称、型号搜索"
            style={{ width: 300 }}
            value={keyword}
            onChange={(e) => { setKeyword(e.target.value); setPage(1); }}
          />
          <Upload accept=".xlsx,.xls" showUploadList={false} beforeUpload={handleUpload}>
            <Button type="primary" icon={<UploadOutlined />} loading={uploading}>导入 Excel</Button>
          </Upload>
        </Space>
      </div>
      <div style={{ display: 'flex', marginBottom: 8 }}>
        <ListPageSizeControl value={pageSize} onChange={setPageSize} />
      </div>

      <Table
        rowKey="id"
        dataSource={items}
        loading={loading}
        pagination={{ ...pagination, total, showTotal: (n) => `共 ${n} 条` }}
        columns={[
          { title: '管理编号', dataIndex: 'asset_code', width: 140, render: (v: string) => <span style={{ fontFamily: 'monospace' }}>{v}</span> },
          { title: '仪器名称', dataIndex: 'name' },
          { title: '型号', dataIndex: 'model', width: 140 },
          { title: '溯源日期', dataIndex: 'trace_date', width: 110 },
          { title: '到期日期', dataIndex: 'expire_date', width: 110, render: (v: string) => {
            if (!v) return <span style={{ color: '#aaa' }}>—</span>;
            const isExpired = new Date(v) < new Date();
            return <span style={{ color: isExpired ? '#cf1322' : '#389e0d' }}>{v}</span>;
          }},
          { title: '状态', dataIndex: 'status', width: 80, render: (v: string) => {
            if (!v) return null;
            const color = v === '合格' ? 'green' : v === '已超期' ? 'red' : 'default';
            return <Tag color={color}>{v}</Tag>;
          }},
          { title: '部门', dataIndex: 'department', width: 160 },
          { title: '操作', width: 60, render: (_, row) => (
            <Tooltip title="查看设备详情">
              <Button size="small" type="text" aria-label={`查看设备详情：${row.asset_code}`} icon={<EyeOutlined />} onClick={() => setDetailId(row.id)} />
            </Tooltip>
          ) },
        ]}
      />

      {detailId !== null && <EquipmentDetail key={detailId} id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}
