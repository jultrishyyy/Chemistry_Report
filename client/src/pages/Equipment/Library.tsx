import { useState, useEffect, useCallback } from 'react';
import { Table, Input, Button, Space, Upload, message, Tag, Modal, Descriptions } from 'antd';
import { SearchOutlined, UploadOutlined, EyeOutlined } from '@ant-design/icons';
import axios from 'axios';

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
  raw_payload?: Record<string, any>;
}

export default function EquipmentLibrary() {
  const [items, setItems] = useState<Equipment[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [uploading, setUploading] = useState(false);
  const [detail, setDetail] = useState<Equipment | null>(null);

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

      <Table
        rowKey="id"
        dataSource={items}
        loading={loading}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (n) => `共 ${n} 条`,
          onChange: (p, s) => { setPage(p); setPageSize(s); },
        }}
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
          { title: '操作', width: 60, render: (_, row) => <Button size="small" type="text" icon={<EyeOutlined />} onClick={() => setDetail(row)} /> },
        ]}
      />

      <Modal
        title="设备详情"
        open={!!detail}
        onCancel={() => setDetail(null)}
        footer={null}
        width={720}
        destroyOnClose
      >
        {detail && (
          <Descriptions column={2} size="small" bordered>
            {Object.entries(detail.raw_payload || {}).filter(([_, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => (
              <Descriptions.Item key={k} label={k}>{String(v)}</Descriptions.Item>
            ))}
          </Descriptions>
        )}
      </Modal>
    </div>
  );
}
