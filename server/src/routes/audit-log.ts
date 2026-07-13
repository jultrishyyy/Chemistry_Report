import { Router, Request, Response } from 'express';

import { pool } from '../db.js';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  const { order_no, record_id } = req.query;
  let query = `SELECT l.id, l.record_id, l.order_no, l.action, l.actor_name, l.actor_role, l.note,
                      l.version_no, l.status_after, l.data_snapshot, l.created_at,
                      r.sample_external_id, r.test_item_name
               FROM record_audit_log l
               LEFT JOIN record_data r ON r.id = l.record_id`;
  const conds: string[] = [];
  const params: any[] = [];
  if (order_no)  { params.push(order_no);  conds.push(`l.order_no = $${params.length}`); }
  if (record_id) { params.push(record_id); conds.push(`l.record_id = $${params.length}`); }
  if (conds.length) query += ' WHERE ' + conds.join(' AND ');
  query += ' ORDER BY l.created_at DESC';
  const result = await pool.query(query, params);
  res.json(result.rows);
});

export default router;
