import { Input, InputNumber, Tooltip } from 'antd';
import type { FieldGroup } from '../../../../shared/types';
import FormatPanel from './FormatPanel';

type ILayout = NonNullable<FieldGroup['image_layout']>;

/**
 * 图片分区「格式(A)」Popover 的右侧——图表【上方标签】+【下方备注】（各自文字·样式·与图距离）。
 * 左侧仍是「大标题」（分区 #section 标题）。表内标题在「图片版式」里设，互不重复。
 * 写入 group.image_layout.{top_label*, caption*}；渲染端与布局解耦（单设标签/备注不会改变图位排布）。
 */
export default function ImageSectionNotes({ value, onChange }: {
  value: ILayout;
  onChange: (patch: Partial<ILayout>) => void;
}) {
  const v = value || {};
  // 两列：左＝图表上方标签（文字/样式/距离），右＝图表下方备注（文字/样式/距离）。
  return (
    <div style={{ display: 'flex', gap: 16 }}>
      <div style={{ minWidth: 210 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4 }}>图表上方·标签（左上角，空＝无）</div>
        <Input size="small" value={v.top_label ?? ''} placeholder="如：图 1 检测过程照片"
          onChange={(e) => onChange({ top_label: e.target.value || undefined })} />
        <div style={{ marginTop: 6 }}>
          <FormatPanel variant="text" value={v.top_label_style} onChange={(s) => onChange({ top_label_style: s })} />
        </div>
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Tooltip title="上方标签与图之间的距离；留空＝默认"><span style={{ fontSize: 12, color: '#888' }}>标签↔图距离</span></Tooltip>
          <InputNumber size="small" style={{ width: 96 }} min={0} max={60} step={1} addonAfter="pt" placeholder="默认"
            value={v.top_label_gap ? parseFloat(v.top_label_gap) : undefined}
            onChange={(n) => onChange({ top_label_gap: n != null ? `${n}pt` : undefined })} />
        </div>
      </div>

      <div style={{ borderLeft: '1px solid #eee', paddingLeft: 16, minWidth: 210 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4 }}>图表下方·备注（整组一条，空＝无）</div>
        <Input.TextArea rows={2} value={v.caption ?? ''} placeholder="如：见原始样品照片。"
          onChange={(e) => onChange({ caption: e.target.value || undefined })} />
        <div style={{ marginTop: 6 }}>
          <FormatPanel variant="text" value={v.caption_style} onChange={(s) => onChange({ caption_style: s })} />
        </div>
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Tooltip title="下方备注与图之间的距离；留空＝默认"><span style={{ fontSize: 12, color: '#888' }}>备注↔图距离</span></Tooltip>
          <InputNumber size="small" style={{ width: 96 }} min={0} max={60} step={1} addonAfter="pt" placeholder="默认"
            value={v.caption_gap ? parseFloat(v.caption_gap) : undefined}
            onChange={(n) => onChange({ caption_gap: n != null ? `${n}pt` : undefined })} />
        </div>
      </div>
    </div>
  );
}
