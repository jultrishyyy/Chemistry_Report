/**
 * rbac.ts — 本地角色权限（单一事实来源，前后端共用）。
 *
 * 背景：登录走外部认证系统（接口 5.1，只给身份 jobNo/姓名/部门，**不给角色**）。
 * 角色与权限在本系统**本地**管理：users 表存每个用户被分配的角色，角色→权限是这里的固定矩阵。
 * 新登录用户默认无角色（待管理员分配）；管理员在「用户管理」页派角色，或用户自助申请→管理员审核。
 *
 * 鉴权用【权限】而非角色名（permissionsForRoles(user.roles).includes(perm)），所以一个用户可拥有多个角色、
 * 权限自动并集——支持"自助申请叠加角色"。
 */

/** 角色（固定集合，不在 UI 动态新增）。 */
export type Role = 'admin' | 'test_engineer' | 'test_supervisor' | 'report_clerk' | 'report_reviewer';

/** 能力点（路由/按钮按此校验）。 */
export type Permission =
  | 'record.entry'           // 选取原始记录 / 录入数据（主检）
  | 'record.review'          // 审核原始记录与数据
  | 'record_template.edit'   // 编辑原始记录模板（建草稿/改/审核版本）
  | 'report.generate'        // 取号 / 生成报告
  | 'report.edit'            // 编辑报告实例
  | 'report.review'          // 审核系统合并的报告 + 报告模板版本
  | 'report_template.edit'   // 编辑报告模板（建草稿/改）
  | 'user.manage';           // 用户与角色管理

export const ALL_ROLES: Role[] = ['admin', 'test_engineer', 'test_supervisor', 'report_clerk', 'report_reviewer'];

export const ROLE_LABELS: Record<Role, string> = {
  admin: '管理员',
  test_engineer: '测试工程师',
  test_supervisor: '测试主管',
  report_clerk: '报告文员',
  report_reviewer: '报告审核',
};

/** 角色一句话职责（UI 提示用）。 */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: '系统管理：用户与角色分配（拥有全部权限）',
  test_engineer: '选取原始记录、填写数据（主检）',
  test_supervisor: '编辑原始记录模板、审核测试工程师填写的原始记录与数据',
  report_clerk: '生成报告并在生成时编辑',
  report_reviewer: '编辑报告模板、审核系统合并的报告',
};

export const PERMISSION_LABELS: Record<Permission, string> = {
  'record.entry': '选取记录/录入数据',
  'record.review': '审核原始记录数据',
  'record_template.edit': '编辑原始记录模板',
  'report.generate': '生成报告',
  'report.edit': '编辑报告',
  'report.review': '审核报告/报告模板',
  'report_template.edit': '编辑报告模板',
  'user.manage': '用户与角色管理',
};

/** 角色 → 权限矩阵。admin 拥有全部。 */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: ['record.entry', 'record.review', 'record_template.edit', 'report.generate', 'report.edit', 'report.review', 'report_template.edit', 'user.manage'],
  test_engineer: ['record.entry'],
  test_supervisor: ['record_template.edit', 'record.review'],
  report_clerk: ['report.generate', 'report.edit'],
  report_reviewer: ['report_template.edit', 'report.review'],
};

/** 把角色集合并成权限集合（去重）。无效角色忽略。 */
export function permissionsForRoles(roles: readonly string[] | null | undefined): Permission[] {
  const set = new Set<Permission>();
  for (const r of roles || []) {
    const perms = ROLE_PERMISSIONS[r as Role];
    if (perms) perms.forEach((p) => set.add(p));
  }
  return [...set];
}

/** 角色集合是否拥有某权限。 */
export function rolesHavePermission(roles: readonly string[] | null | undefined, perm: Permission): boolean {
  return permissionsForRoles(roles).includes(perm);
}

export function isRole(x: string): x is Role {
  return (ALL_ROLES as string[]).includes(x);
}

/** 本系统用户（身份来自 5.1，角色本地分配）。 */
export interface AppUser {
  job_no: string;
  user_name: string;
  depart_name?: string | null;
  roles: Role[];
  active: boolean;
  last_login_at?: string | null;
  created_at?: string;
}
