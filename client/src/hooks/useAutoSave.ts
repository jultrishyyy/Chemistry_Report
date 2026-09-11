import { useEffect, useRef } from 'react';

/**
 * 编辑器统一自动保存：每隔一段时间检查一次，只在存在真实未保存改动时写入。
 * ref 保证定时器始终读取最新状态，同时避免保存请求重叠。
 */
export function useAutoSave({
  enabled,
  isDirty,
  save,
  intervalMs = 30_000,
}: {
  enabled: boolean;
  isDirty: () => boolean;
  save: () => Promise<boolean | void>;
  intervalMs?: number;
}) {
  const enabledRef = useRef(enabled);
  const dirtyRef = useRef(isDirty);
  const saveRef = useRef(save);
  const inFlightRef = useRef(false);
  enabledRef.current = enabled;
  dirtyRef.current = isDirty;
  saveRef.current = save;

  useEffect(() => {
    const timer = window.setInterval(async () => {
      if (!enabledRef.current || inFlightRef.current || !dirtyRef.current()) return;
      inFlightRef.current = true;
      try {
        await saveRef.current();
      } finally {
        inFlightRef.current = false;
      }
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
}
