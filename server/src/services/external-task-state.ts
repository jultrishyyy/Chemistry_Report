/**
 * 接口 1.6 材料任务完工通知编排。
 *
 * record_data 没有复制外部 TaskId；它通过
 * (order_no, sample_external_id, test_item_name) 稳定关联 work_orders.payload 中的
 * SampleList[].TaskList[].TaskId。只有同一任务下所有未取消记录均 reviewed 才入队。
 */
import { pool } from '../db.js';
import { isExternalSoapConfigured, updateMaterialTaskState } from './external-report-delivery.js';

export interface TaskStateSyncResult {
  task_id?: string;
  order_no: string;
  sample_external_id: string;
  test_item_name: string;
  status: 'sent' | 'mock' | 'queued' | 'failed' | 'already_sent' | 'not_complete' | 'missing_task_id';
  error?: string;
}

function taskIdFromPayload(payload: any, sampleExternalId: string, testItemName: string): string {
  const samples: any[] = Array.isArray(payload?.samples) ? payload.samples : [];
  const sample = samples.find(item => String(item?.id ?? '') === sampleExternalId)
    || samples.find(item => String(item?.barcode ?? '') === sampleExternalId);
  const test = (Array.isArray(sample?.test_infos) ? sample.test_infos : [])
    .find((item: any) => String(item?.name ?? '').trim() === testItemName);
  return String(test?.task_id ?? test?.TaskId ?? '').trim();
}

/** 审核成功后调用：判定任务是否真正完工、持久化通知，并立即尝试发送。 */
export async function notifyCompletedTasksForRecords(recordIds: number[]): Promise<TaskStateSyncResult[]> {
  const ids = [...new Set(recordIds.map(Number).filter(Number.isFinite))];
  if (!ids.length) return [];
  const records = await pool.query(
    `SELECT id,order_no,sample_external_id,test_item_name
       FROM record_data WHERE id=ANY($1::int[])`, [ids],
  );
  const contexts = new Map<string, any>();
  for (const row of records.rows) {
    const key = `${row.order_no}\u0000${row.sample_external_id}\u0000${row.test_item_name}`;
    if (!contexts.has(key)) contexts.set(key, row);
  }

  const queuedIds: number[] = [];
  const resultByDeliveryId = new Map<number, TaskStateSyncResult>();
  const immediate: TaskStateSyncResult[] = [];
  for (const row of contexts.values()) {
    const base = {
      order_no: String(row.order_no),
      sample_external_id: String(row.sample_external_id),
      test_item_name: String(row.test_item_name),
    };
    const unfinished = await pool.query(
      `SELECT COUNT(*)::int AS count FROM record_data
        WHERE order_no=$1 AND sample_external_id=$2 AND test_item_name=$3
          AND cancelled_at IS NULL AND audit_status<>'reviewed'`,
      [base.order_no, base.sample_external_id, base.test_item_name],
    );
    if (Number(unfinished.rows[0]?.count || 0) > 0) {
      immediate.push({ ...base, status: 'not_complete' });
      continue;
    }
    const order = await pool.query('SELECT payload FROM work_orders WHERE order_no=$1', [base.order_no]);
    const taskId = taskIdFromPayload(order.rows[0]?.payload, base.sample_external_id, base.test_item_name);
    if (!taskId) {
      immediate.push({ ...base, status: 'missing_task_id', error: '订单 TaskList 中没有 TaskId，无法回传完工状态' });
      continue;
    }
    const allRecordIds = await pool.query(
      `SELECT array_agg(id ORDER BY id)::int[] AS ids FROM record_data
        WHERE order_no=$1 AND sample_external_id=$2 AND test_item_name=$3 AND cancelled_at IS NULL`,
      [base.order_no, base.sample_external_id, base.test_item_name],
    );
    const inserted = await pool.query(
      `INSERT INTO external_task_state_deliveries
         (task_id,test_state,order_no,sample_external_id,test_item_name,record_data_ids,delivery_status,next_retry_at)
       VALUES ($1,1,$2,$3,$4,$5::int[],'pending',NOW())
       ON CONFLICT (task_id,test_state) DO UPDATE SET
         order_no=EXCLUDED.order_no,sample_external_id=EXCLUDED.sample_external_id,
         test_item_name=EXCLUDED.test_item_name,record_data_ids=EXCLUDED.record_data_ids,
         delivery_status=CASE WHEN external_task_state_deliveries.delivery_status='sent' THEN 'sent' ELSE 'pending' END,
         next_retry_at=CASE WHEN external_task_state_deliveries.delivery_status='sent' THEN external_task_state_deliveries.next_retry_at ELSE NOW() END,
         updated_at=NOW()
       RETURNING id,delivery_status`,
      [taskId, base.order_no, base.sample_external_id, base.test_item_name, allRecordIds.rows[0]?.ids || ids],
    );
    const deliveryId = Number(inserted.rows[0].id);
    if (inserted.rows[0].delivery_status === 'sent') {
      immediate.push({ task_id: taskId, ...base, status: 'already_sent' });
    } else {
      queuedIds.push(deliveryId);
      resultByDeliveryId.set(deliveryId, { task_id: taskId, ...base, status: 'queued' });
    }
  }

  if (queuedIds.length) {
    const sent = await deliverTaskStateQueue(queuedIds);
    for (const item of sent) resultByDeliveryId.set(item.id, {
      task_id: item.task_id,
      order_no: item.order_no,
      sample_external_id: item.sample_external_id,
      test_item_name: item.test_item_name,
      status: item.mock ? 'mock' : item.ok ? 'sent' : 'failed',
      ...(item.error ? { error: item.error } : {}),
    });
  }
  return [...immediate, ...queuedIds.map(id => resultByDeliveryId.get(id)!)];
}

interface DeliveryAttempt {
  id: number;
  task_id: string;
  order_no: string;
  sample_external_id: string;
  test_item_name: string;
  ok: boolean;
  mock?: boolean;
  error?: string;
}

/** 认领并发送指定通知；未指定 id 时处理到期的失败/待发通知。 */
export async function deliverTaskStateQueue(deliveryIds?: number[]): Promise<DeliveryAttempt[]> {
  const client = await pool.connect();
  let rows: any[] = [];
  try {
    await client.query('BEGIN');
    const claimed = await client.query(
      `WITH candidates AS (
         SELECT id FROM external_task_state_deliveries
          WHERE delivery_status<>'sent'
            AND (delivery_status<>'sending' OR updated_at < NOW()-INTERVAL '10 minutes')
            AND (next_retry_at IS NULL OR next_retry_at<=NOW())
            AND ($1::bigint[] IS NULL OR id=ANY($1::bigint[]))
          ORDER BY updated_at ASC LIMIT 20 FOR UPDATE SKIP LOCKED
       )
       UPDATE external_task_state_deliveries d
          SET delivery_status='sending',attempts=attempts+1,updated_at=NOW()
         FROM candidates c WHERE d.id=c.id RETURNING d.*`,
      [deliveryIds?.length ? deliveryIds : null],
    );
    rows = claimed.rows;
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return Promise.all(rows.map(async row => {
    const delivered = await updateMaterialTaskState(String(row.task_id), Number(row.test_state) === 0 ? 0 : 1);
    if (delivered.mock) {
      // demo 配置绝不能写成 sent，否则以后切到 server 配置会永久漏发。
      await pool.query(
        `UPDATE external_task_state_deliveries SET delivery_status='pending',receipt=$1,
           delivery_error='mock 模式未向外部系统发送',next_retry_at=NULL,updated_at=NOW() WHERE id=$2`,
        [delivered.receipt || null, row.id],
      );
    } else if (delivered.ok) {
      await pool.query(
        `UPDATE external_task_state_deliveries SET delivery_status='sent',receipt=$1,delivery_error=NULL,
           delivered_at=NOW(),next_retry_at=NULL,updated_at=NOW() WHERE id=$2`,
        [delivered.receipt || null, row.id],
      );
    } else {
      const retrySeconds = Math.min(21600, 300 * (2 ** Math.min(Number(row.attempts || 1) - 1, 7)));
      await pool.query(
        `UPDATE external_task_state_deliveries SET delivery_status='failed',delivery_error=$1,
           next_retry_at=NOW()+($2::text || ' seconds')::interval,updated_at=NOW() WHERE id=$3`,
        [delivered.error || '未知错误', String(retrySeconds), row.id],
      );
    }
    return {
      id: Number(row.id), task_id: String(row.task_id), order_no: String(row.order_no),
      sample_external_id: String(row.sample_external_id), test_item_name: String(row.test_item_name),
      ok: delivered.ok, ...(delivered.mock ? { mock: true } : {}), ...(delivered.error ? { error: delivered.error } : {}),
    };
  }));
}

/** 服务启动后后台重试；定时器 unref，不阻止进程退出。 */
export function startTaskStateDeliveryRetryWorker(): void {
  if (!isExternalSoapConfigured()) {
    console.log('[external-task-state] mock 模式不启动完工通知重试；通知保留 pending，切换 server 配置后发送');
    return;
  }
  const run = () => deliverTaskStateQueue().catch(error => {
    console.error('[external-task-state] 重试任务状态通知失败:', error?.message || error);
  });
  const first = setTimeout(run, 10_000);
  first.unref();
  const timer = setInterval(run, 5 * 60_000);
  timer.unref();
}
