import { Button, InputNumber, Select, Space, Tooltip } from 'antd';
import type { RecordTemplate, StyleOverride } from '../../../../shared/types';
import { coverLegacyFormatState } from '../../../../shared/cover-legacy-format';
import { reportLengthPt } from '../../../../shared/report-body-layout';
import { canQuickLayout, contiguousCoverSelection } from '../../../../shared/cover-batch-layout';
import { REPORT_TEXT_FONTS } from '../../../../shared/report-rich-document';

export default function CoverBatchToolbar({ template, ids, readOnly, onChange, onConfigure }: {
  template: RecordTemplate; ids: string[]; readOnly: boolean;
  onChange: (patch: Partial<StyleOverride>, gap?: string) => void; onConfigure: () => void;
}) {
  const targets = template.groups.flatMap(group => group.fields.filter(field => ids.includes(field.id)).map(field => ({ field, group })));
  const supported = targets.length > 0 && targets.length === ids.length && targets.every(({ field, group }) => canQuickLayout(field, group));
  const disabled = readOnly || !supported;
  const formats = targets.flatMap(({ field, group }) => (['label', 'value'] as const).map(part => coverLegacyFormatState(field, group, template.layout_options?.theme_config, part)));
  const common = <T,>(values: T[]): T | undefined => values.length && values.every(value => value === values[0]) ? values[0] : undefined;
  const font = common(formats.map(f => f.font)), size = common(formats.map(f => f.size)), bold = common(formats.map(f => f.bold));
  const spacing = (key: 'space_before' | 'space_after' | 'field_gap') => common(targets.map(({ field, group }) => {
    const size = coverLegacyFormatState(field, group, template.layout_options?.theme_config, 'paragraph').size;
    return key !== 'field_gap' ? reportLengthPt(field.style?.[key], 'pt', size) ?? 0
      : reportLengthPt(field.field_gap, 'pt', size) ?? reportLengthPt(group.style?.block_spacing, 'pt', size) ?? reportLengthPt(template.layout_options?.theme_config?.line_gap, 'em', size) ?? .6 * size;
  }));
  return <div role="toolbar" aria-label="首页批量排版" style={{ position: 'sticky', top: 0, zIndex: 5, background: '#eef4fc', border: '1px solid #cedcf0', borderRadius: 8, padding: 10, marginBottom: 12 }}><Space size={8} wrap>
    <Tooltip title="单击选中；Ctrl/Cmd 点选多个；Shift 连选；双击配置"><span>{ids.length ? `已选 ${ids.length} 个字段` : '请选择字段'}</span></Tooltip>
    <Select aria-label="批量字体" disabled={disabled} value={supported ? font : undefined} placeholder={supported && !font ? '混合字体' : '字体'} style={{ width: 150 }} options={REPORT_TEXT_FONTS.map(value => ({ value, label: value }))} onChange={font => onChange({ font })} />
    <InputNumber aria-label="批量字号" disabled={disabled} min={6} max={72} suffix="pt" style={{ width: 88 }} value={supported ? size : null} placeholder={supported && size == null ? '混合' : ''} onChange={value => value != null && onChange({ size: `${value}pt` })} />
    <Button aria-label="批量加粗" disabled={disabled} type={bold ? 'primary' : 'default'} onClick={() => onChange({ weight: bold ? 'regular' : 'bold' })}><b>B</b></Button>
    <Space.Compact>{(['left', 'center', 'right'] as const).map((align, i) => <Button key={align} disabled={disabled} type={supported && common(formats.map(f => f.align)) === align ? 'primary' : 'default'} onClick={() => onChange({ align })}>{['左对齐', '居中', '右对齐'][i]}</Button>)}</Space.Compact>
    {(['space_before', 'space_after', 'field_gap'] as const).map((key, index) => <Space key={key} size={4}>
      <Tooltip title={index === 2 ? '同一分区连续字段的基础间距，选区边缘也会变化；保留已有空行和段前后设置' : '额外留白，不删除已有空行'}><span>{['段前', '段后', '字段间距'][index]}</span></Tooltip>
      <InputNumber aria-label={['字段段前间距', '字段段后间距', '连续字段间距'][index]} disabled={disabled || (index === 2 && !contiguousCoverSelection(template, ids))} min={0} step={2} precision={1} suffix="pt" style={{ width: 92 }} value={supported ? spacing(key) : null} placeholder={supported && spacing(key) == null ? '混合' : ''}
        onChange={value => { if (value != null && Number.isFinite(value) && value >= 0) index === 2 ? onChange({}, `${value}pt`) : onChange({ [key]: `${value}pt` }); }} />
    </Space>)}
    <Button disabled={ids.length !== 1} onClick={onConfigure}>字段设置</Button>
  </Space></div>;
}
