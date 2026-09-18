import type { NumericRoundingRule } from './types';

export function validateRoundingIntervals(intervals: NumericRoundingRule['intervals']): string | undefined {
  if (!intervals?.length || intervals.length > 20) return '请设置 1 至 20 段规则';
  let previous = -Infinity;
  for (let i = 0; i < intervals.length; i++) {
    const part = intervals[i];
    if (!Number.isFinite(part.step) || part.step <= 0) return '修约间隔必须大于 0';
    if (!['half_even', 'ceil'].includes(part.mode)) return '请选择有效修约规则';
    if (i === intervals.length - 1) { if (part.upper != null) return '最后一段应不设上限'; }
    else if (!Number.isFinite(part.upper) || part.upper! <= previous) return '各段上限必须依次增大';
    previous = part.upper ?? Infinity;
  }
}

/** 数值修约：修约改变实际数值；数字格式只改变最终显示。 */
export function applyNumericRounding(value: unknown, rule: NumericRoundingRule | undefined): unknown {
  if (!rule) return value;
  if (rule.mode === 'none') return value;
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !value.trim())) return value;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return value;
  let mode = rule.mode;
  let intervalStep: number | undefined;
  if (mode === 'piecewise') {
    if (validateRoundingIntervals(rule.intervals)) return value;
    const interval = rule.intervals!.find(part => part.upper == null || (part.inclusive ? n <= part.upper : n < part.upper))!;
    mode = interval.mode;
    intervalStep = interval.step;
  }

  // Use decimal quotient/remainder, not binary multiplication or an epsilon window.
  const text = String(value).trim();
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!match || !(match[2] || match[3]) || text.length > 2000) return value;
  const negative = match[1] === '-';
  const coefficient = BigInt((match[2] || '0') + (match[3] || ''));
  const exponent = Number(match[4] || 0) - (match[3]?.length || 0);
  const multiple = mode === 'multiple_2' ? 2 : mode === 'multiple_5' ? 5 : 1;
  const digits = Math.max(-308, Math.min(324, Math.round(Number.isFinite(rule.digits) ? rule.digits! : multiple !== 1 ? 0 : 2)));
  const stepMatch = intervalStep == null ? null : /^(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(String(intervalStep));
  const stepCoefficient = stepMatch ? BigInt(stepMatch[1] + (stepMatch[2] || '')) : BigInt(multiple);
  const stepExponent = stepMatch ? Number(stepMatch[3] || 0) - (stepMatch[2]?.length || 0) : -digits;
  const shift = exponent - stepExponent;
  if (Math.abs(shift) > 2000) return value;
  const numerator = shift >= 0 ? coefficient * 10n ** BigInt(shift) : coefficient;
  const denominator = stepCoefficient * (shift < 0 ? 10n ** BigInt(-shift) : 1n);
  let quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (mode === 'ceil') { if (!negative && remainder) quotient++; }
  else if (mode === 'floor') { if (negative && remainder) quotient++; }
  else if (mode !== 'truncate') {
    const twice = remainder * 2n;
    const halfEven = mode === 'half_even' || multiple !== 1;
    if (twice > denominator || (twice === denominator && (!halfEven || quotient % 2n !== 0n))) quotient++;
  }
  const result = Number(`${negative ? '-' : ''}${quotient * stepCoefficient}e${stepExponent}`);
  if (!Number.isFinite(result)) return value;
  return Object.is(result, -0) ? 0 : result;
}

export function numericRoundingLabel(rule: NumericRoundingRule | undefined): string {
  if (!rule || rule.mode === 'none') return '不修约';
  if (rule.mode === 'piecewise') return '按数值区间修约';
  if (rule.mode === 'multiple_2') return '间隔 2 修约（五成双，位数随格式）';
  if (rule.mode === 'multiple_5') return '间隔 5 修约（五成双，位数随格式）';
  const suffix = '（位数随数字格式）';
  if (rule.mode === 'half_up') return `四舍五入${suffix}`;
  if (rule.mode === 'half_even') return `四舍六入五单双（五成双）${suffix}`;
  if (rule.mode === 'truncate') return `直接截尾${suffix}`;
  if (rule.mode === 'ceil') return `向上修约${suffix}`;
  return `向下修约${suffix}`;
}
