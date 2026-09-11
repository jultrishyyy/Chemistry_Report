/**
 * 订单条目 / 移动端的独立图片上传面板。
 * 与数据录入共用 RecordImageCollectionEditor，按图片分区整体编辑，不再按旧图片字段拆卡。
 */
import { useEffect, useState } from 'react';
import { Alert, Button, Empty, Spin, message } from 'antd';
import axios from 'axios';
import type { FieldGroup, RecordTemplate } from '../../../shared/types';
import {
  findImageCollection,
  imageCollectionFromLegacy,
  imageCollectionKey,
  type RecordImageCollection,
} from '../../../shared/image-collection';
import { useAutoSave } from '../hooks/useAutoSave';
import RecordImageCollectionEditor from './RecordImageCollectionEditor';

const API = '/api';

interface Props {
  templateId: number;
  orderNo: string;
  sampleId: string;
  sampleName?: string;
  testName: string;
  onSaved?: () => void;
  readOnly?: boolean;
}

export default function ImageUploadPanel({
  templateId,
  orderNo,
  sampleId,
  sampleName,
  testName,
  onSaved,
  readOnly = false,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [imageGroups, setImageGroups] = useState<FieldGroup[]>([]);
  const [collections, setCollections] = useState<Record<string, RecordImageCollection>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const templateRes = await axios.get(`${API}/record-templates/${templateId}`);
        const groups = (templateRes.data.field_definitions || []) as RecordTemplate['groups'];
        const groupsWithImages = groups.filter(group => group.fields.some(field => field.type === 'image'));

        let raw: Record<string, any> = {};
        const listRes = await axios.get(`${API}/record-data?template_id=${templateId}&order_no=${encodeURIComponent(orderNo)}`);
        const record = (listRes.data || []).find((row: any) =>
          row.sample_external_id === sampleId && row.test_item_name === testName);
        if (record) {
          const full = await axios.get(`${API}/record-data/${record.id}`);
          raw = full.data.raw_data || {};
        }

        const initial: Record<string, RecordImageCollection> = {};
        groupsWithImages.forEach(group => {
          initial[group.id] = findImageCollection(raw, group) || imageCollectionFromLegacy(group, raw);
        });
        if (!cancelled) {
          setImageGroups(groupsWithImages);
          setCollections(initial);
          setDirty(new Set());
        }
      } catch {
        if (!cancelled) message.error('加载图片内容失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [templateId, orderNo, sampleId, testName]);

  const updateCollection = (groupId: string, collection: RecordImageCollection) => {
    setCollections(previous => ({ ...previous, [groupId]: collection }));
    setDirty(previous => new Set(previous).add(groupId));
  };

  const save = async (options: { silent?: boolean } = {}): Promise<boolean> => {
    if (!dirty.size) {
      if (!options.silent) message.info('没有需要保存的改动');
      return true;
    }
    setSaving(true);
    try {
      for (const groupId of dirty) {
        const group = imageGroups.find(item => item.id === groupId);
        const collection = collections[groupId];
        if (!group || !collection) continue;

        const legacyImagesByField: Record<string, any[]> = {};
        group.fields.filter(field => field.type === 'image').forEach(field => {
          legacyImagesByField[field.code] = collection.items
            .filter(item => item.source_field_code === field.code && item.photo)
            .map(item => item.photo);
        });

        await axios.put(`${API}/record-data/images`, {
          template_id: templateId,
          order_no: orderNo,
          sample_external_id: sampleId,
          test_item_name: testName,
          image_collection_key: imageCollectionKey(group.id),
          image_collection: collection,
          legacy_images_by_field: legacyImagesByField,
        });
      }
      if (!options.silent) message.success('图片已保存');
      setDirty(new Set());
      onSaved?.();
      return true;
    } catch (error: any) {
      if (error.response?.status === 401) message.error('请先登录后再上传');
      else message.error(`保存失败：${error.response?.data?.error || error.message || ''}`);
      return false;
    } finally {
      setSaving(false);
    }
  };

  useAutoSave({
    enabled: !readOnly && !loading && !saving,
    isDirty: () => dirty.size > 0,
    save: () => save({ silent: true }),
  });

  if (loading) return <Spin style={{ display: 'block', margin: '40px auto' }} />;
  if (imageGroups.length === 0) return <Empty description="该原始记录模板没有图片字段" />;

  return (
    <div style={{ minWidth: 0 }}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={readOnly
          ? '当前为只读模式，图片仅可查看，不能上传、删除、改名、调整或排序。'
          : '保存后该记录会重新进入“待审核”（图片属于原始记录）。'}
      />

      {imageGroups.map((group, index) => {
        const collection = collections[group.id];
        if (!collection) return null;
        return (
          <div key={group.id} style={{ marginBottom: 12 }}>
            {imageGroups.length > 1 && (
              <div style={{ fontWeight: 600, marginBottom: 8 }}>{group.label || `图片分区${index + 1}`}</div>
            )}
            <RecordImageCollectionEditor
              group={group}
              collection={collection}
              readOnly={readOnly}
              uploadCtx={{ orderNo, recordDir: [sampleName, testName].filter(Boolean).join('_') }}
              onChange={next => updateCollection(group.id, next)}
            />
          </div>
        );
      })}

      {!readOnly && (
        <div style={{ position: 'sticky', bottom: 0, zIndex: 2, paddingTop: 10, background: 'linear-gradient(transparent, #fff 28%)' }}>
          <Button type="primary" block size="large" loading={saving} disabled={!dirty.size} onClick={() => save()}>
            保存图片{dirty.size ? `（${dirty.size} 个图片分区有改动）` : ''}
          </Button>
        </div>
      )}
    </div>
  );
}
