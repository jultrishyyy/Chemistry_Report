/**
 * 录入进度面板（可复用）
 *
 * 展示一张委托单完整的「样品 × 测试项目」清单 + 每项录入状态，
 * 每个已录入项可「查看原始记录」（只读）。
 *
 * 用在：
 *  - 报告委托单列表 Report/OrderList.tsx（行展开，默认收起）
 *  - 报告工作台 Report/Workbench.tsx（顶部常驻）
 */
import type { CSSProperties } from 'react';
import { Tag, Button } from 'antd';

export interface ProgressSample {
  id: string;
  name: string;
  test_infos: { name: string; standard?: string }[];
}
export interface ProgressRecord {
  id: number;
  sample_external_id?: string | null;
  test_item_name?: string | null;
  audit_status?: string | null;
}

/** record_data.audit_status → 状态标签 */
export const REC_STATUS: Record<string, { color: string; text: string }> = {
  draft: { color: 'blue', text: '草稿' },
  pending: { color: 'blue', text: '待审核' },
  reviewed: { color: 'green', text: '已审核' },
  rejected: { color: 'red', text: '已退回' },
};

interface Props {
  samples: ProgressSample[];
  records: ProgressRecord[];
  /** 点击「查看原始记录」 */
  onView: (recordId: number, subtitle: string) => void;
  /** 是否显示绿色外框 + "已录 N/M" 头部（工作台 true；列表展开行 false） */
  framed?: boolean;
}

export default function RecordProgressPanel({ samples, records, onView, framed = true }: Props) {
  const findRecs = (sampleId: string, testName: string) =>
    records.filter(r => r.sample_external_id === sampleId && r.test_item_name === testName);
  const allTests = (samples || []).flatMap(s => (s.test_infos || []).map(t => ({ s, t })));
  const enteredCount = allTests.filter(({ s, t }) => findRecs(s.id, t.name).length > 0).length;

  const body = (
    <>
      {framed && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontWeight: 'bold' }}>录入进度</span>
          <span style={{ fontSize: 12, color: '#666' }}>已录 {enteredCount} / {allTests.length} 项</span>
        </div>
      )}
      {(samples || []).map(s => (
        <div key={s.id} style={{ marginBottom: 10 }}>
          {/* 样品分组小标题（左侧色条） */}
          <div style={{ fontSize: 12, color: '#555', fontWeight: 600, padding: '2px 0 4px 8px', borderLeft: '3px solid #d6e4ff' }}>{s.name}</div>
          {/* 每个测试项目一条（带分隔线、左项目名 + 右状态/操作贴在一起，避免中段大留白） */}
          {(s.test_infos || []).map(t => {
            const recs = findRecs(s.id, t.name);
            const rowStyle: CSSProperties = {
              display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', fontSize: 12,
              borderBottom: '1px solid #f0f0f0', background: '#fff', borderRadius: 4, marginBottom: 2,
            };
            if (recs.length === 0) {
              return (
                <div key={t.name} style={rowStyle}>
                  <span style={{ flex: 1, color: '#333' }}>{t.name}</span>
                  <Tag color="default" style={{ margin: 0 }}>未录入</Tag>
                </div>
              );
            }
            // 一个测试项目可能关联多条原始记录（多模板）→ 每条单独一行
            return recs.map((rec, idx) => {
              const st = rec.audit_status
                ? (Object.prototype.hasOwnProperty.call(REC_STATUS, rec.audit_status)
                  ? REC_STATUS[rec.audit_status] : { color: 'default', text: '未知状态' })
                : { color: 'default', text: '待审核' };
              const label = recs.length > 1 ? `${t.name}（记录 ${idx + 1}）` : t.name;
              return (
                <div key={`${t.name}__${rec.id}`} style={rowStyle}>
                  <span style={{ flex: 1, color: '#333' }}>{label}</span>
                  <Tag color={st.color} style={{ margin: 0 }}>{st.text}</Tag>
                  <Button size="small" type="link" style={{ padding: 0, fontSize: 12, height: 'auto' }}
                    onClick={() => onView(rec.id, `${s.name} · ${label}`)}>查看原始记录</Button>
                </div>
              );
            });
          })}
        </div>
      ))}
    </>
  );

  if (!framed) return <div>{body}</div>;
  return (
    <div style={{ marginBottom: 12, padding: 8, background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 6 }}>
      {body}
    </div>
  );
}
