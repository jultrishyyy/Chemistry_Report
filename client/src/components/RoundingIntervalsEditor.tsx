import { useState } from 'react';
import { Button, InputNumber, Popover, Select, Space, message } from 'antd';
import type { NumericRoundingRule } from '../../../shared/types';
import { ROUNDING_PRESETS } from '../../../shared/rounding-presets';
import { validateRoundingIntervals } from '../../../shared/numeric-rounding';

export default function RoundingIntervalsEditor({ value, onChange, disabled = false }: {
  value: NumericRoundingRule; onChange: (value: NumericRoundingRule) => void; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [parts, setParts] = useState<NonNullable<NumericRoundingRule['intervals']>>([]);
  const change = (index: number, patch: Partial<typeof parts[number]>) => setParts(parts.map((part, i) => i === index ? { ...part, ...patch } : part));
  return <Popover zIndex={1300} open={open} trigger="click" onOpenChange={next => {
    if (disabled) return;
    if (next) setParts((value.intervals || [{ step: 1, mode: 'half_even' }]).map(part => ({ ...part })));
    setOpen(next);
  }} title="按原始数值选择修约间隔" content={<div style={{ width: 'min(520px, 80vw)', maxHeight: '60vh', overflow: 'auto' }}>
    <Select<number> aria-label="修约规则预设" placeholder="选用客户示例，或手工设置" style={{ width: '100%', marginBottom: 10 }} value={undefined}
      options={ROUNDING_PRESETS.map((preset, i) => ({ value: i, label: preset.label }))}
      onChange={index => setParts(ROUNDING_PRESETS[index].intervals.map(part => ({ ...part })))} />
    {parts.map((part, index) => <div key={index} style={{ padding: '8px 0', borderBottom: '1px solid #eee' }}>
      <div style={{ color: '#595959', marginBottom: 4 }}>{index === 0 ? '第一段' : `未满足前面区间时，第 ${index + 1} 段`}</div>
      <Space wrap>
        {index < parts.length - 1 ? <><Select aria-label={`第${index + 1}段上限包含方式`} style={{ width: 100 }} value={!!part.inclusive}
          options={[{ value: false, label: '数值 <' }, { value: true, label: '数值 ≤' }]} onChange={inclusive => change(index, { inclusive })} />
          <InputNumber aria-label={`第${index + 1}段上限`} value={part.upper} onChange={upper => change(index, { upper: upper ?? undefined })} /></> : <span>其余数值</span>}
        <span>修约至</span><InputNumber aria-label={`第${index + 1}段间隔`} style={{ width: 90 }} min={0.000000001} value={part.step} onChange={step => change(index, { step: step ?? 0 })} />
        <Select aria-label={`第${index + 1}段规则`} style={{ width: 120 }} value={part.mode} onChange={mode => change(index, { mode })}
          options={[{ value: 'half_even', label: '五成双' }, { value: 'ceil', label: '向上修约' }]} />
        {index < parts.length - 1 && <Button size="small" danger onClick={() => setParts(parts.filter((_, i) => i !== index))}>删除</Button>}
      </Space>
    </div>)}
    <div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>间隔直接填写数据单位，例如 0.2、0.5、10。按修约前的数值匹配区间；最后一段涵盖其余数值。分段间隔优先于格式位数。</div>
    <Space style={{ marginTop: 10 }}><Button disabled={parts.length >= 20} onClick={() => setParts([...parts.slice(0, -1), { upper: (parts.at(-2)?.upper ?? 0) + 10, step: 1, mode: 'half_even' }, parts.at(-1)!])}>增加区间</Button>
      <Button type="primary" onClick={() => { const error = validateRoundingIntervals(parts); if (error) { message.warning(error); return; } onChange({ mode: 'piecewise', intervals: parts }); setOpen(false); }}>应用规则</Button>
      <Button onClick={() => setOpen(false)}>取消</Button></Space>
  </div>}><Button size="small" disabled={disabled}>{value.intervals?.length ? `分段规则（${value.intervals.length} 段）` : '设置分段规则'}</Button></Popover>;
}
