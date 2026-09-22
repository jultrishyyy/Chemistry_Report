import { useEffect, useMemo, useState } from 'react';
import { Alert, Input, Table, Tag } from 'antd';
import axios from 'axios';
import PageHeader from '../../components/PageHeader';
import { useAuth } from '../../auth';

export default function ProjectList() {
  const { has } = useAuth();
  const [orders, setOrders] = useState<any[]>([]);
  const [keyword, setKeyword] = useState('');
  useEffect(() => { axios.get('/api/work-orders').then(r => setOrders(r.data)); }, []);
  const rows = useMemo(() => orders.flatMap(o => (o.payload?.samples || []).flatMap((s: any) =>
    (s.test_infos || []).map((t: any) => ({ key: `${o.order_no}-${s.id}-${t.name}`, order_no: o.order_no, sample: s.name, ...t }))
  )).filter(r => [r.order_no, r.sample, r.name, r.detection_group, r.leader].join(' ').toLowerCase().includes(keyword.toLowerCase())), [orders, keyword]);
  return <div style={{ padding: 24 }}>
    {!has('test_project.view_all') && <Alert type="info" showIcon message="当前列表仅显示账号有权限的测试项目" style={{ marginBottom: 16 }} />}
    <PageHeader title="测试项目管理" subtitle="按检测组和项目负责人查看当前可处理的测试项目。" extra={<Input.Search allowClear placeholder="搜索委托单、样品、项目或检测组" style={{ width: 320 }} onChange={e => setKeyword(e.target.value)} />} />
    <Table rowKey="key" dataSource={rows} columns={[
      { title: '委托单号', dataIndex: 'order_no' }, { title: '样品', dataIndex: 'sample' },
      { title: '测试项目', dataIndex: 'name' }, { title: '检测组', dataIndex: 'detection_group', render: (v: string) => v ? <Tag color="blue">{v}</Tag> : '—' },
      { title: '项目负责人', dataIndex: 'leader', render: (v: string) => v || '—' },
      { title: '检测标准', dataIndex: 'standard', render: (v: string) => v || '—' },
    ]} />
  </div>;
}
