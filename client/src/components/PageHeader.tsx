/** 统一页面头：标题 + 副标题(说明) + 右侧操作区，统一页边距。各列表/工作台页复用，避免各写 <h2>。 */
import type { ReactNode } from 'react';

export default function PageHeader({
  title, subtitle, extra,
}: { title: ReactNode; subtitle?: ReactNode; extra?: ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
      gap: 16, margin: '0 0 16px', flexWrap: 'wrap',
    }}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#1f2733', lineHeight: 1.25 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 13, color: '#8a93a3', marginTop: 4 }}>{subtitle}</div>}
      </div>
      {extra && <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>{extra}</div>}
    </div>
  );
}
