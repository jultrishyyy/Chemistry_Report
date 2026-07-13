import { Tag, Space, Avatar, Dropdown } from 'antd';
import { UserOutlined, LogoutOutlined, DownOutlined, IdcardOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { ROLE_LABELS, type Role } from '../../../shared/rbac';

/** 顶部当前用户：显示姓名 + 角色，下拉「我的角色/申请」+ 登出。 */
export default function UserSwitcher() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;

  const roleColor = user.roles.includes('admin' as Role) ? 'gold'
    : (user.roles.includes('test_supervisor' as Role) || user.roles.includes('report_reviewer' as Role)) ? 'green' : 'blue';

  return (
    <Dropdown
      menu={{ items: [
        { key: 'roles', icon: <IdcardOutlined />, label: '我的角色 / 申请', onClick: () => navigate('/me/roles') },
        { type: 'divider' },
        { key: 'out', icon: <LogoutOutlined />, label: '登出', onClick: logout },
      ] }}
      trigger={['click']}
    >
      <Space size={8} style={{ cursor: 'pointer', padding: '0 4px' }}>
        <Avatar size="small" icon={<UserOutlined />} style={{ background: roleColor === 'gold' ? '#d48806' : roleColor === 'green' ? '#52c41a' : '#1677ff' }} />
        <span style={{ fontSize: 13 }}>{user.user_name}</span>
        {user.roles.length
          ? user.roles.map((r) => <Tag key={r} color={roleColor} style={{ marginRight: 0 }}>{ROLE_LABELS[r] || r}</Tag>)
          : <Tag style={{ marginRight: 0 }}>待分配</Tag>}
        <DownOutlined style={{ fontSize: 10, color: '#999' }} />
      </Space>
    </Dropdown>
  );
}
