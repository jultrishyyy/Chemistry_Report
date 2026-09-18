import { REPORT_BODY_PARAGRAPH_GAP_EM } from './report-body-layout';
import { reportTypstLineBox } from './report-line-box';
import type { CellBinding } from './types';
export type TemplateFieldReference = { id: string; label: string; binding: CellBinding };
/** Versioned string payload keeps existing literal bindings/backups compatible. */
export const REPORT_RICH_PREFIX = '@report-rich:v1:';
export type ReportParagraphSpacing = { spaceBefore?: number; spaceAfter?: number; lineGap?: number };
export function cleanReportParagraphSpacing(attrs: ReportParagraphSpacing = {}): ReportParagraphSpacing {
  return Object.fromEntries(Object.entries(attrs).filter(([key, value]) => ['spaceBefore', 'spaceAfter', 'lineGap'].includes(key) && typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= (key === 'lineGap' ? 10 : 200)));
}
export function reportParagraphCSS(attrs: ReportParagraphSpacing = {}) {
  const a = cleanReportParagraphSpacing(attrs);
  return { ...(a.spaceBefore != null ? { marginTop: `${a.spaceBefore}pt` } : {}), ...(a.spaceAfter != null ? { marginBottom: `${a.spaceAfter}pt` } : {}), ...(a.lineGap != null ? { lineHeight: String(1 + a.lineGap) } : {}) };
}
export const REPORT_TEXT_FONTS = ['Songti SC', 'STSong', 'SimHei', 'KaiTi', 'FangSong', 'FangSong_GB2312', 'Arial', 'Times New Roman'] as const;
export type ReportTextStyle = { fontSize?: number; color?: string; font?: string };
export function cleanReportTextStyle(attrs: ReportTextStyle = {}): ReportTextStyle {
  return {
    ...(typeof attrs.font === 'string' && (REPORT_TEXT_FONTS as readonly string[]).includes(attrs.font) ? { font: attrs.font } : {}),
    ...(typeof attrs.fontSize === 'number' && Number.isFinite(attrs.fontSize) && attrs.fontSize >= 6 && attrs.fontSize <= 72 ? { fontSize: attrs.fontSize } : {}),
    ...(typeof attrs.color === 'string' && /^#[0-9a-f]{6}$/i.test(attrs.color) ? { color: attrs.color.toLowerCase() } : {}),
  };
}
export type ReportRichMark = { type: 'bold' | 'italic' } | { type: 'reportTextStyle'; attrs?: ReportTextStyle };
export interface ReportRichNode {
  type: 'doc' | 'paragraph' | 'text' | 'hardBreak' | 'bulletList' | 'orderedList' | 'listItem' | 'reportSpacer' | 'templateField';
  content?: ReportRichNode[];
  text?: string;
  marks?: ReportRichMark[];
  attrs?: { start?: number; height?: string; textAlign?: 'left' | 'center' | 'right'; reference?: TemplateFieldReference; templateEmptyPolicy?: 'hide'; templateSpacing?: ReportParagraphSpacing } & ReportParagraphSpacing;
}
const types = new Set(['doc', 'paragraph', 'text', 'hardBreak', 'bulletList', 'orderedList', 'listItem', 'reportSpacer', 'templateField']);
function clean(node: ReportRichNode, depth = 0): ReportRichNode {
  if (!node || !types.has(node.type) || depth > 32) throw new Error('不支持的正文结构');
  if (node.type === 'templateField') {
    const ref = node.attrs?.reference;
    if (!ref || typeof ref.id !== 'string' || !ref.id || typeof ref.label !== 'string' || !ref.binding || typeof ref.binding.source !== 'string') throw new Error('无效的模板字段');
    const text = clean({ type: 'text', text: '', marks: node.marks });
    return { type: 'templateField', attrs: { reference: JSON.parse(JSON.stringify(ref)) }, ...(text.marks ? { marks: text.marks } : {}) };
  }
  if (node.type === 'reportSpacer') {
    const height = node.attrs?.height || '';
    if (!/^(?:\d+(?:\.\d+)?|\.\d+)(?:em|pt|cm|mm|in)$/.test(height)) throw new Error('无效留白高度');
    return { type: 'reportSpacer', attrs: { height } };
  }
  if (node.type === 'text') {
    if (typeof node.text !== 'string') throw new Error('无效正文文字');
    const marks: ReportRichMark[] = (node.marks || []).flatMap((m): ReportRichMark[] => {
      if (m.type === 'bold' || m.type === 'italic') return [{ type: m.type }];
      if (m.type === 'reportTextStyle') {
        const attrs = cleanReportTextStyle(m.attrs || {});
        return Object.keys(attrs).length ? [{ type: 'reportTextStyle', attrs }] : [];
      }
      return [];
    });
    return { type: 'text', text: node.text, ...(marks.length ? { marks } : {}) };
  }
  return { type: node.type,
    ...(node.type === 'orderedList' ? { attrs: { start: Number.isSafeInteger(node.attrs?.start) && node.attrs!.start! > 0 ? node.attrs!.start : 1 } } : {}),
    ...(node.type === 'paragraph' && (node.attrs?.templateSpacing || node.attrs?.templateEmptyPolicy === 'hide' || Object.keys(cleanReportParagraphSpacing(node.attrs)).length || ['left', 'center', 'right'].includes(node.attrs?.textAlign || '')) ? { attrs: { ...(node.attrs?.templateSpacing ? { templateSpacing: cleanReportParagraphSpacing(node.attrs.templateSpacing) } : {}), ...(node.attrs?.templateEmptyPolicy === 'hide' ? { templateEmptyPolicy: 'hide' as const } : {}), ...cleanReportParagraphSpacing(node.attrs), ...(['left', 'center', 'right'].includes(node.attrs?.textAlign || '') ? { textAlign: node.attrs!.textAlign } : {}) } } : {}),
    ...(node.content ? { content: node.content.map(child => clean(child, depth + 1)) } : {}) };
}
export function encodeReportRichDocument(doc: ReportRichNode): string {
  if (doc.type !== 'doc') throw new Error('正文必须是文档');
  return REPORT_RICH_PREFIX + JSON.stringify(clean(doc));
}
export function storedReportRichDocument(value: string): ReportRichNode | null {
  if (!value.startsWith(REPORT_RICH_PREFIX)) return null;
  try { const doc = clean(JSON.parse(value.slice(REPORT_RICH_PREFIX.length))); return doc.type === 'doc' ? doc : null; }
  catch { return null; }
}
function inline(value: string): ReportRichNode[] {
  const result: ReportRichNode[] = []; let last = 0;
  const text = (v: string) => { if (v) result.push({ type: 'text', text: v }); };
  for (const m of value.matchAll(/\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_/g)) {
    text(value.slice(last, m.index));
    result.push({ type: 'text', text: m[1] ?? m[2] ?? m[3], marks: [{ type: m[1] !== undefined ? 'bold' : 'italic' }] });
    last = m.index! + m[0].length;
  }
  text(value.slice(last)); return result;
}
/** Mirror legacy PDF grammar, not arbitrary HTML/CommonMark interpretation. */
export function readReportRichDocument(value: string): ReportRichNode {
  const stored = storedReportRichDocument(value); if (stored) return stored;
  const content: ReportRichNode[] = [];
  for (const paragraph of value.split(/\n[ \t]*\n/)) {
    const lines = paragraph.split('\n').filter(line => line.trim());
    if (!lines.length) continue;
    if (lines.every(line => /^\s*([-*]|\d+\.)\s+/.test(line))) {
      let list: ReportRichNode | undefined;
      for (const line of lines) {
        const type = /^\s*\d+\./.test(line) ? 'orderedList' : 'bulletList';
        if (!list || list.type !== type) { list = { type, content: [] }; content.push(list); }
        list.content!.push({ type: 'listItem', content: [{ type: 'paragraph', content: inline(line.replace(/^\s*([-*]|\d+\.)\s+/, '')) }] });
      }
    } else content.push({ type: 'paragraph', content: lines.flatMap((line, i) => [...(i ? [{ type: 'hardBreak' as const }] : []), ...inline(line)]) });
  }
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}
export function reportRichPlainText(value: string): string {
  const walk = (node: ReportRichNode): string => node.type === 'templateField' ? `〔${node.attrs?.reference?.label || '动态字段'}〕` : node.type === 'text' ? node.text || '' : node.type === 'hardBreak' ? '\n'
    : (node.content || []).map(walk).join(['doc', 'bulletList', 'orderedList', 'listItem'].includes(node.type) ? '\n' : '');
  return walk(readReportRichDocument(value));
}
export function richDocumentToTypst(doc: ReportRichNode, options: { explicitBold?: boolean; boldStroke?: boolean } = {}): string {
  const escape = (text: string) => text.replace(/([\\#$*_\[\]@<>`~])/g, '\\$1');
  const render = (node: ReportRichNode, index = 0, siblings: ReportRichNode[] = []): string => {
    if (node.type === 'templateField') throw new Error('模板动态字段尚未解析，不能直接生成 PDF');
    if (node.type === 'text') {
      // Markup whitespace is collapsed by Typst, unlike the editor's pre-wrap.
      // Explicit text preserves glyph widths (including leading spaces), while
      // keeping ordinary spaces available for line breaking. Do not use nbsp
      // or fixed-width boxes: those would change wrapping and font metrics.
      let text = escape(node.text || '').replace(/[ \u00a0\u3000]+/g, spaces => `#text(${JSON.stringify(spaces)})`);
      for (const mark of node.marks || []) {
        if (mark.type === 'reportTextStyle') {
          const attrs = cleanReportTextStyle(mark.attrs);
          const rules = [attrs.font ? `font: (${JSON.stringify(attrs.font)}, ${JSON.stringify('Arial')})` : '', attrs.fontSize ? `size: ${attrs.fontSize}pt` : '', attrs.color ? `fill: rgb("${attrs.color}")` : ''].filter(Boolean);
          if (rules.length) text = `#text(${rules.join(', ')})[${text}]`;
        } else text = mark.type === 'bold'
          ? options.explicitBold ? `#text(weight: 700, stroke: ${options.boldStroke ? '0.015em' : 'none'})[${text}]` : `#strong[${text}]`
          : `#emph[${text}]`;
      }
      return text;
    }
    if (node.type === 'hardBreak') return '#linebreak()';
    if (node.type === 'reportSpacer') return `#v(${node.attrs!.height})`;
    if (node.type === 'bulletList' || node.type === 'orderedList') {
      return `#${node.type === 'bulletList' ? 'list(' : `enum(start: ${node.attrs?.start || 1}, `}${(node.content || []).map(child => `[${render(child)}]`).join(', ')})`;
    }
    const children = (node.content || []).map((child, i, all) => render(child, i, all));
    if (node.type === 'paragraph') {
      const text = children.join('') || '#v(1em)';
      const aligned = node.attrs?.textAlign ? `#align(${node.attrs.textAlign})[${text}]` : text;
      const spacing = cleanReportParagraphSpacing(node.attrs);
      if (!Object.keys(spacing).length) return aligned;
      const body = spacing.lineGap != null ? reportTypstLineBox(aligned, `${spacing.lineGap}em`) : aligned;
      return `#block(above: ${spacing.spaceBefore ?? 0}pt, below: ${spacing.spaceAfter != null ? `${spacing.spaceAfter}pt` : index === siblings.length - 1 ? '0pt' : `${REPORT_BODY_PARAGRAPH_GAP_EM}em`}, breakable: true)[${body}]`;
    }
    return children.join('\n\n');
  };
  return render(clean(doc));
}
