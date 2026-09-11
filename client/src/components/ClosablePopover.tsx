import { useEffect, useState, type ReactNode } from 'react';
import { Button, Popover, type PopoverProps } from 'antd';
import { CloseOutlined } from '@ant-design/icons';

type Props = Omit<PopoverProps, 'title' | 'content' | 'open' | 'onOpenChange'> & {
  title: ReactNode;
  content: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/** 统一设置卡：关闭按钮固定在右上角，正文超高时内部滚动，并支持 Esc / 点外关闭。 */
export default function ClosablePopover({
  title, content, open: controlledOpen, onOpenChange, children, ...props
}: Props) {
  const [innerOpen, setInnerOpen] = useState(false);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : innerOpen;
  const setOpen = (next: boolean) => {
    if (!controlled) setInnerOpen(next);
    onOpenChange?.(next);
  };

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Popover
      {...props}
      open={open}
      onOpenChange={setOpen}
      title={
        <div style={{ minWidth: 180, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{title}</span>
          <Button type="text" size="small" icon={<CloseOutlined />} aria-label="关闭设置卡" title="关闭"
            onClick={(event) => { event.stopPropagation(); setOpen(false); }}
            style={{ marginRight: -6, color: '#8a94a6' }} />
        </div>
      }
      content={
        <div style={{ maxWidth: 'calc(100vw - 48px)', maxHeight: 'calc(100vh - 130px)', overflow: 'auto', overscrollBehavior: 'contain' }}>
          {content}
        </div>
      }
    >
      {children}
    </Popover>
  );
}
