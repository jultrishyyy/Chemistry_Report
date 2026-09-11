import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export const ReportFigureToolsContext = createContext<HTMLElement | null>(null);

/** Move controls only, never the document block or its editor selection. */
export default function ReportFigureTools({ children }: { children: ReactNode }) {
  const host = useContext(ReportFigureToolsContext);
  return host ? createPortal(<div className="report-shared-figure-tools"
    onMouseDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
    {children}
  </div>, host) : null;
}
