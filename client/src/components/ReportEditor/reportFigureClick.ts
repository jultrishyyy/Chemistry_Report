/** Image content selects its frame; only whitespace outside it moves to adjacent prose. */
export function reportFigureClickTarget(target: EventTarget | null): 'image' | 'control' | 'space' {
  if (!(target instanceof Element)) return 'space';
  if (target.closest('input, textarea, button, select, [contenteditable="true"], table, [role="button"], .ant-select, .ant-color-picker, .ant-upload')) return 'control';
  return target.closest('.report-image-preview') ? 'image' : 'space';
}
