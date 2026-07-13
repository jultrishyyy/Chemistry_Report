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
import { useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export interface PdfPreviewApi {
  /** 滚动到第 page 页、距页顶 yPt（pt，与 typst query 的 y 同单位） */
  scrollToPdfPoint: (page: number, yPt: number) => void;
}

interface PdfPreviewProps {
  url: string;
  height: string;
  /** 点击画布：回调 (页码1起, xPt, yPt, 原生事件)。Ctrl/Cmd 判断交给调用方 */
  onPdfClick?: (page: number, xPt: number, yPt: number, ev: MouseEvent) => void;
  apiRef?: React.MutableRefObject<PdfPreviewApi | null>;
}

const PAGE_GAP = 12;

export default function PdfPreview({ url, height, onPdfClick, apiRef }: PdfPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // 每页的 DOM 与缩放信息（page → {el, scale}），scrollToPdfPoint / 点击换算用
  const pagesRef = useRef<Map<number, { el: HTMLDivElement; scale: number }>>(new Map());
  const renderSeqRef = useRef(0);
  const onClickRef = useRef(onPdfClick);
  onClickRef.current = onPdfClick;

  useEffect(() => {
    if (apiRef) {
      apiRef.current = {
        scrollToPdfPoint: (page, yPt) => {
          const container = containerRef.current;
          const entry = pagesRef.current.get(page);
          if (!container || !entry) return;
          const top = entry.el.offsetTop + yPt * entry.scale - 48;
          container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
          // 短暂高亮提示落点
          entry.el.style.outline = '2px solid #1366d9';
          setTimeout(() => { entry.el.style.outline = 'none'; }, 1200);
        },
      };
      return () => { apiRef.current = null; };
    }
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
        const nextPages = new Map<number, { el: HTMLDivElement; scale: number }>();
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
          canvas.style.width = `${viewport.width / dpr}px`;
          canvas.style.height = `${viewport.height / dpr}px`;
          canvas.style.display = 'block';
          await page.render({ canvasContext: canvas.getContext('2d')!, viewport, canvas } as any).promise;
          const wrap = document.createElement('div');
          wrap.style.cssText = `margin: 0 auto ${PAGE_GAP}px; width: ${viewport.width / dpr}px; box-shadow: 0 1px 4px rgba(16,40,80,0.18); background: #fff;`;
          wrap.dataset.page = String(p);
          wrap.appendChild(canvas);
          frag.appendChild(wrap);
          nextPages.set(p, { el: wrap, scale });
        }
        if (cancelled || seq !== renderSeqRef.current) return;
        const keepScroll = container.scrollTop;
        container.replaceChildren(frag);
        pagesRef.current = nextPages;
        container.scrollTop = keepScroll; // 核心：重渲染后停留原位
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
          const canvas = entry.el.querySelector('canvas');
          if (!canvas) return;
          const curW = parseFloat(canvas.style.width);
          if (!curW || Math.abs(curW - width) < 1) return;
          const ratio = width / curW;
          canvas.style.width = `${width}px`;
          canvas.style.height = `${parseFloat(canvas.style.height) * ratio}px`;
          entry.el.style.width = `${width}px`;
          entry.scale = entry.scale * ratio;
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
    <div
      ref={containerRef}
      style={{ height, overflowY: 'auto', background: '#eceff4', padding: '12px 0' }}
      title="Ctrl/⌘ + 点击可跳到左侧对应字段"
    >
      {!url && (
        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
          等待编译...
        </div>
      )}
    </div>
  );
}
