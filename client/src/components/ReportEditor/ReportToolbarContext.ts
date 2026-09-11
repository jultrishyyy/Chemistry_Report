import { createContext } from 'react';

/** Portaled controls still bubble through the source editor's React ancestors. */
export function isReportToolbarOverlay(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('.report-document-toolbar, .report-shared-figure-tools, .ant-popover, .ant-dropdown, .ant-select-dropdown');
}

/** Browser triple-click/line selections may end on the editor's parent node. */
export function selectedReportTextEditor(): HTMLElement | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const element = (node: Node | null) => node instanceof Element ? node : node?.parentElement;
  for (const node of [selection.anchorNode, selection.focusNode]) {
    const editor = element(node)?.closest<HTMLElement>('.report-visual-paragraph');
    if (editor) return editor;
  }
  const range = selection.getRangeAt(0);
  const candidates = [...document.querySelectorAll<HTMLElement>('.report-visual-paragraph')].filter(editor => range.intersectsNode(editor));
  return candidates.length === 1 ? candidates[0] : null;
}

export function retainsReportTextSelection(target: EventTarget | null): boolean {
  const editor = selectedReportTextEditor();
  return !!editor && target instanceof Element && target !== editor && target.contains(editor);
}

/** Ephemeral UI ownership only; editor selection stays in its original editor. */
export const ReportToolbarContext = createContext<{
  host: HTMLElement | null;
  activeId: string | null;
  activate: (id: string) => void;
} | null>(null);
