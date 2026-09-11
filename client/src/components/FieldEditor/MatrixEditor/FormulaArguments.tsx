import { useState } from 'react';
import { Button, InputNumber, Select, Space } from 'antd';

export type LibraryFormula = { category: string; name: string; signature: string; description: string; minSources: number; example: (aliases: string[]) => string };
export function argumentLabels(item: LibraryFormula): string[] {
  if (item.category === '统计' || item.name === '圆周率') return [];
  if (item.name === '平方') return ['计算哪个值'];
  if (item.name === '百分比') return ['分子', '分母'];
  if (item.name === '百分号常量') return ['百分比数值'];
  return (item.signature.match(/\((.*)\)/)?.[1] || '数值').split(',').map(s => s.trim()).map(s => s === '数值' ? '计算哪个值' : s);
}
const defaults: Record<string, number> = { 'n 次方': 3, 'n 次方根': 3, '指定底数对数': 10, '四舍五入': 2, '向外取整': 2, '向内取整': 2, '向上倍数': 1, '向下倍数': 1 };
export default function FormulaArguments({ item, sources, onInsert, onBack }: {
  item: LibraryFormula; sources: { value: string; label: string }[]; onInsert: (expression: string) => void; onBack: () => void;
}) {
  const labels = argumentLabels(item), aggregate = item.category === '统计';
  const [chosen, setChosen] = useState<string[]>(() => sources.map(source => source.value));
  const [args, setArgs] = useState(() => labels.map((_, i) => {
    const constant = item.name === '百分号常量' ? 5 : i === 1 ? defaults[item.name] : undefined;
    return { source: constant != null ? '__constant__' : i === 0 && sources.length === 1 ? sources[0].value : undefined, number: constant as number | null | undefined };
  }));
  const values = aggregate ? chosen : args.map(arg => arg.source === '__constant__' ? arg.number == null || !Number.isFinite(arg.number) ? '' : arg.number < 0 ? `(${arg.number})` : String(arg.number) : arg.source || '');
  const valid = aggregate ? chosen.length >= item.minSources : values.every(Boolean);
  const expression = valid ? item.example(values) : '';
  return <Space direction="vertical" style={{ width: '100%' }}>
    <Button onClick={onBack}>返回公式库</Button>
    <strong>{item.name}</strong><span>{item.description}</span>
    {aggregate ? <>
      <span>参与计算的来源（默认全部，可移除）</span>
      <Select aria-label="函数来源" mode="multiple" style={{ width: '100%' }} value={chosen} options={sources} onChange={setChosen} />
      <span style={{ color: '#888', fontSize: 12 }}>至少选择 {item.minSources} 个来源</span>
    </> : labels.map((label, i) => <Space key={i} wrap>
      <span>{label}</span>
      <Select aria-label={`函数参数${i + 1}`} style={{ width: 230 }} placeholder="请选择来源" value={args[i].source}
        options={[...sources, { value: '__constant__', label: '填写固定数值' }]}
        onChange={source => setArgs(current => current.map((arg, index) => index === i ? { ...arg, source } : arg))} />
      {args[i].source === '__constant__' && <InputNumber aria-label={`固定数值${i + 1}`} value={args[i].number} onChange={number => setArgs(current => current.map((arg, index) => index === i ? { ...arg, number } : arg))} />}
    </Space>)}
    <div style={{ padding: 10, background: '#f6faff', overflowWrap: 'anywhere' }} aria-label="待插入公式">{expression ? `= ${expression}` : '请先选择来源或填写数值'}</div>
    <Button type="primary" disabled={!valid} onClick={() => onInsert(expression)}>插入公式</Button>
  </Space>;
}
