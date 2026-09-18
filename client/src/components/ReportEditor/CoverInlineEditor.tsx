import { useMemo, useState, type ComponentProps } from 'react';
import { Button, Drawer, Dropdown, Input, Space } from 'antd';
import { Node, Extension, type Editor } from '@tiptap/react';
import { Plugin } from '@tiptap/pm/state';
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model';
import type { FieldDefinition } from '../../../../shared/types';
import type { TemplateFieldReference } from '../../../../shared/report-rich-document';
import { coverInlineValue } from '../../../../shared/cover-template-editing';
import ReportParagraphEditor from './ReportParagraphEditor';
import BindingEditor from './BindingEditor';
import { reportEditorValue, reportEditorSplit } from './reportParagraphModel';
import type { CoverTextSplit } from '../../../../shared/cover-text-boundaries';

export function templateFieldExtension(onSelect: (editor: Editor, id: string) => void) {
  return Node.create({
    name: 'templateField', inline: true, group: 'inline', atom: true, selectable: true,
    addAttributes() { return { reference: { default: null } }; },
    renderText({ node }) { return `〔${node.attrs.reference?.label || '动态字段'}〕`; },
    parseHTML() { return [{ tag: 'span[data-template-field]', getAttrs: element => {
      try {
        const ref = JSON.parse((element as HTMLElement).getAttribute('data-template-field') || 'null');
        return ref && typeof ref.id === 'string' && typeof ref.label === 'string' && ref.binding && typeof ref.binding.source === 'string' ? { reference: ref } : false;
      } catch { return false; }
    } }]; },
    renderHTML({ node }) { return ['span', { 'data-template-field': JSON.stringify(node.attrs.reference), class: 'cover-binding-token', contenteditable: 'false', title: '点击配置数据来源' }, node.attrs.reference?.label || '动态字段']; },
    addNodeView() {
      return ({ node }) => {
        const dom = document.createElement('span');
        dom.className = 'cover-binding-token'; dom.contentEditable = 'false'; dom.title = '点击配置数据来源';
        const paint = (current: PMNode) => { dom.textContent = current.attrs.reference?.label || '动态字段'; dom.setAttribute('data-template-field', JSON.stringify(current.attrs.reference)); };
        paint(node);
        dom.onclick = event => { event.preventDefault(); onSelect(this.editor, JSON.parse(dom.getAttribute('data-template-field')!).id); };
        return { dom, update: current => { if (current.type.name !== 'templateField') return false; paint(current); return true; }, stopEvent: event => event.type === 'click' };
      };
    },
    addProseMirrorPlugins() {
      const editor = this.editor;
      return [new Plugin({ props: {
        handleClickOn: (_view, _pos, node, _nodePos, _event, direct) => {
          if (direct && node.type.name === 'templateField') { onSelect(editor, node.attrs.reference.id); return true; }
          return false;
        },
        transformPasted: slice => {
          const copy = (node: PMNode): PMNode => node.type.name === 'templateField'
            ? node.type.create({ reference: { ...node.attrs.reference, id: crypto.randomUUID() } }, null, node.marks)
            : node.copy(Fragment.fromArray(Array.from({ length: node.childCount }, (_, i) => copy(node.child(i)))));
          return new Slice(Fragment.fromArray(Array.from({ length: slice.content.childCount }, (_, i) => copy(slice.content.child(i)))), slice.openStart, slice.openEnd);
        },
      } })];
    },
  });
}

const templateParagraphPolicy = Extension.create({
  name: 'templateParagraphPolicy',
  addGlobalAttributes() { return [{ types: ['paragraph'], attributes: { templateEmptyPolicy: {
    default: null, parseHTML: element => element.getAttribute('data-template-empty') === 'hide' ? 'hide' : null,
    renderHTML: attrs => attrs.templateEmptyPolicy === 'hide' ? { 'data-template-empty': 'hide' } : {},
  }, templateSpacing: {
    default: null,
    parseHTML: element => { try { return JSON.parse(element.getAttribute('data-template-spacing') || 'null'); } catch { return null; } },
    renderHTML: attrs => attrs.templateSpacing ? { 'data-template-spacing': JSON.stringify(attrs.templateSpacing) } : {},
  } } }]; },
});

export default function CoverInlineEditor({ field, sources, onChange, labelBold = true, onInsert, focusRequest, onBoundary, onDeleteBoundary, onInsertField }: { field: FieldDefinition; sources: FieldDefinition[]; onChange: (value: string) => void; labelBold?: boolean; onInsertField?: (split: CoverTextSplit) => void; onInsert?: ComponentProps<typeof ReportParagraphEditor>['onInsert']; focusRequest?: ComponentProps<typeof ReportParagraphEditor>['focusRequest']; onBoundary?: ComponentProps<typeof ReportParagraphEditor>['onBoundary']; onDeleteBoundary?: ComponentProps<typeof ReportParagraphEditor>['onDeleteBoundary'] }) {
  const [selected, setSelected] = useState<{ editor: Editor; id: string } | null>(null);
  const extensions = useMemo(() => [templateFieldExtension((editor, id) => setSelected({ editor, id })), templateParagraphPolicy], []);
  const locate = () => {
    let result: { pos: number; reference: TemplateFieldReference } | undefined;
    if (selected && !selected.editor.isDestroyed) selected.editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'templateField' && node.attrs.reference.id === selected.id) result = { pos, reference: node.attrs.reference };
    });
    return result;
  };
  const current = locate();
  const update = (patch: Partial<TemplateFieldReference>) => {
    const target = locate();
    if (!selected || !target) return;
    selected.editor.view.dispatch(selected.editor.state.tr.setNodeMarkup(target.pos, undefined, { reference: { ...target.reference, ...patch } }));
  };
  return <>
    <ReportParagraphEditor value={coverInlineValue(field, labelBold)} onChange={onChange} extraExtensions={extensions} onInsert={onInsert} focusRequest={focusRequest} onBoundary={onBoundary} onDeleteBoundary={onDeleteBoundary}
      extraControls={editor => onInsertField ? <Button size="small" onMouseDown={event => event.preventDefault()} onClick={() => { const split = reportEditorSplit(editor); if (split) onInsertField({ value: reportEditorValue(editor), ...split }); }}>添加字段</Button> : <Dropdown trigger={['click']} menu={{ items: [
        { key: 'new', label: '新建动态字段' },
        ...sources.map((source, i) => ({ key: String(i), label: source.label || source.code })),
      ], onClick: ({ key }) => {
        const source = key === 'new' ? undefined : sources[Number(key)];
        const reference: TemplateFieldReference = { id: crypto.randomUUID(), label: source?.label || '动态字段', binding: source?.binding ? structuredClone(source.binding) : { source: 'literal', text: '' } };
        editor.chain().focus().insertContent({ type: 'templateField', attrs: { reference } }).run();
        setSelected({ editor, id: reference.id });
      } }}><Button size="small">插入字段 ▾</Button></Dropdown>} />
    <Drawer title="动态字段" size={420} open={!!current} onClose={() => setSelected(null)}>
      {current && <Space orientation="vertical" style={{ width: '100%' }}>
        <label>显示名称<Input aria-label="动态字段名称" value={current.reference.label} onChange={event => update({ label: event.target.value })} /></label>
        <BindingEditor value={current.reference.binding} onChange={binding => update({ binding })} />
      </Space>}
    </Drawer>
  </>;
}
