/**
 * 模板删除审批按钮（两个列表页共用，migration 023）
 *
 * 删除不再即点即删：
 *   - 无申请        → 红色删除图标 = 「申请删除」弹窗（原因可选）
 * 列表固定流程模式下始终占据“提交 / 撤回 / 审核 / 删除”四个位置：
 * 删除待审时提交与删除禁用，撤回和审核按权限启用，按钮不会因状态切换而跳位。
 * record 模板批准时若有活跃报告模板引用会 409，弹确认后带 force:true 重批。
 */
import { useState } from 'react';
import { Button, Modal, Input, Tooltip, Radio, message } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import axios from 'axios';
import { useAuth } from '../auth';
import { WorkflowActionButton } from './TemplateVersionPanel';

const API = '/api';

export interface ArchiveRow {
  id: number;
  name: string;
  archive_requested_by?: string | null;
  archive_requested_at?: string | null;
  archive_request_note?: string | null;
}

export default function TemplateArchiveButton({ kind, row, onRefresh, fixedWorkflow = false, disabled = false, disabledReason }: {
  kind: 'record' | 'report';
  row: ArchiveRow;
  onRefresh: () => void;
  /** 删除待审时占据固定的“提交 / 撤回 / 审核 / 删除”四个位置。 */
  fixedWorkflow?: boolean;
  /** 版本正在审核时保留删除按钮位置，但禁止再发起删除申请。 */
  disabled?: boolean;
  disabledReason?: string;
}) {
  const { user, has } = useAuth();
  const base = kind === 'record' ? `${API}/record-templates` : `${API}/report-templates`;
  const canEditTemplate = has(kind === 'record' ? 'record_template.edit' : 'report_template.edit');
  const canReviewTemplate = has(kind === 'record' ? 'record.review' : 'report.review');

  const [requestOpen, setRequestOpen] = useState(false);
  const [requestNote, setRequestNote] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [decision, setDecision] = useState<'approve' | 'reject'>('approve');
  const [reviewNote, setReviewNote] = useState('');
  const [busy, setBusy] = useState(false);

  const doRequest = async () => {
    if (!canEditTemplate) { message.warning('当前账号无删除模板权限'); return; }
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
    if (!canEditTemplate) { message.warning('当前账号无撤销删除申请权限'); return; }
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
    if (!canReviewTemplate) { message.warning('当前账号无审批模板删除权限'); return; }
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
  const isAdministrator = !!user?.roles?.includes('admin');
  // 普通申请人不可自审；管理员保留系统职责例外（与服务端 reviewArchiveRequest 一致）。
  const canReview = requested && canReviewTemplate && (!isRequester || isAdministrator);
  const canCancel = requested && canEditTemplate && (isRequester || canReviewTemplate);

  const openReview = () => {
    setDecision('approve');
    setReviewNote('');
    setReviewOpen(true);
  };

  const trigger = fixedWorkflow && requested ? (
    <>
      <WorkflowActionButton action="submit" title="删除申请审核中，不能提交模板版本" disabled onClick={() => undefined} />
      <WorkflowActionButton action="withdraw"
        title={canCancel ? '撤回删除申请' : !canEditTemplate ? '当前账号无撤回删除申请权限' : '只有申请人或审核员可以撤回删除申请'}
        disabled={!canCancel} onClick={doCancel} />
      <WorkflowActionButton action="review"
        title={canReview ? `审核删除申请（${row.archive_requested_by} 发起）`
          : isRequester && canReviewTemplate ? '申请人不能审核自己发起的删除申请' : '当前账号无模板删除审核权限'}
        disabled={!canReview} onClick={openReview} />
      <Tooltip title="删除申请已经提交，不能重复申请删除">
        <Button size="small" danger disabled icon={<DeleteOutlined />} />
      </Tooltip>
    </>
  ) : !canEditTemplate && !canReviewTemplate ? (
    <Tooltip title="当前账号无删除模板权限">
      <Button size="small" danger disabled icon={<DeleteOutlined />} />
    </Tooltip>
  ) : !requested ? (
    <Tooltip title={disabled ? (disabledReason || '当前状态不能申请删除')
      : !canEditTemplate ? '当前账号无删除模板权限' : '申请删除（需审核员批准后生效）'}>
      <Button size="small" danger icon={<DeleteOutlined />} disabled={disabled || !canEditTemplate}
        onClick={() => setRequestOpen(true)} />
    </Tooltip>
  ) : isRequester ? (
    <WorkflowActionButton action="withdraw" title="撤回删除申请"
      disabled={!canEditTemplate} onClick={doCancel} />
  ) : canReview ? (
    <WorkflowActionButton action="review"
      title={`审核删除申请（${row.archive_requested_by} 发起${row.archive_request_note ? `：${row.archive_request_note}` : ''}）`}
      onClick={openReview} />
  ) : (
    <Tooltip title={`删除申请审批中（${row.archive_requested_by} 发起）`}>
      <Button size="small" disabled icon={<DeleteOutlined />} />
    </Tooltip>
  );

  return (
    <>
      {trigger}

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
