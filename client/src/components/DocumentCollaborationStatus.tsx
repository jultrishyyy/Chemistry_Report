import { Avatar, Badge, Button, Input, message, Modal, Popover, Space, Tag, Tooltip } from 'antd';
import { EditOutlined, EyeOutlined, SaveOutlined, SwapOutlined, TeamOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { useAuth } from '../auth';
import { useCollaborationPresence, useExclusiveEditLease } from '../hooks/useCollaboration';

export type DocumentLease = ReturnType<typeof useExclusiveEditLease>;

export default function DocumentCollaborationStatus({
  resourceType, resourceId, canEdit, lease, onSaveBeforeRelease, changes = [], saving = false,
}: {
  resourceType: 'record_template' | 'record_data' | 'report_template' | 'report_instance';
  resourceId?: string | number | null;
  canEdit: boolean;
  lease: DocumentLease;
  onSaveBeforeRelease?: () => Promise<boolean>;
  changes?: string[];
  /** 外层保存请求状态；与本组件的释放状态合并，防止重复点击。 */
  saving?: boolean;
}) {
  const { user } = useAuth();
  const [finishing, setFinishing] = useState(false);
  const { users, recentChanges } = useCollaborationPresence({
    resourceType, resourceId, enabled: !!resourceId && !!user,
    changes,
  });
  if (!resourceId) return null;

  const startEditing = async () => {
    if (await lease.acquire()) {
      // 令牌状态会直接把当前只读内容切换成可编辑；整页刷新会触发卸载清理，
      // 与刚取得的锁发生“获取后立即释放”的竞态。
      message.success('已取得编辑权，可以开始修改');
    }
    else message.info(`当前由 ${lease.holderName || '其他用户'} 编辑，你可以申请交接`);
  };
  const requestEditing = async () => {
    try {
      if (await lease.requestEdit()) message.success('编辑申请已发送');
    } catch (error: any) { message.error(error.response?.data?.error || '发送申请失败'); }
  };
  const forceEditing = () => {
    let reason = '';
    Modal.confirm({
      title: `强制接管 ${lease.holderName || '其他用户'} 的编辑权？`,
      content: <Input.TextArea autoFocus rows={3} placeholder="请填写强制接管原因（将写入审计日志）" onChange={event => { reason = event.target.value; }} />,
      okText: '确认强制接管', okButtonProps: { danger: true }, cancelText: '取消',
      onOk: async () => {
        if (!reason.trim()) { message.warning('请填写强制接管原因'); throw new Error('reason required'); }
        try {
          await lease.forceAcquire(reason.trim());
          message.success('已强制取得编辑权，可以开始修改');
        } catch (error: any) {
          message.error(error.response?.data?.error || '强制接管失败');
          throw error;
        }
      },
    });
  };
  const saveAndRelease = async () => {
    if (finishing || saving) return;
    setFinishing(true);
    try {
      if (onSaveBeforeRelease && !await onSaveBeforeRelease()) return;
      await lease.release();
      message.success('修改已保存，已结束编辑，现在可以提交审核');
    } catch (error: any) {
      message.error(error.response?.data?.error || '结束编辑失败');
    } finally {
      setFinishing(false);
    }
  };
  const respond = async (request: DocumentLease['pendingRequests'][number], action: 'approve' | 'reject') => {
    try {
      if (action === 'approve' && onSaveBeforeRelease && !await onSaveBeforeRelease()) return;
      await lease.respond(request.id, action);
      message.success(action === 'approve' ? `已保存并把编辑权交给 ${request.requester_name}` : `已拒绝 ${request.requester_name} 的申请`);
    } catch (error: any) { message.error(error.response?.data?.error || '处理申请失败'); }
  };

  const onlineContent = (
    <div style={{ width: 270, display: 'grid', gap: 9 }}>
      {users.length ? users.map(member => {
        const recent = recentChanges.find(item => item.user_job_no === member.user_job_no);
        const details = member.latest_changes?.length ? member : recent;
        return (
        <div key={member.user_job_no} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Popover trigger="click" placement="rightTop" title={`${member.user_name}的修改详情`} content={(
            <div style={{ width: 260 }}>
              {details?.latest_changes?.length
                ? <>{details.latest_changes.map(change => <div key={change} style={{ lineHeight: 1.8 }}>• {change}</div>)}
                    {details.last_change_at && <div style={{ color: '#98a2b3', fontSize: 12, marginTop: 6 }}>最近更新：{new Date(details.last_change_at).toLocaleString()}</div>}</>
                : <span style={{ color: '#98a2b3' }}>暂无修改记录</span>}
            </div>
          )}>
            <Badge dot color={member.is_editor ? '#52c41a' : '#98a2b3'}>
              <Avatar size={27} style={{ cursor: 'pointer', background: member.is_editor ? '#1677ff' : '#98a2b3' }}>{member.user_name.slice(0, 1)}</Avatar>
            </Badge>
          </Popover>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 600 }}>{member.user_name}{member.user_job_no === user?.job_no ? '（我）' : ''}</div>
            <div style={{ fontSize: 12, color: member.is_editor ? '#1677ff' : '#667085' }}>{member.is_editor ? '正在编辑' : '只读查看'}</div>
          </div>
        </div>
      ); }) : <span style={{ color: '#98a2b3' }}>正在获取在线状态…</span>}
    </div>
  );

  const requestsContent = (
    <div style={{ width: 300, display: 'grid', gap: 10 }}>
      {lease.pendingRequests.map(request => (
        <div key={request.id} style={{ paddingBottom: 9, borderBottom: '1px solid #f0f0f0' }}>
          <div style={{ marginBottom: 7 }}><strong>{request.requester_name}</strong> 申请编辑此文档</div>
          <Space size={6}>
            <Button size="small" type="primary" onClick={() => respond(request, 'approve')}>保存并交接</Button>
            <Button size="small" onClick={() => respond(request, 'reject')}>拒绝</Button>
          </Space>
        </div>
      ))}
    </div>
  );

  return (
    <Space size={6} wrap={false}>
      <Popover title={`当前在线 ${users.length} 人`} content={onlineContent} placement="bottomRight">
        <Tag icon={<TeamOutlined />} color="processing" style={{ margin: 0, cursor: 'pointer' }}>在线 {users.length}</Tag>
      </Popover>
      {!canEdit ? null : lease.loading ? <Tag style={{ margin: 0 }}>正在确认编辑权…</Tag>
        : lease.acquired ? (
          <>
            <Tag icon={<EditOutlined />} color="success" style={{ margin: 0 }}>我正在编辑</Tag>
            {!!lease.pendingRequests.length && (
              <Popover title="编辑权申请" content={requestsContent} placement="bottomRight">
                <Badge count={lease.pendingRequests.length} size="small">
                  <Button size="small" icon={<SwapOutlined />}>交接申请</Button>
                </Badge>
              </Popover>
            )}
            <Tooltip title="先保存当前内容，再让其他有权限的人员取得编辑权">
              <Button size="small" type="primary" icon={<SaveOutlined />} loading={finishing || saving}
                onClick={saveAndRelease}>结束编辑</Button>
            </Tooltip>
          </>
        ) : (
          <>
            <Tag icon={<EyeOutlined />} color={lease.holderName ? 'gold' : 'default'} style={{ margin: 0 }}>
              {lease.holderName ? `${lease.holderName}正在编辑 · 我只读` : '当前只读'}
            </Tag>
            {canEdit && !lease.holderName && <Button size="small" type="primary" icon={<EditOutlined />} onClick={startEditing}>开始编辑</Button>}
            {canEdit && !!lease.holderName && (
              <>
                <Button size="small" icon={<SwapOutlined />} onClick={requestEditing} disabled={lease.myRequestStatus === 'pending'}>
                  {lease.myRequestStatus === 'pending' ? '已申请，等待处理' : '申请编辑'}
                </Button>
                {user?.roles?.includes('admin') && <Button size="small" danger onClick={forceEditing}>强制接管</Button>}
              </>
            )}
          </>
        )}
    </Space>
  );
}
