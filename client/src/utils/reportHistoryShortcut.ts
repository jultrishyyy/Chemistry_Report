/** Report-owned edits use one chronological history, not competing DOM/ProseMirror stacks. */
export function reportHistoryShortcut(event: {
  key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean;
  isComposing: boolean; target: EventTarget | null;
}): 'undo' | 'redo' | null {
  if (event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey)) return null;
  const key = event.key.toLowerCase();
  const action = key === 'z' ? event.shiftKey ? 'redo' : 'undo' : key === 'y' && !event.shiftKey ? 'redo' : null;
  if (!action || !(event.target instanceof Element)) return null;
  const target = event.target;
  if (target.closest('.ant-modal, .ant-popover, .ant-dropdown, .ant-select-dropdown')) return null;
  if (!target.closest('.report-document-paper, .report-document-toolbar, [data-report-history-toolbar]')) return null;
  // Image titles commit on blur, unlike controlled cells and rich prose. While
  // typing a title, its uncommitted DOM text must retain native undo.
  if (target.closest('[contenteditable="true"]') && !target.closest('.report-visual-paragraph')) return null;
  return action;
}
