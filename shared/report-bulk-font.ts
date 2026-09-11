import type { FieldDefinition, StyleOverride } from './types';
import { cleanReportTextStyle, type ReportTextStyle } from './report-rich-document';

export type ReportFontPatch = ReportTextStyle & { bold?: boolean; italic?: boolean };
export function reportStyleFontValues(style?: StyleOverride): ReportFontPatch {
  return { font: style?.font, fontSize: style?.size && /^\d+(\.\d+)?pt$/.test(style.size) ? parseFloat(style.size) : undefined,
    color: style?.color, bold: style?.weight ? style.weight === 'bold' : undefined, italic: style?.italic };
}
export function reportTableFontValues(field: FieldDefinition): ReportFontPatch[] {
  const ts = field.table_style;
  const base = (header: boolean): StyleOverride => ({ font: (header ? ts?.header_font : ts?.body_font) || ts?.font,
    size: (header ? ts?.header_font_size : ts?.body_font_size) || ts?.font_size,
    weight: (header ? ts?.header_bold !== false : ts?.body_bold === true) ? 'bold' : 'regular', color: ts?.color, italic: ts?.italic });
  const styles = [base(true), base(false)];
  for (const column of field.free_table?.columns || []) if (column.style) styles.push({ ...base(true), ...column.style });
  for (const [key, style] of Object.entries(field.free_table?.cell_styles || {})) styles.push({ ...base(!!field.free_table?.header_cells?.[key]), ...style });
  return styles.map(reportStyleFontValues);
}
export function reportFontStyle(patch: ReportFontPatch): StyleOverride {
  const text = cleanReportTextStyle(patch);
  return { ...(text.font ? { font: text.font } : {}), ...(text.fontSize ? { size: `${text.fontSize}pt` } : {}),
    ...(text.color ? { color: text.color } : {}), ...(typeof patch.bold === 'boolean' ? { weight: patch.bold ? 'bold' : 'regular' } : {}),
    ...(typeof patch.italic === 'boolean' ? { italic: patch.italic } : {}) };
}
/** Format native table metadata only: no value evaluation, conversion or binding changes. */
export function applyReportTableFont(field: FieldDefinition, patch: ReportFontPatch) {
  const style = reportFontStyle(patch);
  if (!Object.keys(style).length) return;
  field.table_style = { ...field.table_style,
    ...(style.font ? { font: style.font, header_font: style.font, body_font: style.font } : {}),
    ...(style.size ? { font_size: style.size, header_font_size: style.size, body_font_size: style.size } : {}),
    ...(style.weight ? { header_bold: style.weight === 'bold', body_bold: style.weight === 'bold' } : {}),
    ...(style.color ? { color: style.color } : {}), ...(style.italic != null ? { italic: style.italic } : {}) };
  // Existing explicit overrides must not defeat the new whole-table setting.
  const table = field.free_table;
  if (table) {
    for (const column of table.columns) if (column.style) column.style = { ...column.style, ...style };
    for (const key of Object.keys(table.cell_styles || {})) table.cell_styles![key] = { ...table.cell_styles![key], ...style };
  }
}
