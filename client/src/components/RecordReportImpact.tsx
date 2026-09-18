import { useState } from 'react';
import { Alert, Button, Modal, Spin, Tag } from 'antd';
import axios from 'axios';
import type { FieldGroup } from '../../../shared/types';
import type { ReportBindingReviewItem } from '../../../shared/report-binding-review';

type Impact = { id: number; name: string; checked: boolean; checked_status?: string | null; issues: ReportBindingReviewItem[] };
export default function RecordReportImpact({ id, groups }: { id: number; groups: FieldGroup[] }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Impact[]>([]);
  const [error, setError] = useState('');
  const check = async () => {
    setOpen(true); setLoading(true); setError(''); setRows([]);
    try {
      const response = await axios.post(`/api/record-templates/${id}/report-impact`, { groups });
      setRows(response.data.templates);
    } catch { setError('暂时无法检查，请稍后重试'); }
    finally { setLoading(false); }
  };
  return <>
    <Button size="small" onClick={check}>检查关联项目</Button>
    <Modal title="关联项目" open={open} onCancel={() => setOpen(false)} footer={<Button onClick={() => setOpen(false)}>关闭</Button>} width={640}>
      <p style={{ color: '#777' }}>优先检查已发布版本；尚未发布的检查最新草稿，不会修改模板内容。</p>
      {loading ? <Spin /> : error ? <Alert type="error" message={error} action={<Button onClick={check}>重试</Button>} /> : !rows.length ? <p>暂无关联项目模板</p> :
        <div style={{ maxHeight: '55vh', overflow: 'auto' }}>{rows.map(row => <div key={row.id} style={{ padding: '12px 0', borderBottom: '1px solid #eee' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <strong style={{ flex: 1 }}>{row.name}</strong>
            {row.checked && <span style={{ color: '#777', fontSize: 12 }}>
              {row.checked_status === 'approved' ? '已发布版本' : row.checked_status === 'pending' ? '待审核版本' : '草稿版本'}
            </span>}
            <Tag color={!row.checked ? 'default' : row.issues.length ? 'warning' : 'success'}>
              {!row.checked ? '暂无可检查内容' : row.issues.length ? `${row.issues.length} 项需调整` : '来源可用'}
            </Tag>
            <a href={`/report-templates/project/editor?id=${row.id}`} target="_blank" rel="noopener noreferrer">打开模板</a>
          </div>
          {row.issues.map((issue, i) => <div key={i} style={{ marginTop: 6 }}>
            {issue.groupName} / {issue.fieldName}：{issue.reasons.join('；')}
          </div>)}
        </div>)}</div>}
    </Modal>
  </>;
}
