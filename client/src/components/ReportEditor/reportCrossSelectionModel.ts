import { Extension, type Editor } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { cleanReportParagraphSpacing, cleanReportTextStyle, encodeReportRichDocument, type ReportParagraphSpacing, type ReportRichNode, type ReportTextStyle } from '../../../../shared/report-rich-document';

export type CrossFormat = ReportTextStyle & ReportParagraphSpacing & { bold?: boolean; italic?: boolean; textAlign?: 'left' | 'center' | 'right' };

/** Only common explicit values are displayed; mixed/inherited values stay empty. */
export function crossTextFormatValues(ranges: Array<{ editor: Editor; from: number; to: number }>): CrossFormat {
  const sets = new Map<string, Set<unknown>>();
  const collect = (key: string, value: unknown) => { if (!sets.has(key)) sets.set(key, new Set()); sets.get(key)!.add(value ?? undefined); };
  for (const r of ranges) r.editor.state.doc.nodesBetween(r.from, r.to, node => {
    if (node.isText) {
      const attrs = node.marks.find(mark => mark.type.name === 'reportTextStyle')?.attrs || {};
      for (const key of ['font', 'fontSize', 'color']) collect(key, attrs[key]);
      for (const key of ['bold', 'italic']) collect(key, node.marks.some(mark => mark.type.name === key));
    }
    if (node.type.name === 'paragraph') for (const key of ['spaceBefore', 'spaceAfter', 'lineGap', 'textAlign']) collect(key, node.attrs[key]);
  });
  return Object.fromEntries([...sets].filter(([, values]) => values.size === 1).map(([key, values]) => [key, [...values][0]]));
}
export const crossSelectionKey = new PluginKey<DecorationSet>('reportCrossSelection');
export const ReportCrossSelectionDecoration = Extension.create({
  name: 'reportCrossSelectionDecoration',
  addProseMirrorPlugins() { return [new Plugin({
    key: crossSelectionKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, old) {
        const range = tr.getMeta(crossSelectionKey);
        if (range === null) return DecorationSet.empty;
        if (range) return range.to > range.from ? DecorationSet.create(tr.doc, [Decoration.inline(range.from, range.to, { class: 'report-cross-selected' })]) : DecorationSet.empty;
        return old.map(tr.mapping, tr.doc);
      },
    },
    props: { decorations(state) { return crossSelectionKey.getState(state); } },
  })]; },
});

/** Prepare only: caller validates ALL documents before committing any callback. */
export function prepareCrossTextFormat(editor: Editor, from: number, to: number, patch: CrossFormat): string {
  if (editor.isDestroyed || editor.view.composing || from < 0 || to > editor.state.doc.content.size || from > to) throw new Error('选区已变化，请重新选择');
  const tr = editor.state.tr;
  const text = cleanReportTextStyle(patch), spacing = cleanReportParagraphSpacing(patch);
  const paragraph = { ...spacing, ...(['left', 'center', 'right'].includes(patch.textAlign || '') ? { textAlign: patch.textAlign } : {}) };
  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isText && Object.keys(text).length) {
      const existing = node.marks.find(mark => mark.type.name === 'reportTextStyle')?.attrs || {};
      tr.addMark(Math.max(from, pos), Math.min(to, pos + node.nodeSize), editor.schema.marks.reportTextStyle.create({ ...existing, ...text }));
    }
    if (node.type.name === 'paragraph' && Object.keys(paragraph).length && pos + 1 < to && pos + node.nodeSize > from) tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...paragraph });
  });
  for (const name of ['bold', 'italic'] as const) {
    if (patch[name] === true) tr.addMark(from, to, editor.schema.marks[name].create());
    else if (patch[name] === false) tr.removeMark(from, to, editor.schema.marks[name]);
  }
  return encodeReportRichDocument(tr.doc.toJSON() as ReportRichNode);
}
