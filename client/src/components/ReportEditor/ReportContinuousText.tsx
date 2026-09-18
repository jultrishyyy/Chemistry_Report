import type { FieldDefinition, FieldGroup } from '../../../../shared/types';
import type { CSSProperties } from 'react';
import type { ReportInsertOptions } from '../../../../shared/report-document-editing';
import { continuousTextValue } from '../../../../shared/report-continuous-text';
import ReportParagraphEditor from './ReportParagraphEditor';
import ReportRichText from './ReportRichText';
import ReportSectionHeading from './ReportSectionHeading';
import { reportFontStack, reportLengthPt, REPORT_BODY_PARAGRAPH_GAP_EM } from '../../../../shared/report-body-layout';
import { reportParagraphOuterStyle } from '../../../../shared/report-text-runs';

/** One editing surface per ordinary prose section; no per-field controls. */
export default function ReportContinuousText({ group, resolve, readOnly, font, size, onChange, onFocus, onInsert, onBoundary, onDeleteBoundary, focusRequest, onTitleChange }: {
  group: FieldGroup; resolve: (field: FieldDefinition) => string; readOnly: boolean;
  font: string; size: number; onChange: (value: string) => void; onFocus: () => void;
  onTitleChange?: (title: string) => void;
  onBoundary?: (direction: -1 | 1) => boolean;
  onDeleteBoundary?: (direction: -1 | 1) => boolean;
  focusRequest?: { token: number; edge?: 'start' | 'end'; position?: number; onApplied?: () => void };
  onInsert?: (kind: 'table' | 'image', value: string, split: { before: string; after: string }, options?: ReportInsertOptions) => void;
}) {
  let value: string;
  try { value = continuousTextValue(group, resolve); }
  catch { return <div role="alert">此段正文格式无法读取，请恢复报告版本后重试。原始字段仍保留，未被删除。</div>; }
  const bodySize = reportLengthPt(group.style?.size, 'pt', size) || size;
  const leading = reportLengthPt(group.style?.line_height, 'em', bodySize) ?? bodySize * 0.65;
  const outerStyle = reportParagraphOuterStyle(group.style, value);
  return <section className="report-continuous-text" onFocus={onFocus}
    onClick={event => {
      // Focus does not fire again when clicking inside an already active editor.
      // Toolbar clicks should retain the selection without moving the PDF.
      if ((event.target as HTMLElement).closest('.report-visual-paragraph')) onFocus();
    }}
    style={{ fontFamily: reportFontStack(group.style?.font || font, !!group.style?.font), fontSize: `${bodySize}pt`, color: group.style?.color,
      lineHeight: 1 + leading / bodySize, '--report-paragraph-gap': `${REPORT_BODY_PARAGRAPH_GAP_EM}em`,
      letterSpacing: group.style?.tracking ? `${reportLengthPt(group.style.tracking, 'pt', bodySize) || 0}pt` : undefined,
      marginTop: outerStyle?.space_before ? `${reportLengthPt(outerStyle.space_before, 'pt', bodySize) || 0}pt` : 0,
      marginBottom: outerStyle?.space_after ? `${reportLengthPt(outerStyle.space_after, 'pt', bodySize) || 0}pt` : 0,
      textAlign: group.style?.align, fontWeight: group.style?.weight === 'bold' ? 700 : undefined, fontStyle: group.style?.italic ? 'italic' : undefined } as CSSProperties}>
    <ReportSectionHeading group={group} readOnly={readOnly} onChange={onTitleChange} />
    {readOnly ? <ReportRichText value={value} /> : <ReportParagraphEditor value={value} onChange={onChange} onBoundary={onBoundary} onDeleteBoundary={onDeleteBoundary} focusRequest={focusRequest}
      onInsert={onInsert ? (kind, _editorValue, _offset, split, options) => { if (split) onInsert(kind, value, split, options); } : undefined} />}
  </section>;
}
