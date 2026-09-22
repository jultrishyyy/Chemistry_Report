/**
 * 本地 RBAC 的公共类型与内置默认值。
 * 实际角色定义存于 role_definitions 表；这里的内置配置用于迁移、首次启动与兼容兜底。
 */

export type BuiltinRole = 'admin' | 'deputy_director' | 'test_engineer' | 'test_supervisor' | 'report_clerk' | 'report_reviewer';
/** 自定义角色使用服务端生成的字符串代码。 */
export type Role = string;

export type Permission =
  | 'record.entry'
  | 'test_project.view_all'
  | 'record.review'
  | 'record_template.edit'
  | 'report.generate'
  | 'report.edit' // 旧权限兼容：运行时归并到 report.generate
  | 'report.review'
  | 'report_template.edit'
  | 'user.manage';

/** 管理界面可分配的权限；旧 report.edit 不再单独展示。 */
export const ALL_PERMISSIONS: Permission[] = [
  'record.entry',
  'test_project.view_all',
  'record.review',
  'record_template.edit',
  'report.generate',
  'report.review',
  'report_template.edit',
  'user.manage',
];

export const ALL_ROLES: BuiltinRole[] = ['admin', 'deputy_director', 'test_engineer', 'test_supervisor', 'report_clerk', 'report_reviewer'];

export const ROLE_LABELS: Record<string, string> = {
  admin: '管理员',
  deputy_director: '副主任',
  test_engineer: '测试工程师',
  test_supervisor: '测试主管',
  report_clerk: '报告文员',
  report_reviewer: '报告审核',
};

export const ROLE_DESCRIPTIONS: Record<string, string> = {
  admin: '系统管理：用户、角色与权限配置',
  deputy_director: '查看全部测试项目和委托单项目',
  test_engineer: '录入原始记录数据',
  test_supervisor: '包含测试工程师权限，并可编辑模板、审核原始记录',
  report_clerk: '编辑和送审报告',
  report_reviewer: '包含报告文员权限，并可编辑、审核报告模板',
};

export const PERMISSION_LABELS: Record<Permission, string> = {
  'record.entry': '录入原始记录数据',
  'test_project.view_all': '查看全部测试项目',
  'record.review': '审核原始记录数据',
  'record_template.edit': '编辑原始记录模板',
  'report.generate': '编辑和送审报告',
  'report.edit': '编辑和送审报告',
  'report.review': '审核报告模板',
  'report_template.edit': '编辑报告模板',
  'user.manage': '用户与角色管理',
};

/** 内置角色初始权限。主管/审核角色显式包含下级角色权限，之后管理员仍可调整。 */
export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  admin: [...ALL_PERMISSIONS],
  deputy_director: ['record.entry', 'test_project.view_all'],
  test_engineer: ['record.entry'],
  test_supervisor: ['record.entry', 'record_template.edit', 'record.review'],
  report_clerk: ['report.generate'],
  report_reviewer: ['report.generate', 'report_template.edit', 'report.review'],
};

export interface RoleDefinition {
  code: string;
  label: string;
  description?: string | null;
  permissions: Permission[];
  builtin: boolean;
}

export function normalizePermissions(values: readonly string[] | null | undefined): Permission[] {
  const set = new Set<Permission>();
  for (const value of values || []) {
    const permission = value === 'report.edit' ? 'report.generate' : value;
    if ((ALL_PERMISSIONS as string[]).includes(permission)) set.add(permission as Permission);
  }
  return [...set];
}

export function permissionsForRoles(
  roles: readonly string[] | null | undefined,
  matrix: Record<string, readonly string[]> = ROLE_PERMISSIONS,
): Permission[] {
  const set = new Set<Permission>();
  for (const role of roles || []) {
    normalizePermissions(matrix[role]).forEach(permission => set.add(permission));
  }
  return [...set];
}

export function rolesHavePermission(
  roles: readonly string[] | null | undefined,
  permission: Permission,
  matrix: Record<string, readonly string[]> = ROLE_PERMISSIONS,
): boolean {
  const normalized = permission === 'report.edit' ? 'report.generate' : permission;
  return permissionsForRoles(roles, matrix).includes(normalized as Permission);
}

export function isBuiltinRole(value: string): value is BuiltinRole {
  return (ALL_ROLES as string[]).includes(value);
}

/** 仅作旧调用兼容；动态角色的有效性必须由服务端查询 role_definitions。 */
export function isRole(value: string): value is Role {
  return typeof value === 'string' && /^[a-z][a-z0-9_:-]{1,79}$/i.test(value);
}

export interface AppUser {
  job_no: string;
  user_name: string;
  depart_name?: string | null;
  roles: Role[];
  active: boolean;
  last_login_at?: string | null;
  created_at?: string;
}
