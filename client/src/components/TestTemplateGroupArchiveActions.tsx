import { useState } from 'react';
import { AuditOutlined, DeleteOutlined, UndoOutlined } from '@ant-design/icons';
import { Button, Input, Modal, Radio, Space, Tooltip, message } from 'antd';
import axios from 'axios';
import { useAuth } from '../auth';

const errorMessage = (error: unknown, fallback: string) => {
  if (axios.isAxiosError<{ error?: string }>(error)) return error.response?.data?.error || error.message || fallback;
  return error instanceof Error ? error.message : fallback;
};

export type TestTemplateGroupArchiveRow = {
  id: number;
  name: string;
  archive_requested_by?: string | null;
  archive_requested_at?: string | null;
  archive_request_note?: string | null;
};

/** 项目组删除固定为两个小操作位：申请/撤回、审核。 */
export default function TestTemplateGroupArchiveActions({ group, onRefresh, kind = 'record' }: {
  group: TestTemplateGroupArchiveRow;
  onRefresh: () => void | Promise<void>;
  kind?: 'record' | 'report';
}) {
  const { user, has } = useAuth();
  const canEdit = has(kind === 'record' ? 'record_template.edit' : 'report_template.edit');
  const canReviewPermission = has(kind === 'record' ? 'record.review' : 'report.review');
  const apiBase = kind === 'record' ? '/api/test-methods/groups' : '/api/report-project-families';
  const requested = !!group.archive_requested_by;
  const isRequester = group.archive_requested_by === user?.display_name;
  const isAdmin = !!user?.roles?.includes('admin');
  const canCancel = requested && canEdit && (isRequester || canReviewPermission);
  const canReview = requested && canReviewPermission && (!isRequester || isAdmin);
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestNote, setRequestNote] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [decision, setDecision] = useState<'approve' | 'reject'>('approve');
  const [reviewNote, setReviewNote] = useState('');
  const [busy, setBusy] = useState(false);

  const requestArchive = async () => {
    setBusy(true);
    try {
      await axios.post(`${apiBase}/${group.id}/archive-request`, {
        note: requestNote.trim() || undefined,
      });
      message.success('项目组删除申请已提交，等待审核');
      setRequestOpen(false); setRequestNote(''); await onRefresh();
    } catch (error: unknown) {
      message.error(errorMessage(error, '删除申请提交失败'));
    } finally { setBusy(false); }
  };

  const cancelArchive = () => Modal.confirm({
    title: '撤回项目组删除申请？',
    content: `将撤回“${group.name}”的删除申请，项目组继续正常使用。`,
    okText: '撤回申请', cancelText: '取消',
    onOk: async () => {
      try {
        await axios.post(`${apiBase}/${group.id}/archive-request/cancel`);
        message.success('删除申请已撤回'); await onRefresh();
      } catch (error: unknown) { message.error(errorMessage(error, '撤回失败')); }
    },
  });

  const reviewArchive = async () => {
    if (decision === 'reject' && !reviewNote.trim()) {
      message.warning('驳回时请填写原因'); return;
    }
    setBusy(true);
    try {
      const response = await axios.post(`${apiBase}/${group.id}/archive-review`, {
        decision, note: reviewNote.trim() || undefined,
      });
      if (decision === 'approve') {
        const count = Number(response.data?.detached_template_count || 0);
        message.success(`项目组已删除${count ? `，${count} 个模板已转为未归组` : ''}`);
      } else message.success('删除申请已驳回');
      setReviewOpen(false); setReviewNote(''); await onRefresh();
    } catch (error: unknown) {
      message.error(errorMessage(error, '审核失败'));
    } finally { setBusy(false); }
  };

  const requestTitle = requested
    ? canCancel ? `撤回删除申请（${group.archive_requested_by} 发起）` : `删除申请审核中（${group.archive_requested_by} 发起）`
    : canEdit ? '申请删除项目组（审核通过后生效）' : '当前账号无项目组删除权限';
  const reviewTitle = !requested
    ? '当前没有待审核的删除申请'
    : canReview ? `审核删除申请（${group.archive_requested_by} 发起）`
      : isRequester && canReviewPermission ? '申请人不能审核自己的删除申请' : '当前账号无项目组删除审核权限';

  return <>
    <Space size={4} onClick={event => event.stopPropagation()}>
      <Tooltip title={requestTitle}>
        <Button size="small" danger={!requested} disabled={requested ? !canCancel : !canEdit}
          icon={requested ? <UndoOutlined /> : <DeleteOutlined />}
          onClick={() => requested ? cancelArchive() : setRequestOpen(true)} />
      </Tooltip>
      <Tooltip title={reviewTitle}>
        <Button size="small" disabled={!canReview} icon={<AuditOutlined />}
          onClick={() => { setDecision('approve'); setReviewNote(''); setReviewOpen(true); }} />
      </Tooltip>
    </Space>

    <Modal open={requestOpen} title={`申请删除项目组 · ${group.name}`} onCancel={() => setRequestOpen(false)}
      onOk={requestArchive} okText="提交删除申请" okButtonProps={{ danger: true, loading: busy }}>
      <p style={{ color: '#667085', fontSize: 13, marginBottom: 12 }}>
        审核通过后，项目组会从列表中移除，组内模板会转为未归组；模板内容和历史录入数据不会删除。
      </p>
      <Input.TextArea rows={3} value={requestNote} onChange={event => setRequestNote(event.target.value)}
        placeholder="删除原因（可选，供审核人查看）" />
    </Modal>

    <Modal open={reviewOpen} title={`审核项目组删除 · ${group.name}`} onCancel={() => setReviewOpen(false)}
      onOk={reviewArchive} okText={decision === 'approve' ? '批准删除' : '驳回申请'}
      okButtonProps={{ danger: decision === 'approve', loading: busy }}>
      <div style={{ padding: 12, marginBottom: 12, borderRadius: 8, background: '#fff7e6' }}>
        <div>申请人：<b>{group.archive_requested_by}</b></div>
        <div>申请原因：{group.archive_request_note || <span style={{ color: '#98a2b3' }}>未填写</span>}</div>
      </div>
      <Radio.Group value={decision} onChange={event => setDecision(event.target.value)} style={{ marginBottom: 12 }}>
        <Radio.Button value="approve">批准删除</Radio.Button>
        <Radio.Button value="reject">驳回</Radio.Button>
      </Radio.Group>
      <Input.TextArea rows={3} value={reviewNote} onChange={event => setReviewNote(event.target.value)}
        placeholder={decision === 'reject' ? '请输入驳回原因（必填）' : '审核备注（可选）'} />
    </Modal>
  </>;
}
