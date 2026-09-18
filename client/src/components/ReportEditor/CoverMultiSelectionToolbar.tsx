import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, InputNumber, Select, Space, message } from 'antd';
import type { RecordTemplate, StyleOverride } from '../../../../shared/types';
import type { CoverSelectionTarget } from '../../../../shared/cover-template-editing';
import { coverLegacyFormatState } from '../../../../shared/cover-legacy-format';
import { coverTextSegments } from '../../../../shared/cover-text-selection';
import { REPORT_TEXT_FONTS } from '../../../../shared/report-rich-document';
import { restoreTextRange, textRange, type TextRange } from './CoverLegacyText';

type Snapshot = { range: TextRange; targets: CoverSelectionTarget[]; unsupported: boolean };

/** Native cross-field selections; never flatten source bindings into preview text. */
export default function CoverMultiSelectionToolbar({ paper, host, template, readOnly, active, activate, onChange }: {
  paper: HTMLElement | null; host: HTMLElement | null; template: RecordTemplate; readOnly: boolean;
  active: boolean; activate: () => void;
  onChange: (targets: CoverSelectionTarget[], patch: StyleOverride) => void;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const latest = useRef({ activate, readOnly }); latest.current = { activate, readOnly };
  useEffect(() => {
    if (!paper) return;
    const capture = () => {
      if (latest.current.readOnly) return;
      const range = textRange(paper);
      if (!range || range.from === range.to) { setSnapshot(null); return; }
      const intersection = (element: Element) => {
        const prefix = document.createRange(); prefix.selectNodeContents(paper); prefix.setEndBefore(element);
        const offset = prefix.toString().length, text = element.textContent || '';
        return { text, from: Math.max(0, range.from - offset), to: Math.min(text.length, range.to - offset) };
      };
      const fields = [...paper.querySelectorAll<HTMLElement>('[data-cover-field]')].filter(element => {
        const selected = intersection(element); return selected.to > selected.from;
      });
      if (fields.length < 2) { setSnapshot(null); return; }
      const targets: CoverSelectionTarget[] = [];
      let unsupported = false;
      for (const field of fields) {
        const line = field.querySelector('.cover-legacy-line');
        if (!line) { unsupported = true; continue; }
        const token = line.querySelector('.cover-binding-token');
        if (token) { const selected = intersection(token); if (selected.to > selected.from) unsupported = true; }
        const selections = [...line.querySelectorAll<HTMLElement>('[role="textbox"]')].flatMap(element => {
          const selected = intersection(element);
          return selected.to > selected.from ? [{ ...selected, part: element.getAttribute('aria-label') === '编辑正文标签' ? 'label' as const : 'value' as const }] : [];
        });
        if (selections.length) targets.push({ groupId: field.dataset.coverGroup!, fieldId: field.dataset.coverField!, selections });
      }
      setSnapshot({ range, targets, unsupported: unsupported || !targets.length });
      latest.current.activate();
    };
    // Document bubbling runs after React's per-field selection handlers.
    const handle = (event: Event) => { if (event.target instanceof Node && paper.contains(event.target)) capture(); };
    document.addEventListener('mouseup', handle); document.addEventListener('keyup', handle);
    return () => { document.removeEventListener('mouseup', handle); document.removeEventListener('keyup', handle); };
  }, [paper]);
  useEffect(() => {
    if (!paper || !snapshot || !active || readOnly) return;
    if (snapshot.range.text !== paper.textContent) { setSnapshot(null); return; }
    restoreTextRange(paper, snapshot.range);
  }, [paper, snapshot, template, active, readOnly]);
  if (!host || !snapshot || !active || readOnly) return null;
  const styles = snapshot.targets.flatMap(target => {
    const group = template.groups.find(g => g.id === target.groupId), field = group?.fields.find(f => f.id === target.fieldId);
    if (!group || !field) return [];
    return target.selections.flatMap(selected => {
      const base = coverLegacyFormatState(field, group, template.layout_options?.theme_config, selected.part);
      return coverTextSegments(selected.text, field.cover_text_styles?.[selected.part]).filter(s => s.to > selected.from && s.from < selected.to).map(s => ({
        font: s.style.font || base.font, size: s.style.size ? parseFloat(s.style.size) : base.size, color: s.style.color || base.color,
        bold: s.style.weight ? s.style.weight === 'bold' : base.bold, italic: s.style.italic ?? base.italic,
      }));
    });
  });
  const font = styles.every(s => s.font === styles[0]?.font) ? styles[0]?.font : undefined;
  const size = styles.every(s => s.size === styles[0]?.size) ? styles[0]?.size : null;
  const color = styles.every(s => s.color === styles[0]?.color) ? styles[0]?.color : undefined;
  const bold = styles.length > 0 && styles.every(s => s.bold), italic = styles.length > 0 && styles.every(s => s.italic);
  const patch = (value: StyleOverride) => {
    if (snapshot.unsupported) return;
    try { onChange(snapshot.targets, value); } catch (error) { message.warning(error instanceof Error ? error.message : '选区已变化，请重新选择'); setSnapshot(null); }
  };
  return createPortal(<Space size={6} wrap className="cover-multi-format-toolbar" onMouseDown={event => { if ((event.target as HTMLElement).closest('button')) event.preventDefault(); }}>
    {snapshot.unsupported ? <span>此选区包含动态字段、富文本或图表，请分别选择后设置格式。</span> : <>
      <span style={{ fontSize: 12, color: '#64748b' }}>选中文字</span>
      <Button size="small" aria-label="跨字段加粗" type={bold ? 'primary' : 'default'} onClick={() => patch({ weight: bold ? 'regular' : 'bold' })}><b>B</b></Button>
      <Button size="small" aria-label="跨字段斜体" type={italic ? 'primary' : 'default'} onClick={() => patch({ italic: !italic })}><i>I</i></Button>
      <InputNumber aria-label="跨字段字号" size="small" min={6} max={72} value={size} suffix="pt" style={{ width: 88 }} onChange={value => value != null && patch({ size: `${value}pt` })} />
      <Select aria-label="跨字段字体" size="small" value={font} style={{ width: 150 }} options={REPORT_TEXT_FONTS.map(value => ({ value, label: value }))} onChange={value => patch({ font: value })} />
      <input aria-label="跨字段颜色" title={color ? '文字颜色' : '选中文字颜色不同'} type="color" value={color || '#000000'} style={{ width: 28, height: 24, padding: 0, border: '1px solid #d5dfed' }} onChange={event => patch({ color: event.target.value })} />
    </>}
  </Space>, host);
}
