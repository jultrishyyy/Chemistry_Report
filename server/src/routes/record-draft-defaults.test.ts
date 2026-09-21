import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pool } from '../db.js';
import orders from './work-orders.js';
import batches from './record-batches.js';

// Invoke the real route handlers with an isolated SQL stub; never connect to a database.
for (const [router, path] of [[orders, '/:orderNo/bulk-link'], [batches, '/'], [batches, '/:id/methods']] as const) {
  for (const existing of [false, true]) {
    test(`${path}: ${existing ? 'preserves existing values and explicit blanks' : 'initializes defaults from the pinned version'}`, async (t) => {
      const fields = [{
        id: 'group', fields: [
          { id: 'text', code: 'time', type: 'text', default_value: 'Start - End' },
          { id: 'area', code: 'notes', type: 'textarea', default_value: 'Line 1\nLine 2' },
          { id: 'zero', code: 'zero', type: 'number', default_value: 0 },
          { id: 'empty', code: 'empty', type: 'text', default_value: '' },
        ],
      }];
      const original = JSON.stringify(fields);
      const stored = { time: '', notes: 'User value' };
      const scheme = {
        id: 1, group_id: 1, record_template_id: 2, current_version_id: 20,
        status: 'approved', version_status: 'approved', shared_profile_code: 'default',
        field_definitions: fields,
      };
      const batch = { id: 3, audit_status: 'draft', shared_profile_code: 'default', order_no: 'O', sample_external_id: 'S', test_item_name: 'T' };
      const inserts: unknown[][] = [];
      const query = async (sql: string, params: unknown[] = []) => {
        const q = sql.replace(/\s+/g, ' ').trim();
        if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(q)) return { rows: [] };
        if (q.includes('FROM record_templates t') || q.includes('FROM test_method_schemes m')) {
          assert.match(q, /v\.field_definitions/);
          assert.match(q, /v\.id\s*=\s*t\.current_version_id/);
          return { rows: [scheme] };
        }
        if (q.startsWith('SELECT payload FROM work_orders')) {
          return { rows: [{ payload: { samples: [{ id: 'S', test_infos: [{ name: 'T' }] }] } }] };
        }
        if (q.startsWith('SELECT id,audit_status FROM record_batches')) return { rows: [] };
        if (q.startsWith('SELECT * FROM record_batches')) return { rows: [batch] };
        if (q.startsWith('SELECT 1 FROM record_data')) return { rows: [] };
        if (q.startsWith('SELECT method_scheme_id')) return { rows: [] };
        if (q.startsWith('SELECT COALESCE(MAX')) return { rows: [{ next_sort: 0 }] };
        if (q.startsWith('SELECT id') && q.includes('FROM record_data')) {
          return { rows: existing ? [{ id: 10, audit_status: 'draft', raw_data: stored }] : [] };
        }
        if (q.startsWith('INSERT INTO record_batches')) return { rows: [batch] };
        if (q.startsWith('INSERT INTO record_data')) {
          assert.match(q, path === '/:orderNo/bulk-link' ? /\$7::jsonb/ : /\$8::jsonb/);
          inserts.push(params);
          return { rows: [{ id: 10 }] };
        }
        if (q.startsWith('UPDATE record_data')) {
          assert.match(q, /^UPDATE record_data SET record_batch_id=/);
          assert.doesNotMatch(q, /raw_data|derived_data/);
          return { rows: [] };
        }
        if (/^(INSERT INTO record_batch_items|UPDATE work_orders|UPDATE record_batches)/.test(q)) return { rows: [] };
        throw new Error(`Unexpected SQL: ${q}`);
      };
      t.mock.method(pool, 'connect', async () => ({ query, release() {} }));
      t.mock.method(pool, 'query', query);
      const route = router.stack.find((layer: any) => layer.route?.path === path && layer.route.methods.post)!.route!;
      const handler = route.stack[route.stack.length - 1].handle;
      const req = {
        params: { orderNo: 'O', id: '3' },
        body: { template_id: 2, targets: [{ sample_id: 'S', test_name: 'T' }],
          order_no: 'O', sample_external_id: 'S', test_item_name: 'T', method_scheme_ids: [1] },
        header: () => 'Tester',
      };
      const res = { code: 200, body: {} as any,
        status(code: number) { this.code = code; return this; },
        json(body: unknown) { this.body = body; return this; } };
      await handler(req as any, res as any, (() => {}) as any);
      assert.ok(res.code < 300, JSON.stringify(res.body));
      assert.equal(inserts.length, existing ? 0 : 1);
      if (!existing) {
        assert.equal(inserts[0][1], 20);
        assert.deepEqual(JSON.parse(inserts[0].at(-1) as string),
          { time: 'Start - End', notes: 'Line 1\nLine 2', zero: 0 });
      }
      assert.deepEqual(stored, { time: '', notes: 'User value' });
      assert.equal(JSON.stringify(fields), original);
    });
  }
}
