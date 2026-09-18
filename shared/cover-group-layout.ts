import type { FieldGroup, FieldDefinition } from './types';
import { reportLengthPt, reportFontStack } from './report-body-layout';

export function coverGridChunks(group: FieldGroup, theme: Record<string, any> = {}): { fields: FieldDefinition[]; columns?: number; rowGap?: string; columnGap?: string }[] {
  if (group.fields.some(f => f.signature_line) || !['grid', 'two-col'].includes(group.layout)) return [{ fields: group.fields.some(f => f.signature_line) ? [...group.fields.filter(f => f.signature_line), ...group.fields.filter(f => !f.signature_line)] : group.fields }];
  const size = reportLengthPt(group.style?.size, 'pt', reportLengthPt(theme.body_size, 'pt') || 10) || reportLengthPt(theme.body_size, 'pt') || 10;
  const rowGap = `${reportLengthPt(group.style?.block_spacing, 'pt', size) ?? reportLengthPt(theme.line_gap, 'em', size) ?? size * 0.6}pt`;
  const columnGap = group.layout === 'two-col' ? '24pt' : '16pt';
  const chunks: { fields: FieldDefinition[]; columns?: number; rowGap?: string; columnGap?: string }[] = [];
  let pending: FieldDefinition[] = [];
  const flush = () => {
    if (!pending.length) return;
    const columns = group.layout === 'two-col' ? 2 : group.grid_columns && group.grid_columns >= 1 ? Math.min(4, Math.max(1, Math.round(group.grid_columns))) : Math.min(4, pending.length);
    let cells: FieldDefinition[] = [];
    const flushCells = () => { if (cells.length) chunks.push({ fields: cells, columns, rowGap, columnGap }); cells = []; };
    for (const field of pending) {
      const align = field.style?.align ?? group.style?.align;
      if (align === 'center' || align === 'right') { flushCells(); chunks.push({ fields: [field], columns: 1, rowGap, columnGap }); }
      else cells.push(field);
    }
    flushCells(); pending = [];
  };
  for (const field of group.fields) {
    if (field.type === 'spacer') continue; // PDF ignores layout spacers inside grids; source data remains intact.
    const standalone = ['data_matrix', 'static_content', 'record_conclusion'].includes(field.type) || (field.type === 'image' && (Array.isArray(field.image_photos) || Array.isArray(field.image_items)));
    if (standalone) { flush(); chunks.push({ fields: [field], columns: 1, rowGap, columnGap }); }
    else pending.push(field);
  }
  flush(); return chunks;
}

/** Display-only projection of top-level section()/hidden block configuration. */
export function coverGroupLayout(group: FieldGroup, theme: Record<string, any> = {}) {
  const size = reportLengthPt(theme.body_size, 'pt') || 10;
  const groupSize = reportLengthPt(group.style?.size, 'pt', size) || size;
  const gap = reportLengthPt(group.style?.block_spacing, 'pt', size) ?? reportLengthPt(theme.line_gap, 'em', size) ?? size * 0.6;
  const pt = (value: unknown) => reportLengthPt(value, 'pt', groupSize) ?? 0;
  const title = group.title_style;
  const titleSize = reportLengthPt(title?.size, 'pt', size) ?? size * (title ? 1.15 : Number(theme.heading_scale) > 0 ? Number(theme.heading_scale) : 1.15);
  return {
    section: {
      marginTop: group.hide_title ? `${gap}pt` : '0pt', marginBottom: group.hide_title ? `${gap}pt` : '0pt',
      paddingTop: group.hide_title ? '0pt' : `${reportLengthPt(theme.paragraph_gap, 'em', size) ?? size * 0.8}pt`,
    },
    content: {
      paddingTop: `${pt(group.style?.space_before) + pt(group.style?.margin?.top)}pt`,
      paddingBottom: `${pt(group.style?.space_after) + pt(group.style?.margin?.bottom)}pt`,
      paddingLeft: `${pt(group.style?.margin?.left)}pt`, paddingRight: `${pt(group.style?.margin?.right)}pt`,
    },
    title: {
      fontFamily: reportFontStack(title?.font || theme.font, true), fontSize: `${titleSize}pt`,
      fontWeight: title?.weight === 'regular' ? 'normal' : 'bold', fontStyle: title?.italic ? 'italic' : 'normal',
      color: title?.color || '#000000',
      textAlign: (theme.section_style === 'center-bold' ? 'center' : 'left') as 'left' | 'center',
      marginBottom: `${reportLengthPt(group.title_gap, 'pt', size) ?? size * 0.4}pt`,
      ...(theme.section_style === 'banner' ? { background: '#f0f5ff', padding: '5pt 8pt', borderRadius: '2pt' } : {}),
    },
  };
}
