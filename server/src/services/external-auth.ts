/**
 * 登录认证（接口 5.1 commonLogin/login）—— 入站调用接缝 + 响应解析。
 *
 * 业务含义：本报告系统作为客户端，调用「原认证系统」的 REST 登录接口校验账号密码，
 * 拿回身份信息（工号/姓名/部门/token）。**认证系统只给身份，不给角色**——
 * 角色与权限在本系统本地管理（见 services/auth.ts 的本地 RBAC）。
 *
 * 协议（规范 §5.1，已据现场联调确认）：
 *   GET {BaseURL}/commonLogin/login?loginName=&pwd=&appId=   （参数走 query string）
 *   - BaseURL 含路径前缀，现场为 http://172.19.0.27/grgtapi/common-api（字符串拼接，前缀自动保留）
 *   - pwd 传【SHA-1 大写十六进制】的密文，不是明文（OA 自己不加密、直接比对）→ 本服务把明文 hash 后再发
 *   - appId 现场为 chemistry
 *   响应 JSON：{ code, success, fail, message, ticks, response:{ jobNo, userName, departName, token, loginToken, modifyPwdTips, id } }
 *   code='0010' 为成功。
 *
 * 当前：未配置 common_login_url 时走 mock（任意账号即登录成功，便于演示）；配置后走真实 HTTP GET。
 * 真实接入只需配 config/auth.local.json（common_login_url / app_id），无需改代码。
 * Node 全局 fetch 默认不走 http_proxy，内网直连——无需额外设置。
 * 完整对接细节与排错手册见项目根目录《外部OA登录对接.md》。
 */

/** 解析后的归一化登录身份。 */
export interface LoginIdentity {
  ok: boolean;
  code?: string;
  message?: string;
  jobNo?: string;
  userName?: string;
  departName?: string;
  token?: string;
  loginToken?: string;
  /** 非空＝密码超期需提示用户修改 */
  modifyPwdTips?: string;
}

import { createHash } from 'crypto';
import { authConfig } from '../../../config/index.js';

/** 原认证系统地址（含路径前缀，如 http://172.19.0.27/grgtapi/common-api）。缺省为空＝mock 模式。配 config/auth.local.json 或 AUTH_COMMON_LOGIN_URL。 */
const COMMON_LOGIN_URL = String(authConfig.common_login_url || process.env.COMMON_LOGIN_URL || '').replace(/\/+$/, '');
/** 接入方应用标识，由 OA 分配（现场=chemistry）。空＝不发送该参数。配 app_id 或 AUTH_APP_ID。 */
const COMMON_LOGIN_APP_ID = String(authConfig.app_id ?? process.env.COMMON_LOGIN_APP_ID ?? 'chemistry');
/** 密码加密方式：'sha1'＝把明文按 SHA-1 大写十六进制加密后发送（现场确认）；'none'＝原样发送。配 pwd_hash 或 AUTH_PWD_HASH。 */
const PWD_HASH = String(authConfig.pwd_hash || process.env.AUTH_PWD_HASH || 'sha1').toLowerCase();
/** 调用超时(ms)，避免 OA 不可达时登录卡死。 */
const LOGIN_TIMEOUT_MS = Number(authConfig.timeout_ms || 10000);

/** 成功业务码（规范 §5.1：0010=成功）。 */
const SUCCESS_CODE = '0010';

/** 按配置加密密码。用户输入明文，OA 要的是密文（现场为 SHA-1 大写）。 */
export function encodePwd(pwd: string): string {
  if (PWD_HASH === 'none') return pwd;
  if (PWD_HASH === 'sha1') return createHash('sha1').update(pwd, 'utf8').digest('hex').toUpperCase();
  return pwd; // 未知配置兜底为原样
}

/** 是否 mock 模式（未配 OA 地址）。前端据此决定是否显示「演示账号·任意密码」提示。 */
export function isMockLogin(): boolean {
  return !COMMON_LOGIN_URL;
}

/** 业务码前两位 → 人话（规范 §5.1：002X 参数 / 003X token / 004X 访问控制 / 005X 系统内部）。 */
function codeHint(code?: string): string {
  if (!code) return '';
  if (code.startsWith('002')) return '参数异常';
  if (code.startsWith('003')) return 'token 异常';
  if (code.startsWith('004')) return '无访问权限';
  if (code.startsWith('005')) return 'OA 系统内部错误';
  return '';
}

/**
 * 解析认证系统的登录响应（ResponseModel«登录返回信息»）→ 归一化身份。
 * 容错：兼容字段大小写缺省；success/fail 与 code 任一标识成败。
 */
export function parseLoginResponse(raw: any): LoginIdentity {
  if (!raw || typeof raw !== 'object') return { ok: false, message: '空响应' };
  const code = raw.code != null ? String(raw.code) : undefined;
  const success = raw.success === true || code === SUCCESS_CODE;
  const r = raw.response || raw.Response || {};
  const ok = !!success && raw.fail !== true;
  return {
    ok,
    code,
    message: raw.message || raw.Message || (ok ? '' : (codeHint(code) || '账号或密码错误')),
    jobNo: r.jobNo || r.JobNo || undefined,
    userName: r.userName || r.UserName || undefined,
    departName: r.departName || r.DepartName || undefined,
    token: r.token || r.Token || undefined,
    loginToken: r.loginToken || r.LoginToken || undefined,
    modifyPwdTips: r.modifyPwdTips || undefined,
  };
}

/**
 * 调用 5.1 登录接口校验账号密码，返回归一化身份。
 * @param loginName 登录名（工号/账号）
 * @param pwd       密码
 * @param appId     应用标识（缺省取 COMMON_LOGIN_APP_ID）
 */
export async function loginViaCommonLogin(loginName: string, pwd: string, appId?: string): Promise<LoginIdentity> {
  if (!loginName) return { ok: false, message: '登录名为空' };

  // ── 真实接入：HTTP GET（参数走 query；spec 标 x-www-form-urlencoded，但参数在 query string 上）──
  if (COMMON_LOGIN_URL) {
    // 密码按配置加密（默认 SHA-1 大写）后再发；appId 为空则不发送。
    const qs = new URLSearchParams({ loginName, pwd: encodePwd(pwd || '') });
    const finalAppId = appId || COMMON_LOGIN_APP_ID;
    if (finalAppId) qs.set('appId', finalAppId);
    const url = `${COMMON_LOGIN_URL}/commonLogin/login?${qs.toString()}`;
    try {
      const resp = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: AbortSignal.timeout(LOGIN_TIMEOUT_MS),
      });
      if (resp.status === 401 || resp.status === 403) return { ok: false, code: String(resp.status), message: '账号或密码错误' };
      if (resp.status === 404) return { ok: false, code: '404', message: 'OA 登录接口不存在(404)，请检查 common_login_url 配置' };
      if (!resp.ok) return { ok: false, code: String(resp.status), message: `OA 认证服务返回 ${resp.status}` };
      const data = await resp.json().catch(() => null);
      if (!data) return { ok: false, message: 'OA 认证响应不是合法 JSON' };
      return parseLoginResponse(data);
    } catch (e: any) {
      const isTimeout = e?.name === 'TimeoutError' || /aborted|timeout/i.test(String(e?.message));
      console.error('[external-auth] 调用 OA 登录失败:', e?.message || e);
      return { ok: false, message: isTimeout ? 'OA 认证服务超时，请稍后重试或检查网络' : `无法连接 OA 认证服务（${e?.message || e}）` };
    }
  }

  // ── mock：未配置真实地址时，任意账号登录成功，工号=登录名 ──
  console.log(`[external-auth] (mock) 登录 loginName=${loginName}`);
  return parseLoginResponse({
    code: SUCCESS_CODE, success: true, fail: false, message: '',
    response: { jobNo: loginName, userName: loginName, departName: '化学检测中心', token: `MOCK-JWT-${loginName}`, loginToken: '', modifyPwdTips: '' },
  });
}
