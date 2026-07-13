/**
 * 移动端图片上传页（/m/upload）
 *
 * 工程师用手机 / Pad 登录后：选订单 → 选样品×测试项目（已关联模板）→ 拍照 / 选图上传。
 * 也支持桌面端生成深链直接带参进入（template_id/order_no/sample_id/test_name）。
 * 复用 ImageUploadPanel + /api/record-data/images，写回同一条原始记录的图片字段。
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, List, Tag, Button, Empty, Spin, Space, Alert } from 'antd';
import { ArrowLeftOutlined, PictureOutlined } from '@ant-design/icons';
import axios from 'axios';
import { useAuth } from '../../auth';
import UserSwitcher from '../../components/UserSwitcher';
import ImageUploadPanel from '../../components/ImageUploadPanel';
import { type WorkOrder, type TemplateItem, normalizeLinkedIds } from '../Lab/order-shared';

const API = '/api';

interface Target { templateId: number; templateName: string; orderNo: string; sampleId: string; sampleName: string; testName: string }

export default function MobileImageUpload() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<string | null>(null);
  const [target, setTarget] = useState<Target | null>(null);

  // 深链直达
  const deepLink: Target | null = useMemo(() => {
    const templateId = Number(params.get('template_id'));
    const orderNo = params.get('order_no');
    const sampleId = params.get('sample_id');
    const testName = params.get('test_name');
    if (templateId && orderNo && sampleId && testName) {
      return { templateId, templateName: '', orderNo, sampleId, sampleName: params.get('sample_name') || '', testName };
    }
    return null;
  }, [params]);

  useEffect(() => {
    if (deepLink) { setTarget(deepLink); setLoading(false); return; }
    (async () => {
      try {
        const [wo, tpls] = await Promise.all([
          axios.get(`${API}/work-orders`),
          axios.get(`${API}/record-templates`),
        ]);
        setOrders(wo.data);
        setTemplates(tpls.data);
      } finally { setLoading(false); }
    })();
  }, [deepLink]);

  const templateById = useMemo(() => {
    const m = new Map<number, TemplateItem>();
    for (const t of templates) m.set(t.id, t);
    return m;
  }, [templates]);

  const header = (
    <div style={{ position: 'sticky', top: 0, zIndex: 1, background: '#fff', borderBottom: '1px solid #eee',
      padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <Space>
        <PictureOutlined style={{ color: '#1677ff' }} />
        <strong>图片上传</strong>
      </Space>
      <UserSwitcher />
    </div>
  );

  const wrap = (body: React.ReactNode) => (
    <div style={{ maxWidth: 640, margin: '0 auto', minHeight: '100vh', background: '#fff' }}>
      {header}
      <div style={{ padding: 14 }}>{body}</div>
    </div>
  );

  if (loading) return wrap(<Spin style={{ display: 'block', margin: '60px auto' }} />);

  if (!user) {
    return wrap(<Alert type="warning" showIcon message="请先登录" description="点右上角「登录」选择身份后再上传图片。" />);
  }

  // 已选定目标 → 上传面板
  if (target) {
    return wrap(
      <>
        {!deepLink && (
          <Button type="text" icon={<ArrowLeftOutlined />} style={{ marginBottom: 8 }}
            onClick={() => setTarget(null)}>返回选择</Button>
        )}
        <ImageUploadPanel
          templateId={target.templateId}
          orderNo={target.orderNo}
          sampleId={target.sampleId}
          sampleName={target.sampleName}
          testName={target.testName}
        />
      </>
    );
  }

  // 选订单
  if (!selectedOrder) {
    return wrap(
      orders.length === 0 ? <Empty description="暂无委托单" /> : (
        <List
          dataSource={orders}
          renderItem={(o) => (
            <List.Item style={{ cursor: 'pointer' }} onClick={() => setSelectedOrder(o.order_no)}>
              <Space direction="vertical" size={0}>
                <strong style={{ fontFamily: 'monospace' }}>{o.order_no}</strong>
                <span style={{ fontSize: 12, color: '#888' }}>{o.customer_name} · 样品 {o.payload.samples?.length || 0}</span>
              </Space>
            </List.Item>
          )}
        />
      )
    );
  }

  // 选样品×项目（仅显示已关联模板的项目）
  const order = orders.find(o => o.order_no === selectedOrder);
  return wrap(
    <>
      <Button type="text" icon={<ArrowLeftOutlined />} style={{ marginBottom: 8 }}
        onClick={() => setSelectedOrder(null)}>返回订单列表</Button>
      <div style={{ marginBottom: 8, fontFamily: 'monospace', fontWeight: 600 }}>{selectedOrder}</div>
      {(order?.payload.samples || []).map(s => (
        <Card key={s.id} size="small" title={s.name} style={{ marginBottom: 12 }}>
          {(s.test_infos || []).flatMap(t => {
            const ids = normalizeLinkedIds(t);
            if (!ids.length) return [(
              <div key={t.name} style={{ padding: '6px 0', color: '#bbb', fontSize: 13 }}>
                {t.name} <Tag>未关联模板，无法上传</Tag>
              </div>
            )];
            return ids.map(tid => (
              <div key={`${t.name}__${tid}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0' }}>
                <Space direction="vertical" size={0}>
                  <span>{t.name}</span>
                  <span style={{ fontSize: 12, color: '#999' }}>{templateById.get(tid)?.name || `模板 ${tid}`}</span>
                </Space>
                <Button type="primary" ghost icon={<PictureOutlined />}
                  onClick={() => setTarget({
                    templateId: tid, templateName: templateById.get(tid)?.name || '',
                    orderNo: selectedOrder, sampleId: s.id, sampleName: s.name, testName: t.name,
                  })}>
                  上传
                </Button>
              </div>
            ));
          })}
        </Card>
      ))}
    </>
  );
}
