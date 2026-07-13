import { useEffect, useState, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { debounce } from 'lodash';
import axios from 'axios';
import MonacoTypstEditor from './MonacoEditor';
import PdfPreview, { type PdfPreviewApi } from './PdfPreview';
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
}

export interface PosMarker {
  kind: 'group' | 'field';
  code: string;
  page: number;
  y: number; // pt
}

export interface TypstViewerHandle {
  /** 正向跳转：按字段 code（回退分区 id）滚动 PDF 到对应位置 */
  scrollToMarker: (fieldCode: string, groupId?: string) => void;
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
  debounceMs = 500,
  enableSync = false,
  onMarkerClick,
  downloadName = 'document.pdf',
}, ref) {
  const [pdfUrl, setPdfUrl] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [compiling, setCompiling] = useState(false);
  const markersRef = useRef<PosMarker[]>([]);
  const pdfApiRef = useRef<PdfPreviewApi | null>(null);
  const onMarkerClickRef = useRef(onMarkerClick);
  onMarkerClickRef.current = onMarkerClick;

  const doCompile = useCallback(async (src: string, payload?: Record<string, any>) => {
    setCompiling(true);
    try {
      const finalSrc = injectData(src, payload);
      const url = await compileTypst(finalSrc);
      setPdfUrl(url);
      setError(null);
      if (enableSync) {
        // 与编译同一 source 查询位置标记；失败仅降级跳转功能，不影响预览
        try {
          const res = await axios.post('/api/typst/query', { source: finalSrc });
          markersRef.current = res.data?.markers || [];
        } catch {
          markersRef.current = [];
        }
      }
    } catch (e: any) {
      const msg = e.response?.data?.message || e.message || 'Compilation failed';
      setError(msg);
    } finally {
      setCompiling(false);
    }
  }, [enableSync]);

  const debouncedCompile = useRef(
    debounce((src: string, payload?: Record<string, any>) => {
      doCompile(src, payload);
    }, debounceMs)
  ).current;

  useEffect(() => {
    debouncedCompile(source, data);
    return () => debouncedCompile.cancel();
  }, [source, data, debouncedCompile]);

  useImperativeHandle(ref, () => ({
    scrollToMarker: (fieldCode: string, groupId?: string) => {
      const ms = markersRef.current;
      const m = ms.find(x => x.kind === 'field' && x.code === fieldCode)
        ?? (groupId ? ms.find(x => x.kind === 'group' && x.code === groupId) : undefined);
      if (m) pdfApiRef.current?.scrollToPdfPoint(m.page, m.y);
    },
  }), []);

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
    if (best) onMarkerClickRef.current?.(best);
  }, []);

  // 下载渲染后的 PDF（用 compile 得到的 blob URL；下载文件名给一个 ASCII 兜底 + 真实名）。
  const downloadBtn = (pdfUrl && !error && downloadName !== null) ? (
    <a href={pdfUrl} download={downloadName || 'document.pdf'} title="下载渲染后的 PDF"
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
        onPdfClick={enableSync ? handlePdfClick : undefined}
      />
    );
  };

  if (mode === 'view') {
    // height 落到外层容器：height="100%" 等百分比值需有定高父级才能解析（否则预览塌缩成 0、不滚动/不渲染）。
    return (
      <div style={{ position: 'relative', height }}>
        {compiling && <div style={{ position: 'absolute', top: 8, right: 110, zIndex: 10, fontSize: 12, color: '#1890ff' }}>编译中...</div>}
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
        {compiling && <div style={{ position: 'absolute', top: 8, right: 110, zIndex: 10, fontSize: 12, color: '#1890ff' }}>编译中...</div>}
        {downloadBtn}
        {renderPdf()}
      </div>
    </div>
  );
});

export default TypstViewer;
