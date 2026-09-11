import type { FieldDefinition } from './types';

export type ReportInsertOptions = { rows?: number; columns?: number; imageCount?: number; copyToken?: string };
export function makeReportManualTable(code: string, options: ReportInsertOptions = {}): FieldDefinition {
  const rows = options.rows ?? 3, columns = options.columns ?? 3;
  if (!Number.isInteger(rows) || rows < 1 || rows > 100 || !Number.isInteger(columns) || columns < 1 || columns > 50) throw new Error('表格支持 1–100 行、1–50 列');
  // New document tables have no extra header track. Existing saved tables are not migrated.
  return { id: code, code, label: '', hide_label: true, type: 'free_grid', free_table: {
    columns: Array.from({ length: columns }, (_, i) => ({ id: `c${i + 1}`, label: '', width: '1fr' })),
    rows: Array.from({ length: rows }, (_, i) => ({ id: `r${i + 1}` })), cells: {},
  } };
}

export function makeReportManualImages(code: string, options: ReportInsertOptions = {}): FieldDefinition {
  const count = options.imageCount ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > 50) throw new Error('一次可插入 1–50 张图片');
  return { id: code, code, label: '图片', type: 'image', image_layout: 'loose', allow_multiple: true,
    image_photos: Array.from({ length: count }, (_, i) => ({ id: `${code}_photo_${i + 1}`, title: `图片${i + 1}` })) };
}

/** Preserve original units and zero; never reinterpret a historic pt value as em. */
export function reportSpacerSize(raw?: string): { value: number; unit: string } {
  const match = /^\s*(\d+(?:\.\d+)?|\.\d+)\s*(em|pt|cm|mm|in|%)?\s*$/i.exec(raw || '0.5cm');
  return match ? { value: Number(match[1]), unit: match[2]?.toLowerCase() || 'pt' } : { value: 0.5, unit: 'cm' };
}

/** Split only the supported inline Markdown grammar; keep formatting on both sides. */
export function splitReportParagraph(value: string, offset: number): [string, string] {
  let at = Math.max(0, Math.min(value.length, Math.trunc(offset)));
  if (!Number.isFinite(at)) at = value.length;
  // A browser caret is normally code-point aligned; protect programmatic callers too.
  if (at > 0 && /[\uD800-\uDBFF]/.test(value[at - 1]) && /[\uDC00-\uDFFF]/.test(value[at] || '')) at++;
  const lineStart = value.lastIndexOf('\n', at - 1) + 1;
  const lineEnd = value.indexOf('\n', at);
  const line = value.slice(lineStart, lineEnd < 0 ? value.length : lineEnd);
  const pattern = /\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_/g;
  for (const match of line.matchAll(pattern)) {
    const marker = match[1] !== undefined ? '**' : match[2] !== undefined ? '*' : '_';
    const start = lineStart + match.index!, end = start + match[0].length;
    if (at <= start || at >= end) continue;
    if (at <= start + marker.length) return [value.slice(0, start), value.slice(start)];
    if (at >= end - marker.length) return [value.slice(0, end), value.slice(end)];
    return [value.slice(0, at) + marker, marker + value.slice(at)];
  }
  return [value.slice(0, at), value.slice(at)];
}

/** One atomic report-only edit; never copy bindings/page breaks into the continuation. */
export function insertIntoReportParagraph(field: FieldDefinition, value: string, offset: number, inserted: FieldDefinition, continuationCode: string, split?: { before: string; after: string }, keepEdges = false): FieldDefinition[] {
  const [before, after] = split ? [split.before, split.after] : splitReportParagraph(value, offset);
  const original: FieldDefinition = JSON.parse(JSON.stringify(field));
  if (!before && !keepEdges) return [inserted, original];
  original.binding = { source: 'literal', text: before };
  if (!after && !keepEdges) return [original, inserted];
  const continuation: FieldDefinition = {
    id: continuationCode, code: continuationCode, type: 'text', label: '', hide_label: true, rich: true,
    binding: { source: 'literal', text: after },
    ...(field.style ? { style: JSON.parse(JSON.stringify(field.style)) } : {}),
    ...(field.value_style ? { value_style: JSON.parse(JSON.stringify(field.value_style)) } : {}),
  };
  return [original, inserted, continuation];
}
