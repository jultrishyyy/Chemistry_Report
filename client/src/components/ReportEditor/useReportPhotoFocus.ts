import { useLayoutEffect, useState, type RefObject } from 'react';

/** Keep the clicked slot focused when selecting a block replaces its preview tree. */
export function useReportPhotoFocus(frame: RefObject<HTMLElement | null>) {
  const [request, setRequest] = useState<{ index: string } | null>(null);
  useLayoutEffect(() => {
    if (!request) return;
    const slot = Array.from(frame.current?.querySelectorAll<HTMLElement>('[data-report-photo-index]') || [])
      .find(node => node.dataset.reportPhotoIndex === request.index);
    slot?.focus({ preventScroll: true });
  }, [request, frame]);
  return (target: EventTarget | null) => {
    if (!(target instanceof Element) || target.closest('[contenteditable="true"], input, textarea, button')) return false;
    const slot = target.closest<HTMLElement>('[data-report-photo-index]');
    if (!slot || !frame.current?.contains(slot)) return false;
    slot.focus({ preventScroll: true });
    setRequest({ index: slot.dataset.reportPhotoIndex! });
    return true;
  };
}
