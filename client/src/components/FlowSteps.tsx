/**
 * 紧凑流程进度条：关联 → 录入 → 审核 → 报告 这类多阶段计数，
 * 用一串带圆点的胶囊 + 连接线展示，替代一堆零散 <Tag>（"标签汤"）。
 * 完成=绿、进行中=蓝、未开始=灰。
 */
export interface FlowStep { label: string; done: number; total: number }

export default function FlowSteps({ steps, size = 'default' }: { steps: FlowStep[]; size?: 'small' | 'default' }) {
  const fs = size === 'small' ? 11 : 12;
  const pad = size === 'small' ? '1px 8px' : '2px 9px';
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {steps.map((s, i) => {
        const complete = s.total > 0 && s.done >= s.total;
        const partial = s.done > 0 && !complete;
        const color = complete ? '#16a34a' : partial ? '#1366d9' : '#9aa6b8';
        const bg = complete ? '#eafaf0' : partial ? '#eef4ff' : '#f1f3f7';
        return (
          <div key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: pad, borderRadius: 20, background: bg, color, fontSize: fs, fontWeight: 500, whiteSpace: 'nowrap' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
              {s.label} {s.done}/{s.total}
            </span>
            {i < steps.length - 1 && <span style={{ width: 12, height: 1, background: '#e3e8f0' }} />}
          </div>
        );
      })}
    </div>
  );
}
