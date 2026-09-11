import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/react';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Button, Dropdown, InputNumber, Select, Tooltip, message } from 'antd';
import { AlignLeftOutlined, AlignCenterOutlined, AlignRightOutlined } from '@ant-design/icons';
import { REPORT_TEXT_FONTS, encodeReportRichDocument, type ReportRichNode } from '../../../../shared/report-rich-document';
import { crossSelectionKey, crossTextFormatValues, prepareCrossTextFormat, type CrossFormat } from './reportCrossSelectionModel';
import { isReportToolbarOverlay } from './ReportToolbarContext';

type TextEntry = { editor: Editor; write: (value: string) => void };
type RangeEntry = TextEntry & { from: number; to: number; doc: PMNode };
type FigureEntry = { element: HTMLElement; kind: 'table' | 'image'; values: () => CrossFormat[]; snapshot: () => string; prepare: (patch: CrossFormat) => (() => void) };
type FigureRange = { entry: FigureEntry; snapshot: string };
const CrossContext = createContext<{ register: (entry: TextEntry) => () => void; registerFigure: (entry: FigureEntry) => () => void; active: boolean } | null>(null);
export function ReportCrossFigure({ children, kind, snapshot, prepare, values = [] }: { children: ReactNode; kind: 'table' | 'image'; snapshot: string; prepare: FigureEntry['prepare']; values?: CrossFormat[] }) {
  const context = useContext(CrossContext), element = useRef<HTMLDivElement>(null);
  const latest = useRef({ snapshot, prepare, values }); latest.current = { snapshot, prepare, values };
  useEffect(() => element.current && context ? context.registerFigure({ element: element.current, kind, values: () => latest.current.values, snapshot: () => latest.current.snapshot, prepare: patch => latest.current.prepare(patch) }) : undefined, [context?.registerFigure, kind]);
  return <div ref={element} className="report-cross-figure">{children}</div>;
}
export function useReportCrossText(editor: Editor | null, write: (value: string) => void) {
  const context = useContext(CrossContext);
  const writeRef = useRef(write); writeRef.current = write;
  useEffect(() => editor && context ? context.register({ editor, write: value => writeRef.current(value) }) : undefined, [editor, context?.register]);
  return context?.active || false;
}

/** Cross-editor selection is transient; never serialize DOM or flatten source fields. */
export default function ReportCrossSelection({ children, host, enabled, revision, batch, onActive }: {
  children: ReactNode; host: HTMLElement | null; enabled: boolean; revision: unknown;
  batch: (commit: () => void) => void | boolean; onActive: (active: boolean) => void;
}) {
  const entries = useRef(new Set<TextEntry>());
  const figures = useRef(new Set<FigureEntry>());
  const figureSelection = useRef<FigureRange[]>([]);
  const [figureCount, setFigureCount] = useState(0);
  const wrapper = useRef<HTMLDivElement>(null);
  const selection = useRef<RangeEntry[]>([]);
  const drag = useRef<{ entry: TextEntry; pos: number; crossed: boolean } | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const ownCommit = useRef(false);
  const [count, setCount] = useState(0);
  const [values, setValues] = useState<CrossFormat>({});
  const activeCallback = useRef(onActive); activeCallback.current = onActive;
  const register = useCallback((entry: TextEntry) => { entries.current.add(entry); return () => { entries.current.delete(entry); }; }, []);
  const registerFigure = useCallback((entry: FigureEntry) => { figures.current.add(entry); return () => { figures.current.delete(entry); entry.element.removeAttribute('data-cross-selected'); }; }, []);
  const paintFigures = (ranges: FigureRange[]) => {
    figureSelection.current = ranges;
    for (const entry of figures.current) entry.element.toggleAttribute('data-cross-selected', ranges.some(r => r.entry === entry));
    setFigureCount(ranges.length);
  };
  const ordered = () => [...entries.current].filter(entry => !entry.editor.isDestroyed && entry.editor.view.dom.isConnected)
    .sort((a, b) => a.editor.view.dom.compareDocumentPosition(b.editor.view.dom) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  const clear = () => {
    for (const entry of entries.current) if (!entry.editor.isDestroyed) entry.editor.view.dispatch(entry.editor.state.tr.setMeta(crossSelectionKey, null));
    selection.current = []; paintFigures([]); setCount(0); setValues({}); activeCallback.current(false);
  };
  const paint = (ranges: RangeEntry[]) => {
    ranges = ranges.filter(r => r.to > r.from);
    selection.current = ranges;
    const textValues = crossTextFormatValues(ranges);
    const samples = [...(ranges.length ? [textValues] : []), ...figureSelection.current.flatMap(r => r.entry.values().length ? r.entry.values() : [{}])];
    const common = { ...textValues };
    for (const key of ['font', 'fontSize', 'color', 'bold', 'italic'] as const) {
      const options = new Set(samples.map(sample => sample[key]));
      Object.assign(common, { [key]: options.size === 1 ? [...options][0] : undefined });
    }
    setValues(common);
    for (const entry of entries.current) {
      if (entry.editor.isDestroyed) continue;
      const range = ranges.find(r => r.editor === entry.editor);
      entry.editor.view.dispatch(entry.editor.state.tr.setMeta(crossSelectionKey, range ? { from: range.from, to: range.to } : null));
    }
    setCount(ranges.length); activeCallback.current(ranges.length + figureSelection.current.length > 0);
    window.getSelection()?.removeAllRanges();
  };
  useEffect(() => {
    if (!selection.current.length && !figureSelection.current.length) return;
    if (ownCommit.current) {
      ownCommit.current = false;
      // Editor props settle before measuring the next formatting selection.
      const frame = requestAnimationFrame(() => {
        if (selection.current.some(r => r.editor.isDestroyed)) { clear(); return; }
        if (figureSelection.current.some(r => !figures.current.has(r.entry) || !r.entry.element.isConnected)) { clear(); return; }
        paintFigures(figureSelection.current.map(r => ({ entry: r.entry, snapshot: r.entry.snapshot() })));
        paint(selection.current.map(r => ({ ...r, doc: r.editor.state.doc, to: Math.min(r.to, r.editor.state.doc.content.size) })));
      });
      return () => cancelAnimationFrame(frame);
    }
    clear(); // Undo, reload, or an unrelated document edit invalidates stale offsets.
  }, [revision]);
  useEffect(() => { if (!enabled) clear(); }, [enabled]);
  const apply = (patch: CrossFormat) => {
    const ranges = selection.current;
    if (!enabled || !ranges.length && !figureSelection.current.length) return;
    try {
      if (figureSelection.current.length && ['textAlign', 'spaceBefore', 'spaceAfter', 'lineGap'].some(key => key in patch)) throw new Error('混合选区仅支持字体类格式，请单独选择正文调整间距和对齐');
      if (figureSelection.current.some(r => !figures.current.has(r.entry) || !r.entry.element.isConnected || r.entry.snapshot() !== r.snapshot)) throw new Error('图表已更新，请重新选择');
      if (ranges.some(r => r.editor.isDestroyed || r.editor.view.composing || r.editor.state.doc !== r.doc)) throw new Error('正文已更新，请重新选择后设置格式');
      const plans = ranges.map(r => ({ write: r.write, value: prepareCrossTextFormat(r.editor, r.from, r.to, patch), before: encodeReportRichDocument(r.doc.toJSON() as ReportRichNode) }))
        .filter(plan => plan.value !== plan.before);
      const figurePlans = figureSelection.current.map(r => r.entry.prepare(patch));
      if (!plans.length && !figurePlans.length) { setValues(previous => ({ ...previous, ...patch })); return; }
      ownCommit.current = true;
      const changed = batch(() => { plans.forEach(plan => plan.write(plan.value)); figurePlans.forEach(commit => commit()); });
      if (changed === false) ownCommit.current = false;
      setValues(previous => ({ ...previous, ...patch }));
    } catch (error) { ownCommit.current = false; message.warning(error instanceof Error ? error.message : '无法修改此选区'); clear(); }
  };
  const findEntry = (target: EventTarget | null) => target instanceof Node ? ordered().find(entry => entry.editor.view.dom.contains(target)) : undefined;
  const position = (entry: TextEntry, x: number, y: number) => Math.max(0, Math.min(entry.editor.state.doc.content.size, entry.editor.view.posAtCoords({ left: x, top: y })?.pos ?? 0));
  const extendDrag = (x: number, y: number) => {
    const anchor = drag.current;
    if (!anchor) return false;
    const focus = findEntry(document.elementFromPoint(x, y));
    if (!focus || focus === anchor.entry && !anchor.crossed) return false;
    const all = ordered(), a = all.indexOf(anchor.entry), b = all.indexOf(focus);
    if (a < 0 || b < 0) return false;
    anchor.crossed = true;
    const end = position(focus, x, y), forwards = a < b || a === b && anchor.pos <= end;
    const first = all[Math.min(a, b)].editor.view.dom, last = all[Math.max(a, b)].editor.view.dom;
    paintFigures([...figures.current].filter(entry => entry.element.isConnected && !!(first.compareDocumentPosition(entry.element) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(entry.element.compareDocumentPosition(last) & Node.DOCUMENT_POSITION_FOLLOWING)).map(entry => ({ entry, snapshot: entry.snapshot() })));
    paint(all.slice(Math.min(a, b), Math.max(a, b) + 1).map(entry => ({ ...entry, doc: entry.editor.state.doc,
      from: entry === (forwards ? anchor.entry : focus) ? forwards ? anchor.pos : end : 0,
      to: entry === (forwards ? focus : anchor.entry) ? forwards ? end : anchor.pos : entry.editor.state.doc.content.size })));
    return true;
  };
  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const tick = () => {
      if (!drag.current) { frame = 0; return; }
      const at = pointer.current;
      const scroller = wrapper.current?.querySelector<HTMLElement>('.report-document-scroll');
      if (drag.current && at && scroller) {
        const rect = scroller.getBoundingClientRect();
        const delta = at.y < rect.top + 32 ? -12 : at.y > rect.bottom - 32 ? 12 : 0;
        if (delta && at.x >= rect.left && at.x <= rect.right) {
          const before = scroller.scrollTop;
          scroller.scrollTop += delta;
          if (scroller.scrollTop !== before) extendDrag(at.x, Math.max(rect.top + 2, Math.min(at.y, rect.bottom - 2)));
        }
      }
      frame = requestAnimationFrame(tick);
    };
    const start = () => { if (!frame) frame = requestAnimationFrame(tick); };
    const stop = () => { cancelAnimationFrame(frame); frame = 0; drag.current = null; pointer.current = null; };
    const move = (event: PointerEvent) => { if (drag.current) pointer.current = { x: event.clientX, y: event.clientY }; };
    const root = wrapper.current;
    root?.addEventListener('pointerdown', start);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);
    return () => { stop(); root?.removeEventListener('pointerdown', start); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); window.removeEventListener('blur', stop); };
  }, [enabled]);
  const protect = (event: { preventDefault(): void; stopPropagation(): void }) => {
    event.preventDefault(); event.stopPropagation(); message.info('跨区选中目前仅支持修改格式；请按 Esc 后在单处编辑内容');
  };
  return <CrossContext.Provider value={{ register, registerFigure, active: count + figureCount > 0 }}>
    {count + figureCount > 0 && host && createPortal(<div className="report-cross-tools" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); clear(); } }} onMouseDown={event => { if (!(event.target as HTMLElement).closest('input,.ant-select')) event.preventDefault(); }}>
      <Tooltip title="签署区和不支持的控件不参与；混合选区仅修改字体类格式"><span role="status">已选 {count} 处正文 · {figureSelection.current.filter(r => r.entry.kind === 'table').length} 张表格 · {figureSelection.current.filter(r => r.entry.kind === 'image').length} 组图片标题</span></Tooltip>
      <Button size="small" type={values.bold ? 'primary' : 'default'} onClick={() => apply({ bold: !values.bold })}>B</Button>
      <Button size="small" type={values.italic ? 'primary' : 'default'} onClick={() => apply({ italic: !values.italic })}>I</Button>
      <Select size="small" aria-label="跨区字体" style={{ width: 120 }} value={values.font} options={REPORT_TEXT_FONTS.map(font => ({ value: font, label: font }))} onChange={font => apply({ font })} />
      <InputNumber size="small" aria-label="跨区字号" style={{ width: 72 }} min={6} max={72} value={values.fontSize} onChange={fontSize => { if (fontSize != null) apply({ fontSize }); }} />
      <Dropdown trigger={['click']} menu={{ items: ['#000000', '#595959', '#cf1322', '#389e0d', '#1677ff', '#722ed1'].map((key, i) => ({ key, label: ['黑色', '灰色', '红色', '绿色', '蓝色', '紫色'][i] })), onClick: ({ key }) => apply({ color: key }) }}><Button size="small" aria-label="跨区颜色">颜色 ▾</Button></Dropdown>
      {(['left', 'center', 'right'] as const).map((textAlign, i) => <Tooltip key={textAlign} title={['左对齐', '居中', '右对齐'][i]}><Button size="small" disabled={figureCount > 0} aria-label={`跨区${['左对齐', '居中', '右对齐'][i]}`} type={values.textAlign === textAlign ? 'primary' : 'default'} icon={[<AlignLeftOutlined />, <AlignCenterOutlined />, <AlignRightOutlined />][i]} onClick={() => apply({ textAlign })} /></Tooltip>)}
      {(['spaceBefore', 'spaceAfter', 'lineGap'] as const).map((key, i) => <label className="report-image-number" key={key}>{['段前', '段后', '行距'][i]}<InputNumber size="small" disabled={figureCount > 0} aria-label={`跨区${['段前', '段后', '行距'][i]}`} style={{ width: 68 }} min={0} max={i === 2 ? 10 : 200} step={i === 2 ? 0.1 : 1} value={values[key]} onChange={value => { if (value != null) apply({ [key]: value }); }} />{i === 2 ? 'em' : 'pt'}</label>)}
      <Button size="small" onClick={clear}>取消选中</Button>
      {figureCount > 0 && count > 0 && <Tooltip title="保留正文选区，即可统一调整正文段落间距和对齐，不影响图表"><Button size="small" onClick={() => { paintFigures([]); paint(selection.current); }}>仅选正文</Button></Tooltip>}
    </div>, host)}
    <div ref={wrapper} className="report-cross-root"
      onKeyDownCapture={event => {
        if (!enabled || isReportToolbarOverlay(event.target) || !(event.target as HTMLElement).closest('.report-document-paper')) return;
        if (event.nativeEvent.isComposing) return;
        if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'a') {
          if ((event.target as HTMLElement).closest('input,textarea') && !selection.current.length) return;
          event.preventDefault(); event.stopPropagation();
          paintFigures([...figures.current].filter(entry => entry.element.isConnected).map(entry => ({ entry, snapshot: entry.snapshot() })));
          paint(ordered().map(entry => ({ ...entry, from: 0, to: entry.editor.state.doc.content.size, doc: entry.editor.state.doc })));
          return;
        }
        if (!selection.current.length && !figureSelection.current.length) return;
        if ((event.ctrlKey || event.metaKey) && !event.altKey && ['b', 'i'].includes(event.key.toLowerCase())) {
          event.preventDefault(); event.stopPropagation();
          const key = event.key.toLowerCase() === 'b' ? 'bold' : 'italic'; apply({ [key]: !values[key] }); return;
        }
        if (event.key === 'Escape') { event.preventDefault(); clear(); return; }
        if (event.key === 'Backspace' || event.key === 'Delete' || event.key === 'Enter' || (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1)) protect(event);
      }}
      onBeforeInputCapture={event => { if ((selection.current.length || figureSelection.current.length) && !isReportToolbarOverlay(event.target)) protect(event); }}
      onPasteCapture={event => { if ((selection.current.length || figureSelection.current.length) && !isReportToolbarOverlay(event.target)) protect(event); }}
      onCutCapture={event => { if ((selection.current.length || figureSelection.current.length) && !isReportToolbarOverlay(event.target)) protect(event); }}
      onCopyCapture={event => {
        if ((!selection.current.length && !figureSelection.current.length) || isReportToolbarOverlay(event.target)) return;
        event.preventDefault(); event.stopPropagation();
        if (figureSelection.current.length) { message.info('混合选区暂不支持复制，请单独复制文字或图表'); return; }
        event.clipboardData.setData('text/plain', selection.current.map(r => r.doc.textBetween(r.from, r.to, '\n')).join('\n'));
      }}
      onPointerDownCapture={event => {
        if (!enabled || event.button !== 0 || isReportToolbarOverlay(event.target)) return;
        if (selection.current.length || figureSelection.current.length) clear();
        const entry = findEntry(event.target);
        if (entry?.editor.view.composing) return;
        pointer.current = { x: event.clientX, y: event.clientY };
        drag.current = entry ? { entry, pos: position(entry, event.clientX, event.clientY), crossed: false } : null;
      }}
      onPointerMoveCapture={event => {
        if (!drag.current || event.buttons !== 1) { drag.current = null; return; }
        pointer.current = { x: event.clientX, y: event.clientY };
        if (extendDrag(event.clientX, event.clientY)) { event.preventDefault(); event.stopPropagation(); }
      }}
      onPointerUpCapture={event => { if (drag.current?.crossed) { event.preventDefault(); event.stopPropagation(); window.getSelection()?.removeAllRanges(); } drag.current = null; }}
      onPointerCancelCapture={() => { drag.current = null; }}
    >{children}</div>
  </CrossContext.Provider>;
}
