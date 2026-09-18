import { Button, Dropdown, Empty, Modal, Upload } from 'antd';
import { useEffect, useRef } from 'react';
import {
  ArrowDownOutlined, ArrowUpOutlined, CameraOutlined, DeleteOutlined, PlusOutlined, UploadOutlined,
} from '@ant-design/icons';
import { IS_TOUCH } from '../utils/device';
import ImageProcessButton, { formatImageBytes } from './ImageProcessButton';
import AutoGrowTextArea from './AutoGrowTextArea';
import { readReportPhoto } from '../utils/reportPhotoClipboard';

export type ImageListPhoto = {
  url?: string;
  server_path?: string;
  name?: string;
  original_name?: string;
  size_bytes?: number;
  [key: string]: any;
};

export type ImageListItem = { id: string; title: string; photo?: ImageListPhoto; [key: string]: any };

interface Props<T extends ImageListItem> {
  items: T[];
  onChange: (items: T[]) => void;
  /** 上传或“调整并替换”后返回新的图片引用；列表会负责写回对应卡片。 */
  onUpload: (index: number, file: File) => Promise<ImageListPhoto | undefined>;
  onCreate: () => T;
  readOnly?: boolean;
  /** Compact controls for final-report editing only. */
  reportMode?: boolean;
  help?: string;
  /** 新图片尚未单独设置尺寸时采用的 PDF 显示尺寸。 */
  defaultDisplaySize?: { widthCm?: number; heightCm?: number };
  onItemFocus?: (index: number, item: T) => void;
}

/** 原始记录、模板静态图片共用的图片卡片：上传、调整、排序、删除完全同一套交互。 */
export default function ImageListEditor<T extends ImageListItem>({ items, onChange, onUpload, onCreate, readOnly = false, reportMode = false, help, defaultDisplaySize, onItemFocus }: Props<T>) {
  const latest = useRef({ items, onChange, readOnly });
  latest.current = { items, onChange, readOnly };
  const mounted = useRef(true);
  const uploadVersions = useRef(new Map<string, number>());
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const publish = (next: T[]) => {
    if (!mounted.current || latest.current.readOnly) return;
    latest.current.items = next;
    latest.current.onChange(next);
  };
  const update = (index: number, patch: Partial<T>) => {
    const target = latest.current.items.findIndex(item => item.id === items[index]?.id);
    if (target < 0) return;
    const next = [...latest.current.items];
    next[target] = { ...next[target], ...patch };
    publish(next);
  };
  const remove = (index: number) => publish(latest.current.items.filter(item => item.id !== items[index]?.id));
  const move = (index: number, direction: -1 | 1) => {
    const current = latest.current.items.findIndex(item => item.id === items[index]?.id), target = current + direction;
    if (current < 0 || target < 0 || target >= latest.current.items.length) return;
    const next = [...latest.current.items];
    [next[current], next[target]] = [next[target], next[current]];
    publish(next);
  };
  const uploadAt = async (index: number, file: File) => {
    const id = items[index]?.id;
    if (!id) return false;
    const version = (uploadVersions.current.get(id) || 0) + 1;
    uploadVersions.current.set(id, version);
    const photo = await onUpload(index, file);
    // 图片替换只更新文件引用，保留已设置的 PDF 显示尺寸。
    const target = latest.current.items.findIndex(item => item.id === id);
    if (photo && target >= 0 && uploadVersions.current.get(id) === version) {
      const next = [...latest.current.items];
      next[target] = { ...next[target], photo: { ...next[target].photo, ...photo } };
      publish(next);
    }
    return false;
  };

  if (readOnly && items.length === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无图片" />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 2px 8px' }}>
      {items.map((item, index) => {
        const src = item.photo?.url || item.photo?.server_path;
        return <div key={item.id} tabIndex={reportMode ? 0 : undefined} onPaste={event => {
          if (!reportMode || readOnly) return;
          const copied = readReportPhoto(event.clipboardData); if (!copied) return;
          event.preventDefault(); event.stopPropagation();
          const next = [...items]; next[index] = { ...item, title: copied.title, photo: copied.photo }; onChange(next);
        }} onClick={event => { onItemFocus?.(index, item); if (reportMode && (event.target as HTMLElement).tagName === 'IMG') event.currentTarget.focus(); }} onFocusCapture={() => onItemFocus?.(index, item)} style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: 8,
          border: '1px solid #e8ecf3', borderRadius: 6, background: '#fff', minWidth: 0,
          flexWrap: reportMode || IS_TOUCH ? 'wrap' : 'nowrap', overflowX: reportMode || IS_TOUCH ? 'hidden' : 'auto',
        }}>
          <span style={{ width: 22, flexShrink: 0, textAlign: 'center', color: '#98a2b3', fontSize: 12 }}>{index + 1}</span>
          <div style={{ width: 82, height: 70, border: '1px dashed #ccd3df', borderRadius: 4, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafbfd', flexShrink: 0 }}>
            {src ? <img src={src} alt={item.title} style={{ width: '100%', height: '100%', objectFit: reportMode ? 'contain' : 'cover' }} /> : <span style={{ color: '#b2bac7', fontSize: 11 }}>未上传</span>}
          </div>
          <AutoGrowTextArea size="small" value={item.title} placeholder="图片名称" disabled={readOnly}
            style={{ flex: '1 1 145px', minWidth: 120, maxWidth: 175 }} onChange={event => update(index, { title: event.target.value } as Partial<T>)} />
          {!reportMode && <span style={{ minWidth: 48, flexShrink: 0, color: item.photo?.size_bytes != null ? '#7b8496' : '#b8bfca', fontSize: 11, whiteSpace: 'nowrap' }} title="上传压缩后的图片大小">
            {item.photo?.size_bytes != null ? formatImageBytes(item.photo.size_bytes) : ''}
          </span>}
          {!readOnly && (IS_TOUCH ? <>
            <Upload accept="image/*" showUploadList={false} beforeUpload={file => uploadAt(index, file as File)}><Button size="small" icon={<UploadOutlined />}>相册</Button></Upload>
            <Upload accept="image/*" capture="environment" showUploadList={false} beforeUpload={file => uploadAt(index, file as File)}><Button size="small" icon={<CameraOutlined />}>拍照</Button></Upload>
          </> : <Upload accept="image/*" showUploadList={false} beforeUpload={file => uploadAt(index, file as File)}><Button size="small" icon={<UploadOutlined />}>{reportMode && src ? '替换图片' : '上传'}</Button></Upload>)}
          {!readOnly && (src
            ? <ImageProcessButton src={src} name={item.photo?.original_name || item.photo?.name || item.title} sizeBytes={item.photo?.size_bytes} showSize={false}
                displaySize={{ widthCm: item.photo?.display_width_cm ?? defaultDisplaySize?.widthCm, heightCm: item.photo?.display_height_cm ?? defaultDisplaySize?.heightCm }}
                displayRotation={item.photo?.display_rotation ?? 0}
                onDisplaySizeChange={size => update(index, { photo: { ...item.photo, display_width_cm: size.widthCm, display_height_cm: size.heightCm } } as unknown as Partial<T>)}
                onPreviewChange={preview => update(index, { photo: { ...item.photo, display_width_cm: preview.widthCm, display_height_cm: preview.heightCm, display_rotation: preview.rotation || undefined } } as unknown as Partial<T>)}
                onProcessed={file => uploadAt(index, file)} />
            : <ImageProcessButton disabled onProcessed={file => uploadAt(index, file)} />)}
          {!readOnly && reportMode && <Dropdown trigger={['click']} menu={{ items: [
            { key: 'up', label: '上移', disabled: index === 0 },
            { key: 'down', label: '下移', disabled: index === items.length - 1 },
            { key: 'delete', label: '删除图片', danger: true },
          ], onClick: ({ key, domEvent }) => {
            domEvent.stopPropagation();
            if (key === 'up') move(index, -1);
            else if (key === 'down') move(index, 1);
            else Modal.confirm({ title: '删除这张图片？', content: '仅从当前报告移除，不删除已上传的文件。', okText: '删除', cancelText: '取消', onOk: () => remove(index) });
          } }}><Button size="small" aria-label={`图片 ${index + 1} 更多操作`}>更多 ▾</Button></Dropdown>}
          {!readOnly && !reportMode && <div style={{ display: 'inline-flex', alignItems: 'center', marginLeft: 'auto', flexShrink: 0 }}>
            <Button size="small" type="text" disabled={index === 0} title="上移" icon={<ArrowUpOutlined />} onClick={() => move(index, -1)} />
            <Button size="small" type="text" disabled={index === items.length - 1} title="下移" icon={<ArrowDownOutlined />} onClick={() => move(index, 1)} />
            <Button size="small" type="text" danger title="删除" icon={<DeleteOutlined />} onClick={() => remove(index)} />
          </div>}
        </div>;
      })}
      {!readOnly && <>
        <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={() => publish([...latest.current.items, onCreate()])} style={{ width: 130 }}>添加图片</Button>
        {help && !reportMode && <div style={{ fontSize: 11, color: '#8a94a6' }}>{help}</div>}
      </>}
    </div>
  );
}
