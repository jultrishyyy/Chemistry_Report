import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { message } from 'antd';

const REMINDER_KEY = 'start-editing-reminder';

export default function EditAttemptGuard({
  active,
  children,
  style,
}: {
  active: boolean;
  children: ReactNode;
  style?: React.CSSProperties;
}) {
  const remind = () => {
    if (!active) return;
    message.info({
      key: REMINDER_KEY,
      content: '当前尚未开始编辑，请先点击页面右上角“开始编辑”',
      duration: 2.5,
    });
  };

  const onPointerDownCapture = (_event: PointerEvent<HTMLDivElement>) => remind();
  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key.length === 1 || event.key === 'Backspace' || event.key === 'Delete' || event.key === 'Enter') remind();
  };

  return (
    <div
      style={style}
      onPointerDownCapture={active ? onPointerDownCapture : undefined}
      onKeyDownCapture={active ? onKeyDownCapture : undefined}
    >
      {children}
    </div>
  );
}
