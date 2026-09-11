import type { ReactNode } from 'react';
import { Button, Tooltip } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';

export default function EditorToolbar({ title, onBack, backTitle = '返回', children }: {
  title: ReactNode;
  onBack: () => void;
  backTitle?: string;
  children?: ReactNode;
}) {
  return (
    <div style={{
      minHeight: 46,
      padding: '7px 14px',
      borderBottom: '1px solid #e8eaed',
      background: '#fff',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      flexWrap: 'nowrap',
      overflowX: 'auto',
    }}>
      <Tooltip title={backTitle}>
        <Button size="small" type="text" icon={<ArrowLeftOutlined />} aria-label={backTitle} onClick={onBack} />
      </Tooltip>
      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 1, minWidth: 56 }}>
        {title}
      </h3>
      {children}
    </div>
  );
}
