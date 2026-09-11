import StarterKit from '@tiptap/starter-kit';
import { ReportCrossSelectionDecoration } from './reportCrossSelectionModel';
import { closeHistory } from '@tiptap/pm/history';
import { Node, Mark, Extension, type Editor } from '@tiptap/react';
import { cleanReportTextStyle, cleanReportParagraphSpacing, reportParagraphCSS, encodeReportRichDocument, type ReportRichNode, type ReportParagraphSpacing } from '../../../../shared/report-rich-document';

const ReportTextStyle = Mark.create({
  name: 'reportTextStyle',
  addAttributes() { return { fontSize: { default: null }, color: { default: null }, font: { default: null } }; },
  // Paste only the supported visual styles; no arbitrary CSS/HTML enters the model.
  parseHTML() { return [{ tag: 'span', getAttrs: element => {
    const el = element as HTMLElement;
    const size = /^(\d+(?:\.\d+)?)pt$/.exec(el.style.fontSize);
    const rgb = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(el.style.color);
    const color = rgb ? '#' + rgb.slice(1).map(n => Number(n).toString(16).padStart(2, '0')).join('') : el.style.color;
    const attrs = cleanReportTextStyle({ fontSize: size ? Number(size[1]) : undefined, color, font: el.dataset.reportFont });
    return Object.keys(attrs).length ? attrs : false;
  } }]; },
  renderHTML({ mark }) {
    const attrs = cleanReportTextStyle(mark.attrs);
    return ['span', { 'data-report-font': attrs.font, style: [attrs.font ? `font-family:${JSON.stringify(attrs.font)},Arial` : '', attrs.fontSize ? `font-size:${attrs.fontSize}pt` : '', attrs.color ? `color:${attrs.color}` : ''].filter(Boolean).join(';') }, 0];
  },
});
const ReportParagraphAlignment = Extension.create({
  name: 'reportParagraphAlignment',
  addGlobalAttributes() { return [{ types: ['paragraph'], attributes: { textAlign: {
    default: null,
    parseHTML: element => ['left', 'center', 'right'].includes(element.style.textAlign) ? element.style.textAlign : null,
    renderHTML: attrs => ['left', 'center', 'right'].includes(attrs.textAlign) ? { style: `text-align:${attrs.textAlign}` } : {},
  }, ...Object.fromEntries(['spaceBefore', 'spaceAfter', 'lineGap'].map(key => [key, {
    default: null,
    parseHTML: () => null,
    renderHTML: (attrs: ReportParagraphSpacing) => {
      const css = reportParagraphCSS({ [key]: attrs[key as keyof ReportParagraphSpacing] });
      return { style: Object.entries(css).map(([name, value]) => `${name.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase())}:${value}`).join(';') };
    },
  }])) } }]; },
});

export function selectedReportParagraphs(editor: Editor) {
  const result: Array<{ pos: number; attrs: Record<string, any> }> = [];
  const { from, to, $from, empty } = editor.state.selection;
  if (empty) {
    for (let depth = $from.depth; depth > 0; depth--) if ($from.node(depth).type.name === 'paragraph') { result.push({ pos: $from.before(depth), attrs: $from.node(depth).attrs }); break; }
  } else editor.state.doc.nodesBetween(from, to, (node, pos) => { if (node.type.name === 'paragraph' && pos + 1 < to && pos + node.nodeSize > from) result.push({ pos, attrs: node.attrs }); });
  return result;
}

/** Clamp browser whole-line selections whose endpoints sit outside contenteditable. */
export function reportEditorTextSelection(editor: Editor): { from: number; to: number } {
  const fallback = { from: editor.state.selection.from, to: editor.state.selection.to };
  const selection = editor.view.dom.ownerDocument.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return fallback;
  const range = selection.getRangeAt(0), dom = editor.view.dom;
  if (!range.intersectsNode(dom)) return fallback;
  const max = Math.max(1, editor.state.doc.content.size - 1);
  try {
    const from = dom.contains(range.startContainer) ? editor.view.posAtDOM(range.startContainer, range.startOffset) : 1;
    const to = dom.contains(range.endContainer) ? editor.view.posAtDOM(range.endContainer, range.endOffset) : max;
    return { from: Math.max(1, Math.min(from, max)), to: Math.max(1, Math.min(to, max)) };
  } catch { return fallback; }
}
export function setReportParagraphSpacing(editor: Editor, patch: ReportParagraphSpacing) {
  if (editor.isDestroyed || editor.view.composing) return false;
  const clean = cleanReportParagraphSpacing(patch), paragraphs = selectedReportParagraphs(editor);
  if (!paragraphs.length || !Object.keys(clean).length) return false;
  const tr = editor.state.tr;
  for (const p of paragraphs) tr.setNodeMarkup(p.pos, undefined, { ...p.attrs, ...clean });
  editor.view.dispatch(closeHistory(tr));
  editor.view.dispatch(closeHistory(editor.state.tr));
  return true;
}

const ReportSpacer = Node.create({
  name: 'reportSpacer', group: 'block', atom: true, selectable: true,
  addAttributes() { return { height: { default: '0.5cm' } }; },
  // Only our JSON can create a spacer. Pasted HTML cannot inject arbitrary sizes.
  parseHTML() { return []; },
  renderHTML({ node }) { return ['div', { class: 'report-text-spacer', 'data-height': node.attrs.height, style: `height:${node.attrs.height}`, contenteditable: 'false', title: '原有留白，可选中后删除', 'aria-label': '留白' }]; },
});
export const reportParagraphExtensions = () => [StarterKit.configure({ heading: false, blockquote: false, code: false, codeBlock: false, horizontalRule: false, link: false, underline: false, strike: false, trailingNode: false }), ReportSpacer, ReportTextStyle, ReportParagraphAlignment, ReportCrossSelectionDecoration];
export function reportEditorValue(editor: Editor): string { return encodeReportRichDocument(editor.getJSON() as ReportRichNode); }
export function reportEditorSplit(editor: Editor): { before: string; after: string } {
  const { doc, selection } = editor.state;
  const encode = (node: typeof doc) => node.childCount === 0 || (node.childCount === 1 && node.firstChild?.type.name === 'paragraph' && !node.firstChild.content.size && !Object.values(node.firstChild.attrs).some(value => value != null))
    ? '' : encodeReportRichDocument(node.toJSON() as ReportRichNode);
  return { before: encode(doc.cut(0, selection.to)), after: encode(doc.cut(selection.to)) };
}
