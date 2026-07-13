import { useEffect, useState } from 'react';
import { Card, Tag, Input, Button, message, Space, Typography, Table, Empty, Tooltip } from 'antd';
import {
  CrownOutlined, ExperimentOutlined, AuditOutlined, FileTextOutlined,
  SafetyCertificateOutlined, CheckOutlined, IdcardOutlined, LeftOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth';
import {
  ALL_ROLES, ROLE_LABELS, ROLE_DESCRIPTIONS, ROLE_PERMISSIONS, PERMISSION_LABELS,
  permissionsForRoles, type Role,
} from '../../../../shared/rbac';
import PageHeader from '../../components/PageHeader';

const API = (import.meta as any).env?.VITE_API_URL || '/api';

const STATUS_LABEL: Record<string, { text: string; color: string }> = {
  pending: { text: '待审核', color: 'gold' },
  approved: { text: '已通过', color: 'green' },
  rejected: { text: '已驳回', color: 'red' },
  withdrawn: { text: '已撤回', color: 'default' },
};

/** 每个角色一个图标 + 主题色，让卡片可一眼区分。 */
const ROLE_VISUAL: Record<Role, { icon: React.ReactNode; color: string }> = {
  admin: { icon: <CrownOutlined />, color: '#722ed1' },
  test_engineer: { icon: <ExperimentOutlined />, color: '#1677ff' },
  test_supervisor: { icon: <AuditOutlined />, color: '#13c2c2' },
  report_clerk: { icon: <FileTextOutlined />, color: '#fa8c16' },
  report_reviewer: { icon: <SafetyCertificateOutlined />, color: '#52c41a' },
};

/** 自助：查看我的角色/权限 + 申请新角色 + 看申请进度。所有登录用户可见。 */
export default function MyRoles() {
  const navigate = useNavigate();
  const { user, refresh } = useAuth();
  const myRoles = (user?.roles || []) as Role[];
  const myPerms = permissionsForRoles(myRoles);
  // 可申请的角色＝还没有的
  const requestable = ALL_ROLES.filter((r) => !myRoles.includes(r));

  const [picked, setPicked] = useState<Role[]>([]);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [reqs, setReqs] = useState<any[]>([]);

  const load = async () => {
    try { const r = await axios.get(`${API}/auth/role-requests/mine`); setReqs(r.data || []); } catch { /* ignore */ }
  };
  useEffect(() => { load(); }, []);

  const hasPending = reqs.some((r) => r.status === 'pending');
  // 收起：回到进入本页前所在的界面；无历史记录时兜底到首页
  const goBack = () => { if (window.history.length > 1) navigate(-1); else navigate('/record-templates'); };
  const toggle = (r: Role) => setPicked((p) => (p.includes(r) ? p.filter((x) => x !== r) : [...p, r]));

  const submit = async () => {
    if (!picked.length) { message.warning('请选择要申请的角色'); return; }
    setSubmitting(true);
    try {
      await axios.post(`${API}/auth/role-requests`, { roles: picked, reason });
      message.success('已提交申请，等待管理员审核');
      setPicked([]); setReason('');
      load();
    } catch (e: any) { message.error(e?.response?.data?.error || '提交失败'); }
    finally { setSubmitting(false); }
  };
  const withdraw = async (id: number) => {
    try { await axios.post(`${API}/auth/role-requests/${id}/withdraw`); message.success('已撤回'); load(); }
    catch (e: any) { message.error(e?.response?.data?.error || '撤回失败'); }
  };

  return (
    <div style={{ padding: '20px 24px' }}>
      <PageHeader
        title="我的角色与权限"
        subtitle="登录身份来自外部认证；角色/权限在本系统本地管理。没有需要的角色可在此申请，由管理员审核分配。"
        extra={(
          <Space>
            <Button onClick={() => { refresh?.(); load(); }}>刷新</Button>
            <Button icon={<LeftOutlined />} onClick={goBack}>收起</Button>
          </Space>
        )}
      />

      {/* 当前角色 / 权限 */}
      <Card size="small" style={{ marginBottom: 16, borderRadius: 10 }}>
        <Space align="center" size={8} style={{ marginBottom: 12 }}>
          <IdcardOutlined style={{ color: '#1677ff' }} />
          <Typography.Text strong>当前角色</Typography.Text>
        </Space>
        {myRoles.length ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {myRoles.map((r) => (
              <div key={r} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 12px', borderRadius: 8,
                background: `${ROLE_VISUAL[r].color}14`, border: `1px solid ${ROLE_VISUAL[r].color}33`,
              }}>
                <span style={{ color: ROLE_VISUAL[r].color, fontSize: 16, display: 'flex' }}>{ROLE_VISUAL[r].icon}</span>
                <div style={{ lineHeight: 1.3 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{ROLE_LABELS[r]}</div>
                  <div style={{ fontSize: 11, color: '#8a93a3' }}>{ROLE_DESCRIPTIONS[r]}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Tag>暂无角色（待管理员分配）</Tag>
        )}

        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #f0f0f0' }}>
          <Typography.Text type="secondary" style={{ fontSize: 12, marginRight: 8 }}>已获权限</Typography.Text>
          {myPerms.length
            ? <Space size={[4, 6]} wrap>{myPerms.map((p) => <Tag key={p} color="blue" style={{ marginRight: 0 }}>{PERMISSION_LABELS[p]}</Tag>)}</Space>
            : <Typography.Text type="secondary" style={{ fontSize: 12 }}>无</Typography.Text>}
        </div>
      </Card>

      {/* 申请角色 */}
      <Card size="small" title="申请角色" style={{ marginBottom: 16, borderRadius: 10 }}>
        {requestable.length === 0 ? (
          <Typography.Text type="secondary">你已拥有全部角色，无需申请。</Typography.Text>
        ) : (
          <Space direction="vertical" style={{ width: '100%' }} size={14}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>点击卡片选择要申请的角色（可多选）</Typography.Text>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
              {requestable.map((r) => {
                const v = ROLE_VISUAL[r];
                const on = picked.includes(r);
                return (
                  <div
                    key={r}
                    role="button"
                    onClick={() => toggle(r)}
                    style={{
                      position: 'relative', cursor: 'pointer', userSelect: 'none',
                      padding: 14, borderRadius: 10,
                      border: `1.5px solid ${on ? v.color : '#e8ebf0'}`,
                      background: on ? `${v.color}0d` : '#fff',
                      boxShadow: on ? `0 0 0 3px ${v.color}1f` : 'none',
                      transition: 'all .15s',
                    }}
                  >
                    {on && (
                      <span style={{
                        position: 'absolute', top: 10, right: 10, width: 20, height: 20, borderRadius: '50%',
                        background: v.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12,
                      }}><CheckOutlined /></span>
                    )}
                    <Space align="center" size={8} style={{ marginBottom: 6 }}>
                      <span style={{
                        width: 30, height: 30, borderRadius: 8, background: `${v.color}1a`, color: v.color,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
                      }}>{v.icon}</span>
                      <Typography.Text strong style={{ fontSize: 14 }}>{ROLE_LABELS[r]}</Typography.Text>
                    </Space>
                    <div style={{ fontSize: 12, color: '#8a93a3', minHeight: 32, marginBottom: 8, lineHeight: 1.4 }}>{ROLE_DESCRIPTIONS[r]}</div>
                    <Space size={[4, 4]} wrap>
                      {ROLE_PERMISSIONS[r].map((p) => <Tag key={p} style={{ marginRight: 0, fontSize: 11 }}>{PERMISSION_LABELS[p]}</Tag>)}
                    </Space>
                  </div>
                );
              })}
            </div>

            <Input.TextArea
              rows={2}
              placeholder="申请理由（可选，如：负责本组报告生成，需要文员权限）"
              value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} showCount
            />
            <Space>
              <Tooltip title={hasPending ? '你已有一条待审申请，请先撤回' : ''}>
                <Button type="primary" loading={submitting} disabled={hasPending || !picked.length} onClick={submit}>
                  提交申请{picked.length ? `（${picked.length}）` : ''}
                </Button>
              </Tooltip>
              {picked.length > 0 && <Button type="text" onClick={() => setPicked([])}>清空</Button>}
            </Space>
          </Space>
        )}
      </Card>

      {/* 申请记录 */}
      <Card size="small" title="我的申请记录" style={{ borderRadius: 10 }}>
        <Table rowKey="id" size="small" pagination={false} dataSource={reqs}
          locale={{ emptyText: <Empty description="暂无申请" /> }}
          columns={[
            { title: '申请角色', dataIndex: 'requested_roles', render: (rs: string[]) => <Space size={[2, 4]} wrap>{(rs || []).map((r) => <Tag key={r}>{ROLE_LABELS[r as Role] || r}</Tag>)}</Space> },
            { title: '理由', dataIndex: 'reason', render: (v: string) => v || '—' },
            { title: '状态', dataIndex: 'status', width: 90, render: (s: string) => <Tag color={STATUS_LABEL[s]?.color}>{STATUS_LABEL[s]?.text || s}</Tag> },
            { title: '审核意见', dataIndex: 'review_note', render: (v: string, r: any) => v ? `${v}（${r.reviewer_name || ''}）` : '—' },
            { title: '提交时间', dataIndex: 'created_at', width: 160, render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '—' },
            { title: '操作', width: 80, render: (_: any, r: any) => r.status === 'pending' ? <Button size="small" type="link" onClick={() => withdraw(r.id)}>撤回</Button> : null },
          ] as any} />
      </Card>
    </div>
  );
}
