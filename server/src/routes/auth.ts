/**
 * 登录 + 本地 RBAC 路由。
 *
 * 登录：调外部认证系统(接口 5.1，services/external-auth.ts 接缝)校验身份，
 *      在本地 users 表建档(首次)，返回身份 + 本地角色 + 权限。
 * 鉴权：identity 走 `X-User-Job` 头(= 登录返回的 job_no)→查 users 表→角色→权限矩阵。
 *      `requirePermission(perm)` 中间件用于需要权限的路由(如用户管理)。
 */
import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { authConfig, integrationsProfile } from '../../../config/index.js';
import { pool } from '../db.js';
import { loginViaCommonLogin, isMockLogin } from '../services/external-auth.js';
import {
  ALL_PERMISSIONS, PERMISSION_LABELS,
  normalizePermissions, permissionsForRoles, type Role, type Permission, type AppUser, type RoleDefinition,
} from '../../../shared/rbac.js';

const router = Router();

function rowToUser(r: any): AppUser {
  return {
    job_no: r.job_no, user_name: r.user_name, depart_name: r.depart_name,
    roles: (r.roles || []).filter((role: any) => typeof role === 'string') as Role[], active: r.active,
    last_login_at: r.last_login_at, created_at: r.created_at,
  };
}

async function roleDefinitions(db: { query: (sql: string, values?: any[]) => Promise<any> } = pool): Promise<RoleDefinition[]> {
  const result = await db.query(
    `SELECT code, label, description, permissions, builtin
       FROM role_definitions ORDER BY builtin DESC, created_at, code`,
  );
  return result.rows.map((row: any) => ({
    code: row.code,
    label: row.label,
    description: row.description,
    permissions: normalizePermissions(row.permissions),
    builtin: !!row.builtin,
  }));
}

function roleMatrix(definitions: RoleDefinition[]): Record<string, Permission[]> {
  return Object.fromEntries(definitions.map(definition => [definition.code, definition.permissions]));
}

async function userPermissions(user: AppUser): Promise<Permission[]> {
  return permissionsForRoles(user.roles, roleMatrix(await roleDefinitions()));
}

async function getUser(jobNo: string): Promise<AppUser | null> {
  if (!jobNo) return null;
  const r = await pool.query('SELECT * FROM users WHERE job_no=$1', [jobNo]);
  return r.rows.length ? rowToUser(r.rows[0]) : null;
}

/** 从请求解析当前用户(X-User-Job 头)。 */
export async function currentUser(req: Request): Promise<AppUser | null> {
  const jobNo = (req.header('X-User-Job') || '').trim();
  return jobNo ? getUser(jobNo) : null;
}

/** 权限中间件：要求当前用户拥有某能力点；缺身份=401，无权限=403。 */
export function requirePermission(perm: Permission) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const u = await currentUser(req);
    if (!u) { res.status(401).json({ error: '未登录' }); return; }
    if (!u.active) { res.status(403).json({ error: '账号已停用' }); return; }
    const normalized = perm === 'report.edit' ? 'report.generate' : perm;
    if (!(await userPermissions(u)).includes(normalized)) { res.status(403).json({ error: '无权限', need: normalized }); return; }
    (req as any).appUser = u;
    next();
  };
}

const withPerms = async (u: AppUser) => ({ ...u, permissions: await userPermissions(u) });

/** POST /api/auth/login — body {loginName, pwd, appId?}：校验身份→本地建档→返回用户+权限。 */
router.post('/login', async (req: Request, res: Response) => {
  const { loginName, pwd, appId } = req.body || {};
  if (!loginName) { res.status(400).json({ error: '缺少 loginName' }); return; }

  // ── 本地管理员旁路（破冰用）──
  // 内网只用 OA 登录时，OA 不认识此账号 → 没有管理员可审批首批用户的角色申请。
  // 配 config/auth.json 的 local_admin / local_admin_pwd（默认 admin/123）即可用本账号【跳过 OA】直接登入，
  // 始终拥有 admin 角色 + active。server 模式在 deploy/system.env 中把本地管理员留空即关闭。
  const adminName = String(authConfig.local_admin || '').trim();
  const adminPwd = String(authConfig.local_admin_pwd ?? '');
  if (integrationsProfile !== 'server' && adminName && adminPwd && String(loginName).trim() === adminName && String(pwd ?? '') === adminPwd) {
    // 首登即建档为 admin 角色；已存在则刷新 last_login + 解除停用 + 确保含 admin 角色（破冰账号必须始终可用，
    // 保留其它已分配角色不变）。
    const r = await pool.query(
      `INSERT INTO users (job_no, user_name, depart_name, roles, active, last_login_at)
         VALUES ($1, '管理员', '系统管理', ARRAY['admin']::text[], true, NOW())
       ON CONFLICT (job_no) DO UPDATE
         SET active = true, last_login_at = NOW(),
             roles = CASE WHEN 'admin' = ANY(users.roles) THEN users.roles
                          ELSE users.roles || ARRAY['admin']::text[] END
       RETURNING *`,
      [adminName],
    );
    const au = rowToUser(r.rows[0]);
    console.log('[auth] 本地管理员旁路登录 job=%s', adminName);
    res.json({ ...(await withPerms(au)), token: '', modify_pwd_tips: '' });
    return;
  }

  const id = await loginViaCommonLogin(String(loginName), String(pwd || ''), appId);
  if (!id.ok) { res.status(401).json({ error: id.message || '账号或密码错误', code: id.code }); return; }

  const jobNo = id.jobNo || String(loginName);
  // 首次登录建档(roles 默认空=待分配)；已存在则更新姓名/部门 + last_login，保留已分配角色。
  const upserted = await pool.query(
    `INSERT INTO users (job_no, user_name, depart_name, last_login_at)
       VALUES ($1,$2,$3,NOW())
     ON CONFLICT (job_no) DO UPDATE
       SET user_name=COALESCE(EXCLUDED.user_name, users.user_name),
           depart_name=COALESCE(EXCLUDED.depart_name, users.depart_name),
           last_login_at=NOW()
     RETURNING *`,
    [jobNo, id.userName || jobNo, id.departName || null],
  );
  let u = rowToUser(upserted.rows[0]);
  // 部门自动授权：OA 返回的 departName 命中 auth.json 的 admin_departments → 自动补 admin 角色（保留其它角色）。
  // 用真实 OA 账号即为管理员，无需弱口令；解决"内网首批用户申请角色后无人可审"的破冰问题。
  const adminDepts = (Array.isArray(authConfig.admin_departments) ? authConfig.admin_departments : [])
    .map((d: any) => String(d).trim()).filter(Boolean);
  const dept = String(id.departName || '').trim();
  if (dept && adminDepts.includes(dept) && !u.roles.includes('admin')) {
    const r2 = await pool.query(
      `UPDATE users SET roles = roles || ARRAY['admin']::text[] WHERE job_no = $1 RETURNING *`, [jobNo]);
    u = rowToUser(r2.rows[0]);
    console.log('[auth] 部门自动授权 admin job=%s dept=%s', jobNo, dept);
  }
  if (!u.active) { res.status(403).json({ error: '账号已停用，请联系管理员' }); return; }
  res.json({ ...(await withPerms(u)), token: id.token, modify_pwd_tips: id.modifyPwdTips || '' });
});

/**
 * POST /api/auth/sso — 外部系统深链「免二次登录」入口（共享密钥校验，最简方案）。
 * body {job, key, name?, dept?}：
 *   - job = 工号（身份；若贵系统登录账号即工号，可直接传账号）
 *   - key = 双方约定的共享密钥（须等于服务端 sso_secret）
 *   - name/dept = 可选，仅首次建档时用作显示名/部门
 * 密钥校验通过→本地 users 表建档（首次，roles 默认空待分配）→返回身份+权限（同 /login）。
 * 未配 sso_secret = SSO 关闭（返回 503）。
 * 注：密钥经 URL 传入（最简方案，安全靠内网/IP 白名单）；泄露需两边同步更换。
 */
router.post('/sso', async (req: Request, res: Response) => {
  const secret = String(authConfig.sso_secret || '');
  if (!secret) { res.status(503).json({ error: 'SSO 未启用（服务端未配 sso_secret）' }); return; }
  const { job, key, name, dept } = req.body || {};
  const jobNo = String(job || '').trim();
  const provided = String(key || '');
  if (!jobNo || !provided) { res.status(400).json({ error: '缺少 job / key' }); return; }
  const a = Buffer.from(provided); const b = Buffer.from(secret);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    console.warn('[auth sso] 密钥校验失败 job=%s', jobNo);
    res.status(401).json({ error: '密钥校验失败' }); return;
  }

  const upserted = await pool.query(
    `INSERT INTO users (job_no, user_name, depart_name, last_login_at)
       VALUES ($1,$2,$3,NOW())
     ON CONFLICT (job_no) DO UPDATE
       SET user_name=COALESCE(EXCLUDED.user_name, users.user_name),
           depart_name=COALESCE(EXCLUDED.depart_name, users.depart_name),
           last_login_at=NOW()
     RETURNING *`,
    [jobNo, (name && String(name)) || jobNo, (dept && String(dept)) || null],
  );
  const u = rowToUser(upserted.rows[0]);
  if (!u.active) { res.status(403).json({ error: '账号已停用，请联系管理员' }); return; }
  console.log('[auth sso] 免登成功 job=%s name=%s', jobNo, u.user_name);
  res.json({ ...(await withPerms(u)), token: '' });
});

/** GET /api/auth/me — 按 X-User-Job 返回当前用户 + 权限。 */
router.get('/me', async (req: Request, res: Response) => {
  const u = await currentUser(req);
  if (!u) { res.status(401).json({ error: '未登录' }); return; }
  res.json(await withPerms(u));
});

/** GET /api/auth/meta — 角色/权限元数据(供「用户管理」页渲染) + 登录模式(前端据此决定是否显示演示账号提示)。 */
router.get('/meta', async (_req: Request, res: Response) => {
  const definitions = await roleDefinitions();
  res.json({
    roles: definitions.map(role => role.code),
    role_definitions: definitions,
    role_labels: Object.fromEntries(definitions.map(role => [role.code, role.label])),
    permission_labels: PERMISSION_LABELS,
    role_permissions: roleMatrix(definitions),
    permissions: ALL_PERMISSIONS,
    login_mock: isMockLogin(),
  });
});

/** 管理员新增角色。代码由服务端生成，避免名称修改影响用户已分配角色。 */
router.post('/roles', requirePermission('user.manage'), async (req: Request, res: Response) => {
  const label = typeof req.body?.label === 'string' ? req.body.label.trim().slice(0, 80) : '';
  const description = typeof req.body?.description === 'string' ? req.body.description.trim().slice(0, 300) : null;
  const permissions = normalizePermissions(req.body?.permissions);
  if (!label) { res.status(400).json({ error: '请输入角色名称' }); return; }
  const duplicate = await pool.query('SELECT 1 FROM role_definitions WHERE label=$1', [label]);
  if (duplicate.rows.length) { res.status(409).json({ error: '角色名称已存在' }); return; }
  const code = `custom_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const result = await pool.query(
    `INSERT INTO role_definitions (code, label, description, permissions, builtin)
     VALUES ($1,$2,$3,$4,FALSE) RETURNING code, label, description, permissions, builtin`,
    [code, label, description, permissions],
  );
  res.status(201).json({ ...result.rows[0], permissions: normalizePermissions(result.rows[0].permissions) });
});

/** 所有角色（含内置角色）均可调整名称、说明与权限。 */
router.put('/roles/:code', requirePermission('user.manage'), async (req: Request, res: Response) => {
  const code = String(req.params.code || '');
  const current = await pool.query('SELECT * FROM role_definitions WHERE code=$1', [code]);
  if (!current.rows.length) { res.status(404).json({ error: '角色不存在' }); return; }
  const label = typeof req.body?.label === 'string' ? req.body.label.trim().slice(0, 80) : current.rows[0].label;
  const description = typeof req.body?.description === 'string'
    ? req.body.description.trim().slice(0, 300)
    : current.rows[0].description;
  const permissions = Array.isArray(req.body?.permissions)
    ? normalizePermissions(req.body.permissions)
    : normalizePermissions(current.rows[0].permissions);
  if (!label) { res.status(400).json({ error: '角色名称不能为空' }); return; }
  if (code === 'admin' && !permissions.includes('user.manage')) {
    res.status(409).json({ error: '管理员角色必须保留“用户与角色管理”权限' }); return;
  }
  const duplicate = await pool.query('SELECT 1 FROM role_definitions WHERE label=$1 AND code<>$2', [label, code]);
  if (duplicate.rows.length) { res.status(409).json({ error: '角色名称已存在' }); return; }
  const result = await pool.query(
    `UPDATE role_definitions SET label=$1, description=$2, permissions=$3, updated_at=NOW()
      WHERE code=$4 RETURNING code, label, description, permissions, builtin`,
    [label, description, permissions, code],
  );
  res.json({ ...result.rows[0], permissions: normalizePermissions(result.rows[0].permissions) });
});

/** GET /api/auth/users — 列出所有用户(仅 user.manage)。 */
router.get('/users', requirePermission('user.manage'), async (_req: Request, res: Response) => {
  const r = await pool.query('SELECT * FROM users ORDER BY created_at, job_no');
  const definitions = await roleDefinitions();
  const matrix = roleMatrix(definitions);
  res.json(r.rows.map((row) => {
    const user = rowToUser(row);
    return { ...user, permissions: permissionsForRoles(user.roles, matrix) };
  }));
});

/** PUT /api/auth/users/:jobNo — 改角色/启停(仅 user.manage)。body {roles?, active?} */
router.put('/users/:jobNo', requirePermission('user.manage'), async (req: Request, res: Response) => {
  const jobNo = String(req.params.jobNo || '');
  const exist = await getUser(jobNo);
  if (!exist) { res.status(404).json({ error: '用户不存在' }); return; }

  const { roles, active } = req.body || {};
  const sets: string[] = [];
  const vals: any[] = [];
  if (Array.isArray(roles)) {
    const definitions = await roleDefinitions();
    const valid = new Set(definitions.map(role => role.code));
    const clean = [...new Set(roles.filter((x: any) => typeof x === 'string' && valid.has(x)))];
    sets.push(`roles=$${sets.length + 1}`); vals.push(clean);
  }
  if (typeof active === 'boolean') { sets.push(`active=$${sets.length + 1}`); vals.push(active); }
  if (!sets.length) { res.status(400).json({ error: '无可更新字段(roles/active)' }); return; }

  // 护栏：不能停用 / 摘除最后一个 admin（避免锁死系统）。
  const willBeAdmin = Array.isArray(roles) ? roles.includes('admin') : exist.roles.includes('admin');
  const willBeActive = typeof active === 'boolean' ? active : exist.active;
  if (exist.roles.includes('admin') && (!willBeAdmin || !willBeActive)) {
    const others = await pool.query(`SELECT COUNT(*)::int AS n FROM users WHERE 'admin'=ANY(roles) AND active AND job_no<>$1`, [jobNo]);
    if ((others.rows[0]?.n || 0) === 0) { res.status(409).json({ error: '不能停用/摘除最后一个管理员' }); return; }
  }

  vals.push(jobNo);
  const r = await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE job_no=$${vals.length} RETURNING *`, vals);
  res.json(await withPerms(rowToUser(r.rows[0])));
});

/** 删除本地用户；外部身份仍存在时，下次登录会重新建档为无角色用户。 */
router.delete('/users/:jobNo', requirePermission('user.manage'), async (req: Request, res: Response) => {
  const actor = (req as any).appUser as AppUser;
  const jobNo = String(req.params.jobNo || '');
  if (jobNo === actor.job_no) { res.status(409).json({ error: '不能删除当前登录用户' }); return; }
  const target = await getUser(jobNo);
  if (!target) { res.status(404).json({ error: '用户不存在' }); return; }
  if (target.roles.includes('admin') && target.active) {
    const others = await pool.query(
      `SELECT COUNT(*)::int AS n FROM users WHERE 'admin'=ANY(roles) AND active AND job_no<>$1`,
      [jobNo],
    );
    if ((others.rows[0]?.n || 0) === 0) {
      res.status(409).json({ error: '不能删除最后一个有效管理员' }); return;
    }
  }
  await pool.query('DELETE FROM users WHERE job_no=$1', [jobNo]);
  res.status(204).end();
});

// ───────────────────────── 角色申请 / 审核（自助申请 → user.manage 审核分配）─────────────────────────

/** POST /api/auth/role-requests — 当前登录用户申请角色。body {roles: Role[], reason?} */
router.post('/role-requests', async (req: Request, res: Response) => {
  const u = await currentUser(req);
  if (!u) { res.status(401).json({ error: '未登录' }); return; }
  const valid = new Set((await roleDefinitions()).map(role => role.code));
  const roles = [...new Set((Array.isArray(req.body?.roles) ? req.body.roles : [])
    .filter((x: any) => typeof x === 'string' && valid.has(x)))] as Role[];
  if (!roles.length) { res.status(400).json({ error: '请选择要申请的角色' }); return; }
  // 去掉已拥有的角色
  const wanted = roles.filter((r) => !u.roles.includes(r));
  if (!wanted.length) { res.status(400).json({ error: '所选角色你已拥有' }); return; }
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : null;
  try {
    const r = await pool.query(
      `INSERT INTO role_requests (job_no, user_name, requested_roles, reason) VALUES ($1,$2,$3,$4) RETURNING *`,
      [u.job_no, u.user_name, wanted, reason],
    );
    res.json(r.rows[0]);
  } catch (e: any) {
    // 部分唯一索引：已有 pending
    if (String(e?.code) === '23505') { res.status(409).json({ error: '你已有一条待审申请，请先撤回再提交' }); return; }
    res.status(500).json({ error: e?.message || String(e) });
  }
});

/** GET /api/auth/role-requests/mine — 当前用户自己的申请记录。 */
router.get('/role-requests/mine', async (req: Request, res: Response) => {
  const u = await currentUser(req);
  if (!u) { res.status(401).json({ error: '未登录' }); return; }
  const r = await pool.query('SELECT * FROM role_requests WHERE job_no=$1 ORDER BY created_at DESC LIMIT 20', [u.job_no]);
  res.json(r.rows);
});

/** POST /api/auth/role-requests/:id/withdraw — 撤回自己的待审申请。 */
router.post('/role-requests/:id/withdraw', async (req: Request, res: Response) => {
  const u = await currentUser(req);
  if (!u) { res.status(401).json({ error: '未登录' }); return; }
  const r = await pool.query(
    `UPDATE role_requests SET status='withdrawn', reviewed_at=NOW() WHERE id=$1 AND job_no=$2 AND status='pending' RETURNING *`,
    [req.params.id, u.job_no],
  );
  if (!r.rows.length) { res.status(404).json({ error: '没有可撤回的待审申请' }); return; }
  res.json(r.rows[0]);
});

/** GET /api/auth/role-requests — 列出申请（仅 user.manage）。?status=pending 默认只看待审。 */
router.get('/role-requests', requirePermission('user.manage'), async (req: Request, res: Response) => {
  const status = (req.query.status as string) || 'pending';
  const r = status === 'all'
    ? await pool.query('SELECT * FROM role_requests ORDER BY created_at DESC LIMIT 100')
    : await pool.query('SELECT * FROM role_requests WHERE status=$1 ORDER BY created_at DESC LIMIT 100', [status]);
  res.json(r.rows);
});

/** POST /api/auth/role-requests/:id/review — 审核（仅 user.manage）。body {action:'approve'|'reject', note?} */
router.post('/role-requests/:id/review', requirePermission('user.manage'), async (req: Request, res: Response) => {
  const reviewer = (req as any).appUser as AppUser;
  const action = req.body?.action;
  const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) : null;
  if (action !== 'approve' && action !== 'reject') { res.status(400).json({ error: 'action 必须是 approve / reject' }); return; }
  if (action === 'reject' && !note) { res.status(400).json({ error: '驳回需填写说明' }); return; }

  const reqRow = await pool.query(`SELECT * FROM role_requests WHERE id=$1 AND status='pending'`, [req.params.id]);
  if (!reqRow.rows.length) { res.status(404).json({ error: '申请不存在或已处理' }); return; }
  const rr = reqRow.rows[0];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (action === 'approve') {
      // 把申请的角色并入用户 roles（去重；仅有效角色）
      const target = await client.query('SELECT * FROM users WHERE job_no=$1 FOR UPDATE', [rr.job_no]);
      if (!target.rows.length) { await client.query('ROLLBACK'); res.status(404).json({ error: '申请人已不存在' }); return; }
      const cur: string[] = target.rows[0].roles || [];
      const valid = new Set((await roleDefinitions(client)).map(role => role.code));
      const merged = [...new Set([...cur, ...((rr.requested_roles || []).filter((role: any) => valid.has(role)))])];
      await client.query('UPDATE users SET roles=$1 WHERE job_no=$2', [merged, rr.job_no]);
    }
    await client.query(
      `UPDATE role_requests SET status=$1, reviewer_job_no=$2, reviewer_name=$3, review_note=$4, reviewed_at=NOW() WHERE id=$5`,
      [action === 'approve' ? 'approved' : 'rejected', reviewer.job_no, reviewer.user_name, note, rr.id],
    );
    await client.query('COMMIT');
  } catch (e: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e?.message || String(e) }); return;
  } finally { client.release(); }

  const after = await pool.query('SELECT * FROM role_requests WHERE id=$1', [rr.id]);
  res.json(after.rows[0]);
});

export default router;
