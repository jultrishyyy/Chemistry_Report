import type { FieldGroup } from '../../../../shared/types';
import ImageLayoutControls from './ImageLayoutControls';
import FormatPanel from './FormatPanel';
import AutoGrowTextArea from '../AutoGrowTextArea';

type ILayout = NonNullable<FieldGroup['image_layout']>;

/**
 * 「图片版式」Popover（记录模板编辑器·图片分区）——只管【表内标题 + 排布】：
 *   · 表内标题：共用 / 每张一个（共用→填共用标题；每张→模板字段名作为录入初始名称）+ 表内标题样式；
 *   · 排布：每行几张 / 尺寸 / 独立框·粘连 / 单数独占 / 共用时跨页表头（ImageLayoutControls）。
 * 「大标题 / 图表上方标签 / 图表下方备注」在分区标题栏的「格式(A)」里设（ImageSectionNotes），互不重复。
 */
export default function ImageSectionPanel({ value, onChange, inheritedFont = 'Songti SC', inheritedSize = 10, defaultInset = 6 }: {
  value: ILayout;
  onChange: (patch: Partial<ILayout>) => void;
  inheritedFont?: string;
  inheritedSize?: number;
  defaultInset?: number;
}) {
  const v = value || {};
  const titleMode = v.title_mode || 'per';
  return (
    <div style={{
      width: 'min(520px, calc(100vw - 64px))',
      maxWidth: '100%',
      maxHeight: 'calc(100vh - 150px)',
      overflowX: 'hidden',
      overflowY: 'auto',
      overscrollBehavior: 'contain',
      paddingRight: 6,
    }}>
      <ImageLayoutControls value={v}
        defaultInset={defaultInset}
        onChange={(patch) => onChange(patch as Partial<ILayout>)}
        onTitleModeChange={(m) => onChange({ title_mode: m })} />

      {titleMode === 'shared' && (
        <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: '#888', whiteSpace: 'nowrap' }}>共用标题</span>
          <AutoGrowTextArea size="small" style={{ flex: 1 }} placeholder="表内共用标题（空＝不显示）"
            value={v.shared_title ?? ''} onChange={(e) => onChange({ shared_title: e.target.value })} />
        </div>
      )}

      <div style={{ borderTop: '1px solid #eee', paddingTop: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4 }}>
          表内标题样式（{titleMode === 'shared' ? '共用标题' : '各图片名称'}·加粗 / 字体 / 字号 / 颜色）
        </div>
        <FormatPanel variant="text" value={v.label_style}
          inheritedFont={inheritedFont} inheritedSize={inheritedSize} inheritedBold={true}
          onChange={(s) => onChange({ label_style: s })} />
      </div>

      <div style={{ fontSize: 11, color: '#888', marginTop: 8, lineHeight: 1.7 }}>
        模板图片字段提供录入时的初始图片项；录入人员可继续增删、改名和排序。「每行」＝每行几张图片。<b>共用</b>＝整组一个表内标题（上方填；粘连时可跨页重复表头）；<b>每张</b>＝使用录入后的图片名称作标题（始终与其图片同页）。<br />
        「大标题 / 图表上方标签 / 图表下方备注」在分区标题栏的<b>「格式(A)」</b>里设。
      </div>
    </div>
  );
}
