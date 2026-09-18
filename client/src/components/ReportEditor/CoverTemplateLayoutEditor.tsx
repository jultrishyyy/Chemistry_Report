import { useEffect, useRef, useState } from 'react';
import { uploadCoverImage } from '../../utils/coverImageUpload';
import { coverTextRuns, type CoverTextRun } from '../../../../shared/cover-text-runs';
import { ReportInsertionContext, type ReportInsertionTarget } from './ReportInsertionContext';
import { canSplitCoverText, isCoverFigure, type CoverTextSplit } from '../../../../shared/cover-text-boundaries';
import { storedReportRichDocument } from '../../../../shared/report-rich-document';
import ReportFigureEdges from './ReportFigureEdges';
import { Button, Drawer, Space, InputNumber, Select, Popover, message } from 'antd';
import CoverStaticTableEditor from './CoverStaticTableEditor';
import type { RecordTemplate, FieldDefinition } from '../../../../shared/types';
import { coverFieldMode, coverGroupCanFlow, coverCanEditInline, coverStaticTextValue, coverSourceFields, type CoverFieldChange } from '../../../../shared/cover-template-editing';
import { reportSpacerSize } from '../../../../shared/report-document-editing';
import CoverLogoEditor from './CoverLogoEditor';
import CoverLegacyText from './CoverLegacyText';
import CoverMultiSelectionToolbar from './CoverMultiSelectionToolbar';
import { coverLegacyBlockSpacing } from '../../../../shared/cover-legacy-format';
import { coverGroupLayout, coverGridChunks } from '../../../../shared/cover-group-layout';
import { reportPaperScale } from './ReportPaperViewport';
import type { CoverSelectionTarget } from '../../../../shared/cover-template-editing';
import type { StyleOverride } from '../../../../shared/types';
import { reportBodyLayout, reportFontStack } from '../../../../shared/report-body-layout';
import CoverInlineEditor from './CoverInlineEditor';
import ReportRichText from './ReportRichText';
import { ReportToolbarContext, isReportToolbarOverlay } from './ReportToolbarContext';
import BindingEditor from './BindingEditor';
import FieldPropsPanel from '../FieldEditor/FieldPropsPanel';
import { createFieldForCategory } from '../FieldEditor/field-types';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import './CoverTemplateLayoutEditor.css';

/** Compatibility-first cover canvas; unsupported blocks keep their original configuration. */
export default function CoverTemplateLayoutEditor({ template, readOnly, resolve, onChange, onConfigure, onFocus, onInsert, onInsertAtText, onInsertLogo, onContinueFigure, onDeleteBlank, onChangeRun, onFormatSelection, onStartBody, onInsertConfiguredField }: {
  template: RecordTemplate; readOnly: boolean; resolve: (field: FieldDefinition) => string;
  onChange: (groupId: string, fieldId: string, change: CoverFieldChange) => void;
  onChangeRun?: (run: CoverTextRun, value: string) => void;
  onFormatSelection?: (targets: CoverSelectionTarget[], patch: StyleOverride) => void;
  onStartBody?: (groupId: string | null) => { groupId: string; fieldId: string } | undefined;
  onInsertConfiguredField?: (groupId: string, afterId: string | null, field: FieldDefinition, split?: CoverTextSplit) => string | undefined;
  onInsertLogo?: (groupId: string, afterId: string | null, image: NonNullable<FieldDefinition['static_images']>[number], split?: CoverTextSplit) => string | undefined;
  onInsert?: (groupId: string, afterId: string | null, kind: 'logo' | 'spacer' | 'table', dimensions?: { rows: number; columns: number }) => string | undefined;
  onInsertAtText?: (groupId: string, fieldId: string, split: CoverTextSplit, kind: 'logo' | 'table', dimensions?: { rows: number; columns: number }) => string | undefined;
  onContinueFigure?: (groupId: string, fieldId: string, direction: -1 | 1) => string | undefined;
  onDeleteBlank?: (groupId: string, fieldId: string, paragraphIndex: number, direction: -1 | 1) => { figureId: string; edge: -1 | 1 } | undefined;
  onConfigure: (kind: 'field' | 'group', code: string) => void;
  onFocus: (code: string, groupId: string) => void;
}) {
  const [host, setHost] = useState<HTMLDivElement | null>(null), [activeId, activate] = useState<string | null>(null);
  const [paper, setPaper] = useState<HTMLDivElement | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => setAvailableWidth(element.clientWidth);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element); window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  const [bindingTarget, setBindingTarget] = useState<{ group: string; field: string } | null>(null);
  const [tableCard, setTableCard] = useState(false);
  const [dimensions, setDimensions] = useState({ rows: 3, columns: 3 });
  const [selected, setSelected] = useState<{ group: string; field: string } | null>(null);
  const [fieldDraft, setFieldDraft] = useState<{ groupId: string; afterId: string | null; field: FieldDefinition; split?: CoverTextSplit; snapshot: RecordTemplate } | null>(null);
  const configureNewField = (groupId: string, afterId: string | null, split?: CoverTextSplit) => {
    if (readOnly || !onInsertConfiguredField) return;
    setFieldDraft({ groupId, afterId, split, snapshot: template, field: createFieldForCategory('text', `cover_${crypto.randomUUID().replaceAll('-', '')}`) });
  };
  const insertion = useRef<ReportInsertionTarget | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const pendingLogo = useRef<{ snapshot: RecordTemplate; group: string; after: string | null; split?: CoverTextSplit } | null>(null);
  const latest = useRef({ template, readOnly }); latest.current = { template, readOnly };
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [uploading, setUploading] = useState(false);
  const chooseLogo = (group: string, after: string | null, split?: CoverTextSplit) => {
    if (readOnly || uploading) return;
    pendingLogo.current = { snapshot: template, group, after, split };
    picker.current?.click();
  };
  const fieldElements = useRef(new Map<string, HTMLDivElement>());
  const [focus, setFocus] = useState<{ field: string; edge: 'start' | 'end'; token: number } | null>(null);
  const startBody = (groupId: string | null) => {
    if (readOnly) return;
    const target = onStartBody?.(groupId);
    if (!target) return;
    setSelected({ group: target.groupId, field: target.fieldId });
    setFocus({ field: target.fieldId, edge: 'start', token: Date.now() });
  };
  const emptyBody = (groupId: string | null) => !readOnly && onStartBody
    ? <button type="button" className="cover-empty-body" onClick={() => startBody(groupId)}>点击输入正文</button>
    : <div className="cover-empty-body-hint">空白模板</div>;
  const field = template.groups.find(g => g.id === bindingTarget?.group)?.fields.find(f => f.id === bindingTarget?.field);
  const body = reportBodyLayout(template.layout_options?.theme_config);
  const sources = coverSourceFields(template);
  const runs = onChangeRun && !readOnly ? coverTextRuns(template) : [];
  const selectedGroup = template.groups.find(g => g.id === selected?.group);
  const selectedField = selectedGroup?.fields.find(f => f.id === selected?.field);
  const insertGroup = selectedGroup || template.groups.find(coverGroupCanFlow);
  const space = reportSpacerSize(selectedField?.spacer_height);
  const insert = (kind: 'logo' | 'spacer' | 'table') => {
    if (!insertGroup || readOnly) return;
    if (kind !== 'spacer' && selectedField && (canSplitCoverText(selectedField) || runs.some(r => r.groupId === insertGroup.id && r.ids[0] === selectedField.id)) && activeId !== 'figure' && insertion.current && onInsertAtText) {
      if (insertion.current.insert(kind === 'logo' ? 'image' : 'table', dimensions)) return;
    }
    const selectedRun = runs.find(run => run.groupId === insertGroup.id && run.ids.includes(selectedField?.id || ''));
    const afterId = selectedRun?.ids.at(-1) || selectedField?.id || null;
    if (kind === 'logo' && onInsertLogo) { chooseLogo(insertGroup.id, afterId); return; }
    const id = onInsert?.(insertGroup.id, afterId, kind, kind === 'table' ? dimensions : undefined);
    if (id) { setSelected({ group: insertGroup.id, field: id }); activate('figure'); }
  };
  const continueFigure = (groupId: string, fieldId: string, direction: -1 | 1) => {
    if (readOnly) return;
    const target = onContinueFigure?.(groupId, fieldId, direction);
    if (target) { setSelected({ group: groupId, field: target }); setFocus({ field: target, edge: direction === 1 ? 'start' : 'end', token: Date.now() }); }
  };
  const focusFigure = (groupId: string, fieldId: string, edge: -1 | 1) => {
    const button = fieldElements.current.get(fieldId)?.querySelector<HTMLButtonElement>(edge === -1 ? '.report-figure-edge-before' : '.report-figure-edge-after');
    if (!button || readOnly) return false;
    setFocus(null); setSelected({ group: groupId, field: fieldId }); activate('figure'); button.focus();
    return true;
  };
  const navigate = (groupId: string, fieldId: string, direction: -1 | 1) => {
    if (readOnly) return false;
    const group = template.groups.find(g => g.id === groupId);
    const currentRun = runs.find(run => run.groupId === groupId && run.ids.includes(fieldId));
    const boundaryId = currentRun ? (direction === 1 ? currentRun.ids.at(-1) : currentRun.ids[0]) : fieldId;
    const index = group?.fields.findIndex(f => f.id === boundaryId) ?? -1;
    const neighbor = index < 0 ? undefined : group?.fields[index + direction];
    if (!group || !neighbor || !coverGroupCanFlow(group)) return false;
    if (isCoverFigure(neighbor)) return focusFigure(groupId, neighbor.id, direction === 1 ? -1 : 1);
    if (coverFieldMode(neighbor) !== 'text' && !['text', 'textarea', 'number', 'date', 'daterange', 'select'].includes(neighbor.type)) return false;
    const targetId = runs.find(run => run.groupId === groupId && run.ids.includes(neighbor.id))?.ids[0] || neighbor.id;
    setSelected({ group: groupId, field: targetId }); setFocus({ field: targetId, edge: direction === 1 ? 'start' : 'end', token: Date.now() });
    return true;
  };
  const deleteBlank = (groupId: string, fieldId: string, paragraphIndex: number, direction: -1 | 1) => {
    if (readOnly) return false;
    const result = onDeleteBlank?.(groupId, fieldId, paragraphIndex, direction);
    if (!result) return false;
    if (!focusFigure(groupId, result.figureId, result.edge)) {
      setSelected({ group: groupId, field: result.figureId });
      setFocus({ field: result.figureId, edge: result.edge === 1 ? 'end' : 'start', token: Date.now() });
    }
    return true;
  };
  return <ReportInsertionContext.Provider value={target => { insertion.current = target; }}><ReportToolbarContext.Provider value={{ host, activeId, activate }}>
    <div className="cover-layout-editor">
      <input ref={picker} type="file" accept=".png,.jpg,.jpeg,.gif,.webp" hidden aria-label="选择 Logo 图片" onChange={async event => {
        const file = event.target.files?.[0], target = pendingLogo.current;
        event.target.value = ''; pendingLogo.current = null;
        if (!file || !target || uploading || latest.current.readOnly) return;
        setUploading(true);
        try {
          const image = await uploadCoverImage(file, target.snapshot.id);
          if (!mounted.current) return;
          if (latest.current.readOnly || latest.current.template !== target.snapshot) {
            message.warning('编辑内容或权限已变化，未插入图片，请在目标位置重新选择。'); return;
          }
          const id = onInsertLogo?.(target.group, target.after, image, target.split);
          if (id) { setSelected({ group: target.group, field: id }); activate('figure'); }
        } catch (error: any) {
          if (mounted.current) message.error(`上传失败：${error.response?.data?.error || error.message}`);
        } finally { if (mounted.current) setUploading(false); }
      }} />
      <div ref={setHost} className="report-document-toolbar">{!activeId && <span className="cover-layout-hint">点击文字直接编辑，点击动态字段配置来源</span>}</div>
      {!readOnly && <div className="cover-layout-insert-tools"><Space size={6} wrap>
        {selectedField && <Button size="small" onClick={() => onConfigure('field', selectedField.code)}>字段设置</Button>}
        {onInsertConfiguredField && activeId === 'figure' && <Button size="small" disabled={!insertGroup || !coverGroupCanFlow(insertGroup)} onClick={() => insertGroup && configureNewField(insertGroup.id, selectedField?.id || null)}>添加字段</Button>}
        {onInsertConfiguredField && !activeId && <Button size="small" disabled={!insertGroup || !coverGroupCanFlow(insertGroup)} onClick={() => insertGroup && configureNewField(insertGroup.id, null)}>添加字段</Button>}
        {onInsert && <><Button size="small" loading={uploading} title="选择图片后插入当前位置" disabled={!insertGroup || !coverGroupCanFlow(insertGroup)} onClick={() => insert('logo')}>插入 Logo / 图片</Button>
          <Button size="small" title="插在当前内容后；未选择时放在首个可编辑区域末尾" disabled={!insertGroup || !coverGroupCanFlow(insertGroup)} onClick={() => insert('spacer')}>插入留白</Button>
          <Popover trigger="click" open={tableCard} onOpenChange={setTableCard} content={<Space orientation="vertical">
            <label>行数 <InputNumber aria-label="插入表格行数" min={1} max={50} precision={0} value={dimensions.rows} onChange={rows => rows != null && setDimensions(d => ({ ...d, rows }))} /></label>
            <label>列数 <InputNumber aria-label="插入表格列数" min={1} max={30} precision={0} value={dimensions.columns} onChange={columns => columns != null && setDimensions(d => ({ ...d, columns }))} /></label>
            <Button size="small" type="primary" onClick={() => { insert('table'); setTableCard(false); }}>插入表格</Button>
          </Space>}><Button size="small" disabled={!insertGroup || !coverGroupCanFlow(insertGroup)}>插入表格 ▾</Button></Popover></>}
        {selectedField?.type === 'spacer' && selected && <>
          <label>留白高度 <InputNumber aria-label="留白高度" min={0} max={1000} step={0.1} value={space.value} style={{ width: 100 }} onChange={value => value != null && onChange(selected.group, selected.field, { spacerHeight: `${value}${space.unit}` })} /></label>
          <Select aria-label="留白单位" value={space.unit} options={['cm', 'mm', 'pt', 'em', 'in'].map(value => ({ value, label: value }))} onChange={unit => onChange(selected.group, selected.field, { spacerHeight: `${space.value}${unit}` })} />
        </>}
      </Space></div>}
      <div className="cover-layout-scroll"><div ref={viewport} className="cover-layout-viewport"><div ref={setPaper} className="cover-layout-paper" style={{ fontFamily: body.font, fontSize: `${body.size}pt`, width: `${body.widthPt}pt`, zoom: reportPaperScale('fit', availableWidth, body.widthPt * 96 / 72 + 88) }}>
        {!template.groups.length && emptyBody(null)}
        {template.groups.map(group => { const layout = coverGroupLayout(group, template.layout_options?.theme_config); return <section key={group.id} data-cover-section={group.id} style={layout.section}>
          {!group.hide_title && <div className="cover-layout-section-title" style={layout.title}>{group.label}</div>}
          {!group.fields.length && emptyBody(coverGroupCanFlow(group) ? group.id : null)}
          {<div className="cover-layout-group" style={{ display: group.fields.some(f => f.signature_line) || ['grid', 'two-col', 'inline'].includes(group.layout) ? 'grid' : 'block', gridTemplateColumns: `repeat(${group.fields.filter(f => f.signature_line).length || (group.layout === 'two-col' ? 2 : group.grid_columns || Math.min(4, group.fields.length) || 1)}, minmax(0, 1fr))`, gap: '12px', fontFamily: group.style?.font ? reportFontStack(group.style.font, true) : undefined, fontSize: group.style?.size, textAlign: group.style?.align, fontWeight: group.style?.weight === 'bold' ? 'bold' : group.style?.weight === 'regular' ? 'normal' : undefined, fontStyle: group.style?.italic ? 'italic' : 'normal', color: group.style?.color, ...layout.content }}>
              {coverGridChunks(group, template.layout_options?.theme_config).map((chunk, chunkIndex) => <div key={chunk.fields[0]?.id || chunkIndex} className={chunk.columns ? 'cover-layout-grid-chunk' : undefined} style={chunk.columns ? { display: 'grid', gridColumn: '1 / -1', gridTemplateColumns: `repeat(${chunk.columns}, minmax(0, 1fr))`, rowGap: chunk.rowGap, columnGap: chunk.columnGap, marginBottom: chunk.rowGap } : { display: 'contents' }}>{chunk.fields.map(f => {
                const run = runs.find(r => r.groupId === group.id && r.ids.includes(f.id));
                if (run && run.ids[0] !== f.id) return null;
                const mode = coverFieldMode(f);
                const legacySpacing = group.layout === 'vertical' && !f.signature_line && !coverCanEditInline(f) && ['text', 'textarea', 'number', 'date', 'daterange', 'select'].includes(f.type)
                  ? coverLegacyBlockSpacing(f, group, template.layout_options?.theme_config) : {};
                const select = () => { setSelected({ group: group.id, field: f.id }); onFocus(f.code, group.id); };
                if (mode === 'spacer') return <div key={f.id} tabIndex={0} role="button" aria-label="选择留白" className={`cover-layout-spacer${selectedField?.id === f.id ? ' is-active' : ''}`} style={{ height: f.spacer_height || '0.5cm', minHeight: 4, gridColumn: '1 / -1' }} onFocus={() => { select(); activate('figure'); }} onClick={() => { select(); activate('figure'); }} title="点击调整留白高度" />;
                const figure = f.type === 'static_content' && ['images', 'table'].includes(f.static_kind || '');
                return <div key={f.id} data-cover-group={group.id} data-cover-field={f.id} ref={element => { if (element) fieldElements.current.set(f.id, element); else fieldElements.current.delete(f.id); }} className="cover-layout-field" onKeyDown={event => {
                  if (figure && !readOnly && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !event.nativeEvent.isComposing && !(event.target as HTMLElement).closest('input, textarea, table, button, [contenteditable="true"], .report-document-toolbar')) {
                    const direction = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : null;
                    if (direction && focusFigure(group.id, f.id, direction)) { event.preventDefault(); event.stopPropagation(); }
                  }
                  if (figure && !readOnly && event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !event.nativeEvent.isComposing && !(event.target as HTMLElement).closest('input, textarea, table, button, [contenteditable="true"], .report-document-toolbar')) {
                    event.preventDefault(); continueFigure(group.id, f.id, 1);
                  }
                }} onFocusCapture={event => { if (!isReportToolbarOverlay(event.target)) { select(); if ((event.target as HTMLElement).closest('.cover-legacy-text')) activate('figure'); } }} style={{ position: 'relative', marginTop: f.style?.space_before, marginBottom: f.style?.space_after, fontWeight: f.style?.weight === 'bold' ? 'bold' : f.style?.weight === 'regular' ? 'normal' : undefined,
                  gridColumn: !f.signature_line && group.fields.some(field => field.signature_line) ? '1 / -1' : undefined, fontFamily: f.style?.font ? reportFontStack(f.style.font, true) : undefined, fontSize: f.style?.size, color: f.style?.color, textAlign: f.style?.align, ...legacySpacing }}>
                  {figure && !readOnly && onContinueFigure && <ReportFigureEdges directInput onContinue={direction => continueFigure(group.id, f.id, direction)}
                    onNavigate={(edge, direction) => { if (edge !== direction) focusFigure(group.id, f.id, direction); else navigate(group.id, f.id, direction); }}
                    onDelete={direction => {
                      const index = group.fields.findIndex(field => field.id === f.id), neighbor = group.fields[index + direction];
                      if (!neighbor || coverFieldMode(neighbor) !== 'text') return;
                      const doc = storedReportRichDocument(coverStaticTextValue(neighbor));
                      deleteBlank(group.id, neighbor.id, direction === 1 ? 0 : (doc?.content?.length || 1) - 1, direction === 1 ? -1 : 1);
                    }} />}
                  {f.type === 'static_content' && f.static_kind === 'images' ? <CoverLogoEditor field={f} templateId={template.id} readOnly={readOnly} host={host} active={selectedField?.id === f.id && activeId === 'figure'} onSelect={() => { select(); activate('figure'); }} onChange={images => onChange(group.id, f.id, { images })} />
                    : f.type === 'static_content' && f.static_kind === 'table' && f.static_table ? <CoverStaticTableEditor field={f} readOnly={readOnly} host={host} active={selectedField?.id === f.id && activeId === 'figure'} font={f.static_layout?.font || f.style?.font || group.style?.font || template.layout_options?.theme_config?.font || 'Songti SC'} size={f.static_layout?.font_size || body.size} onSelect={() => { select(); activate('figure'); }} onChange={table => onChange(group.id, f.id, { table })} />
                    : coverGroupCanFlow(group) && coverCanEditInline(f) && !readOnly ? <CoverInlineEditor field={run?.field || f} labelBold={template.layout_options?.theme_config?.label_weight !== 'regular'} sources={sources} onChange={text => run ? onChangeRun?.(run, text) : onChange(group.id, f.id, { text })}
                      onInsertField={onInsertConfiguredField ? split => configureNewField(group.id, f.id, run || canSplitCoverText(f) ? split : undefined) : undefined}
                      onBoundary={direction => navigate(group.id, f.id, direction)}
                      onDeleteBoundary={(direction, paragraphIndex) => deleteBlank(group.id, f.id, paragraphIndex ?? 0, direction)}
                      focusRequest={focus?.field === f.id ? { ...focus, onApplied: () => setFocus(null) } : undefined}
                      onInsert={onInsertAtText && (run || canSplitCoverText(f)) ? (kind, value, _offset, split, options) => {
                        if (!split) return;
                        if (kind === 'image' && onInsertLogo) { chooseLogo(group.id, f.id, { value, ...split }); return; }
                        const id = onInsertAtText(group.id, f.id, { value, ...split }, kind === 'image' ? 'logo' : 'table', { rows: options?.rows ?? 3, columns: options?.columns ?? 3 });
                        if (id) { setSelected({ group: group.id, field: id }); activate('figure'); }
                      } : undefined} />
                    : mode === 'text' && !f.cover_configured_field && !f.cover_text_styles && (coverGroupCanFlow(group) || readOnly) ? <ReportRichText value={f.rich ? resolve(f) : coverStaticTextValue(f)} />
                    : ['text', 'textarea', 'number', 'date', 'daterange', 'select'].includes(f.type) ? <CoverLegacyText onBoundary={direction => navigate(group.id, f.id, direction)} onContinue={onContinueFigure && coverGroupCanFlow(group) ? direction => continueFigure(group.id, f.id, direction) : undefined} focusRequest={focus?.field === f.id ? { ...focus, onApplied: () => setFocus(null) } : undefined} field={f} group={group} theme={template.layout_options?.theme_config} readOnly={readOnly} resolve={resolve} host={host} active={selectedField?.id === f.id && activeId === 'figure'} onSelect={() => { select(); activate('figure'); }} onChange={change => onChange(group.id, f.id, change)} onConfigure={() => { select(); onConfigure('field', f.code); }} />
                      : <Button type="text" onClick={() => onConfigure('field', f.code)}>{f.label || '内容'} · 配置</Button>}
                </div>;
              })}</div>)}
            </div>}
        </section>; })}
      </div></div></div>
      {onFormatSelection && <CoverMultiSelectionToolbar paper={paper} host={host} template={template} readOnly={readOnly} active={activeId === 'cover-multi'} activate={() => activate('cover-multi')} onChange={onFormatSelection} />}
      <Drawer title="添加字段" size={520} open={!!fieldDraft} onClose={() => setFieldDraft(null)} footer={<Space>
        <Button onClick={() => setFieldDraft(null)}>取消</Button>
        <Button type="primary" disabled={readOnly || !fieldDraft} onClick={() => {
          if (readOnly || !fieldDraft) return;
          if (latest.current.template !== fieldDraft.snapshot) { message.warning('正文已变化，请重新选择插入位置'); return; }
          const id = onInsertConfiguredField?.(fieldDraft.groupId, fieldDraft.afterId, fieldDraft.field, fieldDraft.split);
          if (id) { setSelected({ group: fieldDraft.groupId, field: id }); activate('figure'); setFieldDraft(null); }
        }}>添加到正文</Button>
      </Space>}>
        {fieldDraft && <DndProvider backend={HTML5Backend}><fieldset disabled={readOnly} style={{ border: 0, padding: 0, minWidth: 0 }}><FieldPropsPanel editorMode="report-cover" field={fieldDraft.field}
          template={{ ...template, groups: template.groups.map(g => g.id === fieldDraft.groupId ? { ...g, fields: [...g.fields, fieldDraft.field] } : g) }}
          onChange={patch => { if (!readOnly) setFieldDraft(draft => draft && ({ ...draft, field: { ...draft.field, ...patch } })); }}
          onReplaceField={field => { if (!readOnly) setFieldDraft(draft => draft && ({ ...draft, field })); }}
        /></fieldset></DndProvider>}
      </Drawer>
      <Drawer title={field?.label ? `${field.label} · 数据来源` : '数据来源'} open={!!field && !!bindingTarget} onClose={() => setBindingTarget(null)} size={420}>
        {field?.binding && bindingTarget && <Space orientation="vertical" style={{ width: '100%' }}>
          {readOnly ? <p>当前只读，开始编辑后可修改数据来源。</p> : <BindingEditor value={field.binding} onChange={binding => onChange(bindingTarget.group, bindingTarget.field, { binding })} />}
          <Button onClick={() => { onConfigure('field', field.code); setBindingTarget(null); }}>更多字段设置</Button>
        </Space>}
      </Drawer>
    </div>
  </ReportToolbarContext.Provider></ReportInsertionContext.Provider>;
}
