import type { NumericRoundingRule } from './types';
export const ROUNDING_PRESETS: { label: string; intervals: NonNullable<NumericRoundingRule['intervals']> }[] = [
  { label: '示例1 · 断裂强力（1 / 10 / 100 N）', intervals: [
    { upper: 100, step: 1, mode: 'half_even' }, { upper: 1000, step: 10, mode: 'half_even' }, { step: 100, mode: 'half_even' },
  ] },
  { label: '示例1 · 伸长率（0.2 / 0.5 / 1%）', intervals: [
    { upper: 8, step: 0.2, mode: 'half_even' }, { upper: 75, inclusive: true, step: 0.5, mode: 'half_even' }, { step: 1, mode: 'half_even' },
  ] },
  { label: '示例2 · 断裂强力（0.1 / 1 / 10 N）', intervals: [
    { upper: 10, inclusive: true, step: 0.1, mode: 'half_even' }, { upper: 1000, step: 1, mode: 'half_even' }, { step: 10, mode: 'half_even' },
  ] },
  { label: '示例2 · 伸长率（0.2 / 0.5 / 1%）', intervals: [
    { upper: 8, inclusive: true, step: 0.2, mode: 'half_even' }, { upper: 50, step: 0.5, mode: 'half_even' }, { step: 1, mode: 'half_even' },
  ] },
];
