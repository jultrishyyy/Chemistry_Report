/** Small hover/focus targets outside the figure; never overlay its data cells. */
export default function ReportFigureEdges({ onContinue }: { onContinue: (direction: -1 | 1) => void }) {
  return <>{([-1, 1] as const).map(direction => <button key={direction} type="button"
    className={`report-figure-edge ${direction === -1 ? 'report-figure-edge-before' : 'report-figure-edge-after'}`}
    aria-label={direction === -1 ? '在图表前输入文字' : '在图表后输入文字'}
    title={direction === -1 ? '定位到图表前，按 Enter 输入文字' : '定位到图表后，按 Enter 输入文字'}
    onMouseDown={event => { event.preventDefault(); event.stopPropagation(); }}
    onClick={event => { event.stopPropagation(); onContinue(direction); }} />)}</>;
}
