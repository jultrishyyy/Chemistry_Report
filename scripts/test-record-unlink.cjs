// Uses connection-local TEMP tables only; never deletes application data.
const assert = require('node:assert/strict');
const Module = require('node:module');
const { Client } = require('pg');
const url = process.env.TEST_DATABASE_URL;
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw Error('Set TEST_DATABASE_URL to a local test database');
const db = new Client({ connectionString: url });
(async () => {
  await db.connect();
  await db.query(`
    CREATE TEMP TABLE work_orders (order_no text PRIMARY KEY, payload jsonb, updated_at timestamptz);
    CREATE TEMP TABLE record_batches (id int PRIMARY KEY, order_no text, audit_status text, updated_at timestamptz);
    CREATE TEMP TABLE record_data (id int PRIMARY KEY, template_id int, template_version_id int, order_no text,
      sample_external_id text, test_item_name text, audit_status text, cancelled_at timestamptz,
      record_batch_id int REFERENCES record_batches(id) ON DELETE SET NULL);
    CREATE TEMP TABLE record_batch_items (id int PRIMARY KEY, batch_id int REFERENCES record_batches(id) ON DELETE CASCADE,
      record_data_id int REFERENCES record_data(id) ON DELETE RESTRICT, item_status text DEFAULT 'active');
    CREATE TEMP TABLE record_audit_log (record_id int REFERENCES record_data(id) ON DELETE CASCADE);
    CREATE TEMP TABLE rework_tickets (record_data_id int REFERENCES record_data(id), status text, resolved_at timestamptz, resolution_note text);
    INSERT INTO work_orders VALUES ('TEST', '{"samples":[{"id":"s1","test_infos":[{"name":"密度","linked_template_ids":[10,20]}]}]}', NOW());
    INSERT INTO record_batches VALUES (1,'TEST','pending',NOW()),(2,'TEST','draft',NOW());
    INSERT INTO record_data VALUES (61,10,100,'TEST','s1','密度','draft',NULL,1),
      (62,20,200,'TEST','s1','密度','draft',NULL,1),(63,10,101,'TEST','s1','密度','pending',NULL,2),
      (64,10,101,'TEST','s2','密度','draft',NULL,NULL);
    INSERT INTO record_batch_items(id,batch_id,record_data_id) VALUES (1,1,61),(2,1,62),(3,2,63);
    INSERT INTO record_audit_log VALUES(61),(62),(63);
    INSERT INTO rework_tickets VALUES(61,'open',NULL,NULL);
  `);
  const pool = { query: (...args) => db.query(...args), connect: async () => ({ query: (...args) => db.query(...args), release() {} }) };
  const originalLoad = Module._load;
  Module._load = function(name, ...rest) {
    if (name === '../db.js') return { pool };
    return originalLoad.call(this, name, ...rest);
  };
  const router = require('../server/src/routes/work-orders.ts').default;
  Module._load = originalLoad;
  const handler = router.stack.find(layer => layer.route?.path === '/:orderNo/link').route.stack.at(-1).handle;
  const invoke = async id => {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ params: { orderNo: 'TEST' }, body: { sample_id: 's1', test_name: '密度', linked_template_id: id, op: 'remove' } }, res);
    return res;
  };
  const result = await invoke(10);
  assert.equal(result.code, 200);
  assert.equal(result.body.removed_records, 2, 'all template versions must be removed');
  assert.deepEqual((await db.query('SELECT id FROM record_data ORDER BY id')).rows.map(r => r.id), [62,64], 'sibling template and other sample remain');
  assert.deepEqual((await db.query('SELECT record_data_id FROM record_batch_items')).rows.map(r => r.record_data_id), [62]);
  assert.deepEqual((await db.query('SELECT record_id FROM record_audit_log')).rows.map(r => r.record_id), [62]);
  assert.deepEqual((await db.query('SELECT id,audit_status FROM record_batches')).rows, [{ id: 1, audit_status: 'draft' }]);
  assert.deepEqual((await db.query('SELECT record_data_id,status FROM rework_tickets')).rows, [{ record_data_id: null, status: 'resolved' }]);
  assert.deepEqual(result.body.payload.samples[0].test_infos[0].linked_template_ids, [20]);
  await db.query("UPDATE record_data SET audit_status='reviewed' WHERE id=62");
  assert.equal((await invoke(20)).code, 409, 'approved records remain protected');
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM record_data')).rows[0].n, 2);
  // Simulate an unexpected dependent table and verify atomic rollback + friendly message.
  await db.query("UPDATE record_data SET audit_status='draft' WHERE id=62");
  await db.query('CREATE TEMP TABLE extra_dependency (record_id int REFERENCES record_data(id)); INSERT INTO extra_dependency VALUES(62)');
  const failed = await invoke(20);
  assert.equal(failed.code, 500);
  assert.doesNotMatch(failed.body.error, /foreign key|constraint|record_data/);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM record_batch_items')).rows[0].n, 1, 'deleted items rolled back');
  assert.deepEqual((await db.query('SELECT payload FROM work_orders')).rows[0].payload.samples[0].test_infos[0].linked_template_ids, [20]);
  console.log('Unlink PostgreSQL TEMP-table tests passed: versions, FK cleanup, sibling isolation, empty batches, audit cascade, reviewed protection and rollback.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.end());
