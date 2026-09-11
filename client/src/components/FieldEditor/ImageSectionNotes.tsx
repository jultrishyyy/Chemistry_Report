import { InputNumber, Tooltip } from 'antd';
import type { FieldGroup } from '../../../../shared/types';
import FormatPanel from './FormatPanel';
import AutoGrowTextArea from '../AutoGrowTextArea';

type ILayout = NonNullable<FieldGroup['image_layout']>;

/**
 * 图片分区「格式(A)」Popover 的右侧——图表【上方标签】+【下方备注】（各自文字·样式·与图距离）。
 * 左侧仍是「大标题」（分区 #section 标题）。表内标题在「图片版式」里设，互不重复。
 * 写入 group.image_layout.{top_label*, caption*}；渲染端与布局解耦（单设标签/备注不会改变图位排布）。
 */
export default function ImageSectionNotes({
  value, onChange, inheritedFont = 'Songti SC', inheritedSize = 10, inheritedFigureGapPt,
}: {
  value: ILayout;
  onChange: (patch: Partial<ILayout>) => void;
  inheritedFont?: string;
  inheritedSize?: number;
  inheritedFigureGapPt?: number;
}) {
  const v = value || {};
  const topGapPt = Math.round(inheritedSize * 0.4 * 10) / 10;
  const captionGapPt = inheritedFigureGapPt ?? Math.round(inheritedSize * 0.6 * 10) / 10;
  // 上下堆叠，避免“分区标题 + 标签 + 备注”三列横向撑出屏幕。
  return (
    <div style={{
      width: 'min(340px, calc(100vw - 64px))',
      maxWidth: '100%',
      maxHeight: 'calc(100vh - 150px)',
      overflowY: 'auto',
      overscrollBehavior: 'contain',
      paddingRight: 6,
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
    }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4 }}>图表上方·标签（左上角，空＝无）</div>
        <AutoGrowTextArea size="small" value={v.top_label ?? ''} placeholder="如：图 1 检测过程照片"
          onChange={(e) => onChange({ top_label: e.target.value || undefined })} />
        <div style={{ marginTop: 6 }}>
          <FormatPanel variant="text" value={v.top_label_style}
            inheritedFont={inheritedFont} inheritedSize={inheritedSize} inheritedBold={true}
            onChange={(s) => onChange({ top_label_style: s })} />
        </div>
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Tooltip title="上方标签与图片表之间当前实际生效的距离"><span style={{ fontSize: 12, color: '#888' }}>标签↔图距离</span></Tooltip>
          <InputNumber size="small" style={{ width: 104 }} min={0} max={60} step={0.5} addonAfter="pt"
            value={v.top_label_gap ? parseFloat(v.top_label_gap) : topGapPt}
            onChange={(n) => onChange({ top_label_gap: `${n ?? topGapPt}pt` })} />
        </div>
      </div>

      <div style={{ borderTop: '1px solid #eee', paddingTop: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4 }}>图表下方·备注（整组一条，空＝无）</div>
        <AutoGrowTextArea autoSize={{ minRows: 2, maxRows: 3 }} value={v.caption ?? ''} placeholder="如：见原始样品照片。"
          onChange={(e) => onChange({ caption: e.target.value || undefined })} />
        <div style={{ marginTop: 6 }}>
          <FormatPanel variant="text" value={v.caption_style}
            inheritedFont={inheritedFont} inheritedSize={9} inheritedBold={false}
            onChange={(s) => onChange({ caption_style: s })} />
        </div>
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Tooltip title="下方备注与图片表之间当前实际生效的距离"><span style={{ fontSize: 12, color: '#888' }}>备注↔图距离</span></Tooltip>
          <InputNumber size="small" style={{ width: 104 }} min={0} max={60} step={0.5} addonAfter="pt"
            value={v.caption_gap ? parseFloat(v.caption_gap) : captionGapPt}
            onChange={(n) => onChange({ caption_gap: `${n ?? captionGapPt}pt` })} />
        </div>
      </div>
    </div>
  );
}
