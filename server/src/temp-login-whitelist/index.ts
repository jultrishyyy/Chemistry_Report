/**
 * ⚠️⚠️⚠️ 临时登录白名单（TEMPORARY — 试运行阶段限制，后续要【整体删除】）⚠️⚠️⚠️
 *
 * 需求（内网试运行）：只有下面这几个工号 + 本地管理员账号（config/auth.json 的 local_admin）
 * 才能触发登录接口逻辑（OA 认证 / mock 登录）；其他任何工号登录一律拒绝，提示
 * 「无权限，请联系相关部门获取权限」，并且【不调用】外部登录接口。
 *
 * 删除方式（以后放开时）：
 *   1. 删掉整个文件夹 server/src/temp-login-whitelist/
 *   2. 在 server/src/routes/auth.ts 里搜 `TEMP_LOGIN_WHITELIST` 标记，删掉那段 import 与校验代码
 *   3. 删掉本条项目记忆（memory/temp-login-whitelist.md 及 MEMORY.md 里的指针）
 *
 * 白名单集中在此一处，改人只改这个文件。
 */

/** 允许登录的工号 → 姓名（仅用于可读性/日志，不参与鉴权）。 */
export const TEMP_LOGIN_WHITELIST: Record<string, string> = {
  GDJL09509: '张丽娜',
  GDJL05728: '黄创锋',
  GDJL10666: '赖朝坤',
  GDJL11499: '麦卡特',
  GDJL13159: '郑谦',
  GDJL06567: '朱炜烨',
  GDJL31129: '陈成成',
  GDJL12331: '梁志炫',
};

/** 拒绝登录时给前端的提示文案。 */
export const TEMP_LOGIN_DENIED_MESSAGE = '无权限，请联系相关部门获取权限';

/**
 * 该登录名（工号）是否允许触发登录接口。
 * - 本地管理员账号（adminName，来自 config/auth.json 的 local_admin）恒允许；
 * - 其余仅白名单工号允许。
 */
export function isLoginAllowed(loginName: string, adminName: string): boolean {
  const id = (loginName || '').trim();
  if (!id) return false;
  if (adminName && id === adminName.trim()) return true;
  return Object.prototype.hasOwnProperty.call(TEMP_LOGIN_WHITELIST, id);
}
