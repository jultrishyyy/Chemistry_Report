import { useEffect, useRef, useState } from 'react';
import { reportLengthPt } from '../../../../shared/report-body-layout';

/** Preview locally; release commits once. Escape/cancel never writes template data. */
export default function CoverSpacerResize({ value, readOnly, onChange }: { value?: string; readOnly: boolean; onChange: (value: string) => void }) {
  const height = reportLengthPt(value, 'pt') ?? 14.173;
  const [draft, setDraft] = useState<number | null>(null);
  const drag = useRef<{ y: number; height: number; next: number; scale: number; value?: string } | null>(null);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') { drag.current = null; setDraft(null); } };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, []);
  useEffect(() => { drag.current = null; setDraft(null); }, [value, readOnly]);
  return <div style={{ margin: '0 8px 8px 32px', border: '1px dashed #aec3df', background: '#f3f7fc', height: `${draft ?? height}pt`, minHeight: 12, position: 'relative' }}>
    <span style={{ fontSize: 12, color: '#64748b', pointerEvents: 'none' }}>留白 {(draft ?? height).toFixed(1)} pt</span>
    <div role="slider" tabIndex={readOnly ? -1 : 0} aria-label="留白高度" aria-valuenow={draft ?? height} aria-valuemin={0} aria-valuemax={1200} aria-disabled={readOnly}
      title="拖动调整高度，Esc 取消；方向键微调" style={{ position: 'absolute', bottom: -5, height: 10, left: 0, right: 0, cursor: readOnly ? 'default' : 'ns-resize', touchAction: 'none', borderBottom: '3px solid #94afd3' }}
      onPointerDown={event => { if (readOnly || event.button !== 0) return; event.preventDefault(); event.stopPropagation(); const parent = event.currentTarget.parentElement!; drag.current = { y: event.clientY, height, next: height, scale: parent.getBoundingClientRect().height / parent.offsetHeight || 1, value }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { const state = drag.current; if (!state) return; state.next = Math.round(Math.max(0, Math.min(1200, state.height + (event.clientY - state.y) * .75 / state.scale)) * 10) / 10; setDraft(state.next); }}
      onPointerUp={() => { const state = drag.current; drag.current = null; setDraft(null); if (!readOnly && state && state.value === value && state.next !== height) onChange(`${state.next}pt`); }}
      onPointerCancel={() => { drag.current = null; setDraft(null); }} onLostPointerCapture={() => { drag.current = null; setDraft(null); }}
      onKeyDown={event => { if (!readOnly && ['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); onChange(`${Math.max(0, Math.min(1200, height + (event.key === 'ArrowUp' ? -2 : 2)))}pt`); } }} />
  </div>;
}
