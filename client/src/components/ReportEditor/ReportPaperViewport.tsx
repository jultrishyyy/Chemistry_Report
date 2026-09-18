import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { REPORT_A4_WIDTH_PT } from '../../../../shared/report-body-layout';

export function reportPaperScale(mode: 'fit' | number, available: number, paperWidth: number): number {
  if (mode !== 'fit') return Math.max(0.25, Math.min(2, Number.isFinite(mode) ? mode : 1));
  if (!Number.isFinite(available) || available <= 0 || !Number.isFinite(paperWidth) || paperWidth <= 0) return 1;
  return Math.min(1, Math.max(0.1, (available - 2) / paperWidth));
}

/** Display-only zoom: fixed layout width and editor instances never change. */
export default function ReportPaperViewport({ contentWidthPt, children }: { contentWidthPt: number; children: ReactNode }) {
  const [available, setAvailable] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  const safeContentWidth = Math.min(REPORT_A4_WIDTH_PT, Math.max(1, contentWidthPt));
  const paperWidth = REPORT_A4_WIDTH_PT * 96 / 72;
  const paperInset = Math.max(0, (REPORT_A4_WIDTH_PT - safeContentWidth) / 2) * 96 / 72;
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const update = () => setAvailable(element.clientWidth);
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(element);
    window.addEventListener('resize', update);
    return () => { observer?.disconnect(); window.removeEventListener('resize', update); };
  }, []);
  const scale = reportPaperScale('fit', available, paperWidth);
  return <div className="report-paper-viewport">
    <div className="report-paper-scroll" ref={viewport}>
      <div className="report-paper-scaled" style={{ width: paperWidth, zoom: scale, '--report-paper-inset': `${paperInset}px` } as CSSProperties}>
        {children}
      </div>
    </div>
  </div>;
}
