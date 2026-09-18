/** Small hover/focus targets outside the figure; never overlay its data cells. */
export default function ReportFigureEdges({ onContinue, directInput = false, onNavigate, onDelete }: { onContinue: (direction: -1 | 1) => void; directInput?: boolean; onNavigate?: (edge: -1 | 1, direction: -1 | 1) => void; onDelete?: (direction: -1 | 1) => void }) {
  return <>{([-1, 1] as const).map(direction => <button key={direction} type="button"
    className={`report-figure-edge ${direction === -1 ? 'report-figure-edge-before' : 'report-figure-edge-after'}`}
    aria-label={direction === -1 ? '在图表前输入文字' : '在图表后输入文字'}
    title={directInput ? (direction === -1 ? '在图表前输入文字' : '在图表后输入文字') : direction === -1 ? '定位到图表前，按 Enter 输入文字' : '定位到图表后，按 Enter 输入文字'}
    onMouseDown={event => { event.preventDefault(); event.stopPropagation(); }}
    onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const nav = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : null;
      if (nav && onNavigate) { event.preventDefault(); event.stopPropagation(); onNavigate(direction, nav); }
      if (['Backspace', 'Delete'].includes(event.key) && onDelete) { event.preventDefault(); event.stopPropagation(); onDelete(event.key === 'Backspace' ? -1 : 1); }
    }}
    onClick={event => { event.stopPropagation(); onContinue(direction); }} />)}</>;
}
