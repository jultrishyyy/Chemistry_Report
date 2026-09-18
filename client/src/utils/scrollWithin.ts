/** Keep editor navigation inside its own scroll pane, never scroll page ancestors. */
export function scrollWithin(container: HTMLElement, target: Element) {
  const bounds = container.getBoundingClientRect();
  const rect = target.getBoundingClientRect();
  const desired = container.scrollTop + rect.top - bounds.top
    - Math.max(0, (container.clientHeight - rect.height) / 2);
  container.scrollTo({
    top: Math.min(Math.max(0, container.scrollHeight - container.clientHeight), Math.max(0, desired)),
    behavior: 'smooth',
  });
}

/** Reveal content in explicit scroll panes only. Hidden layout ancestors and the page never move. */
export function revealInScrollPanes(target: Element | null | undefined, options: { behavior?: ScrollBehavior; block?: 'nearest' | 'start' | 'center' } = {}) {
  if (!target) return;
  const doc = target.ownerDocument;
  const view = doc.defaultView;
  if (!view) return;
  for (let pane = target.parentElement; pane && pane !== doc.body && pane !== doc.documentElement; pane = pane.parentElement) {
    const style = view.getComputedStyle(pane);
    const y = /^(auto|scroll)$/.test(style.overflowY) && pane.scrollHeight > pane.clientHeight;
    const x = /^(auto|scroll)$/.test(style.overflowX) && pane.scrollWidth > pane.clientWidth;
    if (!x && !y) continue;
    const box = pane.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    const nearest = (start: number, end: number, length: number) => start < 0 ? start : end > length ? (end - start > length ? 0 : end - length) : 0;
    const dy = options.block === 'start' ? rect.top - box.top : options.block === 'center'
      ? rect.top - box.top - Math.max(0, (pane.clientHeight - rect.height) / 2)
      : nearest(rect.top - box.top, rect.bottom - box.top, pane.clientHeight);
    pane.scrollTo({
      top: y ? Math.max(0, Math.min(pane.scrollHeight - pane.clientHeight, pane.scrollTop + dy)) : pane.scrollTop,
      left: x ? Math.max(0, Math.min(pane.scrollWidth - pane.clientWidth, pane.scrollLeft + nearest(rect.left - box.left, rect.right - box.left, pane.clientWidth))) : pane.scrollLeft,
      behavior: options.behavior || 'instant',
    });
  }
}
