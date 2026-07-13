import { Input } from 'antd';
import type { FieldGroup } from '../../../../shared/types';
import ImageLayoutControls from './ImageLayoutControls';
import FormatPanel from './FormatPanel';

type ILayout = NonNullable<FieldGroup['image_layout']>;

/**
 * 「图片版式」Popover（记录模板编辑器·图片分区）——只管【表内标题 + 排布】：
 *   · 表内标题：共用 / 每张一个（共用→填共用标题；每张→用各图片字段名）+ 表内标题样式；
 *   · 排布：每行几张 / 尺寸 / 独立框·粘连 / 单数独占 / 共用时跨页表头（ImageLayoutControls）。
 * 「大标题 / 图表上方标签 / 图表下方备注」在分区标题栏的「格式(A)」里设（ImageSectionNotes），互不重复。
 */
export default function ImageSectionPanel({ value, onChange }: {
  value: ILayout;
  onChange: (patch: Partial<ILayout>) => void;
}) {
  const v = value || {};
  const titleMode = v.title_mode || 'per';
  return (
    <div style={{ width: 400 }}>
      <ImageLayoutControls value={v}
        onChange={(patch) => onChange(patch as Partial<ILayout>)}
        onTitleModeChange={(m) => onChange({ title_mode: m })} />

      {titleMode === 'shared' && (
        <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: '#888', whiteSpace: 'nowrap' }}>共用标题</span>
          <Input size="small" style={{ flex: 1 }} placeholder="表内共用标题（空＝不显示）"
            value={v.shared_title ?? ''} onChange={(e) => onChange({ shared_title: e.target.value })} />
        </div>
      )}

      <div style={{ borderTop: '1px solid #eee', paddingTop: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4 }}>
          表内标题样式（{titleMode === 'shared' ? '共用标题' : '各图片字段名'}·加粗 / 字体 / 字号 / 颜色）
        </div>
        <FormatPanel variant="text" value={v.label_style} onChange={(s) => onChange({ label_style: s })} />
      </div>

      <div style={{ fontSize: 11, color: '#888', marginTop: 8, lineHeight: 1.7 }}>
        每个图片字段＝一个图位；「每行」＝每行几个图位。<b>共用</b>＝整组一个表内标题（上方填；粘连时可跨页重复表头）；<b>每张</b>＝用各图片字段名作表内标题（标题始终与其图片同页）。<br />
        「大标题 / 图表上方标签 / 图表下方备注」在分区标题栏的<b>「格式(A)」</b>里设。
      </div>
    </div>
  );
}
