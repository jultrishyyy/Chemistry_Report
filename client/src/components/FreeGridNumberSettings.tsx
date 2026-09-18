import { useState } from 'react';
import { Button, InputNumber, Popover, Select, Space } from 'antd';
import type { FieldDefinition, NumericRoundingRule } from '../../../shared/types';
import RoundingIntervalsEditor from './RoundingIntervalsEditor';
type Table = NonNullable<FieldDefinition['free_table']>;
export default function FreeGridNumberSettings({ table, cellKeys, onChange }: { table: Table; cellKeys: string[]; onChange: (table: Table) => void }) {
  const [scope, setScope] = useState<'selection' | 'table'>('selection');
  const whole = scope === 'table';
  const key = cellKeys[0];
  const fmt = (whole ? table.default_number_fmt : table.cell_number_fmt?.[key] ?? table.default_number_fmt) ?? { mode: 'none', digits: 2 };
  const rounding = (whole ? table.default_rounding : table.cell_rounding?.[key] ?? table.default_rounding) ?? { mode: 'none', digits: 2 };
  const disabled = !whole && !cellKeys.length;
  const formatOverrides = Object.values(table.cell_number_fmt || {}).filter(rule => rule.mode !== 'none').length;
  const roundingOverrides = Object.values(table.cell_rounding || {}).filter(rule => rule.mode !== 'none').length;
  const mixedFormat = !whole && cellKeys.some(k => JSON.stringify(table.cell_number_fmt?.[k] ?? table.default_number_fmt ?? { mode: 'none', digits: 2 }) !== JSON.stringify(fmt));
  const mixedRounding = !whole && cellKeys.some(k => JSON.stringify(table.cell_rounding?.[k] ?? table.default_rounding ?? { mode: 'none', digits: 2 }) !== JSON.stringify(rounding));
  const setFormat = (format: NonNullable<Table['cell_number_fmt']>[string]) => {
    if (whole) onChange({ ...table, default_number_fmt: format.mode === 'none' ? undefined : { ...format, mode: format.mode } });
    else onChange({ ...table, cell_number_fmt: { ...table.cell_number_fmt, ...Object.fromEntries(cellKeys.map(k => [k, format])) } });
  };
  const setRounding = (rule: NumericRoundingRule) => {
    if (whole) onChange({ ...table, default_rounding: rule });
    else onChange({ ...table, cell_rounding: { ...table.cell_rounding, ...Object.fromEntries(cellKeys.map(k => [k, rule])) } });
  };
  return <Popover trigger="click" rootClassName="free-grid-number-settings-popup" onOpenChange={open => { if (open) setScope('selection'); }} title="数字格式与修约" content={<Space direction="vertical" style={{ maxWidth: 'min(360px, 80vw)' }}>
    <Select aria-label="数值规则作用范围" value={scope} style={{ width: 230 }} onChange={setScope} options={[{ value: 'selection', label: `当前选区（${cellKeys.length} 格）` }, { value: 'table', label: '整表默认（单格设置优先）' }]} />
    {whole && (formatOverrides > 0 || roundingOverrides > 0) && <span style={{ color: '#ad6800' }}>本表另有 {formatOverrides} 格单独格式、{roundingOverrides} 格单独修约，关闭整表默认不会清除它们。</span>}
    <span>数字格式（同时决定修约位数）</span>
    <Space wrap><Select aria-label="数字格式" placeholder="多种格式" disabled={disabled} style={{ width: 160 }} value={mixedFormat ? undefined : fmt.mode} onChange={mode => setFormat({ mode, digits: fmt.digits })} options={[
      { value: 'none', label: '不格式化' }, { value: 'decimals', label: '小数位' }, { value: 'scientific', label: '科学计数法' }, { value: 'significant', label: '有效数字' },
    ]} />{!mixedFormat && fmt.mode !== 'none' && <InputNumber aria-label="格式位数" disabled={disabled} min={fmt.mode === 'significant' ? 1 : 0} max={10} value={fmt.digits} onChange={digits => { if (digits != null) setFormat({ ...fmt, digits }); }} />}</Space>
    <span>数值修约（参与后续计算）</span>
    <Space wrap><Select aria-label="修约方式" placeholder="多种修约规则" disabled={disabled} style={{ width: 210 }} value={mixedRounding ? undefined : rounding.mode} onChange={mode => setRounding({ mode })} options={[
      { value: 'none', label: '不修约' }, { value: 'half_up', label: '四舍五入' }, { value: 'half_even', label: '四舍六入五成双' }, { value: 'truncate', label: '直接截尾' },
      { value: 'ceil', label: '向上修约' }, { value: 'floor', label: '向下修约' }, { value: 'multiple_2', label: '间隔 2（五成双）' }, { value: 'multiple_5', label: '间隔 5（五成双）' }, { value: 'piecewise', label: '按数值区间修约' },
    ]} /></Space>
    {rounding.mode === 'piecewise' && <RoundingIntervalsEditor value={rounding} onChange={setRounding} disabled={disabled} />}
    {!whole && <Button size="small" disabled={disabled} onClick={() => {
      const formats = { ...table.cell_number_fmt }, rules = { ...table.cell_rounding };
      cellKeys.forEach(k => { delete formats[k]; delete rules[k]; });
      onChange({ ...table, cell_number_fmt: formats, cell_rounding: rules });
    }}>选区恢复整表默认</Button>}
    {whole && <Button size="small" onClick={() => onChange({ ...table, default_number_fmt: undefined, default_rounding: undefined, cell_number_fmt: {}, cell_rounding: {} })}>清除整表数字格式与修约</Button>}
    <span style={{ fontSize: 12, color: '#888' }}>仅影响本次记录。普通修约位数随数字格式：如小数 1 位时，间隔 2/5 分别为 0.2/0.5；分段规则按所填间隔。原始输入保留，修改规则无需重新导入。</span>
  </Space>}><Button size="small">数字格式与修约</Button></Popover>;
}
