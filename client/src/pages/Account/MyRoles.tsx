import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Empty, Input, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import {
  AuditOutlined, CheckOutlined, CrownOutlined, ExperimentOutlined, FileTextOutlined,
  IdcardOutlined, LeftOutlined, SafetyCertificateOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth';
import { PERMISSION_LABELS, type Permission, type RoleDefinition } from '../../../../shared/rbac';
import PageHeader from '../../components/PageHeader';

const API = (import.meta as any).env?.VITE_API_URL || '/api';

const STATUS_LABEL: Record<string, { text: string; color: string }> = {
  pending: { text: '待审核', color: 'gold' },
  approved: { text: '已通过', color: 'green' },
  rejected: { text: '已驳回', color: 'red' },
  withdrawn: { text: '已撤回', color: 'default' },
};

const BUILTIN_VISUAL: Record<string, { icon: React.ReactNode; color: string }> = {
  admin: { icon: <CrownOutlined />, color: '#722ed1' },
  test_engineer: { icon: <ExperimentOutlined />, color: '#1677ff' },
  test_supervisor: { icon: <AuditOutlined />, color: '#13c2c2' },
  report_clerk: { icon: <FileTextOutlined />, color: '#fa8c16' },
  report_reviewer: { icon: <SafetyCertificateOutlined />, color: '#52c41a' },
};
const visualOf = (code: string) => BUILTIN_VISUAL[code] || { icon: <IdcardOutlined />, color: '#9254de' };

export default function MyRoles() {
  const navigate = useNavigate();
  const { user, refresh } = useAuth();
  const myRoles = user?.roles || [];
  const myPermissions = user?.permissions || [];
  const [definitions, setDefinitions] = useState<RoleDefinition[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [requests, setRequests] = useState<any[]>([]);

  const roleMap = useMemo(() => new Map(definitions.map(role => [role.code, role])), [definitions]);
  const requestable = definitions.filter(role => !myRoles.includes(role.code));
  const roleLabel = (code: string) => roleMap.get(code)?.label || code;

  const load = async () => {
    try {
      const [meta, requestResult] = await Promise.all([
        axios.get(`${API}/auth/meta`),
        axios.get(`${API}/auth/role-requests/mine`),
      ]);
      setDefinitions(meta.data.role_definitions || []);
      setRequests(requestResult.data || []);
    } catch {
      message.error('加载角色信息失败');
    }
  };
  useEffect(() => { load(); }, []);

  const hasPending = requests.some(request => request.status === 'pending');
  const goBack = () => window.history.length > 1 ? navigate(-1) : navigate('/record-templates');
  const toggle = (code: string) => setPicked(current =>
    current.includes(code) ? current.filter(item => item !== code) : [...current, code]);

  const submit = async () => {
    if (!picked.length) { message.warning('请选择要申请的角色'); return; }
    setSubmitting(true);
    try {
      await axios.post(`${API}/auth/role-requests`, { roles: picked, reason });
      message.success('已提交申请，等待管理员审核');
      setPicked([]);
      setReason('');
      load();
    } catch (error: any) {
      message.error(error?.response?.data?.error || '提交失败');
    } finally {
      setSubmitting(false);
    }
  };
  const withdraw = async (id: number) => {
    try {
      await axios.post(`${API}/auth/role-requests/${id}/withdraw`);
      message.success('已撤回');
      load();
    } catch (error: any) {
      message.error(error?.response?.data?.error || '撤回失败');
    }
  };

  return (
    <div style={{ padding: '20px 24px' }}>
      <PageHeader
        title="我的角色与权限"
        subtitle="角色及权限由管理员维护；你可以申请系统当前提供的任意未拥有角色。"
        extra={<Space>
          <Button onClick={() => { refresh(); load(); }}>刷新</Button>
          <Button icon={<LeftOutlined />} onClick={goBack}>收起</Button>
        </Space>}
      />

      <Card size="small" style={{ marginBottom: 16, borderRadius: 10 }}>
        <Space align="center" size={8} style={{ marginBottom: 12 }}>
          <IdcardOutlined style={{ color: '#1677ff' }} />
          <Typography.Text strong>当前角色</Typography.Text>
        </Space>
        {myRoles.length ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {myRoles.map(code => {
              const definition = roleMap.get(code);
              const visual = visualOf(code);
              return (
                <div key={code} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 8,
                  background: `${visual.color}14`, border: `1px solid ${visual.color}33`,
                }}>
                  <span style={{ color: visual.color, fontSize: 16, display: 'flex' }}>{visual.icon}</span>
                  <div style={{ lineHeight: 1.3 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{definition?.label || code}</div>
                    <div style={{ fontSize: 11, color: '#8a93a3' }}>{definition?.description || '自定义角色'}</div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : <Tag>暂无角色（待管理员分配）</Tag>}

        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #f0f0f0' }}>
          <Typography.Text type="secondary" style={{ fontSize: 12, marginRight: 8 }}>已获权限</Typography.Text>
          {myPermissions.length
            ? <Space size={[4, 6]} wrap>{myPermissions.map(permission => (
                <Tag key={permission} color="blue" style={{ marginRight: 0 }}>
                  {PERMISSION_LABELS[permission as Permission] || permission}
                </Tag>
              ))}</Space>
            : <Typography.Text type="secondary" style={{ fontSize: 12 }}>无</Typography.Text>}
        </div>
      </Card>

      <Card size="small" title="申请角色" style={{ marginBottom: 16, borderRadius: 10 }}>
        {requestable.length === 0 ? (
          <Typography.Text type="secondary">你已拥有全部角色，无需申请。</Typography.Text>
        ) : (
          <Space direction="vertical" style={{ width: '100%' }} size={14}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>点击卡片选择要申请的角色（可多选）</Typography.Text>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
              {requestable.map(role => {
                const visual = visualOf(role.code);
                const selected = picked.includes(role.code);
                return (
                  <div key={role.code} role="button" onClick={() => toggle(role.code)} style={{
                    position: 'relative', cursor: 'pointer', userSelect: 'none', padding: 14, borderRadius: 10,
                    border: `1.5px solid ${selected ? visual.color : '#e8ebf0'}`,
                    background: selected ? `${visual.color}0d` : '#fff',
                    boxShadow: selected ? `0 0 0 3px ${visual.color}1f` : 'none',
                  }}>
                    {selected && <span style={{
                      position: 'absolute', top: 10, right: 10, width: 20, height: 20, borderRadius: '50%',
                      background: visual.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}><CheckOutlined /></span>}
                    <Space align="center" size={8} style={{ marginBottom: 6 }}>
                      <span style={{
                        width: 30, height: 30, borderRadius: 8, background: `${visual.color}1a`, color: visual.color,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
                      }}>{visual.icon}</span>
                      <Typography.Text strong style={{ fontSize: 14 }}>{role.label}</Typography.Text>
                    </Space>
                    <div style={{ fontSize: 12, color: '#8a93a3', minHeight: 32, marginBottom: 8 }}>
                      {role.description || '管理员创建的自定义角色'}
                    </div>
                    <Space size={[4, 4]} wrap>
                      {role.permissions.map(permission => (
                        <Tag key={permission} style={{ marginRight: 0, fontSize: 11 }}>{PERMISSION_LABELS[permission]}</Tag>
                      ))}
                    </Space>
                  </div>
                );
              })}
            </div>

            <Input.TextArea rows={2} placeholder="申请理由（可选）" value={reason}
              onChange={event => setReason(event.target.value)} maxLength={500} showCount />
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

      <Card size="small" title="我的申请记录" style={{ borderRadius: 10 }}>
        <Table rowKey="id" size="small" pagination={false} dataSource={requests}
          locale={{ emptyText: <Empty description="暂无申请" /> }}
          columns={[
            { title: '申请角色', dataIndex: 'requested_roles', render: (values: string[]) => <Space size={[2, 4]} wrap>{(values || []).map(code => <Tag key={code}>{roleLabel(code)}</Tag>)}</Space> },
            { title: '理由', dataIndex: 'reason', render: (value: string) => value || '—' },
            { title: '状态', dataIndex: 'status', width: 90, render: (status: string) => <Tag color={STATUS_LABEL[status]?.color}>{STATUS_LABEL[status]?.text || status}</Tag> },
            { title: '审核意见', dataIndex: 'review_note', render: (value: string, row: any) => value ? `${value}（${row.reviewer_name || ''}）` : '—' },
            { title: '提交时间', dataIndex: 'created_at', width: 160, render: (value: string) => value ? new Date(value).toLocaleString('zh-CN') : '—' },
            { title: '操作', width: 80, render: (_: unknown, row: any) => row.status === 'pending' ? <Button size="small" type="link" onClick={() => withdraw(row.id)}>撤回</Button> : null },
          ] as any}
        />
      </Card>
    </div>
  );
}
