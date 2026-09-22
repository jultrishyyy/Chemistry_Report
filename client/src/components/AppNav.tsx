import { useNavigate, useLocation } from 'react-router-dom';
import { Menu } from 'antd';
import { FileTextOutlined, ExperimentOutlined, FileDoneOutlined, ToolOutlined, TeamOutlined } from '@ant-design/icons';
import UserSwitcher from './UserSwitcher';
import { useAuth } from '../auth';

const NAV_ITEMS = [
  { key: '/record-templates', label: '原始记录模板', icon: <FileTextOutlined /> },
  { key: '/lab', label: '实验室录入', icon: <ExperimentOutlined /> },
  { key: '/report-templates', label: '报告模板', icon: <FileDoneOutlined /> },
  { key: '/report', label: '生成报告', icon: <FileDoneOutlined /> },
  { key: '/equipment', label: '设备库', icon: <ToolOutlined /> },
];

export default function AppNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { has } = useAuth();

  // 用户管理仅 user.manage 可见
  const items = has('user.manage')
    ? [...NAV_ITEMS, { key: '/admin/users', label: '用户管理', icon: <TeamOutlined /> }]
    : NAV_ITEMS;

  // 命中哪个 tab 就高亮哪个；像 /me/roles 这类不在导航里的页面则不高亮任何 tab（不要兜底到原始记录模板）
  const selectedKey = items.find(item => location.pathname.startsWith(item.key))?.key;

  return (
    <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #eef1f6', background: '#fff', paddingRight: 16, boxShadow: '0 1px 2px rgba(16,40,80,0.04)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '0 18px 0 20px', whiteSpace: 'nowrap' }}>
        <span style={{ width: 26, height: 26, borderRadius: 7, background: 'linear-gradient(135deg,#1366d9,#0e4fae)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>检</span>
        <span style={{ fontWeight: 700, fontSize: 15, color: '#1f2733', letterSpacing: 0.2 }}>化学报告系统</span>
      </div>
      <Menu
        mode="horizontal"
        selectedKeys={selectedKey ? [selectedKey] : []}
        items={items}
        onClick={({ key }) => navigate(key)}
        style={{ flex: 1, border: 'none', background: 'transparent' }}
      />
      <UserSwitcher />
    </div>
  );
}
