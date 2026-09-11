import { Button, Checkbox, ColorPicker, InputNumber, Select, Tooltip } from 'antd';
import { BoldOutlined, ItalicOutlined, FontColorsOutlined } from '@ant-design/icons';
import type { ImageLayoutValue } from '../FieldEditor/ImageLayoutControls';
import type { StyleOverride } from '../../../../shared/types';
import { REPORT_FONTS } from '../FieldEditor/FormatPanel';

/** Report-only controls. Opening the toolbar never normalizes or rewrites saved layout. */
export default function ReportImageLayoutToolbar({ value, onChange, onTitleModeChange,
  defaultCols = 2, defaultInset = 6, titleStyle, onTitleStyleChange, inheritedFont, inheritedSize = 10,
}: {
  value: ImageLayoutValue;
  onChange: (patch: Partial<ImageLayoutValue>) => void;
  onTitleModeChange: (mode: 'shared' | 'per') => void;
  defaultCols?: number; defaultInset?: number;
  titleStyle?: StyleOverride; onTitleStyleChange?: (patch: Partial<StyleOverride>) => void;
  inheritedFont?: string; inheritedSize?: number;
}) {
  const cols = value.cols ?? defaultCols;
  const style = titleStyle || {};
  const number = (label: string, key: keyof ImageLayoutValue, current: number, max: number, unit = 'pt', min = 0) => (
    <label className="report-image-number" key={key}>
      {label}<InputNumber aria-label={`图片${label}`} size="small" value={current} min={min} max={max}
        step={unit === 'cm' ? 0.5 : 1} style={{ width: 64 }}
        onChange={next => { if (next != null && Number.isFinite(next) && next >= min && next <= max) onChange({ [key]: next }); }} />{unit}
    </label>
  );
  return <>
    {onTitleStyleChange && <>
      <Tooltip title="图片标题加粗"><Button size="small" aria-label="图片标题加粗" icon={<BoldOutlined />}
        type={(style.weight ?? 'bold') === 'bold' ? 'primary' : 'default'}
        onClick={() => onTitleStyleChange({ weight: (style.weight ?? 'bold') === 'bold' ? 'regular' : 'bold' })} /></Tooltip>
      <Tooltip title="图片标题斜体"><Button size="small" aria-label="图片标题斜体" icon={<ItalicOutlined />}
        type={style.italic ? 'primary' : 'default'} onClick={() => onTitleStyleChange({ italic: !style.italic })} /></Tooltip>
      <InputNumber size="small" aria-label="图片标题字号" style={{ width: 62 }} min={5} max={72}
        value={style.size ? parseFloat(style.size) : inheritedSize}
        onChange={size => { if (size != null && size >= 5 && size <= 72) onTitleStyleChange({ size: `${size}pt` }); }} />
      <ColorPicker size="small" value={style.color || '#000000'} onChange={color => onTitleStyleChange({ color: color.toHexString() })}>
        <Button size="small" icon={<FontColorsOutlined />}>颜色</Button>
      </ColorPicker>
      <Select size="small" aria-label="图片标题字体" style={{ width: 112 }} value={style.font || inheritedFont || undefined}
        options={REPORT_FONTS.filter(font => font.value)} onChange={font => onTitleStyleChange({ font })} />
    </>}
    {number('宽', 'width_cm', value.width_cm ?? 7, 20, 'cm', 1)}
    {number('高', 'height_cm', value.height_cm ?? 6, 25, 'cm', 1)}
    <Select size="small" aria-label="图片每行张数" value={cols} style={{ width: 100 }}
      options={Array.from({ length: Math.max(6, cols) }, (_, i) => ({ value: i + 1, label: `每行 ${i + 1} 张` }))}
      onChange={next => onChange({ cols: next })} />
    <Select size="small" aria-label="图片标题模式" value={value.title_mode || 'per'} style={{ width: 112 }}
      options={[{ value: 'shared', label: '共用标题' }, { value: 'per', label: '每张标题' }]} onChange={onTitleModeChange} />
    <Select size="small" aria-label="图片边框" value={value.seamless === false ? 'separate' : 'joined'} style={{ width: 100 }}
      options={[{ value: 'joined', label: '连续边框' }, { value: 'separate', label: '独立边框' }]} onChange={mode => onChange({ seamless: mode === 'joined' })} />
    {number('左右留白', 'inset_x', value.inset_x ?? defaultInset, 40)}
    {number('上下留白', 'inset_y', value.inset_y ?? defaultInset, 40)}
    {number('标题留白', 'title_inset_y', value.title_inset_y ?? 10, 40)}
    {cols > 1 && <Select size="small" aria-label="图片余图位置" style={{ width: 112 }} value={value.solo || 'first'}
      options={[{ value: 'first', label: '余图在首行' }, { value: 'last', label: '余图在末行' }]} onChange={solo => onChange({ solo })} />}
    {value.title_mode === 'shared' && value.seamless !== false && <Checkbox checked={value.header_follow !== false}
      onChange={event => onChange({ header_follow: event.target.checked })}>跨页重复标题</Checkbox>}
  </>;
}
