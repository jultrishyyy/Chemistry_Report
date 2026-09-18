import { Router, type Request, type Response } from 'express';
import { pool } from '../db.js';
import { acquireEditLease, collaborationActor, LEASE_SECONDS } from '../services/collaboration.js';
import { randomUUID } from 'crypto';

const router = Router();
const validType = (value: unknown) => typeof value === 'string' && /^[a-z][a-z0-9_-]{1,49}$/.test(value);
const validId = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 100;
const requiredPermission: Record<string, string> = {
  record_template: 'record_template.edit', record_data: 'record.entry', report_template: 'report_template.edit', report_instance: 'report.generate',
};
const hasPermission = async (req: Request, permission: string) => {
  const jobNo = collaborationActor(req).jobNo;
  if (!jobNo) return false;
  const allowed = await pool.query(
    `SELECT 1 FROM users u JOIN role_definitions r ON r.code=ANY(u.roles)
      WHERE u.job_no=$1 AND u.active=TRUE AND ($2=ANY(r.permissions) OR ($2='report.generate' AND 'report.edit'=ANY(r.permissions))) LIMIT 1`,
    [jobNo, permission],
  );
  return !!allowed.rows.length;
};
const canEditResource = async (req: Request, type: string) => !!requiredPermission[type] && hasPermission(req, requiredPermission[type]);
const logEvent = async (type: string, id: string, action: string, actor: ReturnType<typeof collaborationActor>, target?: { jobNo?: string; name?: string }, detail: any = {}) => {
  await pool.query(
    `INSERT INTO collaboration_events(resource_type,resource_id,action,actor_job_no,actor_name,target_job_no,target_name,detail)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`, [type, id, action, actor.jobNo, actor.name, target?.jobNo || null, target?.name || null, JSON.stringify(detail)],
  );
};

router.post('/presence', async (req: Request, res: Response) => {
  const { resource_type, resource_id } = req.body || {};
  const changes = Array.isArray(req.body?.changes) ? req.body.changes.map(String).filter(Boolean).slice(0, 12) : [];
  const actor = collaborationActor(req);
  if (!actor.name || !validType(resource_type) || !validId(String(resource_id || ''))) {
    res.status(400).json({ error: '资源或用户信息不完整' }); return;
  }
  await pool.query(
    `INSERT INTO collaboration_presence
       (resource_type, resource_id, user_job_no, user_name, latest_changes, last_change_at, last_seen_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,CASE WHEN jsonb_array_length($5::jsonb)>0 THEN NOW() ELSE NULL END,NOW())
     ON CONFLICT (resource_type, resource_id, user_job_no) DO UPDATE SET
       user_name=EXCLUDED.user_name,
       latest_changes=CASE WHEN jsonb_array_length(EXCLUDED.latest_changes)>0 THEN EXCLUDED.latest_changes ELSE collaboration_presence.latest_changes END,
       last_change_at=CASE WHEN jsonb_array_length(EXCLUDED.latest_changes)>0 THEN NOW() ELSE collaboration_presence.last_change_at END,
       last_seen_at=NOW()`,
    [resource_type, String(resource_id), actor.jobNo, actor.name, JSON.stringify(changes)],
  );
  const active = await pool.query(
    `SELECT p.user_job_no, p.user_name, p.latest_changes, p.last_change_at, p.last_seen_at,
            (l.holder_job_no=p.user_job_no AND l.expires_at>NOW()) AS is_editor
       FROM collaboration_presence p
       LEFT JOIN edit_leases l ON l.resource_type=p.resource_type AND l.resource_id=p.resource_id
      WHERE p.resource_type=$1 AND p.resource_id=$2 AND p.last_seen_at > NOW() - INTERVAL '75 seconds'
      ORDER BY is_editor DESC, p.last_seen_at DESC`, [resource_type, String(resource_id)]);
  const recent = await pool.query(
    `SELECT user_job_no, user_name, latest_changes, last_change_at, last_seen_at
       FROM collaboration_presence
      WHERE resource_type=$1 AND resource_id=$2
        AND last_change_at > NOW() - INTERVAL '24 hours'
        AND jsonb_array_length(latest_changes) > 0
      ORDER BY last_change_at DESC LIMIT 12`, [resource_type, String(resource_id)]);
  res.json({ users: active.rows, recent_changes: recent.rows });
});

router.delete('/presence', async (req: Request, res: Response) => {
  const actor = collaborationActor(req);
  const { resource_type, resource_id } = req.body || {};
  await pool.query(
    `UPDATE collaboration_presence SET last_seen_at=NOW() - INTERVAL '2 minutes'
      WHERE resource_type=$1 AND resource_id=$2 AND user_job_no=$3`,
    [resource_type, String(resource_id || ''), actor.jobNo],
  );
  res.json({ ok: true });
});

router.post('/leases/acquire', async (req: Request, res: Response) => {
  const { resource_type, resource_id } = req.body || {};
  const actor = collaborationActor(req);
  if (!actor.name || !validType(resource_type) || !validId(String(resource_id || ''))) {
    res.status(400).json({ error: '资源或用户信息不完整' }); return;
  }
  if (!await canEditResource(req, resource_type)) { res.status(403).json({ error: '当前账号没有该文档的编辑权限' }); return; }
  const result = await acquireEditLease(resource_type, String(resource_id), actor.name, actor.jobNo);
  if (result.acquired) await logEvent(resource_type, String(resource_id), 'lease_acquired', actor);
  res.status(result.acquired ? 200 : 423).json(result);
});

router.get('/leases/status', async (req: Request, res: Response) => {
  const resourceType = String(req.query.resource_type || '');
  const resourceId = String(req.query.resource_id || '');
  const actor = collaborationActor(req);
  if (!actor.name || !validType(resourceType) || !validId(resourceId)) { res.status(400).json({ error: '资源或用户信息不完整' }); return; }
  const held = await pool.query(
    `SELECT holder_job_no,holder_name,acquired_at,expires_at,
            CASE WHEN holder_job_no=$3 THEN lease_token::text ELSE NULL END AS lease_token
       FROM edit_leases WHERE resource_type=$1 AND resource_id=$2 AND expires_at>NOW()`,
    [resourceType, resourceId, actor.jobNo],
  );
  const mine = await pool.query(
    `SELECT id,status,requested_at,resolved_at FROM edit_lease_requests
      WHERE resource_type=$1 AND resource_id=$2 AND requester_job_no=$3
      ORDER BY requested_at DESC LIMIT 1`, [resourceType, resourceId, actor.jobNo],
  );
  let pending: any[] = [];
  if (held.rows[0]?.holder_job_no === actor.jobNo) {
    const requests = await pool.query(
      `SELECT id,requester_job_no,requester_name,requested_at FROM edit_lease_requests
        WHERE resource_type=$1 AND resource_id=$2 AND status='pending' ORDER BY requested_at`, [resourceType, resourceId],
    );
    pending = requests.rows;
  }
  res.json({ lease: held.rows[0] || null, my_request: mine.rows[0] || null, pending_requests: pending });
});

router.post('/leases/request', async (req: Request, res: Response) => {
  const { resource_type, resource_id } = req.body || {};
  const actor = collaborationActor(req);
  if (!actor.name || !validType(resource_type) || !validId(String(resource_id || ''))) { res.status(400).json({ error: '资源或用户信息不完整' }); return; }
  if (!await canEditResource(req, resource_type)) { res.status(403).json({ error: '当前账号没有该文档的编辑权限' }); return; }
  const held = await pool.query(
    `SELECT holder_job_no,holder_name FROM edit_leases WHERE resource_type=$1 AND resource_id=$2 AND expires_at>NOW()`,
    [resource_type, String(resource_id)],
  );
  if (!held.rows.length) { res.status(409).json({ error: '编辑权已空闲，请直接开始编辑', code: 'lease_available' }); return; }
  if (held.rows[0].holder_job_no === actor.jobNo) { res.status(400).json({ error: '你已经是当前编辑者' }); return; }
  await pool.query(
    `UPDATE edit_lease_requests SET status='cancelled',resolved_at=NOW()
      WHERE resource_type=$1 AND resource_id=$2 AND requester_job_no=$3 AND status='pending'`,
    [resource_type, String(resource_id), actor.jobNo],
  );
  const inserted = await pool.query(
    `INSERT INTO edit_lease_requests(resource_type,resource_id,requester_job_no,requester_name)
      VALUES($1,$2,$3,$4) RETURNING *`, [resource_type, String(resource_id), actor.jobNo, actor.name],
  );
  await logEvent(resource_type, String(resource_id), 'handoff_requested', actor, { jobNo: held.rows[0].holder_job_no, name: held.rows[0].holder_name });
  res.status(201).json(inserted.rows[0]);
});

router.post('/leases/force', async (req: Request, res: Response) => {
  const { resource_type, resource_id, reason } = req.body || {};
  const actor = collaborationActor(req);
  if (!String(reason || '').trim()) { res.status(400).json({ error: '强制接管必须填写原因' }); return; }
  if (!await hasPermission(req, 'user.manage') || !await canEditResource(req, resource_type)) {
    res.status(403).json({ error: '只有同时具备系统管理和该文档编辑权限的人员可以强制接管' }); return;
  }
  const previous = await pool.query(
    `SELECT holder_job_no,holder_name FROM edit_leases WHERE resource_type=$1 AND resource_id=$2 AND expires_at>NOW()`,
    [resource_type, String(resource_id)],
  );
  const token = randomUUID();
  const result = await pool.query(
    `INSERT INTO edit_leases(resource_type,resource_id,holder_job_no,holder_name,lease_token,acquired_at,heartbeat_at,expires_at)
      VALUES($1,$2,$3,$4,$5,NOW(),NOW(),NOW()+($6 || ' seconds')::interval)
      ON CONFLICT(resource_type,resource_id) DO UPDATE SET holder_job_no=EXCLUDED.holder_job_no,holder_name=EXCLUDED.holder_name,
        lease_token=EXCLUDED.lease_token,acquired_at=NOW(),heartbeat_at=NOW(),expires_at=EXCLUDED.expires_at RETURNING *`,
    [resource_type, String(resource_id), actor.jobNo, actor.name, token, LEASE_SECONDS],
  );
  await pool.query(
    `UPDATE edit_lease_requests SET status='cancelled',resolved_at=NOW(),resolved_by_job_no=$1,resolved_by_name=$2
      WHERE resource_type=$3 AND resource_id=$4 AND status='pending'`, [actor.jobNo, actor.name, resource_type, String(resource_id)],
  );
  await logEvent(resource_type, String(resource_id), 'lease_forced', actor,
    previous.rows[0] ? { jobNo: previous.rows[0].holder_job_no, name: previous.rows[0].holder_name } : undefined,
    { reason: String(reason).trim() });
  res.json({ acquired: true, lease: result.rows[0] });
});

router.post('/leases/respond', async (req: Request, res: Response) => {
  const { resource_type, resource_id, lease_token, request_id, action } = req.body || {};
  const actor = collaborationActor(req);
  if (!['approve', 'reject'].includes(action)) { res.status(400).json({ error: '无效处理动作' }); return; }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const held = await db.query(
      `SELECT * FROM edit_leases WHERE resource_type=$1 AND resource_id=$2 AND holder_job_no=$3
        AND lease_token=$4::uuid AND expires_at>NOW() FOR UPDATE`, [resource_type, String(resource_id), actor.jobNo, lease_token],
    );
    if (!held.rows.length) { await db.query('ROLLBACK'); res.status(423).json({ error: '你已不是当前编辑者' }); return; }
    const request = await db.query(
      `SELECT * FROM edit_lease_requests WHERE id=$1 AND resource_type=$2 AND resource_id=$3 AND status='pending' FOR UPDATE`,
      [request_id, resource_type, String(resource_id)],
    );
    if (!request.rows.length) { await db.query('ROLLBACK'); res.status(404).json({ error: '申请已失效' }); return; }
    const target = request.rows[0];
    if (action === 'approve') {
      const nextToken = randomUUID();
      await db.query(
        `UPDATE edit_leases SET holder_job_no=$1,holder_name=$2,lease_token=$3,acquired_at=NOW(),heartbeat_at=NOW(),
          expires_at=NOW()+($4 || ' seconds')::interval WHERE resource_type=$5 AND resource_id=$6`,
        [target.requester_job_no, target.requester_name, nextToken, LEASE_SECONDS, resource_type, String(resource_id)],
      );
      await db.query(
        `UPDATE edit_lease_requests SET status='approved',resolved_at=NOW(),resolved_by_job_no=$1,resolved_by_name=$2 WHERE id=$3`,
        [actor.jobNo, actor.name, request_id],
      );
      await db.query(
        `UPDATE edit_lease_requests SET status='cancelled',resolved_at=NOW() WHERE resource_type=$1 AND resource_id=$2 AND status='pending'`,
        [resource_type, String(resource_id)],
      );
    } else {
      await db.query(
        `UPDATE edit_lease_requests SET status='rejected',resolved_at=NOW(),resolved_by_job_no=$1,resolved_by_name=$2 WHERE id=$3`,
        [actor.jobNo, actor.name, request_id],
      );
    }
    await db.query('COMMIT');
    await logEvent(resource_type, String(resource_id), action === 'approve' ? 'handoff_approved' : 'handoff_rejected', actor,
      { jobNo: target.requester_job_no, name: target.requester_name });
    res.json({ ok: true });
  } catch (error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); }
});

router.post('/leases/heartbeat', async (req: Request, res: Response) => {
  const { resource_type, resource_id, lease_token } = req.body || {};
  const actor = collaborationActor(req);
  // 允许后台休眠后用原令牌续期。转交/接管会换令牌，结束编辑会删除行，
  // 因此过期但未被接管的编辑可恢复，旧持有人不能覆盖新持有人的锁。
  const result = await pool.query(
    `UPDATE edit_leases SET heartbeat_at=NOW(), expires_at=NOW() + ($1 || ' seconds')::interval
      WHERE resource_type=$2 AND resource_id=$3 AND holder_job_no=$4
        AND lease_token=$5::uuid RETURNING expires_at`,
    [LEASE_SECONDS, resource_type, String(resource_id || ''), actor.jobNo, lease_token],
  );
  if (!result.rows.length) { res.status(423).json({ error: '编辑权已失效', code: 'edit_lease_lost' }); return; }
  res.json({ ok: true, expires_at: result.rows[0].expires_at });
});

router.delete('/leases', async (req: Request, res: Response) => {
  const { resource_type, resource_id, lease_token } = req.body || {};
  const actor = collaborationActor(req);
  const released = await pool.query(
    `DELETE FROM edit_leases WHERE resource_type=$1 AND resource_id=$2
      AND holder_job_no=$3 AND lease_token=$4::uuid`,
    [resource_type, String(resource_id || ''), actor.jobNo, lease_token],
  );
  if (released.rowCount) await logEvent(resource_type, String(resource_id || ''), 'lease_released', actor);
  res.json({ ok: true });
});

export default router;
