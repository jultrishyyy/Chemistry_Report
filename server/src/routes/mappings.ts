import { Router, Request, Response } from 'express';

import { pool } from '../db.js';

const router = Router();

router.get('/:reportTemplateId', async (req: Request, res: Response) => {
  const { reportTemplateId } = req.params;
  const result = await pool.query(
    'SELECT * FROM report_template_mappings WHERE report_template_id = $1 ORDER BY id',
    [reportTemplateId]
  );
  res.json(result.rows);
});

router.post('/:reportTemplateId', async (req: Request, res: Response) => {
  const { reportTemplateId } = req.params;
  const { placeholder, source_type, source_field_code, literal_value, formula, transform, notes } = req.body;
  if (!placeholder || !source_type) {
    res.status(400).json({ error: 'placeholder and source_type are required' });
    return;
  }

  const result = await pool.query(
    `INSERT INTO report_template_mappings (report_template_id, placeholder, source_type, source_field_code, literal_value, formula, transform, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (report_template_id, placeholder) DO UPDATE SET
       source_type = EXCLUDED.source_type, source_field_code = EXCLUDED.source_field_code,
       literal_value = EXCLUDED.literal_value, formula = EXCLUDED.formula,
       transform = EXCLUDED.transform, notes = EXCLUDED.notes, updated_at = NOW()
     RETURNING *`,
    [reportTemplateId, placeholder, source_type, source_field_code || null, literal_value || null, formula ? JSON.stringify(formula) : null, transform || null, notes || null]
  );
  res.json(result.rows[0]);
});

router.post('/:reportTemplateId/batch', async (req: Request, res: Response) => {
  const { reportTemplateId } = req.params;
  const { mappings } = req.body;
  if (!Array.isArray(mappings)) {
    res.status(400).json({ error: 'mappings array required' });
    return;
  }

  const results = [];
  for (const m of mappings) {
    const result = await pool.query(
      `INSERT INTO report_template_mappings (report_template_id, placeholder, source_type, source_field_code, literal_value, formula, transform)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (report_template_id, placeholder) DO UPDATE SET
         source_type = EXCLUDED.source_type, source_field_code = EXCLUDED.source_field_code,
         literal_value = EXCLUDED.literal_value, formula = EXCLUDED.formula,
         transform = EXCLUDED.transform, updated_at = NOW()
       RETURNING *`,
      [reportTemplateId, m.placeholder, m.source_type, m.source_field_code || null, m.literal_value || null, m.formula ? JSON.stringify(m.formula) : null, m.transform || null]
    );
    results.push(result.rows[0]);
  }
  res.json(results);
});

router.delete('/:reportTemplateId/:placeholder', async (req: Request, res: Response) => {
  const { reportTemplateId, placeholder } = req.params;
  await pool.query('DELETE FROM report_template_mappings WHERE report_template_id = $1 AND placeholder = $2', [reportTemplateId, placeholder]);
  res.json({ ok: true });
});

export default router;
