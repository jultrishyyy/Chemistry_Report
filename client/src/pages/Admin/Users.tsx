import { useEffect, useState } from 'react';
import { Table, Select, Switch, Tag, message, Space, Typography, Tooltip, Card, Button, Input, Modal, Empty, Badge } from 'antd';
import axios from 'axios';
import { useAuth } from '../../auth';
import { ALL_ROLES, ROLE_LABELS, ROLE_PERMISSIONS, PERMISSION_LABELS, permissionsForRoles, type Role } from '../../../../shared/rbac';
import PageHeader from '../../components/PageHeader';

const API = (import.meta as any).env?.VITE_API_URL || '/api';

interface Row {
  job_no: string; user_name: string; depart_name?: string | null;
  roles: Role[]; active: boolean; last_login_at?: string | null; permissions: string[];
}

export default function AdminUsers() {
  const { user, has } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/auth/users`);
      setRows(res.data);
    } catch (e: any) {
      message.error(e?.response?.data?.error || '加载失败');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const update = async (jobNo: string, patch: { roles?: Role[]; active?: boolean }) => {
    try {
      const res = await axios.put(`${API}/auth/users/${encodeURIComponent(jobNo)}`, patch);
      setRows((rs) => rs.map((r) => (r.job_no === jobNo ? res.data : r)));
      message.success('已保存');
    } catch (e: any) {
      message.error(e?.response?.data?.error || '保存失败');
      load(); // 回滚到服务端真实状态
    }
  };

  // ── 角色申请审核 ──
  const [reqs, setReqs] = useState<any[]>([]);
  const loadReqs = async () => {
    try { const r = await axios.get(`${API}/auth/role-requests`); setReqs(r.data || []); } catch { /* ignore */ }
  };
  useEffect(() => { loadReqs(); }, []);
  const review = async (id: number, action: 'approve' | 'reject', note?: string) => {
    try {
      await axios.post(`${API}/auth/role-requests/${id}/review`, { action, note });
      message.success(action === 'approve' ? '已通过并分配角色' : '已驳回');
      loadReqs(); load();
    } catch (e: any) { message.error(e?.response?.data?.error || '操作失败'); }
  };
  const reject = (id: number) => {
    let note = '';
    Modal.confirm({
      title: '驳回角色申请', okText: '确认驳回', okButtonProps: { danger: true },
      content: <Input.TextArea rows={3} placeholder="驳回说明（必填）" onChange={(e) => { note = e.target.value; }} />,
      onOk: async () => { if (!note.trim()) { message.warning('请填写驳回说明'); throw new Error('no note'); } await review(id, 'reject', note.trim()); },
    });
  };

  if (!has('user.manage')) {
    return <div style={{ padding: 24 }}><Typography.Text type="danger">无权限：用户管理仅限管理员。</Typography.Text></div>;
  }

  const columns = [
    { title: '工号', dataIndex: 'job_no', width: 120 },
    { title: '姓名', dataIndex: 'user_name', width: 110 },
    { title: '部门', dataIndex: 'depart_name', width: 130, render: (v: string) => v || '—' },
    {
      title: '角色', dataIndex: 'roles', width: 280,
      render: (roles: Role[], r: Row) => (
        <Select
          mode="multiple" value={roles} style={{ width: '100%' }} placeholder="待分配"
          disabled={r.job_no === user?.job_no}
          options={ALL_ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }))}
          onChange={(val) => update(r.job_no, { roles: val as Role[] })}
        />
      ),
    },
    {
      title: '权限', dataIndex: 'permissions', width: 260,
      render: (_: any, r: Row) => {
        const perms = permissionsForRoles(r.roles);
        if (!perms.length) return <Tag>待分配</Tag>;
        return <Space size={[2, 4]} wrap>{perms.map((p) => <Tag key={p} color="blue" style={{ marginRight: 0 }}>{PERMISSION_LABELS[p]}</Tag>)}</Space>;
      },
    },
    {
      title: '状态', dataIndex: 'active', width: 90,
      render: (active: boolean, r: Row) => (
        <Tooltip title={r.job_no === user?.job_no ? '不能停用自己' : ''}>
          <Switch checked={active} disabled={r.job_no === user?.job_no} onChange={(v) => update(r.job_no, { active: v })} />
        </Tooltip>
      ),
    },
    { title: '最后登录', dataIndex: 'last_login_at', width: 160, render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '—' },
  ];

  return (
    <div style={{ padding: 20 }}>
      <PageHeader title="用户管理" subtitle="登录身份来自外部认证；角色与权限在本系统本地分配（角色→权限见下表）。用户可自助「申请角色」，在此审核分配。" />

      <Card size="small" style={{ marginBottom: 16, borderColor: reqs.length ? '#ffd591' : undefined, background: reqs.length ? '#fffbe6' : undefined }}
        title={<Space><Badge count={reqs.length} size="small" offset={[6, -2]}>待审角色申请</Badge></Space>}
        extra={<Button size="small" onClick={loadReqs}>刷新</Button>}>
        {reqs.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无待审申请" />
        ) : (
          <Table rowKey="id" size="small" pagination={false} dataSource={reqs}
            columns={[
              { title: '申请人', width: 160, render: (_: any, r: any) => <span>{r.user_name || '—'} <Typography.Text type="secondary">（{r.job_no}）</Typography.Text></span> },
              { title: '申请角色', dataIndex: 'requested_roles', render: (rs: string[]) => <Space size={[2, 4]} wrap>{(rs || []).map((x) => <Tag key={x} color="geekblue">{ROLE_LABELS[x as Role] || x}</Tag>)}</Space> },
              { title: '理由', dataIndex: 'reason', render: (v: string) => v || '—' },
              { title: '提交时间', dataIndex: 'created_at', width: 160, render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '—' },
              { title: '操作', width: 140, render: (_: any, r: any) => (
                <Space size={4}>
                  <Button size="small" type="primary" onClick={() => review(r.id, 'approve')}>通过</Button>
                  <Button size="small" danger onClick={() => reject(r.id)}>驳回</Button>
                </Space>
              ) },
            ] as any} />
        )}
      </Card>

      <Table rowKey="job_no" size="small" loading={loading} dataSource={rows} columns={columns as any} pagination={false} style={{ marginBottom: 24 }} />
      <Typography.Title level={5}>角色 → 权限对照</Typography.Title>
      <Table
        rowKey="role" size="small" pagination={false}
        dataSource={ALL_ROLES.map((role) => ({ role, perms: ROLE_PERMISSIONS[role] }))}
        columns={[
          { title: '角色', dataIndex: 'role', width: 140, render: (role: Role) => <Tag color="geekblue">{ROLE_LABELS[role]}</Tag> },
          { title: '权限', dataIndex: 'perms', render: (perms: string[]) => <Space size={[2, 4]} wrap>{perms.map((p) => <Tag key={p} style={{ marginRight: 0 }}>{PERMISSION_LABELS[p as keyof typeof PERMISSION_LABELS]}</Tag>)}</Space> },
        ] as any}
      />
    </div>
  );
}
