import { Input } from 'antd';
import { useLayoutEffect, useRef, type ComponentProps, type ComponentRef } from 'react';

/** Report cells grow on typography changes as well as text/column-width changes.
 * Ant's autoSize caches a height and only remeasures on value/minRows/maxRows. */
export default function ReportCellTextArea(props: ComponentProps<typeof Input.TextArea>) {
  const ref = useRef<ComponentRef<typeof Input.TextArea>>(null);
  const resize = () => {
    const node = ref.current?.resizableTextArea?.textArea;
    if (!node || !node.isConnected) return;
    const css = getComputedStyle(node);
    node.style.height = 'auto';
    const border = (parseFloat(css.borderTopWidth) || 0) + (parseFloat(css.borderBottomWidth) || 0);
    const padding = (parseFloat(css.paddingTop) || 0) + (parseFloat(css.paddingBottom) || 0);
    const line = parseFloat(css.lineHeight) || (parseFloat(css.fontSize) || 14) * 1.5;
    const height = Math.max(node.scrollHeight, line + padding);
    node.style.height = `${Math.ceil(css.boxSizing === 'border-box' ? height + border : height - padding)}px`;
  };
  useLayoutEffect(resize, [props.value, props.style?.lineHeight, props.style?.fontSize, props.style?.fontFamily, props.style?.fontWeight, props.style?.fontStyle]);
  useLayoutEffect(() => {
    // Bundled PDF fonts can finish loading after the first browser layout.
    document.fonts?.addEventListener('loadingdone', resize);
    return () => document.fonts?.removeEventListener('loadingdone', resize);
  }, []);
  useLayoutEffect(() => {
    const node = ref.current?.resizableTextArea?.textArea;
    if (!node || typeof ResizeObserver === 'undefined') return;
    let width = node.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const next = node.getBoundingClientRect().width;
      if (next !== width) { width = next; resize(); }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <Input.TextArea {...props} ref={ref} autoSize={false}
    style={{ resize: 'none', overflowWrap: 'anywhere', ...props.style, overflowY: 'hidden' }} />;
}
