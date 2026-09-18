import { useEffect, useMemo, useState, useRef } from 'react';
import { revealInScrollPanes } from '../../utils/scrollWithin';
import { Alert, Button, Dropdown, Empty, Select, Space, message } from 'antd';
import { generateTypstWithData, flattenDataForDisplay, recordFreeGridSnapshot, type ReportRenderCtx } from '../../../../shared/typst-generator';
import type { RecordTemplate } from '../../../../shared/types';
import { serializeSpreadsheetClipboard } from '../../utils/spreadsheetClipboard';
import { expandEntryRange } from '../../../../shared/free-grid-entry-structure';
import TypstViewer from '../TypstViewer';
import type { ReportTableData } from '../../../../shared/report-document-editing';
import { recordMatrixSnapshot } from '../../../../shared/record-matrix-snapshot';
import { reportRichPlainText } from '../../../../shared/report-rich-document';
import { findImageCollection, imageCollectionFromLegacy } from '../../../../shared/image-collection';
import { copyReportPhoto, REPORT_PHOTO_MIME } from '../../utils/reportPhotoClipboard';

type Source = { name?: string; title?: string; ctx: ReportRenderCtx };
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
type Props = { sources: Source[]; target?: { index: number; code?: string; token: number }; readOnly?: boolean; onInsert?: (data: ReportTableData) => void; reviews?: Array<{ index: number; code: string; reviewed: boolean }>; onReview?: (index: number, code: string, reviewed: boolean) => void; pdf?: boolean };
function SourceTable({ sources, target, readOnly, reviews, onReview }: Props) {
  const [sourceIndex, setSourceIndex] = useState(0), [fieldCode, setFieldCode] = useState<string>();
  const [pdf, setPdf] = useState(false);
  const [selection, setSelection] = useState<{ minR: number; maxR: number; minC: number; maxC: number } | null>(null);
  const [anchor, setAnchor] = useState<[number, number] | null>(null);
  useEffect(() => { if (target && sources[target.index]) { setSourceIndex(target.index); setFieldCode(target.code); setSelection(null); setAnchor(null); setPdf(false); } }, [target?.token]);
  const source = sources[sourceIndex] || sources[0];
  const template = source?.ctx?.linked_record_template as RecordTemplate | undefined;
  const raw = source?.ctx?.record_raw_data;
  const fields = template?.groups.flatMap(group => group.fields).filter(field => field.type === 'free_grid' || field.type === 'data_matrix') || [];
  const field = fields.find(field => field.code === fieldCode) || fields[0];
  const review = reviews?.find(item => item.index === sourceIndex && item.code === field?.code);
  const projection = useMemo(() => {
    try { return { table: field && raw ? field.type === 'data_matrix' ? recordMatrixSnapshot(field, template!, raw) : recordFreeGridSnapshot(field, raw[field.code] || {}, source.ctx) : null, error: '' }; }
    catch { return { table: null, error: '该表格快照无法解析，请查看完整原始记录。' }; }
  }, [field, raw, source]);
  const table = projection.table;
  const preview = useMemo(() => {
    try { return { source: pdf && template && raw ? generateTypstWithData(template, raw) : '', error: '' }; }
    catch { return { source: '', error: '原始记录快照预览失败，不影响报告编辑。' }; }
  }, [pdf, template, raw]);
  if (!template || !raw) return <div style={{ padding: 10 }}>
    {!!sources.length && <Select aria-label="原始数据项目" style={{ width: '100%' }} value={sourceIndex} options={sources.map((s, index) => ({ value: index, label: `${index + 1}. ${s.title || s.name || '项目'}` }))} onChange={index => { setSourceIndex(index); setSelection(null); setFieldCode(undefined); }} />}
    <Empty description="此项目未保存可查看的原始数据快照，不会自动替换成最新记录。" />
  </div>;
  const covered = new Set<string>();
  if (table) for (const [key, span] of Object.entries(table.spans || {})) {
    const [row, col] = key.split('::'), r = table.rows.findIndex(rowDef => rowDef.id === row), c = table.columns.findIndex(colDef => colDef.id === col);
    for (let dr = 0; dr < (span.rowspan || 1); dr++) for (let dc = 0; dc < (span.colspan || 1); dc++) if (dr || dc) covered.add(`${r + dr},${c + dc}`);
  }
  const range = selection && table ? expandEntryRange(table, selection) : null;
  const clipboard = (all = false) => {
    if (!table) return null;
    const area = all ? { minR: 0, maxR: table.rows.length - 1, minC: 0, maxC: table.columns.length - 1 } : range;
    if (!area) return null;
    const rows: string[][] = [], html: string[] = [];
    for (let r = area.minR; r <= area.maxR; r++) {
      const values: string[] = [], tags: string[] = [];
      for (let c = area.minC; c <= area.maxC; c++) {
        const key = `${table.rows[r].id}::${table.columns[c].id}`, value = table.cells[key] || '';
        values.push(covered.has(`${r},${c}`) ? '' : value);
        if (!covered.has(`${r},${c}`)) { const span = table.spans?.[key]; tags.push(`<td rowspan="${span?.rowspan || 1}" colspan="${span?.colspan || 1}">${escape(value).replace(/\n/g, '<br>')}</td>`); }
      }
      rows.push(values); html.push(`<tr>${tags.join('')}</tr>`);
    }
    return { text: serializeSpreadsheetClipboard(rows), html: `<table>${html.join('')}</table>` };
  };
  const copy = async (all: boolean) => {
    const data = clipboard(all); if (!data) return;
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([data.text], { type: 'text/plain' }), 'text/html': new Blob([data.html], { type: 'text/html' }) })]);
      else await navigator.clipboard.writeText(data.text);
      message.success('已复制，可粘贴到左侧报告');
    } catch { message.warning('浏览器未允许复制，请选中表格后按 Ctrl/Cmd+C'); }
  };
  return <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
    {pdf ? preview.error ? <Alert type="error" message={preview.error} /> : <TypstViewer source={preview.source} mode="view" height="100%" /> : <>
      {projection.error && <Alert type="error" message={projection.error} />}
      <Space wrap style={{ padding: '0 10px 10px' }}>
        <span style={{ fontWeight: 600 }}>{field?.label}</span>
        {review && <Button disabled={readOnly || !onReview} title="确认已检查此表的新增内容是否需要补入报告；核对状态随报告保存，复制或插入不会自动确认。" onClick={() => onReview?.(sourceIndex, field!.code, !review.reviewed)}>{review.reviewed ? '已核对 · 撤销核对' : '标记已核对'}</Button>}
      </Space>
      {table && (table.rows.some(row => row.entry_added) || table.columns.some(col => col.entry_added)) && <Alert type={review?.reviewed ? 'info' : 'warning'} showIcon message={review?.reviewed ? '橙色行列为录入时新增内容 · 已核对' : '橙色行列为录入时新增内容，可能未自动带入报告。'} />}
      {!table ? <Empty description="没有可复制的表格，可查看完整原始记录。" /> : <Dropdown trigger={['contextMenu']} menu={{ items: [{ key: 'copy', label: '复制', disabled: !range }, { key: 'paste', label: '粘贴（原始数据只读）', disabled: true }], onClick: ({ key }) => { if (key === 'copy') void copy(false); } }}><div tabIndex={0} aria-label="原始数据表格" style={{ overflow: 'auto', flex: 1, outline: 'none', padding: 10 }}
        onCopy={event => { const data = clipboard(); if (data) { event.preventDefault(); event.clipboardData.setData('text/plain', data.text); event.clipboardData.setData('text/html', data.html); } }} onPointerUp={() => setAnchor(null)} onPointerLeave={() => setAnchor(null)}>
        <table style={{ borderCollapse: 'collapse', minWidth: '100%', userSelect: 'none' }}><tbody>{table.rows.map((row, r) => <tr key={row.id}>{table.columns.map((col, c) => {
          if (covered.has(`${r},${c}`)) return null;
          const key = `${row.id}::${col.id}`, span = table.spans?.[key];
          const selected = range && r >= range.minR && r <= range.maxR && c >= range.minC && c <= range.maxC;
          const select = (a: [number, number]) => setSelection({ minR: Math.min(a[0], r), maxR: Math.max(a[0], r), minC: Math.min(a[1], c), maxC: Math.max(a[1], c) });
          return <td key={col.id} rowSpan={span?.rowspan} colSpan={span?.colspan} onContextMenu={event => { window.getSelection()?.removeAllRanges(); if (!selected) select([r, c]); setAnchor(null); event.currentTarget.closest<HTMLElement>('[tabindex]')?.focus(); }} onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); window.getSelection()?.removeAllRanges(); event.currentTarget.closest<HTMLElement>('[tabindex]')?.focus(); setAnchor([r, c]); select([r, c]); }} onPointerEnter={event => { if (anchor && event.buttons === 1) select(anchor); }}
            style={{ border: '1px solid #cbd5e1', padding: '7px 10px', minWidth: 80, whiteSpace: 'pre-wrap', background: selected ? '#dbeafe' : row.entry_added || col.entry_added ? '#fff1d6' : 'white' }}>{table.cells[key]}</td>;
        })}</tr>)}</tbody></table>
      </div></Dropdown>}
    </>}
  </div>;
}

const sourceText = (value: any): string => {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(sourceText).filter(Boolean).join('、');
  if (typeof value === 'object') {
    if ('custom' in value) return sourceText(value.custom);
    return Object.entries(value).filter(([key]) => !key.startsWith('__')).map(([, item]) => sourceText(item)).filter(Boolean).join('\n');
  }
  return String(value);
};
function SourcePhoto({ photo, title }: { photo: any; title: string }) {
  const candidate = photo?.url || photo?.server_path || (photo?.rel_path ? `/api/template-assets/file?p=${encodeURIComponent(photo.rel_path)}` : undefined);
  const src = typeof candidate === 'string' && /^(https?:\/\/|\/)/i.test(candidate) ? candidate : undefined;
  const copy = () => copyReportPhoto({ ...photo, url: src }, title);
  return <figure style={{ margin: '10px 0' }}>{title && <figcaption style={{ whiteSpace: 'pre-wrap' }}>{title}</figcaption>}{src ? <Dropdown trigger={['contextMenu']} menu={{ items: [{ key: 'copy', label: '复制图片' }], onClick: async () => {
    try { const value = copy(); await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([value.html], { type: 'text/html' }), 'text/plain': new Blob([value.text], { type: 'text/plain' }) })]); }
    catch { message.info('浏览器未允许复制，请选中图片后按 Ctrl/Cmd+C'); }
  } }}><div tabIndex={0} role="button" aria-label={`选择原始图片：${title}`} className="report-source-photo" style={{ width: 'fit-content', maxWidth: '100%', cursor: 'pointer' }}
    onClick={event => { window.getSelection()?.removeAllRanges(); event.currentTarget.focus(); }}
    onContextMenu={event => { window.getSelection()?.removeAllRanges(); event.currentTarget.focus(); }}
    onCopy={event => { const value = copy(); event.preventDefault(); event.stopPropagation(); event.clipboardData.setData(REPORT_PHOTO_MIME, value.token); event.clipboardData.setData('text/html', value.html); event.clipboardData.setData('text/plain', value.text); }}>
    <img src={src} alt={title || '原始记录图片'} draggable={false} style={{ display: 'block', maxWidth: '100%', maxHeight: 300, objectFit: 'contain' }} />
  </div></Dropdown> : <span style={{ color: '#94a3b8' }}>未提供可预览图片</span>}</figure>;
}

/** Entire immutable record, with native selectable text and independently selectable tables. */
export default function ReportSourceDataPanel(props: Props) {
  const [index, setIndex] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (props.target && props.sources[props.target.index]) setIndex(props.target.index); }, [props.target?.token]);
  const source = props.sources[index] || props.sources[0];
  const template = source?.ctx?.linked_record_template as RecordTemplate | undefined;
  const raw = source?.ctx?.record_raw_data;
  const display = useMemo(() => {
    if (!template || !raw) return {};
    try { return flattenDataForDisplay(template, raw); } catch { return raw; }
  }, [template, raw]);
  const preview = useMemo(() => {
    try { return { source: props.pdf && template && raw ? generateTypstWithData(template, raw) : '', error: '' }; }
    catch { return { source: '', error: '原始记录预览失败，可切回原始数据查看。' }; }
  }, [props.pdf, template, raw]);
  useEffect(() => {
    if (props.target?.index !== index || !props.target.code) return;
    revealInScrollPanes([...(bodyRef.current?.querySelectorAll<HTMLElement>('[data-source-field]') || [])].find(node => node.dataset.sourceField === props.target?.code));
  }, [index, props.target?.token, props.pdf]);
  return <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
    <div style={{ padding: '10px 12px', background: '#f4f7fb', borderBottom: '1px solid #e2e8f0' }}>
      <Select aria-label="原始数据项目" style={{ width: '100%' }} value={index} options={props.sources.map((s, i) => ({ value: i, label: `${i + 1}. ${s.title || s.name || '项目'}` }))} onChange={setIndex} />
      <div style={{ marginTop: 6, color: '#64748b', fontSize: 12 }}>报告生成时的记录 · 只读{!props.pdf && ' · 文字可拖选复制，表格可框选后 Ctrl/Cmd+C'}</div>
    </div>
    {!template || !raw ? <Empty description="此项目未保存可查看的原始数据快照，不会自动替换成最新记录。" /> : <>
      <div style={{ display: props.pdf ? 'flex' : 'none', flex: 1, minHeight: 0 }}>{props.pdf && (preview.error ? <Alert type="error" message={preview.error} /> : <TypstViewer source={preview.source} mode="view" height="100%" />)}</div>
      <div ref={bodyRef} aria-label="可复制原始记录" style={{ display: props.pdf ? 'none' : 'block', overflow: 'auto', flex: 1, padding: 16, userSelect: 'text' }}
        onCopyCapture={event => { if (!window.getSelection()?.isCollapsed && window.getSelection()?.toString()) event.stopPropagation(); }}>
        <h3 style={{ margin: '0 0 16px' }}>{template.name}</h3>
        {template.groups.map(group => <section key={group.id} style={{ marginBottom: 24 }}>
          {!group.hide_title && group.label && <div style={{ borderBottom: '1px solid #e2e8f0', color: '#475569', paddingBottom: 6, marginBottom: 12 }}>{group.label}</div>}
          {group.fields.map(field => {
            if (field.type === 'image') {
              if (group.fields.find(f => f.type === 'image')?.id !== field.id) return null;
              const collection = findImageCollection(raw, group) || imageCollectionFromLegacy(group, raw);
              return <div key={field.id}>{collection.items.map(item => <SourcePhoto key={item.id} photo={item.photo} title={item.title} />)}</div>;
            }
            if (field.type === 'static_content' && field.static_kind === 'images') return <div key={field.id}>{field.static_images?.map(item => <SourcePhoto key={item.id} photo={item} title={item.title || item.name || field.label} />)}</div>;
            if (field.type === 'static_content' && !field.static_kind && field.static_content?.length) return <div key={field.id}>{field.static_content.map(item => item.kind === 'image' ? <SourcePhoto key={item.id} photo={item} title={item.name || field.label} /> : <div key={item.id} style={{ whiteSpace: 'pre-wrap', marginBottom: 10 }}>{item.text}</div>)}</div>;
            if (field.type === 'spacer') return <div key={field.id} style={{ height: 12 }} />;
            const review = props.reviews?.find(item => item.index === index && item.code === field.code);
            if (field.type === 'free_grid' || field.type === 'data_matrix' || field.static_table) {
              const projected = field.static_table ? { ...field, type: 'free_grid' as const, free_table: field.static_table } : field;
              const tableSource = { ...source, ctx: { ...source.ctx, linked_record_template: { ...template, groups: template.groups.map(g => ({ ...g, fields: g.fields.map(f => f.code === field.code ? projected : f) })) } } };
              return <div key={`${index}/${field.id}`} data-source-field={field.code} style={{ margin: '14px 0' }}><SourceTable sources={[tableSource]} target={{ index: 0, code: field.code, token: props.target?.token || 1 }} readOnly={props.readOnly} onInsert={props.onInsert}
                reviews={review ? [{ ...review, index: 0 }] : []} onReview={(_, code, checked) => props.onReview?.(index, code, checked)} /></div>;
            }
            const value = field.type === 'static_content' ? field.static_text ?? field.static_content?.map(item => item.text || item.name || '').join('\n') : display[field.code] ?? raw[field.code] ?? source.ctx.record_flat_data?.[field.code] ?? field.default_value;
            const text = field.rich && typeof value === 'string' ? reportRichPlainText(value) : sourceText(value);
            return <div key={field.id} data-source-field={field.code} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.8, marginBottom: 10 }}>{!field.hide_label && field.label ? `${field.label}：` : ''}{text}</div>;
          })}
        </section>)}
      </div>
    </>}
  </div>;
}
