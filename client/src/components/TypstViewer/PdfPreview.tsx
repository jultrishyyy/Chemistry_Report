/**
 * PdfPreview — pdfjs 画布渲染（替代 iframe）。
 *
 * 为什么不用 iframe：blob URL 一变 iframe 整页重载，滚动位置永远回到顶部。
 * 画布方案：重编译后在同一个滚动容器里换画布（双缓冲：新页渲染完一次性替换），
 * scrollTop 原样保留——改字段后预览停在原位。
 *
 * 同时为「编辑器 ⇄ PDF 双向跳转」提供两个原语：
 *  - apiRef.scrollToPdfPoint(page, yPt)：滚动到某页某 pt 纵坐标（正向跳转）
 *  - onPdfClick(page, xPt, yPt, ev)：点击画布回调 PDF 坐标（反向跳转，调用方判断 Ctrl）
 */
import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Button, Space, Tooltip } from 'antd';
import { ColumnWidthOutlined, ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export interface PdfPreviewApi {
  /** 滚动到第 page 页、距页顶 yPt（pt，与 typst query 的 y 同单位） */
  scrollToPdfPoint: (page: number, yPt: number, highlight?: PdfPointHighlight) => void;
  /** 只更新定位高亮，不改变当前滚动位置（PDF 反向点选时使用）。 */
  highlightPdfPoint: (page: number, yPt: number, highlight?: PdfPointHighlight) => void;
  clearHighlight: () => void;
}

export interface PdfPointHighlight {
  label?: string;
  /** text＝浅框住字段附近；block＝只标出图片/表格块起点；group＝分区锚点。 */
  mode?: 'text' | 'block' | 'group';
  /** 字段到下一个位置标记的估算高度；最终仍会限高，避免整张图表被遮罩。 */
  heightPt?: number;
}

interface PdfPreviewProps {
  url: string;
  height: string;
  /** 点击画布：回调 (页码1起, xPt, yPt, 原生事件)。Ctrl/Cmd 判断交给调用方 */
  onPdfClick?: (page: number, xPt: number, yPt: number, ev: MouseEvent) => void;
  /** 用户通过普通点击 / Esc 主动取消定位时通知外层清理当前 marker。 */
  onHighlightClear?: () => void;
  apiRef?: React.MutableRefObject<PdfPreviewApi | null>;
  onApiReady?: () => void;
}

const PAGE_GAP = 12;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.1;

interface PageRenderEntry {
  el: HTMLDivElement;
  /** 当前显示比例：PDF pt → 屏幕 px。 */
  scale: number;
  /** 适合宽度（100%）时的比例和页面显示尺寸。 */
  fitScale: number;
  fitWidth: number;
  fitHeight: number;
}

export default function PdfPreview({ url, height, onPdfClick, onHighlightClear, apiRef, onApiReady }: PdfPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // 每页的 DOM 与缩放信息（page → {el, scale}），scrollToPdfPoint / 点击换算用
  const pagesRef = useRef<Map<number, PageRenderEntry>>(new Map());
  const renderSeqRef = useRef(0);
  const onClickRef = useRef(onPdfClick);
  const onHighlightClearRef = useRef(onHighlightClear);
  const onApiReadyRef = useRef(onApiReady);
  onApiReadyRef.current = onApiReady;
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  const appliedZoomRef = useRef(zoom);
  const activeHighlightRef = useRef<(PdfPointHighlight & { page: number; yPt: number }) | null>(null);
  const highlightElRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollRef = useRef<{ page: number; yPt: number } | null>(null);
  zoomRef.current = zoom;
  onClickRef.current = onPdfClick;
  onHighlightClearRef.current = onHighlightClear;

  const clearHighlight = (notify = false) => {
    highlightElRef.current?.remove();
    highlightElRef.current = null;
    activeHighlightRef.current = null;
    pendingScrollRef.current = null;
    if (notify) onHighlightClearRef.current?.();
  };

  const renderHighlight = (pulse = false) => {
    highlightElRef.current?.remove();
    highlightElRef.current = null;
    const active = activeHighlightRef.current;
    if (!active) return;
    const entry = pagesRef.current.get(active.page);
    if (!entry) return;

    const mode = active.mode || 'text';
    const rawHeight = active.heightPt ?? (mode === 'text' ? 30 : 14);
    // 图/表仅高亮块起始的一小段；普通字段也限高，避免长内容遮住 PDF。
    const heightPt = mode === 'text'
      ? Math.min(48, Math.max(18, rawHeight))
      : mode === 'block' ? 12 : 8;
    const overlay = document.createElement('div');
    overlay.dataset.pdfFieldHighlight = 'true';
    overlay.style.cssText = [
      'position:absolute',
      'left:10px',
      'right:10px',
      `top:${Math.max(2, active.yPt * entry.scale - 4)}px`,
      `height:${Math.max(mode === 'group' ? 8 : 18, heightPt * entry.scale)}px`,
      'box-sizing:border-box',
      `border:${mode === 'group' ? '0 0 0 4px' : '2px'} solid #1677ff`,
      mode === 'group' ? 'border-left:4px solid #1677ff' : '',
      mode === 'block' ? 'border-bottom-style:dashed' : '',
      `background:${mode === 'text' ? 'rgba(22,119,255,.08)' : 'linear-gradient(180deg, rgba(22,119,255,.12), rgba(22,119,255,.025))'}`,
      'border-radius:5px',
      'box-shadow:0 0 0 2px rgba(22,119,255,.10)',
      'pointer-events:none',
      'z-index:4',
      'transition:opacity .2s ease, box-shadow .25s ease',
    ].filter(Boolean).join(';');

    const badge = document.createElement('span');
    badge.textContent = '当前编辑位置';
    badge.style.cssText = [
      'position:absolute',
      'left:-2px',
      'top:-22px',
      'max-width:70%',
      'overflow:hidden',
      'text-overflow:ellipsis',
      'white-space:nowrap',
      'padding:2px 7px',
      'border-radius:4px 4px 4px 0',
      'background:#1677ff',
      'color:#fff',
      'font:500 11px/18px -apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif',
      'box-shadow:0 1px 4px rgba(16,24,40,.18)',
    ].join(';');
    overlay.appendChild(badge);
    entry.el.appendChild(overlay);
    highlightElRef.current = overlay;
    if (pulse && typeof overlay.animate === 'function') {
      overlay.animate(
        [
          { opacity: 0.35, boxShadow: '0 0 0 2px rgba(22,119,255,.10)' },
          { opacity: 1, boxShadow: '0 0 0 8px rgba(22,119,255,.20)' },
          { opacity: 1, boxShadow: '0 0 0 2px rgba(22,119,255,.10)' },
        ],
        { duration: 1100, easing: 'ease-out' },
      );
    }
  };

  const setHighlight = (page: number, yPt: number, highlight?: PdfPointHighlight, pulse = true) => {
    activeHighlightRef.current = { page, yPt, ...highlight };
    renderHighlight(pulse);
  };

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && activeHighlightRef.current) clearHighlight(true);
    };
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
    // clearHighlight only reads live refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyEntryZoom = (entry: PageRenderEntry, nextZoom: number) => {
    const canvas = entry.el.querySelector('canvas');
    if (!canvas) return;
    const width = entry.fitWidth * nextZoom;
    const height = entry.fitHeight * nextZoom;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    entry.el.style.width = `${width}px`;
    entry.scale = entry.fitScale * nextZoom;
  };

  useEffect(() => {
    const container = containerRef.current;
    const prev = appliedZoomRef.current;
    const ratio = prev > 0 ? zoom / prev : 1;
    pagesRef.current.forEach(entry => applyEntryZoom(entry, zoom));
    renderHighlight(false);
    // 缩放时尽量维持当前视口中心，避免每次放大都跳回页面左上角。
    if (container && ratio !== 1) {
      const centerY = container.scrollTop + container.clientHeight / 2;
      const centerX = container.scrollLeft + container.clientWidth / 2;
      container.scrollTop = Math.max(0, centerY * ratio - container.clientHeight / 2);
      container.scrollLeft = Math.max(0, centerX * ratio - container.clientWidth / 2);
    }
    appliedZoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    if (apiRef) {
      apiRef.current = {
        scrollToPdfPoint: (page, yPt, highlight) => {
          setHighlight(page, yPt, highlight, true);
          pendingScrollRef.current = { page, yPt };
          const container = containerRef.current;
          const entry = pagesRef.current.get(page);
          if (!container || !entry) return;
          // 将落点放在视口约 1/5 高度处，而不是紧贴顶部：
          // 既给高亮上方的提示标签留空间，也能同时看到字段前后的版面上下文。
          const top = entry.el.offsetTop + yPt * entry.scale - container.clientHeight * 0.2;
          container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
          pendingScrollRef.current = null;
        },
        highlightPdfPoint: (page, yPt, highlight) => setHighlight(page, yPt, highlight, true),
        clearHighlight: () => clearHighlight(false),
      };
      onApiReadyRef.current?.();
      return () => { clearHighlight(false); apiRef.current = null; };
    }
    return undefined;
    // apiRef is stable for every current caller; functions intentionally read live refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiRef]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !url) return;
    const seq = ++renderSeqRef.current;
    let cancelled = false;

    (async () => {
      try {
        const doc = await pdfjsLib.getDocument(url).promise;
        if (cancelled || seq !== renderSeqRef.current) return;
        // 渲染到离屏 fragment（双缓冲），全部完成后一次性替换，期间滚动不动、不闪白
        const frag = document.createDocumentFragment();
        const nextPages = new Map<number, PageRenderEntry>();
        const width = Math.max(container.clientWidth - 24, 200);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        for (let p = 1; p <= doc.numPages; p++) {
          const page = await doc.getPage(p);
          if (cancelled || seq !== renderSeqRef.current) return;
          const base = page.getViewport({ scale: 1 });
          const scale = width / base.width;
          const viewport = page.getViewport({ scale: scale * dpr });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const fitWidth = viewport.width / dpr;
          const fitHeight = viewport.height / dpr;
          const currentZoom = zoomRef.current;
          canvas.style.width = `${fitWidth * currentZoom}px`;
          canvas.style.height = `${fitHeight * currentZoom}px`;
          canvas.style.display = 'block';
          await page.render({ canvasContext: canvas.getContext('2d')!, viewport, canvas } as any).promise;
          const wrap = document.createElement('div');
          wrap.style.cssText = `position: relative; margin: 0 auto ${PAGE_GAP}px; width: ${fitWidth * currentZoom}px; box-shadow: 0 1px 4px rgba(16,40,80,0.18); background: #fff;`;
          wrap.dataset.page = String(p);
          wrap.appendChild(canvas);
          // canvas 只画出 PDF 外观，不会自动带出 PDF 的链接批注层；因此 Typst 生成的
          // #link 在预览里此前完全无法点击。把 PDF.js 的外部 Link annotation 覆盖成透明 a 标签，
          // 百分比定位会随缩放和“页面宽度”自适应一起缩放。
          const annotations = await page.getAnnotations({ intent: 'display' });
          for (const annotation of annotations as any[]) {
            const rawUrl = String(annotation?.url || annotation?.unsafeUrl || '');
            if (!rawUrl || !Array.isArray(annotation?.rect)) continue;
            let href = '';
            try {
              const parsed = new URL(rawUrl, window.location.href);
              if (parsed.protocol === 'http:' || parsed.protocol === 'https:') href = parsed.href;
            } catch { /* 忽略 PDF 内无效或非 http(s) 的链接 */ }
            if (!href) continue;
            const points = viewport.convertToViewportRectangle(annotation.rect);
            const left = Math.min(points[0], points[2]);
            const top = Math.min(points[1], points[3]);
            const width = Math.abs(points[2] - points[0]);
            const height = Math.abs(points[3] - points[1]);
            if (width < 1 || height < 1) continue;
            const link = document.createElement('a');
            link.href = href;
            link.target = '_blank';
            link.rel = 'noreferrer';
            link.title = '点击打开 / 下载附件';
            link.dataset.pdfLink = 'true';
            link.style.cssText = [
              'position:absolute',
              `left:${(left / viewport.width) * 100}%`,
              `top:${(top / viewport.height) * 100}%`,
              `width:${(width / viewport.width) * 100}%`,
              `height:${(height / viewport.height) * 100}%`,
              'z-index:3',
              'cursor:pointer',
              'background:transparent',
            ].join(';');
            // 点击链接不触发 Ctrl/⌘ 点选字段，也不清除当前的编辑定位提示。
            link.addEventListener('click', event => event.stopPropagation());
            wrap.appendChild(link);
          }
          frag.appendChild(wrap);
          nextPages.set(p, {
            el: wrap,
            scale: scale * currentZoom,
            fitScale: scale,
            fitWidth,
            fitHeight,
          });
        }
        if (cancelled || seq !== renderSeqRef.current) return;
        const keepScroll = container.scrollTop;
        container.replaceChildren(frag);
        pagesRef.current = nextPages;
        container.scrollTop = keepScroll; // 核心：重渲染后停留原位
        renderHighlight(false);
        const pending = pendingScrollRef.current;
        const pendingEntry = pending ? nextPages.get(pending.page) : null;
        if (pending && pendingEntry) {
          container.scrollTo({
            top: Math.max(0, pendingEntry.el.offsetTop + pending.yPt * pendingEntry.scale - container.clientHeight * 0.2),
            behavior: 'smooth',
          });
          pendingScrollRef.current = null;
        }
      } catch (e) {
        if (!cancelled) console.warn('PdfPreview render failed:', e);
      }
    })();

    return () => { cancelled = true; };
  }, [url]);

  // 容器宽度变化：CSS 缩放已渲染画布（视觉近似即时跟手；下次编译会按新宽度精确重渲）
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastWidth = container.clientWidth;
    const ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      if (Math.abs(w - lastWidth) < 4) return;
      lastWidth = w;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const width = Math.max(container.clientWidth - 24, 200);
        pagesRef.current.forEach((entry) => {
          if (!entry.fitWidth || Math.abs(entry.fitWidth - width) < 1) return;
          const ratio = width / entry.fitWidth;
          entry.fitWidth = width;
          entry.fitHeight *= ratio;
          entry.fitScale *= ratio;
          applyEntryZoom(entry, zoomRef.current);
        });
      }, 250);
    });
    ro.observe(container);
    return () => { ro.disconnect(); if (timer) clearTimeout(timer); };
  }, []);

  // 点击 → PDF 坐标（pt）
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handler = (ev: MouseEvent) => {
      if (!onClickRef.current) return;
      if ((ev.target as HTMLElement).closest('[data-pdf-link]')) return;
      const target = (ev.target as HTMLElement).closest('[data-page]') as HTMLDivElement | null;
      if (!target) return;
      const page = Number(target.dataset.page);
      const entry = pagesRef.current.get(page);
      if (!entry) return;
      const rect = target.getBoundingClientRect();
      const xPt = (ev.clientX - rect.left) / entry.scale;
      const yPt = (ev.clientY - rect.top) / entry.scale;
      onClickRef.current(page, xPt, yPt, ev);
    };
    container.addEventListener('click', handler);
    return () => container.removeEventListener('click', handler);
  }, []);

  // 容器始终渲染（占位作为子元素）——click/ResizeObserver 等 [] 依赖的监听在首挂载就能绑上
  return (
    <div style={{ height, minHeight: 0, display: 'flex', flexDirection: 'column', background: '#eceff4' }}>
      <div style={{
        flex: '0 0 36px', minHeight: 36, display: 'flex', alignItems: 'center',
        padding: '0 8px', borderBottom: '1px solid #dfe4eb', background: '#fff',
        overflowX: 'auto', overflowY: 'hidden',
      }}>
        <Space size={4}>
          <Tooltip title="缩小 PDF">
            <Button size="small" icon={<ZoomOutOutlined />} disabled={zoom <= MIN_ZOOM}
              aria-label="缩小 PDF"
              onClick={() => setZoom(v => Math.max(MIN_ZOOM, Number((v - ZOOM_STEP).toFixed(2))))} />
          </Tooltip>
          <span style={{ minWidth: 46, textAlign: 'center', color: '#4b5565', fontSize: 12 }}>
            {Math.round(zoom * 100)}%
          </span>
          <Tooltip title="放大 PDF">
            <Button size="small" icon={<ZoomInOutlined />} disabled={zoom >= MAX_ZOOM}
              aria-label="放大 PDF"
              onClick={() => setZoom(v => Math.min(MAX_ZOOM, Number((v + ZOOM_STEP).toFixed(2))))} />
          </Tooltip>
          <Tooltip title="恢复为页面宽度">
            <Button size="small" icon={<ColumnWidthOutlined />} disabled={zoom === 1}
              onClick={() => setZoom(1)}>页面宽度</Button>
          </Tooltip>
        </Space>
      </div>
      <div
        ref={containerRef}
        style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto', overscrollBehavior: 'contain', background: '#eceff4', padding: '12px 0' }}
        title="Ctrl/⌘ + 点击可跳到左侧对应字段"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            clearHighlight(true);
            (event.currentTarget as HTMLDivElement).blur();
          }
        }}
        onClick={(event) => {
          // 普通点击表示用户把注意力移到 PDF；Ctrl/⌘ 反向定位由上面的原生监听改为新的字段高亮。
          if (!event.ctrlKey && !event.metaKey) clearHighlight(true);
        }}
      >
        {!url && (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
            等待编译...
          </div>
        )}
      </div>
    </div>
  );
}
