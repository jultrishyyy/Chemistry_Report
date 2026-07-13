import { Radio, InputNumber, Tooltip, Checkbox } from 'antd';

/**
 * 图片版式控件条（单一事实来源）——尺寸、每行张数、独立框/粘连、单数独占、标题模式、跨页表头。
 * 「独立框/粘连」＝`seamless`：粘连(缺省)＝整组连成一张连续表格（边框共享、块间距 0）；独立框＝每行独立框、块间留白。
 * 原始记录模板/报告首页/项目模板 + 生成报告编辑器四处**共用本组件**，保证 UI 与可调项完全一致、不各写一套漂移。
 *
 * 只读写传入的 image_gallery / photo_table 配置子集（layout 部分）；shared_title / items / 照片各编辑器自管。
 */
export interface ImageLayoutValue {
  title_mode?: 'shared' | 'per';
  cols?: number;
  width_cm?: number;
  height_cm?: number;
  solo?: 'first' | 'last';
  seamless?: boolean;
  header_follow?: boolean;
  /** 图片左右边距(x,pt)/上下边距(y,pt)/表内标题行高(标题格上下内边距,pt)。缺省回退 6 / 上下+6。 */
  inset_x?: number;
  inset_y?: number;
  title_inset_y?: number;
}

export default function ImageLayoutControls({
  value, onChange, onTitleModeChange, showTitleMode = true, showHeaderFollow = true,
}: {
  value: ImageLayoutValue;
  /** 版式项变更（cols/width/height/solo/seamless/header_follow） */
  onChange: (patch: Partial<ImageLayoutValue>) => void;
  /** 标题模式切换单独走（生成报告侧用 switchMode 以保留照片；模板侧直接 setCfg({title_mode})） */
  onTitleModeChange: (mode: 'shared' | 'per') => void;
  showTitleMode?: boolean;
  showHeaderFollow?: boolean;
}) {
  const titleMode = value.title_mode || 'per';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
      {showTitleMode && (
        <span style={{ fontSize: 12 }}>标题
          <Radio.Group size="small" optionType="button" style={{ marginLeft: 4 }} value={titleMode}
            onChange={(e) => onTitleModeChange(e.target.value)}
            options={[{ value: 'shared', label: '共用标题' }, { value: 'per', label: '每张一个标题' }]} /></span>
      )}
      <Tooltip title="表内标题行的高度（标题格上下留白，pt）；留空＝默认（图片上下边距+6）">
        <span style={{ fontSize: 12 }}>标题行高
          <InputNumber size="small" min={0} max={40} style={{ width: 66, marginLeft: 4 }} value={value.title_inset_y}
            placeholder="默认" addonAfter="pt" onChange={(v) => onChange({ title_inset_y: v ?? undefined })} /></span>
      </Tooltip>
      <span style={{ fontSize: 12 }}>每行
        <InputNumber size="small" min={1} max={6} style={{ width: 56, marginLeft: 4 }} value={value.cols ?? 2}
          onChange={(v) => onChange({ cols: v && v > 0 ? v : undefined })} />张</span>
      <Tooltip title="粘连＝整组连成一张连续表格（边框共享、图之间无空隙）；独立框＝每行/每张各自独立边框、块间留白。缺省粘连。">
        <span style={{ fontSize: 12 }}>边框
          <Radio.Group size="small" optionType="button" style={{ marginLeft: 4 }}
            value={value.seamless === false ? 'independent' : 'seamless'}
            onChange={(e) => onChange({ seamless: e.target.value === 'seamless' })}
            options={[{ value: 'seamless', label: '粘连' }, { value: 'independent', label: '独立框' }]} /></span>
      </Tooltip>
      <span style={{ fontSize: 12 }}>尺寸
        <InputNumber size="small" min={1} max={20} step={0.5} style={{ width: 60, marginLeft: 4 }} value={value.width_cm ?? 7}
          onChange={(v) => onChange({ width_cm: v ?? undefined })} />×
        <InputNumber size="small" min={1} max={25} step={0.5} style={{ width: 60 }} value={value.height_cm ?? 6}
          onChange={(v) => onChange({ height_cm: v ?? undefined })} />cm</span>
      <Tooltip title="每张图片在表格里的左右/上下边距（单元格内边距，pt）；留空＝默认 6">
        <span style={{ fontSize: 12 }}>图片边距
          <InputNumber size="small" min={0} max={40} style={{ width: 62, marginLeft: 4 }} value={value.inset_x}
            placeholder="左右" onChange={(v) => onChange({ inset_x: v ?? undefined })} />
          <InputNumber size="small" min={0} max={40} style={{ width: 62 }} value={value.inset_y}
            placeholder="上下" addonAfter="pt" onChange={(v) => onChange({ inset_y: v ?? undefined })} /></span>
      </Tooltip>
      <Tooltip title="每行排满后剩 1 张时，该张独占整行——第一张独占（在最上）/ 最后一张独占（在最下）">
        <span style={{ fontSize: 12 }}>单数独占
          <Radio.Group size="small" optionType="button" style={{ marginLeft: 4 }} value={value.solo === 'last' ? 'last' : 'first'}
            onChange={(e) => onChange({ solo: e.target.value })}
            options={[{ value: 'last', label: '最后一张' }, { value: 'first', label: '第一张' }]} /></span>
      </Tooltip>
      {showHeaderFollow && titleMode === 'shared' && (
        <Tooltip title="开启后：照片表跨页时，共用表头会在新页顶部自动重复（仅共用标题+粘连有效）。每张一个标题模式下标题始终与图同页，无需此开关。">
          <Checkbox checked={value.header_follow !== false} onChange={(e) => onChange({ header_follow: e.target.checked })}>
            <span style={{ fontSize: 12 }}>跨页表头跟随</span>
          </Checkbox>
        </Tooltip>
      )}
    </div>
  );
}
