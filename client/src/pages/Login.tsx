import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Form, Input, Button, Typography, Tag, message } from 'antd';
import { UserOutlined, LockOutlined, LoginOutlined } from '@ant-design/icons';
import axios from 'axios';
import { useAuth } from '../auth';
import { APP_BG } from '../theme';

const API = (import.meta as any).env?.VITE_API_URL || '/api';

/** 演示账号（mock 登录模式下任意密码即可登录）。 */
const DEMO_ACCOUNTS = [
  { loginName: 'admin', label: '管理员' },
  { loginName: 'zhang_eng', label: '张工·测试工程师' },
  { loginName: 'wang_sup', label: '王主管·测试主管' },
  { loginName: 'clerk', label: '报告文员' },
  { loginName: 'tpl_rev', label: '报告审核' },
];

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  // 登录模式：mock(本机演示，任意密码) vs 真实 OA。决定是否显示演示账号提示。
  const [mock, setMock] = useState<boolean | null>(null);
  useEffect(() => {
    axios.get(`${API}/auth/meta`).then((r) => setMock(!!r.data?.login_mock)).catch(() => setMock(false));
  }, []);

  const submit = async (v: { loginName: string; pwd: string }) => {
    setBusy(true);
    try {
      await login(v.loginName.trim(), v.pwd || '');
      // 身份切换后不保留上一位用户所在的受限页面（如 /admin/users）。
      navigate('/', { replace: true });
    } catch (e: any) {
      message.error(e?.response?.data?.error || '登录失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: APP_BG }}>
      <Card style={{ width: 380, boxShadow: '0 6px 24px rgba(16,40,80,0.10)' }}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <span style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(135deg,#1366d9,#0e4fae)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700 }}>检</span>
          <Typography.Title level={4} style={{ marginTop: 10, marginBottom: 0 }}>化学报告系统</Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>登录后请向管理员申请分配角色</Typography.Text>
        </div>
        <Form form={form} layout="vertical" onFinish={submit} requiredMark={false}>
          <Form.Item name="loginName" rules={[{ required: true, message: '请输入工号/账号' }]}>
            <Input size="large" prefix={<UserOutlined />} placeholder="工号 / 账号" autoFocus />
          </Form.Item>
          <Form.Item name="pwd">
            <Input.Password size="large" prefix={<LockOutlined />} placeholder="密码" onPressEnter={() => form.submit()} />
          </Form.Item>
          <Button type="primary" size="large" htmlType="submit" loading={busy} icon={<LoginOutlined />} block>登录</Button>
        </Form>
        {mock === true && (
          <div style={{ marginTop: 14, fontSize: 12, color: '#888' }}>
            <div style={{ marginBottom: 6 }}>演示账号（本机 mock 模式，任意密码）：</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {DEMO_ACCOUNTS.map((a) => (
                <Tag key={a.loginName} style={{ cursor: 'pointer' }} onClick={() => { form.setFieldsValue({ loginName: a.loginName, pwd: 'demo' }); }}>
                  {a.label} <span style={{ color: '#aaa' }}>@{a.loginName}</span>
                </Tag>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
