/**
 * FormatPanel — Word 式"格式"面板（P1 样式层叠 + P14 字段名/值/版式切片）
 *
 * 编辑一个 StyleOverride（字体/字号/加粗/斜体/对齐/行距/颜色），供：
 *  - 区块级（FieldEditor 分区头）→ 写 group.style（variant='full' + block）
 *  - 字段名 / 字段值（FieldPropsPanel）→ 写 field.label_style / field.value_style（variant='text'）
 *  - 字段版式（FieldPropsPanel）→ 写 field.style 的对齐/段前后（variant='layout'）
 *  - 标题/副标题（TitleStylePanel）→ variant='full'
 * 缺省（未设）＝继承上层（文档默认 → 区块 → 字段 层叠）。
 *
 * variant：
 *  - 'text'   只给文字属性（字体/字号/加粗/斜体/颜色）——字段名、字段值各一份
 *  - 'layout' 只给版式属性（对齐 + 段前/段后）——字段整体在版面上的位置
 *  - 'full'   全部（含行距/字距 + 上述）——区块头、标题用
 * 行距/字段间距属于"全篇统一"的范畴，字段级（text/layout）刻意不放，引导去分区/文档级配。
 */
import { Space, Select, InputNumber, Switch, Radio, Button, Tooltip } from 'antd';
import type { StyleOverride } from '../../../../shared/types';

interface Props {
  value?: StyleOverride;
  onChange: (style: StyleOverride | undefined) => void;
  /** 区块/部件级面板：额外显示「字段间距 + 垂直对齐」（整页分布，仅顶级分区有效）。 */
  block?: boolean;
  /** 控件切片，见文件头。默认 'full'（不破坏既有调用）。
   *  'block-extra'：只给【工具栏没有的】块级属性——字体/行间距/字距/段前后（不含字号/加粗/斜体/颜色/对齐，
   *  这些在报告编辑器浮动工具栏里，避免重复）。 */
  variant?: 'text' | 'layout' | 'full' | 'block-extra';
  /** 区块级用：当前继承的文档级「字段间距」(theme_config.line_gap)，用于把分组「字段间距」的
   *  placeholder 显示成「继承 0.6em」而非泛泛的「默认」，让用户看得见在覆盖什么。 */
  inheritedFieldGap?: string;
  /** 隐藏分区级「字段间距」(block_spacing) 行：报告编辑器改为【文档样式默认 + 每字段单独设】，分区不再有字段间距（保留定位/距底）。 */
  hideFieldGap?: boolean;
  /** 当前【继承生效】的字体（typst family，如 'Songti SC'）。未设本级字体时，下拉【直接显示这个实际字体】
   *  （所见即所得），而非"跟随默认/继承"。未传＝回退显示「默认字体」。 */
  inheritedFont?: string;
  /** 当前【继承生效】的字号（pt 数值，如 10）。未设本级字号时，字号框【直接显示这个实际字号】。未传＝显示占位。 */
  inheritedSize?: number;
  /** 当前【继承生效】的粗细（true=加粗）。未设本级 weight 时，加粗控件【直接显示 加粗/正常】而非"跟随"。缺省 false=正常。 */
  inheritedBold?: boolean;
  /** 对齐控件去掉「默认（继承）」项：未设时直接显示实际生效值「左」（渲染默认靠左），只留 左/中/右。报告字段格式用。 */
  alignNoInherit?: boolean;
}

// 仅列出 demo_v1/fonts/ 里已打包的字体（系统只用这个目录渲染，跨服务器一致）。
// 加字体：把 .ttf 放进 fonts/ 并在此加一行（value=typst family 名）。详见 fonts/README.md。
export const REPORT_FONTS = [
  { value: '', label: '默认字体' },
  { value: 'Songti SC', label: '宋体' },
  { value: 'SimHei', label: '黑体' },
  { value: 'KaiTi', label: '楷体' },
  { value: 'FangSong', label: '仿宋' },
  { value: 'FangSong_GB2312', label: '仿宋_GB2312' },
  { value: 'STSong', label: '华文宋体' },
  { value: 'Arial', label: 'Arial' },
  { value: 'Times New Roman', label: 'Times New Roman' },
];

export default function FormatPanel({ value, onChange, block, variant = 'full', inheritedFieldGap, hideFieldGap, inheritedFont, inheritedSize, inheritedBold, alignNoInherit }: Props) {
  const s = value || {};
  // 字体/字号未设本级时，直接显示【继承生效的实际值】（所见即所得），而非"跟随默认/继承"占位。
  const fontOptions = REPORT_FONTS.map(f => f.value === '' ? { value: '', label: '默认字体' } : f);
  const shownFont = s.font ?? inheritedFont ?? '';
  // 「恢复继承」：只清本级某一个属性，回到上层默认（区别于底部「清除本级样式」的全清）。
  const resetBtn = (key: keyof StyleOverride) => (
    <Tooltip title="恢复继承（清除本级此项，回到上层默认）">
      <Button size="small" type="text" style={{ padding: '0 4px', height: 20, color: '#999' }}
        onClick={() => set({ [key]: undefined } as Partial<StyleOverride>)}>↩</Button>
    </Tooltip>
  );
  const showFont = variant === 'text' || variant === 'full' || variant === 'block-extra';   // 字体
  const showText = variant === 'text' || variant === 'full';   // 字号/加粗/斜体/颜色（block-extra 不给：工具栏已有）
  const showLineTrack = variant === 'full' || variant === 'block-extra';   // 行距 + 字距
  const showAlign = variant === 'layout' || variant === 'full';            // 对齐（block-extra 不给：工具栏已有）
  const showSpacing = variant === 'layout' || variant === 'full' || variant === 'block-extra';
  // 合并补丁；删 key 用 undefined。全空则把整个 style 置 undefined（回到纯继承）。
  const set = (patch: Partial<StyleOverride>) => {
    const next: StyleOverride = { ...s, ...patch };
    (Object.keys(next) as (keyof StyleOverride)[]).forEach(k => {
      if (next[k] === undefined || next[k] === '' || next[k] === null) delete next[k];
    });
    onChange(Object.keys(next).length ? next : undefined);
  };
  const numFromLen = (v?: string) => (v ? parseFloat(v) : undefined);

  return (
    <Space direction="vertical" size={8} style={{ width: 260 }}>
      {showFont && (
        <Space size={6} wrap>
          <span style={{ fontSize: 12, color: '#888', width: 32 }}>字体</span>
          <Select size="small" style={{ width: 180 }} value={shownFont}
            onChange={(v) => set({ font: v || undefined })} options={fontOptions} />
        </Space>
      )}
      {showText && (
        <Space size={6} wrap>
          <span style={{ fontSize: 12, color: '#888', width: 32 }}>字号</span>
          <InputNumber size="small" style={{ width: 90 }} min={6} max={48} step={0.5}
            value={numFromLen(s.size) ?? inheritedSize} addonAfter="pt" placeholder="默认"
            onChange={(v) => set({ size: v ? `${v}pt` : undefined })} />
        </Space>
      )}
      {showLineTrack && (
        <Space size={6} wrap>
          <Tooltip title="行间距：多行文字内部的行高（与「字段间距」不同——后者是字段/表格之间的留白）。留空＝继承上层。">
            <span style={{ fontSize: 12, color: '#888', width: 32 }}>行间距</span>
          </Tooltip>
          <InputNumber size="small" style={{ width: 84 }} min={0.4} max={3} step={0.05}
            value={numFromLen(s.line_height)} addonAfter="em" placeholder="默认"
            onChange={(v) => set({ line_height: v ? `${v}em` : undefined })} />
          {s.line_height != null && resetBtn('line_height')}
        </Space>
      )}
      {showLineTrack && (
        <Space size={6} wrap>
          <Tooltip title="字与字之间的间距（如封面“检 验 报 告”那种拉开）">
            <span style={{ fontSize: 12, color: '#888', width: 32 }}>字距</span>
          </Tooltip>
          <InputNumber size="small" style={{ width: 96 }} min={0} max={2} step={0.05}
            value={numFromLen(s.tracking)} addonAfter="em" placeholder="0"
            onChange={(v) => set({ tracking: v ? `${v}em` : undefined })} />
        </Space>
      )}
      {showText && (
        <Space size={6} wrap>
          <Tooltip title="该文字是否加粗——直接显示当前生效状态；点选即覆盖本级设置。">
            <span style={{ fontSize: 12, color: '#888', width: 32 }}>加粗</span>
          </Tooltip>
          <Radio.Group size="small" optionType="button"
            value={s.weight ?? (inheritedBold ? 'bold' : 'regular')}
            onChange={(e) => set({ weight: e.target.value })}
            options={[
              { value: 'bold', label: '加粗' },
              { value: 'regular', label: '正常' },
            ]} />
        </Space>
      )}
      {showText && (
        <Space size={12} wrap>
          <span style={{ fontSize: 12, color: '#888' }}>斜体
            <Switch size="small" style={{ marginLeft: 4 }} checked={!!s.italic}
              onChange={(v) => set({ italic: v || undefined })} /></span>
          <Tooltip title="文字颜色">
            <input type="color" value={s.color || '#000000'} style={{ width: 28, height: 24, padding: 0, border: '1px solid #d9d9d9', borderRadius: 4, verticalAlign: 'middle' }}
              onChange={(e) => set({ color: e.target.value })} />
          </Tooltip>
        </Space>
      )}
      {showAlign && (
        <Space size={6} wrap>
          <span style={{ fontSize: 12, color: '#888', width: 32 }}>对齐</span>
          <Radio.Group size="small" optionType="button" buttonStyle="solid"
            value={alignNoInherit ? (s.align ?? 'left') : (s.align ?? 'inherit')}
            onChange={(e) => set({ align: e.target.value === 'inherit' ? undefined : e.target.value })}
            options={alignNoInherit
              ? [{ value: 'left', label: '左' }, { value: 'center', label: '中' }, { value: 'right', label: '右' }]
              : [{ value: 'inherit', label: '默认' }, { value: 'left', label: '左' },
                 { value: 'center', label: '中' }, { value: 'right', label: '右' }]} />
        </Space>
      )}
      {showSpacing && (
        <Space size={6} align="center">
          <Tooltip title="本字段与上一段之间的留白（pt），点 −/+ 步进">
            <span style={{ fontSize: 12, color: '#888', width: 32, display: 'inline-block' }}>段前</span>
          </Tooltip>
          <Space.Compact size="small">
            <Button onClick={() => { const n = Math.max(0, (numFromLen(s.space_before) || 0) - 2); set({ space_before: n ? `${n}pt` : undefined }); }}>−</Button>
            <InputNumber size="small" style={{ width: 56 }} min={0} max={200} step={2} controls={false}
              value={numFromLen(s.space_before)} placeholder="0" addonAfter="pt"
              onChange={(v) => set({ space_before: v ? `${v}pt` : undefined })} />
            <Button onClick={() => set({ space_before: `${(numFromLen(s.space_before) || 0) + 2}pt` })}>+</Button>
          </Space.Compact>
        </Space>
      )}
      {showSpacing && (
        <Space size={6} align="center">
          <Tooltip title="本字段与下一段之间的留白（pt），点 −/+ 步进">
            <span style={{ fontSize: 12, color: '#888', width: 32, display: 'inline-block' }}>段后</span>
          </Tooltip>
          <Space.Compact size="small">
            <Button onClick={() => { const n = Math.max(0, (numFromLen(s.space_after) || 0) - 2); set({ space_after: n ? `${n}pt` : undefined }); }}>−</Button>
            <InputNumber size="small" style={{ width: 56 }} min={0} max={200} step={2} controls={false}
              value={numFromLen(s.space_after)} placeholder="0" addonAfter="pt"
              onChange={(v) => set({ space_after: v ? `${v}pt` : undefined })} />
            <Button onClick={() => set({ space_after: `${(numFromLen(s.space_after) || 0) + 2}pt` })}>+</Button>
          </Space.Compact>
        </Space>
      )}
      {block && (
        <div style={{ borderTop: '1px dashed #eee', paddingTop: 6, marginTop: 2 }}>
          {!hideFieldGap && (
            <Space size={6} wrap style={{ marginBottom: 6 }}>
              <Tooltip title="本分区内字段之间、表格之间的统一间距（覆盖文档样式的「字段间距」，仅影响本分区）。留空＝继承文档默认。">
                <span style={{ fontSize: 12, color: '#888', width: 56 }}>字段间距</span>
              </Tooltip>
              <InputNumber size="small" style={{ width: 96 }} min={0} max={120} step={2}
                value={numFromLen(s.block_spacing)} addonAfter="pt"
                placeholder={inheritedFieldGap ? `默认 ${inheritedFieldGap}` : '默认'}
                onChange={(v) => set({ block_spacing: v != null ? `${v}pt` : undefined })} />
              {s.block_spacing != null && resetBtn('block_spacing')}
            </Space>
          )}
          <Space size={6} wrap>
            <Tooltip title="本区块在整页里的竖向锚定：随正文=跟随上文流动；居中=整页正中；钉底=推到页面最底部（自动落在所在页底）。">
              <span style={{ fontSize: 12, color: '#888', width: 32 }}>定位</span>
            </Tooltip>
            <Radio.Group size="small" optionType="button" buttonStyle="solid"
              value={s.vertical_align ?? 'flow'}
              onChange={(e) => set({ vertical_align: e.target.value === 'flow' ? undefined : e.target.value })}
              options={[
                { value: 'flow', label: '随正文' }, { value: 'center', label: '居中' },
                { value: 'bottom', label: '钉底' },
              ]} />
          </Space>
          {s.vertical_align === 'bottom' && (
            <Space size={6} wrap style={{ marginTop: 6 }}>
              <Tooltip title="钉底后再往上抬一点，给最底部的印章/二维码留位">
                <span style={{ fontSize: 12, color: '#888', width: 32 }}>距底</span>
              </Tooltip>
              <InputNumber size="small" style={{ width: 96 }} min={0} max={15} step={0.2}
                value={numFromLen(s.vertical_offset)} addonAfter="cm" placeholder="0"
                onChange={(v) => set({ vertical_offset: v ? `${v}cm` : undefined })} />
            </Space>
          )}
          {(s.vertical_align === 'bottom' || s.vertical_align === 'center') && (
            <Space size={6} style={{ marginTop: 6 }}>
              <span style={{ fontSize: 12, color: '#888' }}>整块不拆页
                <Switch size="small" style={{ marginLeft: 4 }} checked={!!s.keep_together}
                  onChange={(v) => set({ keep_together: v || undefined })} /></span>
            </Space>
          )}
        </div>
      )}
      {value && Object.keys(value).length > 0 && (
        <Button size="small" type="text" danger onClick={() => onChange(undefined)}>清除本级样式</Button>
      )}
    </Space>
  );
}
