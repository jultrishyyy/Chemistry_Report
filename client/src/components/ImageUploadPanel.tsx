/**
 * 图片上传面板（可复用）
 *
 * 把图片单独上传 / 拍照写回某条原始记录的【图片字段】，与完整数据录入解耦：
 *  - 录入工作台「订单详情」页的「上传图片」Modal
 *  - 移动端拍照页 /m/upload
 * 两处共用本组件。保存走 PUT /api/record-data/images（部分合并，不动其它字段；
 * 图片是数据变更 ⇒ 保存后该记录重新进入「待审核」）。
 */
import { useEffect, useState } from 'react';
import { Upload, Button, message, Spin, Empty, Alert, Tag, Space } from 'antd';
import { CameraOutlined, FileImageOutlined, DeleteOutlined } from '@ant-design/icons';
import axios from 'axios';
import type { RecordTemplate, FieldDefinition } from '../../../shared/types';
import { IS_TOUCH } from '../utils/device';

const API = '/api';

interface ImageItem { name: string; original_name?: string; server_path?: string; url: string }

interface Props {
  templateId: number;
  orderNo: string;
  sampleId: string;
  sampleName?: string;
  testName: string;
  /** 保存成功回调（刷新外部进度等） */
  onSaved?: () => void;
  /** 已审核锁定：只看不传——隐藏拍照/选图/删除/保存，仅展示已上传图片 */
  readOnly?: boolean;
}

export default function ImageUploadPanel({ templateId, orderNo, sampleId, sampleName, testName, onSaved, readOnly = false }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [imageFields, setImageFields] = useState<FieldDefinition[]>([]);
  const [imagesByField, setImagesByField] = useState<Record<string, ImageItem[]>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // 1. 模板 → 抽取图片字段
        const tRes = await axios.get(`${API}/record-templates/${templateId}`);
        const groups = (tRes.data.field_definitions || []) as RecordTemplate['groups'];
        const imgFields = groups.flatMap(g => g.fields).filter(f => f.type === 'image');
        // 2. 找现有记录（按上下文）→ 取当前图片
        const init: Record<string, ImageItem[]> = {};
        const listRes = await axios.get(`${API}/record-data?template_id=${templateId}&order_no=${encodeURIComponent(orderNo)}`);
        const rec = (listRes.data || []).find((r: any) =>
          r.sample_external_id === sampleId && r.test_item_name === testName);
        if (rec) {
          const full = await axios.get(`${API}/record-data/${rec.id}`);
          const raw = full.data.raw_data || {};
          for (const f of imgFields) init[f.code] = Array.isArray(raw[f.code]) ? raw[f.code] : [];
        } else {
          for (const f of imgFields) init[f.code] = [];
        }
        if (!cancelled) { setImageFields(imgFields); setImagesByField(init); }
      } catch {
        if (!cancelled) message.error('加载图片字段失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [templateId, orderNo, sampleId, testName]);

  const handleUpload = async (code: string, file: File) => {
    const field = imageFields.find(f => f.code === code);
    const allowMultiple = field?.allow_multiple !== false;
    const fd = new FormData();
    fd.append('file', file);
    // 落盘上下文：订单号 / 原始记录(样品_测试项目) / 字段名 → 按结构分文件夹存
    if (orderNo) fd.append('order_no', orderNo);
    fd.append('record_dir', [sampleName, testName].filter(Boolean).join('_'));
    fd.append('field_name', field?.label || code);
    try {
      const res = await fetch('/api/images/upload', { method: 'POST', body: fd });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setImagesByField(prev => {
        const cur = prev[code] || [];
        return { ...prev, [code]: allowMultiple ? [...cur, data] : [data] };
      });
      setDirty(prev => new Set(prev).add(code));
    } catch (e: any) {
      message.error('上传失败：' + (e.message || ''));
    }
    return false; // 阻止 antd 默认上传
  };

  const removeAt = (code: string, idx: number) => {
    setImagesByField(prev => ({ ...prev, [code]: (prev[code] || []).filter((_, i) => i !== idx) }));
    setDirty(prev => new Set(prev).add(code));
  };

  const save = async () => {
    if (!dirty.size) { message.info('没有需要保存的改动'); return; }
    setSaving(true);
    try {
      for (const code of dirty) {
        await axios.put(`${API}/record-data/images`, {
          template_id: templateId,
          order_no: orderNo,
          sample_external_id: sampleId,
          test_item_name: testName,
          field_code: code,
          images: imagesByField[code] || [],
        });
      }
      message.success('图片已保存');
      setDirty(new Set());
      onSaved?.();
    } catch (e: any) {
      if (e.response?.status === 401) message.error('请先登录后再上传');
      else message.error('保存失败：' + (e.response?.data?.error || e.message));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spin style={{ display: 'block', margin: '40px auto' }} />;

  return (
    <div>
      <div style={{ marginBottom: 12, fontSize: 13, color: '#666' }}>
        <Space wrap size={6}>
          <Tag color="blue" style={{ fontFamily: 'monospace' }}>{orderNo}</Tag>
          {sampleName && <span>样品：{sampleName}</span>}
          <span style={{ color: '#999' }}>·</span>
          <span>项目：{testName}</span>
        </Space>
      </div>

      {imageFields.length === 0 ? (
        <Empty description="该原始记录模板没有图片字段" />
      ) : (
        <>
          <Alert type="info" showIcon style={{ marginBottom: 12 }}
            message={readOnly
              ? '该记录已审核锁定，图片只读。如需修改请在报告生成处「退回原始记录」转回草稿。'
              : '保存后该记录会重新进入「待审核」（图片属于原始记录）。'} />
          {imageFields.map(field => {
            const items = imagesByField[field.code] || [];
            const allowMultiple = field.allow_multiple !== false;
            const canAdd = allowMultiple || items.length === 0;
            return (
              <div key={field.code} style={{ marginBottom: 20 }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>
                  {field.label}
                  {allowMultiple && <span style={{ fontWeight: 'normal', color: '#999', fontSize: 12 }}>（可多张）</span>}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-start' }}>
                  {items.map((it, i) => (
                    <div key={i} style={{ position: 'relative', width: 104, height: 104, border: '1px solid #ddd', borderRadius: 6, overflow: 'hidden' }}>
                      <img src={it.url} alt={it.original_name || it.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      {!readOnly && (
                        <Button size="small" type="text" danger icon={<DeleteOutlined />}
                          style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(255,255,255,0.85)', padding: 0, width: 24, height: 24 }}
                          onClick={() => removeAt(field.code, i)} />
                      )}
                    </div>
                  ))}
                  {!readOnly && canAdd && (
                    <Space direction="vertical" size={6}>
                      {IS_TOUCH && (
                        <Upload accept="image/*" capture="environment" showUploadList={false}
                          beforeUpload={(file) => handleUpload(field.code, file)}>
                          <Button icon={<CameraOutlined />} style={{ width: 104 }}>拍照</Button>
                        </Upload>
                      )}
                      <Upload accept="image/*" showUploadList={false}
                        beforeUpload={(file) => handleUpload(field.code, file)}>
                        <Button icon={<FileImageOutlined />} style={{ width: 104 }}>选图</Button>
                      </Upload>
                    </Space>
                  )}
                  {readOnly && items.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无图片" />}
                </div>
              </div>
            );
          })}
          {!readOnly && (
            <Button type="primary" block size="large" loading={saving} disabled={!dirty.size} onClick={save}>
              保存图片{dirty.size ? `（${dirty.size} 个字段有改动）` : ''}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
