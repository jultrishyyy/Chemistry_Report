/** UI-only caret decisions; neither navigation nor positioning creates paragraphs. */
export function reportFigureArrow(key: string, edge: -1 | 1 | null): { side: -1 | 1; navigate: boolean } | null {
  const side = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : key === 'ArrowRight' || key === 'ArrowDown' ? 1 : null;
  if (!side) return null;
  return { side, navigate: key === 'ArrowUp' || key === 'ArrowDown' || edge === side };
}
export function reportFigureBlankSide(y: number, bounds: { top: number; height: number }): -1 | 1 {
  return y < bounds.top + bounds.height / 2 ? -1 : 1;
}
