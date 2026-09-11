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
  value, onChange, onTitleModeChange, showTitleMode = true, showHeaderFollow = true, defaultInset = 6,
}: {
  value: ImageLayoutValue;
  /** 版式项变更（cols/width/height/solo/seamless/header_follow） */
  onChange: (patch: Partial<ImageLayoutValue>) => void;
  /** 标题模式切换单独走（生成报告侧用 switchMode 以保留照片；模板侧直接 setCfg({title_mode})） */
  onTitleModeChange: (mode: 'shared' | 'per') => void;
  showTitleMode?: boolean;
  showHeaderFollow?: boolean;
  /** 兼容旧字段 image_table_style.inset_pt 的实际生效值。 */
  defaultInset?: number;
}) {
  const titleMode = value.title_mode || 'per';
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
      gap: '10px 16px',
      marginBottom: 10,
      alignItems: 'center',
    }}>
      {showTitleMode && (
        <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>标题
          <Radio.Group size="small" optionType="button" style={{ marginLeft: 4 }} value={titleMode}
            onChange={(e) => onTitleModeChange(e.target.value)}
            options={[{ value: 'shared', label: '共用标题' }, { value: 'per', label: '每张一个标题' }]} /></span>
      )}
      <Tooltip title="表内标题单元格的上下内边距；当前渲染缺省值为 10pt。">
        <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>标题上下留白
          <InputNumber size="small" min={0} max={40} style={{ width: 92, marginLeft: 4 }} value={value.title_inset_y ?? 10}
            addonAfter="pt" onChange={(v) => onChange({ title_inset_y: v ?? 10 })} /></span>
      </Tooltip>
      <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>每行
        <InputNumber size="small" min={1} max={6} style={{ width: 56, marginLeft: 4 }} value={value.cols ?? 2}
          onChange={(v) => onChange({ cols: v && v > 0 ? v : undefined })} />张</span>
      <Tooltip title="粘连＝整组连成一张连续表格（边框共享、图之间无空隙）；独立框＝每行/每张各自独立边框、块间留白。缺省粘连。">
        <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>边框
          <Radio.Group size="small" optionType="button" style={{ marginLeft: 4 }}
            value={value.seamless === false ? 'independent' : 'seamless'}
            onChange={(e) => onChange({ seamless: e.target.value === 'seamless' })}
            options={[{ value: 'seamless', label: '粘连' }, { value: 'independent', label: '独立框' }]} /></span>
      </Tooltip>
      <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>图片显示尺寸
        <InputNumber size="small" min={1} max={20} step={0.5} style={{ width: 60, marginLeft: 4 }} value={value.width_cm ?? 7}
          onChange={(v) => onChange({ width_cm: v ?? undefined })} />×
        <InputNumber size="small" min={1} max={25} step={0.5} style={{ width: 60 }} value={value.height_cm ?? 6}
          onChange={(v) => onChange({ height_cm: v ?? undefined })} />cm</span>
      <Tooltip title="图片单元格内部留白。左右和上下分开设置；当前渲染缺省值均为 6pt。">
        <div style={{
          gridColumn: '1 / -1',
          fontSize: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          maxWidth: '100%',
        }}>
          <span style={{ fontWeight: 600, color: '#555', whiteSpace: 'nowrap' }}>图片内边距</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
            <span style={{ color: '#777' }}>左右</span>
            <InputNumber size="small" min={0} max={40} style={{ width: 82 }} value={value.inset_x ?? defaultInset}
              addonAfter="pt" onChange={(v) => onChange({ inset_x: v ?? defaultInset })} />
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
            <span style={{ color: '#777' }}>上下</span>
            <InputNumber size="small" min={0} max={40} style={{ width: 82 }} value={value.inset_y ?? defaultInset}
              addonAfter="pt" onChange={(v) => onChange({ inset_y: v ?? defaultInset })} />
          </span>
        </div>
      </Tooltip>
      <Tooltip title="每行排满后剩 1 张时，该张独占整行——第一张独占（在最上）/ 最后一张独占（在最下）">
        <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>单数独占
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
