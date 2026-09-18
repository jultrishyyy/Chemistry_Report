import { createPortal } from 'react-dom';
import { InputNumber, Space, message } from 'antd';
import type { FieldDefinition } from '../../../../shared/types';
import ImageListEditor from '../ImageListEditor';
import ReportImageManagerPopover from './ReportImageManagerPopover';
import { uploadCoverImage } from '../../utils/coverImageUpload';

type Images = NonNullable<FieldDefinition['static_images']>;
/** Only fixed template assets; never transforms a mapped image or legacy mixed block. */
export default function CoverLogoEditor({ field, templateId, readOnly, host, active, onSelect, onChange }: {
  field: FieldDefinition; templateId?: string | number; readOnly: boolean; host: HTMLElement | null; active: boolean;
  onSelect: () => void; onChange: (images: Images) => void;
}) {
  const images = field.static_images || [];
  const patchSize = (key: 'display_width_cm' | 'display_height_cm', value: number | null) => {
    if (images.length !== 1 || readOnly) return;
    onChange(images.map(image => ({ ...image, [key]: value ?? undefined })));
  };
  return <>
    {active && !readOnly && host && createPortal(<Space size={8} wrap>
      <ReportImageManagerPopover><ImageListEditor reportMode items={images.map(image => ({ id: image.id, title: image.title || image.name || 'Logo', photo: image }))}
        onChange={items => onChange(items.map(item => ({ ...item.photo, id: item.id, title: item.title })))}
        onCreate={() => { const id = crypto.randomUUID(); return { id, title: 'Logo', photo: { id, display_width_cm: 4 } }; }}
        defaultDisplaySize={{ widthCm: 4 }}
        onUpload={async (_index, file) => {
          try {
            return await uploadCoverImage(file, templateId);
          } catch (error: any) { message.error(`上传失败：${error.response?.data?.error || error.message}`); return undefined; }
        }} /></ReportImageManagerPopover>
      {images.length === 1 && <>
        <label>宽 <InputNumber aria-label="Logo宽度" min={0.1} max={30} step={0.1} suffix="cm" value={images[0].display_width_cm ?? null} onChange={v => patchSize('display_width_cm', v)} style={{ width: 110 }} /></label>
        <label>高 <InputNumber aria-label="Logo高度" min={0.1} max={40} step={0.1} suffix="cm" placeholder="等比" value={images[0].display_height_cm ?? null} disabled={!images[0].display_width_cm} onChange={v => patchSize('display_height_cm', v)} style={{ width: 110 }} /></label>
      </>}
    </Space>, host)}
    <div className={`cover-logo-block${active ? ' is-active' : ''}`} tabIndex={0} onClick={onSelect} onFocus={onSelect} role="group" aria-label="固定图片" style={{ paddingTop: `${field.static_layout?.before_pt ?? 0}pt`, paddingBottom: `${field.static_layout?.after_pt ?? 4}pt` }}>
      {images.length ? images.map((image, index) => <div key={image.id} style={{ textAlign: 'center', marginTop: index ? `${field.static_layout?.image_gap_pt ?? 4}pt` : 0 }}>
        {image.url || image.rel_path ? <img src={image.url || `/api/template-assets/file?p=${encodeURIComponent(image.rel_path!)}`} alt={image.title || image.name || 'Logo'} style={{ display: 'inline-block', maxWidth: '100%', width: image.display_width_cm ? `${image.display_width_cm}cm` : '100%', height: image.display_width_cm && image.display_height_cm ? `${image.display_height_cm}cm` : 'auto', transform: image.display_rotation ? `rotate(${image.display_rotation}deg)` : undefined }} />
          : <span className="cover-logo-empty">{readOnly ? '尚未上传图片' : '点击后在顶部上传 Logo / 图片'}</span>}
      </div>) : <span className="cover-logo-empty">{readOnly ? '暂无图片' : '点击后在顶部添加图片'}</span>}
    </div>
  </>;
}
