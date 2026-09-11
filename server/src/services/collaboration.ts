import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { pool } from '../db.js';

export const LEASE_SECONDS = 90;

export function collaborationActor(req: Request) {
  const raw = (req.header('X-Demo-User') || '').trim();
  let name = raw;
  try { name = decodeURIComponent(raw); } catch { /* keep raw */ }
  const jobNo = (req.header('X-User-Job') || '').trim();
  return { name, jobNo: jobNo || name };
}

export async function acquireEditLease(resourceType: string, resourceId: string, name: string, jobNo: string) {
  const token = randomUUID();
  const result = await pool.query(
    `INSERT INTO edit_leases
       (resource_type, resource_id, holder_job_no, holder_name, lease_token, acquired_at, heartbeat_at, expires_at)
     VALUES ($1,$2,$3,$4,$5,NOW(),NOW(),NOW() + ($6 || ' seconds')::interval)
     ON CONFLICT (resource_type, resource_id) DO UPDATE SET
       holder_job_no = EXCLUDED.holder_job_no,
       holder_name = EXCLUDED.holder_name,
       lease_token = EXCLUDED.lease_token,
       acquired_at = CASE WHEN edit_leases.holder_job_no = EXCLUDED.holder_job_no THEN edit_leases.acquired_at ELSE NOW() END,
       heartbeat_at = NOW(),
       expires_at = EXCLUDED.expires_at
     WHERE edit_leases.expires_at <= NOW() OR edit_leases.holder_job_no = EXCLUDED.holder_job_no
     RETURNING *`,
    [resourceType, resourceId, jobNo, name, token, LEASE_SECONDS],
  );
  if (result.rows.length) return { acquired: true, lease: result.rows[0] };
  const held = await pool.query(
    `SELECT holder_job_no, holder_name, acquired_at, expires_at
       FROM edit_leases WHERE resource_type=$1 AND resource_id=$2 AND expires_at > NOW()`,
    [resourceType, resourceId],
  );
  return { acquired: false, lease: held.rows[0] || null };
}

export async function assertEditLease(
  req: Request, res: Response, resourceType: string, resourceId: string,
): Promise<boolean> {
  const actor = collaborationActor(req);
  const token = (req.header('X-Edit-Lease-Token') || '').trim();
  if (!actor.jobNo || !token) {
    res.status(423).json({ error: '未取得文档编辑权，请刷新后重试', code: 'edit_lease_required' });
    return false;
  }
  const held = await pool.query(
    `SELECT holder_name FROM edit_leases
      WHERE resource_type=$1 AND resource_id=$2 AND holder_job_no=$3
        AND lease_token=$4::uuid AND expires_at > NOW()`,
    [resourceType, resourceId, actor.jobNo, token],
  );
  if (!held.rows.length) {
    const current = await pool.query(
      `SELECT holder_name FROM edit_leases
        WHERE resource_type=$1 AND resource_id=$2 AND expires_at > NOW()`, [resourceType, resourceId]);
    res.status(423).json({
      error: current.rows[0] ? `当前由 ${current.rows[0].holder_name} 编辑，你可以继续只读查看` : '编辑权已过期，请重新取得编辑权',
      code: 'edit_lease_lost', holder_name: current.rows[0]?.holder_name || null,
    });
    return false;
  }
  return true;
}
