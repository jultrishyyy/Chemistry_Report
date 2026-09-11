import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { message } from 'antd';
import axios from 'axios';
import { permissionsForRoles, type Role, type Permission } from '../../shared/rbac';

/**
 * 身份系统：登录走后端 `POST /api/auth/login`（后端再调外部认证接口 5.1，未配真实地址时 mock）。
 * 后端返回身份 + 本地分配的角色 + 权限。角色/权限在本系统本地管理（见 shared/rbac.ts）。
 *
 * 请求头：
 *   X-User-Job = 工号（后端按此查 users 表做鉴权，RBAC 真身份）
 *   X-Demo-User = 姓名（审核日志 actor，沿用旧约定）、X-Demo-Role = 主角色（审核日志）
 *   Authorization = Bearer <token>
 */

export interface AuthUser {
  job_no: string;
  user_name: string;
  display_name: string;        // = user_name（兼容旧代码 user.display_name）
  depart_name?: string | null;
  roles: Role[];
  role: string;                // 主角色（兼容旧 tester/reviewer 门控）
  permissions: Permission[];
  token?: string;
}

const STORAGE_KEY = 'demo_user';
const API = (import.meta as any).env?.VITE_API_URL || '/api';

function toAuthUser(d: any): AuthUser {
  const roles = (d.roles || []) as Role[];
  // 主显示角色：审核类优先（仅影响展示/X-Demo-Role 审计标注；真正鉴权用 permissions/roles 并集）
  const PRIORITY: Role[] = ['admin', 'report_reviewer', 'test_supervisor', 'report_clerk', 'test_engineer'];
  const role = PRIORITY.find((r) => roles.includes(r)) || roles[0] || '';
  return {
    job_no: d.job_no, user_name: d.user_name, display_name: d.user_name,
    depart_name: d.depart_name, roles,
    role, permissions: (d.permissions as Permission[]) || permissionsForRoles(roles),
    token: d.token,
  };
}

interface AuthCtx {
  user: AuthUser | null;
  loading: boolean;
  login: (loginName: string, pwd: string) => Promise<void>;
  logout: () => void;
  has: (perm: Permission) => boolean;
  /** 重新拉取 /me（角色被审核分配后无需重登即可刷新权限）。 */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx>({ user: null, loading: true, login: async () => {}, logout: () => {}, has: () => false, refresh: async () => {} });

// 请求拦截器：从 localStorage 取身份，附到每个请求头。
axios.interceptors.request.use((config) => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const u = JSON.parse(raw) as AuthUser;
      if (u.job_no) config.headers.set('X-User-Job', u.job_no);
      // HTTP 头按 Latin-1 解读，中文必须 URL 编码
      if (u.user_name) config.headers.set('X-Demo-User', encodeURIComponent(u.user_name));
      if (u.role) config.headers.set('X-Demo-Role', u.role);                 // 主显示角色（审计标注）
      if (u.roles?.length) config.headers.set('X-Demo-Roles', u.roles.join(',')); // 全部角色（鉴权用权限并集）
      if (u.permissions?.length) config.headers.set('X-Demo-Permissions', u.permissions.join(','));
      if (u.token) config.headers.set('Authorization', `Bearer ${u.token}`);
    } catch { /* ignore */ }
  }
  return config;
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw) as AuthUser; } catch { return null; }
  });
  const [loading, setLoading] = useState(true);

  // 挂载：① 深链 SSO 免登（URL 带 job/ts/sign）→验签换身份；② 否则按已存身份刷新角色/权限。
  useEffect(() => {
    let alive = true;
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const ssoJob = params.get('job'), ssoKey = params.get('key');
      if (ssoJob && ssoKey) {
        try {
          const res = await axios.post(`${API}/auth/sso`, {
            job: ssoJob, key: ssoKey,
            name: params.get('name') || undefined, dept: params.get('dept') || undefined,
          });
          if (!alive) return;
          const u = toAuthUser(res.data);
          setUser(u); localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
        } catch (e: any) {
          if (alive) message.error('单点登录失败：' + (e?.response?.data?.error || e?.message || '密钥校验失败'));
        } finally {
          // 清掉 URL 上的 SSO 参数（保留路径与其它参数），避免密钥泄露与刷新重放
          ['job', 'key', 'name', 'dept'].forEach((k) => params.delete(k));
          const qs = params.toString();
          window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
          if (alive) setLoading(false);
        }
        return;
      }
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) { setLoading(false); return; }
      try {
        const res = await axios.get(`${API}/auth/me`);
        if (!alive) return;
        const u = toAuthUser(res.data);
        setUser(u); localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
      } catch {
        if (alive) { setUser(null); localStorage.removeItem(STORAGE_KEY); }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const login = async (loginName: string, pwd: string) => {
    const res = await axios.post(`${API}/auth/login`, { loginName, pwd });
    const u = toAuthUser(res.data);
    setUser(u);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
    // OA 返回的「密码超期」提示（非空＝需提醒用户改密码）
    if (res.data?.modify_pwd_tips) message.warning(String(res.data.modify_pwd_tips), 6);
  };

  const logout = () => { setUser(null); localStorage.removeItem(STORAGE_KEY); };
  const has = (perm: Permission) => !!user?.permissions?.includes(perm);
  const refresh = async () => {
    if (!localStorage.getItem(STORAGE_KEY)) return;
    try {
      const res = await axios.get(`${API}/auth/me`);
      const u = toAuthUser(res.data);
      setUser(u); localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
    } catch { /* 保持现状 */ }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, has, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
