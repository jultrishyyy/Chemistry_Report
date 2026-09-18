import type { FieldDefinition, StyleOverride } from './types';
import { validateCoverLegacyFormat } from './cover-legacy-format';

export type CoverTextStyles = { text: string; spans: Array<{ from: number; to: number; style: StyleOverride }> };
export function coverPartText(field: FieldDefinition, part: 'label' | 'value'): string {
  return part === 'label' ? field.label || '' : String(field.binding?.source === 'literal' ? field.binding.text : field.default_value ?? '');
}
export function coverTextSegments(text: string, styles?: CoverTextStyles) {
  const spans = styles?.text === text ? styles.spans.filter(s => Number.isInteger(s.from) && Number.isInteger(s.to) && s.from >= 0 && s.to > s.from && s.to <= text.length) : [];
  const points = [...new Set([0, text.length, ...spans.flatMap(s => [s.from, s.to])])].sort((a, b) => a - b);
  return points.slice(0, -1).map((from, i) => ({ from, to: points[i + 1], text: text.slice(from, points[i + 1]), style: Object.assign({}, ...spans.filter(s => s.from <= from && s.to >= points[i + 1]).map(s => s.style)) as StyleOverride }));
}
export function formatCoverText(text: string, previous: CoverTextStyles | undefined, from: number, to: number, style: StyleOverride): CoverTextStyles {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from || to > text.length) throw new Error('文字选区已失效，请重新选择');
  validateCoverLegacyFormat({ part: 'value', patch: style });
  const spans = previous?.text === text ? previous.spans : [];
  const segments = coverTextSegments(text, { text, spans: [...spans, { from, to, style }] });
  return { text, spans: segments.filter(s => Object.keys(s.style).length).map(({ from, to, style }) => ({ from, to, style })) };
}

/** Preserve unaffected ranges when typing, deleting, or pasting plain text. */
export function rebaseCoverTextStyles(old: CoverTextStyles | undefined, text: string): CoverTextStyles | undefined {
  if (!old || old.text === text) return old;
  let start = 0, suffix = 0;
  while (start < old.text.length && start < text.length && old.text[start] === text[start]) start++;
  while (suffix < old.text.length - start && suffix < text.length - start && old.text[old.text.length - 1 - suffix] === text[text.length - 1 - suffix]) suffix++;
  const oldEnd = old.text.length - suffix, end = text.length - suffix, delta = end - oldEnd;
  const spans: CoverTextStyles['spans'] = [];
  for (const span of old.spans) {
    if (span.from < start) spans.push({ ...span, to: Math.min(span.to, start) });
    if (span.to > oldEnd) spans.push({ ...span, from: Math.max(span.from, oldEnd) + delta, to: span.to + delta });
  }
  const inherit = old.spans.find(s => s.from <= start && s.to > start);
  if (end > start && inherit) spans.push({ from: start, to: end, style: inherit.style });
  return { text, spans: spans.filter(s => s.to > s.from) };
}
