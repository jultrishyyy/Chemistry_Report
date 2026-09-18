import { useLayoutEffect, useRef } from 'react';
import type { FieldGroup } from '../../../../shared/types';

/** Section names remain plain titles, editable independently of their contents. */
export default function ReportSectionHeading({ group, readOnly, onChange }: {
  group: FieldGroup; readOnly?: boolean; onChange?: (title: string) => void;
}) {
  const editor = useRef<HTMLDivElement>(null);
  const focused = useRef(false);
  useLayoutEffect(() => {
    if (!editor.current || focused.current) return;
    if (editor.current.textContent !== group.label) editor.current.textContent = group.label;
  }, [group.label]);
  if (group.hide_title || (!group.label && readOnly)) return null;
  const style = { marginBottom: group.title_gap || '.4em', fontWeight: group.title_style?.weight === 'regular' ? 400 : 700,
    fontSize: group.title_style?.size || '1.15em', fontFamily: group.title_style?.font, color: group.title_style?.color };
  if (readOnly || !onChange) return <div className="report-section-heading" style={{ ...style, whiteSpace: 'pre-wrap' }}>{group.label}</div>;
  return <div ref={editor} className="report-section-heading report-section-heading-editor" role="textbox" aria-label="分区标题" aria-multiline="true"
    contentEditable="plaintext-only" suppressContentEditableWarning
    onFocus={event => { event.stopPropagation(); focused.current = true; }}
    onBlur={event => {
      focused.current = false;
      const value = typeof event.currentTarget.innerText === 'string' ? event.currentTarget.innerText : event.currentTarget.textContent || '';
      if (value !== group.label) onChange(value.replace(/\r\n?/g, '\n'));
    }}
    onInput={event => {
      const value = typeof event.currentTarget.innerText === 'string' ? event.currentTarget.innerText : event.currentTarget.textContent || '';
      onChange(value.replace(/\r\n?/g, '\n'));
    }}
    onPointerDown={event => event.stopPropagation()}
    onClick={event => event.stopPropagation()}
    style={{ ...style, minHeight: '1.4em', outline: 'none', cursor: 'text', userSelect: 'text', whiteSpace: 'pre-wrap' }} />;
}
