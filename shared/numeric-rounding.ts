import type { NumericRoundingRule } from './types';

const clampDigits = (digits: number | undefined) => Math.max(0, Math.min(10, Math.round(digits ?? 2)));

/** 数值修约：修约改变实际数值；数字格式只改变最终显示。 */
export function applyNumericRounding(value: unknown, rule: NumericRoundingRule | undefined): unknown {
  if (!rule) return value;
  if (rule.mode === 'none') return value;
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !value.trim())) return value;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return value;

  const nearest = (increment: number, tiesToEven: boolean): number => {
    const scaled = Math.abs(n / increment);
    const lower = Math.floor(scaled);
    const fraction = scaled - lower;
    const tolerance = Number.EPSILON * Math.max(1, scaled) * 8;
    const rounded = fraction > 0.5 + tolerance
      ? lower + 1
      : fraction < 0.5 - tolerance
        ? lower
        : tiesToEven ? (lower % 2 === 0 ? lower : lower + 1) : lower + 1;
    const result = Math.sign(n) * rounded * increment;
    return Object.is(result, -0) ? 0 : result;
  };

  if (rule.mode === 'multiple_2') return nearest(2, false);
  if (rule.mode === 'multiple_5') return nearest(5, false);
  const factor = 10 ** clampDigits(rule.digits);
  if (rule.mode === 'half_up') return nearest(1 / factor, false);
  if (rule.mode === 'half_even') return nearest(1 / factor, true);
  const scaled = n * factor;
  const rounded = rule.mode === 'truncate' ? Math.trunc(scaled)
    : rule.mode === 'ceil' ? Math.ceil(scaled)
      : Math.floor(scaled);
  const result = rounded / factor;
  return Object.is(result, -0) ? 0 : result;
}

export function numericRoundingLabel(rule: NumericRoundingRule | undefined): string {
  if (!rule || rule.mode === 'none') return '不修约';
  if (rule.mode === 'multiple_2') return '修约到最接近的偶数';
  if (rule.mode === 'multiple_5') return '修约到最接近的 5 的倍数';
  const suffix = `（${clampDigits(rule.digits)} 位小数）`;
  if (rule.mode === 'half_up') return `四舍五入${suffix}`;
  if (rule.mode === 'half_even') return `四舍六入五单双（五成双）${suffix}`;
  if (rule.mode === 'truncate') return `直接截尾${suffix}`;
  if (rule.mode === 'ceil') return `向上修约${suffix}`;
  return `向下修约${suffix}`;
}
