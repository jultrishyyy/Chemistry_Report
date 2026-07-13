/**
 * 模板删除审批按钮（两个列表页共用，migration 023）
 *
 * 删除不再即点即删：
 *   - 无申请        → 红色删除图标 = 「申请删除」弹窗（原因可选）
 *   - 有申请·可审批 → 审核员（非申请人）见红色审批图标 = 批准（即归档）/ 驳回（必填备注）
 *   - 有申请·申请人 → 撤销申请图标
 *   - 有申请·其他人 → 只读提示
 * record 模板批准时若有活跃报告模板引用会 409，弹确认后带 force:true 重批。
 */
import { useState } from 'react';
import { Button, Modal, Input, Tooltip, Radio, message } from 'antd';
import { DeleteOutlined, UndoOutlined, AuditOutlined } from '@ant-design/icons';
import axios from 'axios';
import { useAuth } from '../auth';

const API = '/api';

export interface ArchiveRow {
  id: number;
  name: string;
  archive_requested_by?: string | null;
  archive_requested_at?: string | null;
  archive_request_note?: string | null;
}

export default function TemplateArchiveButton({ kind, row, onRefresh }: {
  kind: 'record' | 'report';
  row: ArchiveRow;
  onRefresh: () => void;
}) {
  const { user, has } = useAuth();
  const base = kind === 'record' ? `${API}/record-templates` : `${API}/report-templates`;

  const [requestOpen, setRequestOpen] = useState(false);
  const [requestNote, setRequestNote] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [decision, setDecision] = useState<'approve' | 'reject'>('approve');
  const [reviewNote, setReviewNote] = useState('');
  const [busy, setBusy] = useState(false);

  const doRequest = async () => {
    setBusy(true);
    try {
      await axios.post(`${base}/${row.id}/archive-request`, { note: requestNote.trim() || undefined });
      message.success('已发起删除申请，等待审核员批准');
      setRequestOpen(false); setRequestNote('');
      onRefresh();
    } catch (e: any) {
      message.error('申请失败：' + (e.response?.data?.error || e.message));
    } finally { setBusy(false); }
  };

  const doCancel = () => {
    Modal.confirm({
      title: '撤销删除申请？',
      content: `「${row.name}」的删除申请将被撤销。`,
      okText: '撤销申请', cancelText: '保留',
      onOk: async () => {
        try {
          await axios.post(`${base}/${row.id}/archive-request/cancel`);
          message.success('已撤销删除申请');
          onRefresh();
        } catch (e: any) {
          message.error('撤销失败：' + (e.response?.data?.error || e.message));
        }
      },
    });
  };

  const doReview = async (force = false) => {
    if (decision === 'reject' && !reviewNote.trim()) { message.warning('驳回必须填写备注'); return; }
    setBusy(true);
    try {
      await axios.post(`${base}/${row.id}/archive-review`, {
        decision, note: reviewNote.trim() || undefined, force,
      });
      message.success(decision === 'approve' ? '已批准，模板已归档（版本历史与数据保留）' : '已驳回删除申请');
      setReviewOpen(false); setReviewNote('');
      onRefresh();
    } catch (e: any) {
      if (e.response?.status === 409 && decision === 'approve') {
        const d = e.response.data;
        Modal.confirm({
          title: '存在关联引用',
          content: `${d.error}（${d.report_template_refs} 个报告模板引用、${d.child_template_count} 个子模板）。强制归档会解除这些关联，录入数据始终保留。`,
          okText: '强制批准归档', okButtonProps: { danger: true }, cancelText: '取消',
          onOk: () => doReview(true),
        });
      } else {
        message.error('审批失败：' + (e.response?.data?.error || e.message));
      }
    } finally { setBusy(false); }
  };

  const requested = !!row.archive_requested_by;
  const isRequester = row.archive_requested_by === user?.display_name;
  // 允许自审：申请人有审核权限时也可批准自己发起的删除申请
  const canReview = requested && has(kind === 'record' ? 'record_template.edit' : 'report_template.edit');

  return (
    <>
      {!requested ? (
        <Tooltip title="申请删除（需审核员批准后生效）">
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => setRequestOpen(true)} />
        </Tooltip>
      ) : canReview ? (
        <Tooltip title={`审批删除申请（${row.archive_requested_by} 发起${row.archive_request_note ? `：${row.archive_request_note}` : ''}）`}>
          <Button size="small" danger type="primary" ghost icon={<AuditOutlined />}
            onClick={() => { setDecision('approve'); setReviewNote(''); setReviewOpen(true); }} />
        </Tooltip>
      ) : isRequester ? (
        <Tooltip title="你已申请删除，等待审核员批准；点击可撤销申请">
          <Button size="small" icon={<UndoOutlined />} onClick={doCancel} />
        </Tooltip>
      ) : (
        <Tooltip title={`删除申请审批中（${row.archive_requested_by} 发起）`}>
          <Button size="small" disabled icon={<DeleteOutlined />} />
        </Tooltip>
      )}

      <Modal
        open={requestOpen} title={`申请删除 · ${row.name}`}
        onCancel={() => setRequestOpen(false)} onOk={doRequest}
        okText="发起删除申请" okButtonProps={{ danger: true, loading: busy }}
      >
        <p style={{ fontSize: 13, color: '#666' }}>
          删除需经审核员批准后生效（归档：列表隐藏，版本历史与录入数据完整保留，可恢复）。
        </p>
        <Input.TextArea rows={3} value={requestNote} onChange={(e) => setRequestNote(e.target.value)}
          placeholder="删除原因（可选，给审批人看）" />
      </Modal>

      <Modal
        open={reviewOpen} title={`审批删除申请 · ${row.name}`}
        onCancel={() => setReviewOpen(false)} onOk={() => doReview(false)}
        okText={decision === 'approve' ? '批准并归档' : '驳回申请'}
        okButtonProps={{ danger: decision === 'approve', loading: busy }}
      >
        <div style={{ padding: 10, background: '#fff7e6', borderRadius: 4, fontSize: 13, marginBottom: 12 }}>
          <div>申请人：<strong>{row.archive_requested_by}</strong>
            {row.archive_requested_at && <span style={{ color: '#999', marginLeft: 8 }}>{new Date(row.archive_requested_at).toLocaleString()}</span>}
          </div>
          <div>原因：{row.archive_request_note || <span style={{ color: '#999' }}>（未填写）</span>}</div>
        </div>
        <Radio.Group value={decision} onChange={(e) => setDecision(e.target.value)} style={{ marginBottom: 12 }}>
          <Radio.Button value="approve">批准（归档）</Radio.Button>
          <Radio.Button value="reject">驳回</Radio.Button>
        </Radio.Group>
        <Input.TextArea rows={3} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)}
          placeholder={decision === 'reject' ? '驳回必填：请说明理由' : '可选：审批备注'} />
      </Modal>
    </>
  );
}
