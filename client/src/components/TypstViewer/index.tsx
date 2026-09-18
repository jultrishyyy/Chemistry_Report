import { useEffect, useState, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import axios from 'axios';
import MonacoTypstEditor from './MonacoEditor';
import PdfPreview, { type PdfPointHighlight, type PdfPreviewApi } from './PdfPreview';
import { compileTypst } from './typst-compiler';

export interface TypstViewerProps {
  source: string;
  data?: Record<string, any>;
  mode?: 'view' | 'edit' | 'split';
  onChange?: (source: string) => void;
  height?: string;
  debounceMs?: number;
  /** 开启「编辑器 ⇄ PDF 双向跳转」：编译后取回 <__fepos__> 位置标记 */
  enableSync?: boolean;
  /** Ctrl/⌘ + 点击 PDF：回调最近的上方标记（反向跳转） */
  onMarkerClick?: (marker: PosMarker) => void;
  /** 下载渲染后 PDF 的文件名（缺省 document.pdf）。预览区右上角出现「下载 PDF」按钮。传 null 隐藏按钮。 */
  downloadName?: string | null;
  /** Instances may save and download the persisted server document instead. */
  onDownload?: () => Promise<void>;
}

export interface PosMarker {
  kind: 'group' | 'field';
  code: string;
  page: number;
  y: number; // pt
}

export interface TypstViewerHandle {
  /** 正向跳转：按字段 code（回退分区 id）滚动 PDF 到对应位置 */
  scrollToMarker: (fieldCode: string, groupId?: string, highlight?: PdfPointHighlight) => void;
  /** 左侧取消选中字段时，同步清除 PDF 的持续定位标记。 */
  clearMarkerHighlight: () => void;
}

const BLOCK_FIELD_TYPES = new Set([
  'data_matrix', 'free_grid', 'image',
  'report_result_table', 'report_equipment_table', 'report_sample_table',
  'report_conclusion_table', 'report_photo_table', 'report_image_gallery', 'report_sample_description_table',
]);

/** 编辑器统一把字段类型翻译成 PDF 定位样式：图表只标起点，普通字段显示浅色范围。 */
export function markerHighlightForField(field?: { label?: string; type?: string } | null): PdfPointHighlight {
  return {
    label: field?.label ? `当前：${field.label}` : '当前编辑字段',
    mode: field?.type && BLOCK_FIELD_TYPES.has(field.type) ? 'block' : 'text',
  };
}

function injectData(source: string, data?: Record<string, any>): string {
  if (!data || Object.keys(data).length === 0) return source;

  const preamble = Object.entries(data)
    .map(([k, v]) => `#let ${k} = ${toTypstValue(v)}`)
    .join('\n');

  return `${preamble}\n\n${source}`;
}

function toTypstValue(v: any): string {
  if (v === null || v === undefined) return 'none';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  if (Array.isArray(v)) return `(${v.map(toTypstValue).join(', ')})`;
  if (typeof v === 'object') {
    const entries = Object.entries(v).map(([k, val]) => `${k}: ${toTypstValue(val)}`);
    return `(${entries.join(', ')})`;
  }
  return 'none';
}

const TypstViewer = forwardRef<TypstViewerHandle, TypstViewerProps>(function TypstViewer({
  source,
  data,
  mode = 'split',
  onChange,
  height = '600px',
  // 图片尺寸/旋转等可视版式调整需要尽快反映；180ms 仍能合并连续文字输入。
  debounceMs = 180,
  enableSync = false,
  onMarkerClick,
  downloadName = 'document.pdf',
  onDownload,
}, ref) {
  const [pdfUrl, setPdfUrl] = useState<string>('');
  useEffect(() => () => { if (pdfUrl.startsWith('blob:')) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);
  const [error, setError] = useState<string | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [compiledSource, setCompiledSource] = useState<string | null>(null);
  const finalSource = injectData(source, data);
  const latestSourceRef = useRef(finalSource);
  latestSourceRef.current = finalSource;
  const previewPending = compiling || compiledSource !== finalSource;
  // 输入连续变更时会同时存在多次编译；只允许最后一次请求写入预览，
  // 否则早先的空值 PDF 晚返回会把刚选中的下拉值覆盖掉。
  const compileSequenceRef = useRef(0);
  const markersRef = useRef<PosMarker[]>([]);
  const pdfApiRef = useRef<PdfPreviewApi | null>(null);
  const activeMarkerFocusRef = useRef<{
    fieldCode: string;
    groupId?: string;
    highlight?: PdfPointHighlight;
    pendingScroll: boolean;
  } | null>(null);
  const onMarkerClickRef = useRef(onMarkerClick);
  onMarkerClickRef.current = onMarkerClick;

  const applyMarkerFocus = useCallback((focus: NonNullable<typeof activeMarkerFocusRef.current>, scroll: boolean) => {
    const ms = markersRef.current;
    const m = ms.find(x => x.kind === 'field' && x.code === focus.fieldCode)
      ?? (focus.groupId ? ms.find(x => x.kind === 'group' && x.code === focus.groupId) : undefined);
    if (!m || !pdfApiRef.current) return false;
    const next = ms
      .filter(x => x.page === m.page && x.y > m.y + 2)
      .sort((a, b) => a.y - b.y)[0];
    const visual: PdfPointHighlight = {
      mode: m.kind === 'group' ? 'group' : 'text',
      heightPt: next ? next.y - m.y : undefined,
      ...focus.highlight,
    };
    if (scroll) pdfApiRef.current?.scrollToPdfPoint(m.page, m.y, visual);
    else pdfApiRef.current?.highlightPdfPoint(m.page, m.y, visual);
    return true;
  }, []);

  const doCompile = useCallback(async (finalSrc: string, sequence: number, signal: AbortSignal) => {
    const current = () => !signal.aborted && sequence === compileSequenceRef.current && latestSourceRef.current === finalSrc;
    try {
      const url = await compileTypst(finalSrc, signal);
      if (!current()) { URL.revokeObjectURL(url); return; }
      setPdfUrl(url);
      setCompiledSource(finalSrc);
      setError(null);
      if (enableSync) {
        // 与编译同一 source 查询位置标记；失败仅降级跳转功能，不影响预览
        try {
          const res = await axios.post('/api/typst/query', { source: finalSrc }, { signal, headers: { 'X-Preview-Request': '1' } });
          if (!current()) return;
          markersRef.current = res.data?.markers || [];
          const active = activeMarkerFocusRef.current;
          if (active) {
            const found = applyMarkerFocus(active, active.pendingScroll);
            if (found) active.pendingScroll = false;
          }
        } catch {
          if (!current()) return;
          markersRef.current = [];
        }
      }
    } catch (e: any) {
      if (!current()) return;
      const msg = e.response?.data?.message || e.message || 'Compilation failed';
      setError(msg);
    } finally {
      if (current()) setCompiling(false);
    }
  }, [enableSync, applyMarkerFocus]);

  useEffect(() => {
    // Invalidate immediately, including the debounce window and component teardown.
    const sequence = ++compileSequenceRef.current;
    const controller = new AbortController();
    setCompiling(true);
    setError(null);
    markersRef.current = [];
    pdfApiRef.current?.clearHighlight();
    const timer = setTimeout(() => doCompile(finalSource, sequence, controller.signal), debounceMs);
    return () => { clearTimeout(timer); ++compileSequenceRef.current; controller.abort(); };
  }, [finalSource, debounceMs, doCompile]);

  useImperativeHandle(ref, () => ({
    scrollToMarker: (fieldCode: string, groupId?: string, highlight?: PdfPointHighlight) => {
      const focus = { fieldCode, groupId, highlight, pendingScroll: true };
      activeMarkerFocusRef.current = focus;
      if (applyMarkerFocus(focus, true)) focus.pendingScroll = false;
    },
    clearMarkerHighlight: () => {
      activeMarkerFocusRef.current = null;
      pdfApiRef.current?.clearHighlight();
    },
  }), [applyMarkerFocus]);

  // 反向跳转：Ctrl/⌘ + 点击 → 同页中点击点上方最近的标记（无则取该页第一个 / 前页最后一个）
  const handlePdfClick = useCallback((page: number, _xPt: number, yPt: number, ev: MouseEvent) => {
    if (!ev.ctrlKey && !ev.metaKey) return;
    const ms = markersRef.current;
    if (!ms.length) return;
    let best: PosMarker | null = null;
    for (const m of ms) {
      if (m.page > page || (m.page === page && m.y > yPt + 2)) continue; // 只看点击点之前的标记
      if (!best || m.page > best.page || (m.page === best.page && m.y >= best.y)) best = m;
    }
    if (best) {
      const next = ms
        .filter(x => x.page === best!.page && x.y > best!.y + 2)
        .sort((a, b) => a.y - b.y)[0];
      pdfApiRef.current?.highlightPdfPoint(best.page, best.y, {
        mode: best.kind === 'group' ? 'group' : 'text',
        heightPt: next ? next.y - best.y : undefined,
      });
      activeMarkerFocusRef.current = {
        fieldCode: best.kind === 'field' ? best.code : '',
        groupId: best.kind === 'group' ? best.code : undefined,
        pendingScroll: false,
      };
      onMarkerClickRef.current?.(best);
    }
  }, []);

  // 下载渲染后的 PDF（用 compile 得到的 blob URL；下载文件名给一个 ASCII 兜底 + 真实名）。
  const downloadBtn = (pdfUrl && !error && !previewPending && downloadName !== null) ? (
    <a href={pdfUrl} download={downloadName || 'document.pdf'} title="下载渲染后的 PDF"
      onClick={onDownload ? event => { event.preventDefault(); void onDownload(); } : undefined}
      style={{
        position: 'absolute', top: 4, right: 8, zIndex: 11,
        fontSize: 12, lineHeight: 1, padding: '4px 10px', borderRadius: 4,
        background: '#1677ff', color: '#fff', textDecoration: 'none',
        boxShadow: '0 1px 4px rgba(16,24,40,0.2)', whiteSpace: 'nowrap',
      }}>⬇ 下载 PDF</a>
  ) : null;

  const renderPdf = () => {
    if (error) {
      return (
        <div style={{ height, overflow: 'auto', padding: 16, background: '#fff2f0', border: '1px solid #ffccc7', fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap', color: '#cf1322' }}>
          {error}
        </div>
      );
    }
    return (
      <PdfPreview
        url={pdfUrl}
        height={height}
        apiRef={pdfApiRef}
        onApiReady={() => {
          const focus = activeMarkerFocusRef.current;
          if (focus && applyMarkerFocus(focus, focus.pendingScroll)) focus.pendingScroll = false;
        }}
        onPdfClick={enableSync ? handlePdfClick : undefined}
        onHighlightClear={() => { activeMarkerFocusRef.current = null; }}
      />
    );
  };

  if (mode === 'view') {
    // height 落到外层容器：height="100%" 等百分比值需有定高父级才能解析（否则预览塌缩成 0、不滚动/不渲染）。
    return (
      <div style={{ position: 'relative', height }}>
        {previewPending && !error && <div role="status" style={{ position: 'absolute', top: 8, right: 12, zIndex: 10, fontSize: 12, padding: '4px 8px', background: '#fffbe6', color: '#874d00' }}>PDF 更新中{pdfUrl ? '，当前显示上一版' : ''}…</div>}
        {downloadBtn}
        {renderPdf()}
      </div>
    );
  }

  if (mode === 'edit') {
    return (
      <MonacoTypstEditor
        value={source}
        onChange={(v) => onChange?.(v)}
        height={height}
      />
    );
  }

  return (
    <div style={{ display: 'flex', height, gap: 1 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <MonacoTypstEditor
          value={source}
          onChange={(v) => onChange?.(v)}
          height={height}
        />
      </div>
      <div style={{ flex: 1, minWidth: 0, position: 'relative', borderLeft: '1px solid #d9d9d9' }}>
        {previewPending && !error && <div role="status" style={{ position: 'absolute', top: 8, right: 12, zIndex: 10, fontSize: 12, padding: '4px 8px', background: '#fffbe6', color: '#874d00' }}>PDF 更新中{pdfUrl ? '，当前显示上一版' : ''}…</div>}
        {downloadBtn}
        {renderPdf()}
      </div>
    </div>
  );
});

export default TypstViewer;
