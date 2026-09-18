import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, InputNumber, Select, Space, Tooltip } from 'antd';
import { AlignLeftOutlined, AlignCenterOutlined, AlignRightOutlined } from '@ant-design/icons';
import { REPORT_TEXT_FONTS } from '../../../../shared/report-rich-document';
import { coverLegacyFormatState, coverLegacyPartCss } from '../../../../shared/cover-legacy-format';
import type { FieldDefinition, FieldGroup } from '../../../../shared/types';
import type { CoverFieldChange, CoverPartSelection } from '../../../../shared/cover-template-editing';
import { reportFontStack, reportLengthPt } from '../../../../shared/report-body-layout';
import { coverTextSegments, type CoverTextStyles } from '../../../../shared/cover-text-selection';

export type TextRange = { text: string; from: number; to: number };
export function textRange(element: HTMLElement): TextRange | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return null;
  const prefix = range.cloneRange(); prefix.selectNodeContents(element); prefix.setEnd(range.startContainer, range.startOffset);
  const from = prefix.toString().length;
  return { text: element.textContent || '', from, to: from + range.toString().length };
}
export function restoreTextRange(element: HTMLElement, selection: TextRange) {
  if (!element.textContent) {
    const range = document.createRange(); range.selectNodeContents(element); range.collapse(true);
    window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range);
    return;
  }
  const walker = document.createTreeWalker(element, window.NodeFilter.SHOW_TEXT);
  let node: Node | null, offset = 0, start: [Node, number] | undefined, end: [Node, number] | undefined;
  while ((node = walker.nextNode())) {
    const length = node.textContent?.length || 0;
    if (!start && selection.from <= offset + length) start = [node, selection.from - offset];
    if (selection.to <= offset + length) { end = [node, selection.to - offset]; break; }
    offset += length;
  }
  if (!start || !end) return;
  const range = document.createRange(); range.setStart(...start); range.setEnd(...end);
  window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range);
}
function insertPlainText(element: HTMLElement, text: string) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !textRange(element)) return false;
  const range = selection.getRangeAt(0), node = document.createTextNode(text.replace(/\r\n?/g, '\n'));
  range.deleteContents(); range.insertNode(node); range.setStartAfter(node); range.collapse(true);
  selection.removeAllRanges(); selection.addRange(range);
  element.dispatchEvent(new window.Event('input', { bubbles: true }));
  return true;
}

function PlainText({ value, label, readOnly, onChange, styles, onRange, active }: { value: string; label: string; readOnly: boolean; onChange: (text: string) => void; styles?: CoverTextStyles; onRange?: (range: TextRange | null) => void; active?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const remembered = useRef<TextRange | null>(null);
  const emitted = useRef(value);
  const capture = () => { const range = ref.current ? textRange(ref.current) : null; remembered.current = range; onRange?.(range); };
  useEffect(() => {
    if (!ref.current) return;
    const range = textRange(ref.current) || (active ? remembered.current : null);
    const nodes = coverTextSegments(value, styles).map(segment => {
      const span = document.createElement('span'); span.textContent = segment.text;
      Object.assign(span.style, { fontFamily: segment.style.font ? reportFontStack(segment.style.font, true) : '', fontSize: segment.style.size || '', color: segment.style.color || '', fontWeight: segment.style.weight === 'bold' ? 'bold' : segment.style.weight === 'regular' ? 'normal' : '', fontStyle: segment.style.italic === true ? 'italic' : segment.style.italic === false ? 'normal' : '' });
      return span;
    });
    ref.current.replaceChildren(...nodes);
    if (range && range.text === value) restoreTextRange(ref.current, range);
    emitted.current = value;
  }, [value, styles]);
  return <span ref={ref} role="textbox" aria-label={label} aria-multiline="true" contentEditable={readOnly ? false : 'plaintext-only'} suppressContentEditableWarning
    onMouseUp={capture} onKeyUp={capture}
    onKeyDown={event => {
      if (readOnly || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      // Keep literal whitespace as text nodes, including the final newline.
      // Browsers otherwise normalize trailing editable whitespace into <br> nodes.
      if (event.key === 'Backspace' || event.key === 'Delete') {
        const element = event.currentTarget, range = textRange(element);
        if (range && range.from === range.to) {
          const index = event.key === 'Backspace' ? range.from - 1 : range.from;
          if (index >= 0 && /[ \n\u00a0]/.test(range.text[index] || '') && index < range.text.length) {
            restoreTextRange(element, { ...range, from: index, to: index + 1 });
            if (insertPlainText(element, '')) event.preventDefault();
          }
        }
      }
      if (event.key === 'Enter' || event.key === ' ') {
        if (insertPlainText(event.currentTarget, event.key === 'Enter' ? '\n' : ' ')) event.preventDefault();
      }
    }}
    onPaste={event => { if (!readOnly && insertPlainText(event.currentTarget, event.clipboardData.getData('text/plain'))) event.preventDefault(); }}
    className={`cover-legacy-text${value.length ? '' : ' is-empty'}`} onInput={event => {
      const next = event.currentTarget.textContent ?? '';
      capture();
      if (!readOnly && next !== value) { emitted.current = next; onChange(next); }
    }} onBlur={event => {
      const next = event.currentTarget.textContent ?? '';
      if (!readOnly && next !== value) onChange(next);
    }} />;
}

/** Legacy fixed-width/signature text remains native template data, not flattened rich text. */
export default function CoverLegacyText({ field, group, theme, readOnly, resolve, onChange, onConfigure, host, active, onSelect, onBoundary, onContinue, focusRequest }: {
  field: FieldDefinition; group: FieldGroup; theme?: Record<string, any>; readOnly: boolean;
  resolve: (field: FieldDefinition) => string; onChange: (change: CoverFieldChange) => void; onConfigure: () => void;
  host?: HTMLElement | null; active?: boolean; onSelect?: () => void;
  onBoundary?: (direction: -1 | 1) => boolean;
  onContinue?: (direction: -1 | 1) => void;
  focusRequest?: { token: number; edge: 'start' | 'end'; onApplied: () => void };
}) {
  const [part, setPart] = useState<'label' | 'value'>('value');
  const line = useRef<HTMLDivElement>(null);
  const focusElement = (element: HTMLElement | undefined, edge: 'start' | 'end') => {
    if (!element || readOnly) return false;
    element.focus();
    if (element.getAttribute('role') === 'textbox') {
      const text = element.textContent || '', offset = edge === 'start' ? 0 : text.length;
      restoreTextRange(element, { text, from: offset, to: offset });
    }
    return true;
  };
  useEffect(() => {
    const elements = line.current?.querySelectorAll<HTMLElement>('[role="textbox"], .cover-binding-token');
    if (focusRequest && elements && focusElement(elements[focusRequest.edge === 'start' ? 0 : elements.length - 1], focusRequest.edge)) focusRequest.onApplied();
  }, [focusRequest]);
  const crossRange = useRef<{ selection: TextRange; parts: CoverPartSelection[] } | null>(null);
  const [selectionVersion, setSelectionVersion] = useState(0);
  const [unsupportedRange, setUnsupportedRange] = useState(false);
  const selectedRange = useRef<{ part: 'label' | 'value'; range: TextRange } | null>(null);
  const [hasRange, setHasRange] = useState(false);
  const baseFormat = coverLegacyFormatState(field, group, theme, part);
  const currentRange = selectedRange.current?.part === part ? selectedRange.current.range : null;
  const ranges = crossRange.current?.parts || (currentRange ? [{ ...currentRange, part }] : []);
  const selectedStyles = ranges.flatMap(selected => {
    const baseFormat = coverLegacyFormatState(field, group, theme, selected.part);
    return coverTextSegments(selected.text, field.cover_text_styles?.[selected.part]).filter(s => s.to > selected.from && s.from < selected.to).map(s => ({
    ...baseFormat, font: s.style.font || baseFormat.font, size: s.style.size ? parseFloat(s.style.size) : baseFormat.size, color: s.style.color || baseFormat.color,
    bold: s.style.weight ? s.style.weight === 'bold' : baseFormat.bold, italic: s.style.italic ?? baseFormat.italic,
    }));
  });
  const format = selectedStyles.length ? { ...selectedStyles[0], bold: selectedStyles.every(s => s.bold), italic: selectedStyles.every(s => s.italic) } : baseFormat;
  const select = (next: 'label' | 'value') => { crossRange.current = null; if (selectedRange.current?.part !== next) { selectedRange.current = null; setHasRange(false); } setPart(next); onSelect?.(); };
  const remember = (target: 'label' | 'value', range: TextRange | null) => { selectedRange.current = range && range.to > range.from ? { part: target, range } : null; setHasRange(!!selectedRange.current); };
  const patch = (value: Parameters<typeof onChange>[0]) => {
    if (readOnly || unsupportedRange) return;
    if ('legacyFormat' in value && value.legacyFormat.part !== 'paragraph' && crossRange.current) {
      onChange({ legacySelectionFormat: { patch: value.legacyFormat.patch, selections: crossRange.current.parts } });
      return;
    }
    const selected = selectedRange.current;
    if ('legacyFormat' in value && value.legacyFormat.part !== 'paragraph' && selected?.part === part) onChange({ ...value, selection: selected.range });
    else onChange(value);
  };
  const multiColumn = ['grid', 'two-col'].includes(group.layout) && !field.signature_line;
  const width = field.signature_line || multiColumn ? 'none' : field.label_width ?? group.label_width ?? theme?.label_width ?? 'none';
  const labelContent = useRef<HTMLSpanElement>(null);
  const [labelPixels, setLabelPixels] = useState(0);
  const paragraphFormat = coverLegacyFormatState(field, group, theme, 'paragraph');
  const fixedIndent = reportLengthPt(width, 'em', paragraphFormat.size);
  const indent = field.hide_label || multiColumn ? '0px' : fixedIndent != null ? `${fixedIndent}pt` : `${labelPixels}px`;
  useLayoutEffect(() => {
    const element = labelContent.current;
    if (!element || field.signature_line || fixedIndent != null || field.hide_label) return;
    let disposed = false;
    const measure = () => {
      if (disposed) return;
      // offsetWidth is in layout pixels, unlike getBoundingClientRect under zoom.
      const pixels = element.offsetWidth;
      setLabelPixels(previous => Math.abs(previous - pixels) < 0.1 ? previous : pixels);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    document.fonts?.addEventListener('loadingdone', measure);
    void document.fonts?.ready.then(measure);
    return () => { disposed = true; observer?.disconnect(); document.fonts?.removeEventListener('loadingdone', measure); };
  }, [field.label, field.label_style, field.cover_text_styles?.label, field.signature_line, field.hide_label, fixedIndent, paragraphFormat.size, paragraphFormat.font, group.style, field.style, theme]);
  const literal = (!field.binding || field.binding.source === 'literal') && !field.formula && !field.rich && ['text', 'textarea'].includes(field.type);
  const raw = String(field.binding?.source === 'literal' ? field.binding.text : field.default_value ?? '');
  const resolved = literal ? '' : resolve(field);
  const dynamicText = field.hide_label && (resolved === '' || resolved === '—') ? '' : resolved || field.label || '动态字段';
  const captureLine = () => {
    const root = line.current, selection = root ? textRange(root) : null;
    crossRange.current = null;
    if (root && selection && selection.to > selection.from && literal) {
      const parts: CoverPartSelection[] = [];
      for (const element of root.querySelectorAll<HTMLElement>('[role="textbox"]')) {
        const prefix = document.createRange(); prefix.selectNodeContents(root); prefix.setEndBefore(element);
        const offset = prefix.toString().length, text = element.textContent || '';
        const from = Math.max(0, selection.from - offset), to = Math.min(text.length, selection.to - offset);
        if (to > from) parts.push({ part: element.getAttribute('aria-label') === '编辑正文标签' ? 'label' : 'value', text, from, to });
      }
      if (parts.length === 2) { crossRange.current = { selection, parts }; selectedRange.current = null; setHasRange(true); onSelect?.(); }
    }
    const nativeSelection = window.getSelection();
    setUnsupportedRange(!!nativeSelection && !nativeSelection.isCollapsed && !crossRange.current && !selectedRange.current);
    setSelectionVersion(v => v + 1);
  };
  // Child text spans are rebuilt after formatting. Restore the whole-line range
  // after both children, rather than restoring only its last editable fragment.
  useEffect(() => {
    const remembered = crossRange.current, root = line.current;
    if (!remembered || !root || !active || readOnly) return;
    if (remembered.selection.text !== root.textContent) { crossRange.current = null; setHasRange(false); return; }
    restoreTextRange(root, remembered.selection);
  }, [field.cover_text_styles, field.label, raw, active, readOnly, selectionVersion]);
  useEffect(() => {
    const selected = selectedRange.current;
    if (selected && selected.range.text !== (selected.part === 'label' ? field.label || '' : raw)) { selectedRange.current = null; setHasRange(false); }
  }, [field.label, raw]);
  const partStyle = (part: 'label' | 'value' | 'paragraph') => coverLegacyPartCss(field, group, theme, part);
  return <>
    {host && active && !readOnly && createPortal(<Space size={6} wrap className="cover-legacy-format-toolbar" onMouseDown={event => { if ((event.target as HTMLElement).closest('button')) event.preventDefault(); }}>
      <Tooltip title={unsupportedRange ? '目前支持同一行的固定文字选区；动态字段请单击后整体设置格式' : hasRange ? '格式作用于选中文字；对齐作用于整行' : `格式作用于整段${part === 'label' ? '字段名' : '字段值'}；对齐作用于整行`}><span style={{ fontSize: 12, color: '#64748b' }}>{unsupportedRange ? '请重新选择文字' : hasRange ? '选中文字' : part === 'label' ? '字段名' : '字段值'}</span></Tooltip>
      <Button size="small" aria-label="加粗" type={format.bold ? 'primary' : 'default'} onClick={() => patch({ legacyFormat: { part, patch: { weight: format.bold ? 'regular' : 'bold' } } })}><b>B</b></Button>
      <Button size="small" aria-label="斜体" type={format.italic ? 'primary' : 'default'} onClick={() => patch({ legacyFormat: { part, patch: { italic: !format.italic } } })}><i>I</i></Button>
      <InputNumber aria-label="文字字号" size="small" min={6} max={72} value={format.size} suffix="pt" style={{ width: 88 }} onChange={size => size != null && patch({ legacyFormat: { part, patch: { size: `${size}pt` } } })} />
      <Select aria-label="文字字体" size="small" value={format.font} style={{ width: 150 }} options={REPORT_TEXT_FONTS.map(value => ({ value, label: value }))} onChange={font => patch({ legacyFormat: { part, patch: { font } } })} />
      <Tooltip title="文字颜色"><input aria-label="文字颜色" type="color" value={format.color} onChange={event => patch({ legacyFormat: { part, patch: { color: event.target.value } } })} style={{ width: 28, height: 24, padding: 0, border: '1px solid #d5dfed' }} /></Tooltip>
      {(['left', 'center', 'right'] as const).map((align, index) => <Tooltip key={align} title={field.signature_line ? '签署行保持模板定位' : ['左对齐', '居中', '右对齐'][index]}><Button size="small" disabled={field.signature_line} aria-label={['左对齐', '居中', '右对齐'][index]} type={format.align === align ? 'primary' : 'default'} icon={[<AlignLeftOutlined />, <AlignCenterOutlined />, <AlignRightOutlined />][index]} onClick={() => patch({ legacyFormat: { part: 'paragraph', patch: { align } } })} /></Tooltip>)}
    </Space>, host)}
    <div ref={line} onKeyDown={event => {
      if (readOnly || event.defaultPrevented || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const element = (event.target as HTMLElement).closest<HTMLElement>('[role="textbox"], .cover-binding-token');
      if (!element) return;
      const token = element.matches('.cover-binding-token');
      if (token && event.key === 'Enter' && onContinue) { event.preventDefault(); onContinue(1); return; }
      const direction = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : null;
      const range = textRange(element);
      if (!direction || (!token && (!range || range.from !== range.to || (direction < 0 ? range.from !== 0 : range.to !== range.text.length)))) return;
      const elements = Array.from(line.current?.querySelectorAll<HTMLElement>('[role="textbox"], .cover-binding-token') || []);
      const next = elements[elements.indexOf(element) + direction];
      if (focusElement(next, direction === 1 ? 'start' : 'end') || onBoundary?.(direction)) event.preventDefault();
    }} onMouseUp={captureLine} onKeyUp={captureLine} className={`cover-legacy-line${field.signature_line ? ' is-signature' : ' is-paragraph'}`} style={{ ...partStyle('paragraph'), ...(field.signature_line ? { gridTemplateColumns: field.hide_label ? 'minmax(0, 1fr)' : 'max-content minmax(0, 1fr)' } : { textAlign: paragraphFormat.align, paddingLeft: indent, textIndent: `calc(-1 * ${indent})` }) }}>
    {!field.hide_label && <span className="cover-legacy-label" onFocusCapture={() => select('label')} onMouseUp={() => select('label')} style={{ ...partStyle('label'), ...(!field.signature_line ? { width: multiColumn ? 'auto' : indent, textIndent: 0 } : {}) }}><span ref={labelContent} className="cover-legacy-label-content">
      <PlainText value={field.label || ''} styles={field.cover_text_styles?.label} active={active && part === 'label'} onRange={range => remember('label', range)} label="编辑正文标签" readOnly={readOnly} onChange={label => onChange({ legacyLabel: label })} />{field.signature_line ? '' : <span style={partStyle('paragraph')}>：</span>}
    </span></span>}
    <span onFocusCapture={() => select('value')} onMouseUp={() => select('value')} style={partStyle('value')} className={field.signature_line ? 'cover-signature-value' : undefined}>
      {literal ? <PlainText value={raw} styles={field.cover_text_styles?.value} active={active && part === 'value'} onRange={range => remember('value', range)} label="编辑固定正文" readOnly={readOnly} onChange={legacyLiteral => onChange({ legacyLiteral })} />
        : <button type="button" className="cover-binding-token" aria-label={field.label || '动态字段'} style={dynamicText ? undefined : { display: 'inline-block', minWidth: '.5em', minHeight: '1em' }} onClick={() => select('value')} onDoubleClick={onConfigure} title="单击设置文字格式；双击配置数据来源">{dynamicText}</button>}
      {!field.hide_label && field.unit ? <span className="cover-legacy-unit" style={partStyle(multiColumn ? 'value' : 'paragraph')}>{` ${field.unit}`}</span> : ''}
    </span>
  </div></>;
}
