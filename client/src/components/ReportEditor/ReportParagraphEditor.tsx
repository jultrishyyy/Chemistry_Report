import { useContext, useEffect, useRef, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { ReportToolbarContext, selectedReportTextEditor } from './ReportToolbarContext';
import { ReportInsertionContext } from './ReportInsertionContext';
import { Button, Dropdown, Space, Tooltip, Popover, InputNumber, message } from 'antd';
import { AlignLeftOutlined, AlignCenterOutlined, AlignRightOutlined } from '@ant-design/icons';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import { reportParagraphExtensions, reportEditorValue, reportEditorSplit, selectedReportParagraphs, setReportParagraphSpacing, reportEditorTextSelection } from './reportParagraphModel';
import { REPORT_TEXT_FONTS, readReportRichDocument, type ReportParagraphSpacing } from '../../../../shared/report-rich-document';
import type { ReportInsertOptions } from '../../../../shared/report-document-editing';
import { useReportCrossText } from './ReportCrossSelection';

export default function ReportParagraphEditor({ value, onChange, onInsert, onBoundary, onDeleteBoundary, focusRequest }: {
  value: string; onChange: (value: string) => void;
  onInsert?: (kind: 'table' | 'image', value: string, offset: number, split?: { before: string; after: string }, options?: ReportInsertOptions) => void;
  onBoundary?: (direction: -1 | 1) => boolean;
  onDeleteBoundary?: (direction: -1 | 1) => boolean;
  focusRequest?: { token: number; edge?: 'start' | 'end'; position?: number; onApplied?: () => void };
}) {
  const activate = useContext(ReportInsertionContext);
  const toolbar = useContext(ReportToolbarContext);
  const toolbarRef = useRef(toolbar); toolbarRef.current = toolbar;
  const toolbarId = useId();
  const activateRef = useRef(activate); activateRef.current = activate;
  const callbacks = useRef({ onChange, onInsert, onBoundary, onDeleteBoundary }); callbacks.current = { onChange, onInsert, onBoundary, onDeleteBoundary };
  const emitted = useRef(value);
  const [spacingCard, setSpacingCard] = useState<keyof ReportParagraphSpacing | null>(null);
  const [spacingDraft, setSpacingDraft] = useState<number | null>(null);
  const spacingSelection = useRef<{ doc: Editor['state']['doc']; from: number; to: number } | null>(null);
  const activateEditor = (editor: Editor) => {
    if (crossActiveRef.current) return;
    toolbarRef.current?.activate(toolbarId);
    activateRef.current?.({ insert: (kind, options) => {
      if (editor.isDestroyed || !editor.view.dom.isConnected || editor.view.composing) return false;
      if (kind === 'paragraph') return editor.chain().focus().splitBlock().run();
      if (!callbacks.current.onInsert) return false;
      callbacks.current.onInsert(kind, reportEditorValue(editor), 0, reportEditorSplit(editor), options);
      return true;
    } });
  };
  const crossActiveRef = useRef(false);
  const editor = useEditor({
    extensions: reportParagraphExtensions(), content: readReportRichDocument(value), immediatelyRender: false,
    onFocus: ({ editor }) => activateEditor(editor),
    onSelectionUpdate: ({ editor }) => { if (editor.isFocused) activateEditor(editor); },
    editorProps: { attributes: { class: 'report-visual-paragraph', role: 'textbox', 'aria-label': '报告正文', 'aria-multiline': 'true' },
      handleKeyDown: (view, event) => {
        if (view.composing || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || !view.state.selection.empty) return false;
        const at = view.state.selection.from;
        const { $from } = view.state.selection;
        const emptyEdgeParagraph = $from.depth === 1 && $from.parent.type.name === 'paragraph' && !$from.parent.textContent.trim()
          && ($from.index(0) === 0 || $from.index(0) === view.state.doc.childCount - 1);
        if ((event.key === 'Backspace' || event.key === 'Delete') && emptyEdgeParagraph) {
          // The first blank can precede a nonempty note in the same editor.
          // Let the adjacent figure remove only that blank and restore its caret.
          if (callbacks.current.onDeleteBoundary?.(event.key === 'Backspace' ? -1 : 1)) return true;
        }
        const direction = (event.key === 'ArrowLeft' || event.key === 'ArrowUp') && at === 1 ? -1
          : (event.key === 'ArrowRight' || event.key === 'ArrowDown') && at === view.state.doc.content.size - 1 ? 1 : null;
        return direction ? callbacks.current.onBoundary?.(direction) || false : false;
      } },
    onUpdate: ({ editor }) => { const next = reportEditorValue(editor); emitted.current = next; callbacks.current.onChange(next); },
  });
  crossActiveRef.current = useReportCrossText(editor, next => callbacks.current.onChange(next));
  const selection = useEditorState({ editor, selector: ({ editor }) => {
    const sizes = new Set<number | null>();
    const fonts = new Set<string | null>();
    if (editor) {
      if (editor.state.selection.empty) fonts.add(editor.getAttributes('reportTextStyle').font ?? null);
      else editor.state.doc.nodesBetween(editor.state.selection.from, editor.state.selection.to, node => {
        if (node.isText) fonts.add(node.marks.find(mark => mark.type.name === 'reportTextStyle')?.attrs.font ?? null);
      });
      if (editor.state.selection.empty) sizes.add(editor.getAttributes('reportTextStyle').fontSize ?? null);
      else editor.state.doc.nodesBetween(editor.state.selection.from, editor.state.selection.to, node => {
        if (node.isText) sizes.add(node.marks.find(mark => mark.type.name === 'reportTextStyle')?.attrs.fontSize ?? null);
      });
    }
    return { font: fonts.size === 1 ? [...fonts][0] : undefined, mixedFont: fonts.size > 1,
      bold: editor?.isActive('bold'), italic: editor?.isActive('italic'), list: editor?.isActive('bulletList'),
      sizeLabel: sizes.size > 1 ? '混合字号' : [...sizes][0] ? `${[...sizes][0]} pt` : '字号',
      left: editor?.isActive('paragraph', { textAlign: 'left' }), center: editor?.isActive('paragraph', { textAlign: 'center' }), right: editor?.isActive('paragraph', { textAlign: 'right' }) };
  } });
  useEffect(() => {
    if (!editor || value === emitted.current) return;
    editor.commands.setContent(readReportRichDocument(value), { emitUpdate: false }); emitted.current = value;
  }, [editor, value]);
  useEffect(() => {
    if (!editor) return;
    const retain = () => {
      const active = document.activeElement;
      if (active?.closest('table, input, textarea') && !active.closest('.report-paragraph-tools, .ant-popover, .ant-dropdown')) return;
      if (!editor.isDestroyed && selectedReportTextEditor() === editor.view.dom) activateEditor(editor);
    };
    document.addEventListener('selectionchange', retain);
    return () => document.removeEventListener('selectionchange', retain);
  }, [editor]);
  useEffect(() => {
    if (editor && focusRequest) {
      editor.commands.focus(focusRequest.position ?? focusRequest.edge, { scrollIntoView: false });
      focusRequest.onApplied?.();
    }
  }, [editor, focusRequest]);
  const insert = (kind: 'table' | 'image') => {
    if (!editor || editor.view.composing) return;
    callbacks.current.onInsert?.(kind, reportEditorValue(editor), 0, reportEditorSplit(editor));
  };
  const changeSpacing = (key: keyof ReportParagraphSpacing, value: number | null) => {
    setSpacingDraft(value);
    // Empty/intermediate input is not zero and must not overwrite the document.
    if (!editor || editor.isDestroyed || editor.view.composing || value == null || !Number.isFinite(value) || value < 0 || value > (key === 'lineGap' ? 10 : 200)) return;
    const saved = spacingSelection.current;
    if (!saved || !saved.doc.eq(editor.state.doc)) {
      setSpacingCard(null);
      message.info('正文已变化，请重新选择段落后调整间距');
      return;
    }
    editor.commands.setTextSelection({ from: Math.max(1, saved.from), to: Math.min(editor.state.doc.content.size - 1, saved.to) });
    setReportParagraphSpacing(editor, { [key]: value });
    // Advance the snapshot for the next keystroke/spinner click, without stealing
    // focus from the number input. External edits still invalidate the snapshot.
    spacingSelection.current = { doc: editor.state.doc, from: editor.state.selection.from, to: editor.state.selection.to };
  };
  const controls = (
    <Space className="report-paragraph-tools" size={2} wrap style={{ marginBottom: 4 }} onMouseDown={event => event.preventDefault()}>
      <Tooltip title="加粗"><Button size="small" aria-label="正文加粗" disabled={!editor} type={selection?.bold ? 'primary' : 'default'} onClick={() => editor?.chain().focus().toggleBold().run()}>B</Button></Tooltip>
      <Tooltip title="斜体"><Button size="small" aria-label="正文斜体" disabled={!editor} type={selection?.italic ? 'primary' : 'default'} onClick={() => editor?.chain().focus().toggleItalic().run()}>I</Button></Tooltip>
      <Dropdown trigger={['click']} menu={{ items: [{ key: 'inherit', label: '跟随文档字号' },
        ...[8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 36].map(size => ({ key: String(size), label: `${size} pt` }))],
        onClick: ({ key }) => { if (editor && !editor.view.composing) editor.chain().focus().setMark('reportTextStyle', { fontSize: key === 'inherit' ? null : Number(key) }).run(); } }}>
        <Button size="small" disabled={!editor} aria-label="正文字号">{selection?.sizeLabel || '字号'} ▾</Button>
      </Dropdown>
      <Dropdown trigger={['click']} menu={{ items: [{ key: 'inherit', label: '跟随文档颜色' },
        ...[['#000000', '黑色'], ['#595959', '灰色'], ['#cf1322', '红色'], ['#d48806', '金色'], ['#389e0d', '绿色'], ['#1677ff', '蓝色'], ['#722ed1', '紫色']].map(([color, label]) => ({ key: color, label, icon: <span style={{ display: 'inline-block', width: 12, height: 12, background: color }} /> }))],
        onClick: ({ key }) => { if (editor && !editor.view.composing) editor.chain().focus().setMark('reportTextStyle', { color: key === 'inherit' ? null : key }).run(); } }}>
        <Button size="small" disabled={!editor} aria-label="正文颜色">颜色 ▾</Button>
      </Dropdown>
      {([{ key: 'left', label: '段落左对齐', icon: <AlignLeftOutlined /> }, { key: 'center', label: '段落居中', icon: <AlignCenterOutlined /> }, { key: 'right', label: '段落右对齐', icon: <AlignRightOutlined /> }] as const).map(item =>
        <Tooltip key={item.key} title={item.label}><Button size="small" aria-label={item.label} disabled={!editor} type={selection?.[item.key] ? 'primary' : 'default'} icon={item.icon}
          onClick={() => { if (editor && !editor.view.composing) editor.chain().focus().updateAttributes('paragraph', { textAlign: item.key }).run(); }} /></Tooltip>)}
      <Dropdown trigger={['click']} menu={{ items: REPORT_TEXT_FONTS.map(font => ({ key: font, label: font })),
        onClick: ({ key }) => { if (editor && !editor.view.composing) editor.chain().focus().setMark('reportTextStyle', { font: key }).run(); } }}>
        <Button size="small" disabled={!editor} aria-label="正文字体" style={{ minWidth: 112 }}>{selection?.mixedFont ? '' : selection?.font || (editor?.isInitialized ? getComputedStyle(editor.view.dom).fontFamily.split(',')[0].trim().replace(/^['"]|['"]$/g, '') : '')} ▾</Button>
      </Dropdown>
      {([{ key: 'spaceBefore', label: '段前', unit: 'pt' }, { key: 'spaceAfter', label: '段后', unit: 'pt' }, { key: 'lineGap', label: '行距', unit: 'em' }] as const).map(item =>
        <Popover key={item.key} trigger="click" open={spacingCard === item.key} title={item.label}
          onOpenChange={open => {
            setSpacingCard(open ? item.key : null);
            if (!open || !editor) return;
            editor.commands.setTextSelection(reportEditorTextSelection(editor));
            spacingSelection.current = { doc: editor.state.doc, from: editor.state.selection.from, to: editor.state.selection.to };
            const values = new Set(selectedReportParagraphs(editor).map(p => {
              if (p.attrs[item.key] != null) return Number(p.attrs[item.key]);
              const element = editor.view.nodeDOM(p.pos);
              if (!(element instanceof HTMLElement)) return undefined;
              const css = getComputedStyle(element);
              const raw = item.key === 'lineGap' ? parseFloat(css.lineHeight) / parseFloat(css.fontSize) - 1 : parseFloat(item.key === 'spaceBefore' ? css.marginTop : css.marginBottom) * 0.75;
              return Number.isFinite(raw) ? Math.round(Math.max(0, raw) * 100) / 100 : undefined;
            }));
            setSpacingDraft(values.size === 1 ? [...values][0] ?? null : null);
          }} content={<Space className="report-paragraph-spacing-card" direction="vertical" onFocus={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}>
            <Tooltip title={item.key === 'lineGap' ? '额外行间留白，以当前字号为单位；不是 Word 的倍数行距' : '仅修改光标所在或选区涉及的段落'}>
              <InputNumber aria-label={`所选段落${item.label}`} style={{ width: 144, maxWidth: 'calc(100vw - 64px)' }} min={0} max={item.key === 'lineGap' ? 10 : 200} step={item.key === 'lineGap' ? 0.1 : 1} suffix={item.unit} value={spacingDraft} onChange={value => changeSpacing(item.key, value)} />
            </Tooltip>
          </Space>}><Button size="small" disabled={!editor}>{item.label} ▾</Button></Popover>)}
      <Button size="small" disabled={!editor} type={selection?.list ? 'primary' : 'default'} onClick={() => editor?.chain().focus().toggleBulletList().run()}>• 列表</Button>
      {onInsert && !toolbar && <><Button size="small" disabled={!editor} onClick={() => insert('table')}>插入表格</Button><Button size="small" disabled={!editor} onClick={() => insert('image')}>插入图片</Button></>}
    </Space>
  );
  return <div onClick={event => {
    if (editor && (event.target as HTMLElement).closest('.report-visual-paragraph')) activateEditor(editor);
  }}>
    {toolbar ? toolbar.activeId === toolbarId && toolbar.host && editor && !editor.isDestroyed ? createPortal(controls, toolbar.host) : null : controls}
    <EditorContent editor={editor} />
  </div>;
}
