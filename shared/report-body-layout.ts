/** Mirrors record-theme A4 width/margin/font defaults. UI dimensions are CSS pt. */
export const REPORT_BODY_PARAGRAPH_GAP_EM = 0.65;
export const REPORT_A4_WIDTH_PT = 21 * 72 / 2.54;
export function reportLengthPt(raw: unknown, bareUnit: 'pt' | 'cm' | 'em', fontSize = 10): number | undefined {
  const match = String(raw ?? '').trim().match(/^(\d+(?:\.\d+)?|\.\d+)\s*(pt|cm|mm|in|em)?$/);
  if (!match) return undefined;
  const factors = { pt: 1, cm: 72 / 2.54, mm: 72 / 25.4, in: 72, em: fontSize };
  const result = Number(match[1]) * factors[(match[2] || bareUnit) as keyof typeof factors];
  return Number.isFinite(result) ? result : undefined;
}
export function reportFontStack(font: unknown = 'Songti SC', explicit = false): string {
  const fonts = (Array.isArray(font) ? font : [font]).filter((f): f is string => typeof f === 'string' && !!f.trim());
  if (explicit && fonts.length === 1 && ['Arial', 'Times New Roman'].includes(fonts[0])) return JSON.stringify(fonts[0]);
  return [...new Set(['Arial', ...(fonts.length ? fonts : ['Songti SC'])])].map(f => JSON.stringify(f)).join(', ');
}
function reportCssLength(raw: unknown, fallbackEm: number): string {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return `${raw}em`;
  const value = String(raw ?? '').trim();
  return /^(?:\d+(?:\.\d+)?|\.\d+)\s*(?:pt|cm|mm|in|em)$/.test(value) ? value.replace(/\s+/g, '') : `${fallbackEm}em`;
}
export function reportBodyLayout(theme: Record<string, any> = {}) {
  const size = reportLengthPt(theme.body_size, 'pt') || 10;
  const preset = theme.margin === 'compact' ? 1.5 : theme.margin === 'wide' ? 2.5 : 2;
  const margin = reportLengthPt(theme.margin_h, 'cm', size) ?? reportLengthPt(theme.margin, 'cm', size) ?? preset * 72 / 2.54;
  return { size, font: reportFontStack(theme.font), pageWidthPt: REPORT_A4_WIDTH_PT, marginPt: margin,
    // Corrupted margins must not create negative CSS widths.
    widthPt: REPORT_A4_WIDTH_PT - 2 * margin > 0 ? REPORT_A4_WIDTH_PT - 2 * margin : 17 * 72 / 2.54,
    fieldGap: reportCssLength(theme.line_gap, 0.6),
    sectionGap: reportCssLength(theme.paragraph_gap, 0.8),
    paragraphGap: `${REPORT_BODY_PARAGRAPH_GAP_EM}em` };
}
