/**
 * EditorSplit — 编辑器页通用左右分栏（左=结构编辑，右=PDF 预览），分隔条可拖拽调宽。
 * 宽度百分比持久化到 localStorage（三个模板编辑器共用同一偏好），钳 25%–75%，双击分隔条复位 45%。
 */
import { useRef, useState } from 'react';

const KEY = 'editorSplitPct';
const clamp = (v: number) => Math.min(Math.max(v, 25), 75);

export default function EditorSplit({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [pct, setPct] = useState<number>(() => {
    const v = Number(localStorage.getItem(KEY));
    return Number.isFinite(v) && v >= 25 && v <= 75 ? v : 45;
  });
  const [dragging, setDragging] = useState(false);

  const update = (clientX: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const next = clamp(((clientX - rect.left) / rect.width) * 100);
    setPct(next);
    localStorage.setItem(KEY, String(Math.round(next * 10) / 10));
  };

  return (
    <div ref={wrapRef} style={{ flex: 1, display: 'flex', minHeight: 0 }}>
      <div style={{ width: `${pct}%`, minWidth: 0, overflow: 'auto' }}>{left}</div>
      <div
        title="拖动调整左右宽度，双击复位"
        onPointerDown={(e) => { e.preventDefault(); (e.target as HTMLElement).setPointerCapture(e.pointerId); setDragging(true); }}
        onPointerMove={(e) => { if (dragging) update(e.clientX); }}
        onPointerUp={(e) => { (e.target as HTMLElement).releasePointerCapture(e.pointerId); setDragging(false); }}
        onDoubleClick={() => { setPct(45); localStorage.setItem(KEY, '45'); }}
        style={{
          flex: 'none', width: 7, cursor: 'col-resize',
          background: dragging ? 'rgba(19,102,217,0.35)' : '#e8ecf3',
          borderLeft: '1px solid #d9d9d9', borderRight: '1px solid #d9d9d9',
          transition: dragging ? 'none' : 'background 0.15s',
        }}
        onMouseEnter={(e) => { if (!dragging) (e.currentTarget as HTMLElement).style.background = 'rgba(19,102,217,0.18)'; }}
        onMouseLeave={(e) => { if (!dragging) (e.currentTarget as HTMLElement).style.background = '#e8ecf3'; }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>{right}</div>
    </div>
  );
}
