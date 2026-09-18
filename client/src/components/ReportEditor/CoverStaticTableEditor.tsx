import type { FieldDefinition } from '../../../../shared/types';
import FreeGridCanvas from '../FieldEditor/MatrixEditor/FreeGridCanvas';
import { isReportToolbarOverlay } from './ReportToolbarContext';

/** Fixed template cells only. Report result tables and their mappings never enter this adapter. */
export default function CoverStaticTableEditor({ field, readOnly, active, host, font, size, onSelect, onChange }: {
  field: FieldDefinition; readOnly: boolean; active: boolean; host: HTMLElement | null; font: string; size: number;
  onSelect: () => void; onChange: (table: NonNullable<FieldDefinition['static_table']>) => void;
}) {
  return <fieldset disabled={readOnly} className="cover-static-table" aria-label="模板固定表格"
    style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
    onMouseDownCapture={event => {
      if (readOnly) { event.preventDefault(); event.stopPropagation(); }
      else if (!isReportToolbarOverlay(event.target)) onSelect();
    }}
    onKeyDownCapture={event => { if (readOnly) { event.preventDefault(); event.stopPropagation(); } }}
    onContextMenuCapture={event => { if (readOnly) { event.preventDefault(); event.stopPropagation(); } }}
    onFocusCapture={event => { if (!readOnly && !isReportToolbarOverlay(event.target)) onSelect(); }}>
    <FreeGridCanvas field={{ ...field, type: 'free_grid', label: '', hide_label: true, free_table: field.static_table }}
      staticContentMode editorMode="report-cover" documentFont={font} documentSize={size}
      toolbarHost={active && !readOnly ? host : null}
      onCellFocus={() => { if (!readOnly) onSelect(); }}
      onChange={patch => { if (!readOnly && patch.free_table) onChange(patch.free_table); }} />
  </fieldset>;
}
