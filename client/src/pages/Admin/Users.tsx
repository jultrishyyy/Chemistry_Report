import { useEffect, useMemo, useState } from 'react';
import {
  Badge, Button, Card, Empty, Input, Modal, Select, Space, Switch, Table, Tag, Tooltip, Typography, message,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import axios from 'axios';
import { useAuth } from '../../auth';
import {
  ALL_PERMISSIONS, PERMISSION_LABELS, type Permission, type RoleDefinition,
} from '../../../../shared/rbac';
import PageHeader from '../../components/PageHeader';
import AutoGrowTextArea from '../../components/AutoGrowTextArea';
import { ListPageSizeControl, useListPagination } from '../../hooks/useListPagination';

const API = (import.meta as any).env?.VITE_API_URL || '/api';

interface Row {
  job_no: string;
  user_name: string;
  depart_name?: string | null;
  roles: string[];
  active: boolean;
  last_login_at?: string | null;
  permissions: Permission[];
}

interface RoleDraft {
  code?: string;
  label: string;
  description: string;
  permissions: Permission[];
}

const EMPTY_ROLE: RoleDraft = { label: '', description: '', permissions: [] };

export default function AdminUsers() {
  const { user, has } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [roleModal, setRoleModal] = useState<RoleDraft | null>(null);
  const [roleSaving, setRoleSaving] = useState(false);
  const { pagination: userPagination, pageSize, setPageSize } = useListPagination(rows.length);

  const roleMap = useMemo(() => new Map(roles.map(role => [role.code, role])), [roles]);
  const roleLabel = (code: string) => roleMap.get(code)?.label || code;

  const loadMeta = async () => {
    const response = await axios.get(`${API}/auth/meta`);
    setRoles(response.data.role_definitions || []);
  };
  const loadUsers = async () => {
    const response = await axios.get(`${API}/auth/users`);
    setRows(response.data || []);
  };
  const loadRequests = async () => {
    const response = await axios.get(`${API}/auth/role-requests`);
    setRequests(response.data || []);
  };
  const load = async () => {
    setLoading(true);
    try {
      await Promise.all([loadMeta(), loadUsers(), loadRequests()]);
    } catch (error: any) {
      message.error(error?.response?.data?.error || '加载失败');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const updateUser = async (jobNo: string, patch: { roles?: string[]; active?: boolean }) => {
    try {
      const response = await axios.put(`${API}/auth/users/${encodeURIComponent(jobNo)}`, patch);
      setRows(current => current.map(row => row.job_no === jobNo ? response.data : row));
      message.success('已保存');
    } catch (error: any) {
      message.error(error?.response?.data?.error || '保存失败');
      loadUsers();
    }
  };

  const deleteUser = (row: Row) => {
    Modal.confirm({
      title: `删除用户“${row.user_name}”？`,
      content: '这会删除本系统中的角色分配和启停状态。该人员若再次通过外部账号登录，会重新以“无角色”用户建档。',
      okText: '确认删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await axios.delete(`${API}/auth/users/${encodeURIComponent(row.job_no)}`);
          setRows(current => current.filter(item => item.job_no !== row.job_no));
          message.success('用户已删除');
        } catch (error: any) {
          message.error(error?.response?.data?.error || '删除失败');
          throw error;
        }
      },
    });
  };

  const saveRole = async (draft: RoleDraft) => {
    if (!draft.label.trim()) { message.warning('请输入角色名称'); return; }
    setRoleSaving(true);
    try {
      if (draft.code) {
        await axios.put(`${API}/auth/roles/${encodeURIComponent(draft.code)}`, draft);
      } else {
        await axios.post(`${API}/auth/roles`, draft);
      }
      message.success(draft.code ? '角色已更新' : '角色已创建');
      setRoleModal(null);
      await Promise.all([loadMeta(), loadUsers()]);
    } catch (error: any) {
      message.error(error?.response?.data?.error || '保存角色失败');
    } finally {
      setRoleSaving(false);
    }
  };

  const updateRolePermissions = async (role: RoleDefinition, permissions: Permission[]) => {
    try {
      await axios.put(`${API}/auth/roles/${encodeURIComponent(role.code)}`, { permissions });
      message.success(`已更新“${role.label}”的权限`);
      await Promise.all([loadMeta(), loadUsers()]);
    } catch (error: any) {
      message.error(error?.response?.data?.error || '更新权限失败');
      loadMeta();
    }
  };

  const review = async (id: number, action: 'approve' | 'reject', note?: string) => {
    try {
      await axios.post(`${API}/auth/role-requests/${id}/review`, { action, note });
      message.success(action === 'approve' ? '已通过并分配角色' : '已驳回');
      await Promise.all([loadRequests(), loadUsers()]);
    } catch (error: any) {
      message.error(error?.response?.data?.error || '操作失败');
    }
  };
  const reject = (id: number) => {
    let note = '';
    Modal.confirm({
      title: '驳回角色申请',
      okText: '确认驳回',
      okButtonProps: { danger: true },
      content: <Input.TextArea rows={3} placeholder="驳回说明（必填）" onChange={event => { note = event.target.value; }} />,
      onOk: async () => {
        if (!note.trim()) { message.warning('请填写驳回说明'); throw new Error('missing note'); }
        await review(id, 'reject', note.trim());
      },
    });
  };

  if (!has('user.manage')) {
    return <div style={{ padding: 24 }}><Typography.Text type="danger">无权限：用户管理仅限管理员。</Typography.Text></div>;
  }

  const permissionOptions = ALL_PERMISSIONS.map(permission => ({
    value: permission,
    label: PERMISSION_LABELS[permission],
  }));

  const userColumns = [
    { title: '工号', dataIndex: 'job_no', width: 120 },
    { title: '姓名', dataIndex: 'user_name', width: 110 },
    { title: '部门', dataIndex: 'depart_name', width: 130, render: (value: string) => value || '—' },
    {
      title: '角色', dataIndex: 'roles', width: 280,
      render: (values: string[], row: Row) => (
        <Select
          mode="multiple"
          value={values}
          style={{ width: '100%' }}
          placeholder="待分配"
          disabled={row.job_no === user?.job_no}
          options={roles.map(role => ({ value: role.code, label: role.label }))}
          onChange={next => updateUser(row.job_no, { roles: next })}
        />
      ),
    },
    {
      title: '权限', dataIndex: 'permissions', width: 280,
      render: (permissions: Permission[]) => permissions?.length
        ? <Space size={[2, 4]} wrap>{permissions.map(permission => (
            <Tag key={permission} color="blue" style={{ marginRight: 0 }}>{PERMISSION_LABELS[permission]}</Tag>
          ))}</Space>
        : <Tag>待分配</Tag>,
    },
    {
      title: '状态', dataIndex: 'active', width: 80,
      render: (active: boolean, row: Row) => (
        <Tooltip title={row.job_no === user?.job_no ? '不能停用自己' : ''}>
          <Switch checked={active} disabled={row.job_no === user?.job_no}
            onChange={value => updateUser(row.job_no, { active: value })} />
        </Tooltip>
      ),
    },
    {
      title: '最后登录', dataIndex: 'last_login_at', width: 160,
      render: (value: string) => value ? new Date(value).toLocaleString('zh-CN') : '—',
    },
    {
      title: '操作', width: 80, fixed: 'right',
      render: (_: unknown, row: Row) => (
        <Tooltip title={row.job_no === user?.job_no ? '不能删除当前登录用户' : '删除用户'}>
          <Button type="text" danger icon={<DeleteOutlined />} disabled={row.job_no === user?.job_no}
            onClick={() => deleteUser(row)} />
        </Tooltip>
      ),
    },
  ];

  return (
    <div style={{ padding: 20 }}>
      <PageHeader
        title="用户管理"
        subtitle="管理员可维护角色及其权限、审核角色申请、分配角色，并停用或删除本地用户。"
        extra={<ListPageSizeControl value={pageSize} onChange={setPageSize} />}
      />

      <Card
        size="small"
        style={{ marginBottom: 16, borderColor: requests.length ? '#ffd591' : undefined, background: requests.length ? '#fffbe6' : undefined }}
        title={<Badge count={requests.length} size="small" offset={[6, -2]}>待审角色申请</Badge>}
        extra={<Button size="small" onClick={loadRequests}>刷新</Button>}
      >
        {requests.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无待审申请" />
        ) : (
          <Table rowKey="id" size="small" pagination={false} dataSource={requests}
            columns={[
              { title: '申请人', width: 160, render: (_: unknown, row: any) => <span>{row.user_name || '—'} <Typography.Text type="secondary">（{row.job_no}）</Typography.Text></span> },
              { title: '申请角色', dataIndex: 'requested_roles', render: (values: string[]) => <Space size={[2, 4]} wrap>{(values || []).map(value => <Tag key={value} color="geekblue">{roleLabel(value)}</Tag>)}</Space> },
              { title: '理由', dataIndex: 'reason', render: (value: string) => value || '—' },
              { title: '提交时间', dataIndex: 'created_at', width: 160, render: (value: string) => value ? new Date(value).toLocaleString('zh-CN') : '—' },
              { title: '操作', width: 140, render: (_: unknown, row: any) => <Space size={4}>
                <Button size="small" type="primary" onClick={() => review(row.id, 'approve')}>通过</Button>
                <Button size="small" danger onClick={() => reject(row.id)}>驳回</Button>
              </Space> },
            ] as any}
          />
        )}
      </Card>

      <Table
        rowKey="job_no"
        size="small"
        loading={loading}
        dataSource={rows}
        columns={userColumns as any}
        pagination={userPagination}
        scroll={{ x: 1200 }}
        style={{ marginBottom: 24 }}
      />

      <Card
        size="small"
        title="角色与权限"
        extra={<Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setRoleModal({ ...EMPTY_ROLE })}>新增角色</Button>}
      >
        <Table
          rowKey="code"
          size="small"
          pagination={false}
          dataSource={roles}
          columns={[
            {
              title: '角色', width: 180,
              render: (_: unknown, role: RoleDefinition) => <Space>
                <Tag color={role.builtin ? 'geekblue' : 'purple'}>{role.label}</Tag>
                {role.builtin && <Typography.Text type="secondary" style={{ fontSize: 11 }}>内置</Typography.Text>}
              </Space>,
            },
            { title: '说明', dataIndex: 'description', width: 280, render: (value: string) => value || '—' },
            {
              title: '权限',
              render: (_: unknown, role: RoleDefinition) => (
                <Select
                  mode="multiple"
                  value={role.permissions}
                  options={permissionOptions}
                  style={{ width: '100%', minWidth: 360 }}
                  onChange={values => updateRolePermissions(role, values as Permission[])}
                />
              ),
            },
            {
              title: '操作', width: 80,
              render: (_: unknown, role: RoleDefinition) => (
                <Button type="text" icon={<EditOutlined />} onClick={() => setRoleModal({
                  code: role.code,
                  label: role.label,
                  description: role.description || '',
                  permissions: role.permissions,
                })}>编辑</Button>
              ),
            },
          ] as any}
        />
      </Card>

      <Modal
        open={!!roleModal}
        title={roleModal?.code ? '编辑角色' : '新增角色'}
        okText="保存"
        confirmLoading={roleSaving}
        onCancel={() => setRoleModal(null)}
        onOk={() => roleModal && saveRole(roleModal)}
      >
        {roleModal && <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div>
            <Typography.Text>角色名称</Typography.Text>
            <AutoGrowTextArea value={roleModal.label} placeholder="如：实验室助理"
              onChange={event => setRoleModal({ ...roleModal, label: event.target.value })} />
          </div>
          <div>
            <Typography.Text>角色说明</Typography.Text>
            <AutoGrowTextArea value={roleModal.description} placeholder="简要说明职责范围"
              onChange={event => setRoleModal({ ...roleModal, description: event.target.value })} />
          </div>
          <div>
            <Typography.Text>权限</Typography.Text>
            <Select mode="multiple" value={roleModal.permissions} options={permissionOptions}
              style={{ width: '100%' }} placeholder="选择权限"
              onChange={values => setRoleModal({ ...roleModal, permissions: values as Permission[] })} />
          </div>
        </Space>}
      </Modal>
    </div>
  );
}
