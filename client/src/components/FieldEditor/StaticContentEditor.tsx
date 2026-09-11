import { Card, Form, Input, InputNumber, Select, message } from 'antd';
import axios from 'axios';
import type { FieldDefinition } from '../../../../shared/types';
import ImageListEditor, { type ImageListItem } from '../ImageListEditor';
import { prepareImageForUpload } from '../../utils/imageProcessing';
import FreeGridCanvas from './MatrixEditor/FreeGridCanvas';

type Asset = { id: string; title?: string; name?: string; url?: string; rel_path?: string; mime_type?: string; size_bytes?: number; display_width_cm?: number; display_height_cm?: number };
const displayOptions = [{ value: 'both', label: '原始记录和录入界面' }, { value: 'pdf', label: '仅原始记录' }, { value: 'form', label: '仅录入界面' }];
const kindOptions = [{ value: 'text', label: '文字说明' }, { value: 'images', label: '图片说明' }, { value: 'table', label: '说明表格' }];
const fontOptions = [
  { value: 'Songti SC', label: '宋体' },
  { value: 'SimHei', label: '黑体' },
  { value: 'KaiTi', label: '楷体' },
  { value: 'FangSong', label: '仿宋' },
  { value: 'FangSong_GB2312', label: '仿宋_GB2312' },
  { value: 'Arial', label: 'Arial' },
  { value: 'Times New Roman', label: 'Times New Roman' },
];
const newStaticTable = (): NonNullable<FieldDefinition['free_table']> => ({
  columns: [{ id: 'c1', label: '' }, { id: 'c2', label: '' }, { id: 'c3', label: '' }],
  rows: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }],
  cells: {}, header_cells: {}, input_cells: {},
});

/** 一个字段只编辑一种静态内容；不同内容类型只展示自身需要的格式项。 */
export default function StaticContentEditor({ field, templateId, inheritedFont = 'Songti SC', inheritedSize = 10, onChange, onItemFocus }: { field: FieldDefinition; templateId?: number; inheritedFont?: string; inheritedSize?: number; onChange: (patch: Partial<FieldDefinition>) => void; onItemFocus?: (itemId: string) => void }) {
  const legacyBlocks = field.static_content || [];
  const inferredKind = legacyBlocks.some(block => block.kind === 'image') ? 'images'
    : legacyBlocks.some(block => (block as any).kind === 'attachment') ? 'table' : 'text';
  // 旧版的 attachments 配置在打开编辑器时立即按说明表格处理；保存后不会再保留该配置。
  const kind = (field.static_kind as any) === 'attachments' ? 'table' : (field.static_kind || inferredKind);
  const layout = field.static_layout || {};
  const legacyText = legacyBlocks.filter(block => block.kind === 'text').map(block => block.text || '').join('\n');
  const legacyAssets: Asset[] = legacyBlocks
    .filter(block => block.kind === 'image')
    .map(({ id, name, url, rel_path, mime_type, size_bytes }) => ({ id, name, url, rel_path, mime_type, size_bytes }));
  const assets: Asset[] = field.static_images || legacyAssets;
  const migratePatch: Partial<FieldDefinition> = kind === 'text'
    ? { static_kind: 'text', static_text: field.static_text ?? legacyText, static_content: undefined }
    : kind === 'images'
      ? { static_kind: 'images', static_images: field.static_images || legacyAssets, static_content: undefined }
      : { static_kind: 'table', static_table: field.static_table || newStaticTable(), static_content: undefined };
  const patchLayout = (patch: Record<string, any>) => onChange({ ...migratePatch, static_layout: { ...layout, ...patch } });
  const setAssets = (next: Asset[]) => onChange({ static_kind: 'images', static_images: next, static_content: undefined });
  const uploadAsset = async (file: File): Promise<Asset | undefined> => {
    try {
      const form = new FormData();
      form.append('file', await prepareImageForUpload(file));
      form.append('template_id', String(templateId || 'draft'));
      const { data } = await axios.post('/api/template-assets/upload', form);
      message.success('资料已上传；保存模板后会随该版本冻结');
      return data;
    } catch (e: any) {
      message.error('上传失败：' + (e.response?.data?.error || e.message));
      return undefined;
    }
  };
  const controlGrid = (children: React.ReactNode) => <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0 12px' }}>{children}</div>;
  const formItemStyle = { marginBottom: 12 };

  const commonLayout = <Card size="small" title="段落间距" style={{ marginBottom: 12 }}>
    {controlGrid(<>
      <Form.Item label="段前" style={formItemStyle}><InputNumber min={0} max={100} value={layout.before_pt ?? 0} addonAfter="pt" style={{ width: '100%' }} onChange={before_pt => patchLayout({ before_pt })} /></Form.Item>
      <Form.Item label="段后" style={formItemStyle}><InputNumber min={0} max={100} value={layout.after_pt ?? 4} addonAfter="pt" style={{ width: '100%' }} onChange={after_pt => patchLayout({ after_pt })} /></Form.Item>
    </>)}
  </Card>;

  const imageItems: ImageListItem[] = assets.map(asset => ({ id: asset.id, title: asset.title || asset.name || '图片', photo: asset }));
  const updateImageItems = (items: ImageListItem[]) => setAssets(items.map(item => ({
    ...(item.photo || {}), id: item.id, title: item.title, name: item.photo?.name || item.title,
  })));

  return <Form layout="vertical" size="small">
    {controlGrid(<>
      <Form.Item label="内容类型" style={formItemStyle}><Select value={kind} options={kindOptions} onChange={nextKind => onChange({
        // 内容类型互斥：切走时清掉旧类型专属数据，避免切回后恢复旧文字/图片/表格。
        static_kind: nextKind as FieldDefinition['static_kind'], static_content: undefined,
        static_text: nextKind === 'text' ? '' : undefined,
        static_images: nextKind === 'images' ? [] : undefined,
        static_table: nextKind === 'table' ? newStaticTable() : undefined,
      })} /></Form.Item>
      <Form.Item label="显示范围" style={formItemStyle}><Select value={field.static_display || 'both'} onChange={static_display => onChange({ ...migratePatch, static_display })} options={displayOptions} /></Form.Item>
    </>)}
    {commonLayout}

    {kind === 'text' && <Card size="small" title="文字格式">
      {controlGrid(<>
        <Form.Item label="字体" style={formItemStyle}><Select value={layout.font || inheritedFont} onChange={font => patchLayout({ font, font_mode: undefined })} options={fontOptions} /></Form.Item>
        <Form.Item label="字号" style={formItemStyle}><InputNumber min={6} max={30} value={layout.font_size ?? inheritedSize} addonAfter="pt" style={{ width: '100%' }} onChange={font_size => patchLayout({ font_size, font_mode: undefined })} /></Form.Item>
        <Form.Item label="行距" style={formItemStyle}><InputNumber min={0} max={40} value={layout.line_gap_pt ?? 4} addonAfter="pt" style={{ width: '100%' }} onChange={line_gap_pt => patchLayout({ line_gap_pt })} /></Form.Item>
        <Form.Item label="段间距" style={formItemStyle}><InputNumber min={0} max={60} value={layout.paragraph_gap_pt ?? 6} addonAfter="pt" style={{ width: '100%' }} onChange={paragraph_gap_pt => patchLayout({ paragraph_gap_pt })} /></Form.Item>
        <Form.Item label="首行缩进" style={formItemStyle}><InputNumber min={0} max={8} step={0.5} value={layout.first_line_indent_em ?? 0} addonAfter="em" style={{ width: '100%' }} onChange={first_line_indent_em => patchLayout({ first_line_indent_em })} /></Form.Item>
      </>)}
      <Form.Item label="说明内容" style={{ marginBottom: 0 }} extra="换行会在 PDF 中保留；空行会形成新段落。">
        <Input.TextArea value={field.static_text ?? legacyText} autoSize={{ minRows: 5, maxRows: 14 }} onChange={e => onChange({ static_kind: 'text', static_text: e.target.value, static_content: undefined })} />
      </Form.Item>
    </Card>}

    {kind === 'images' && <>
      <Card size="small" title="图片显示" style={{ marginBottom: 12 }}>
        {controlGrid(<>
          <Form.Item label="图片间距" style={formItemStyle}><InputNumber min={0} max={60} value={layout.image_gap_pt ?? 4} addonAfter="pt" style={{ width: '100%' }} onChange={image_gap_pt => patchLayout({ image_gap_pt })} /></Form.Item>
        </>)}
        <div style={{ marginTop: -4, color: '#667085', fontSize: 12 }}>每张图片的 PDF 尺寸在其“调整”中设置；未单独设置的图片会按页面宽度等比显示。</div>
      </Card>
      <Card size="small" title="图片列表">
        <ImageListEditor
          items={imageItems}
          onChange={updateImageItems}
          onUpload={(_index, file) => uploadAsset(file)}
          onCreate={() => ({ id: globalThis.crypto?.randomUUID?.() || `image_${Date.now()}_${assets.length}`, title: `图片${assets.length + 1}` })}
          defaultDisplaySize={{ widthCm: 17 }}
          help="可上传、改名、压缩、旋转、调整 PDF 尺寸、排序或删除；“调整”会替换当前图片。"
          onItemFocus={(_index, item) => onItemFocus?.(item.id)}
        />
      </Card>
    </>}

    {kind === 'table' && <Card size="small" title="说明表格">
      <div style={{ color: '#667085', fontSize: 12, marginBottom: 10 }}>每个单元格直接录入模板固定文字；拖动框选区域后可合并、拆分，以及调整字体、字号、加粗和对齐。该表不属于数据录入。</div>
      <FreeGridCanvas
        field={{ ...field, type: 'free_grid', label: '', hide_label: true, free_table: field.static_table || newStaticTable() }}
        onChange={patch => onChange({ static_kind: 'table', static_table: patch.free_table, static_content: undefined })}
        documentFont={inheritedFont}
        documentSize={inheritedSize}
        staticContentMode
      />
    </Card>}
  </Form>;
}
