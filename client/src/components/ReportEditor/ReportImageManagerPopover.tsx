import type { ReactNode } from 'react';
import { Button } from 'antd';
import ClosablePopover from '../ClosablePopover';

export default function ReportImageManagerPopover({ children }: { children: ReactNode }) {
  return <ClosablePopover trigger="click" title="管理图片" placement="bottom" autoAdjustOverflow
    styles={{ container: { width: 'min(560px, calc(100vw - 32px))', maxWidth: 'calc(100vw - 32px)', boxSizing: 'border-box' } }}
    content={<div className="report-image-manager-content" style={{ width: '100%', minWidth: 0,
      maxHeight: 'min(360px, calc(50dvh - 72px))', overflow: 'auto', overscrollBehavior: 'contain', overflowWrap: 'anywhere' }}>{children}</div>}>
    <Button size="small">管理图片 ▾</Button>
  </ClosablePopover>;
}
