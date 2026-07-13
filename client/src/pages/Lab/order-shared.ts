/**
 * 录入工作台共享类型 + 纯函数（订单列表页 TaskList 与 订单详情页 OrderDetail 共用）。
 */

export interface TestInfo {
  name: string;
  standard?: string;
  /** 旧单值字段（兼容存量数据）；新数据统一用 linked_template_ids */
  linked_template_id?: number | null;
  /** 一个测试项目可关联一个或多个原始记录模板 */
  linked_template_ids?: number[];
}

/** 读取测试项目的关联模板集合（兼容旧单值 linked_template_id）。 */
export function normalizeLinkedIds(t: TestInfo): number[] {
  if (Array.isArray(t.linked_template_ids)) return t.linked_template_ids.filter(n => typeof n === 'number');
  return typeof t.linked_template_id === 'number' ? [t.linked_template_id] : [];
}
export interface Sample {
  id: string;
  name: string;
  test_infos: TestInfo[];
}
export interface WorkOrder {
  order_no: string;
  customer_name: string;
  received_at: string;
  source?: string;
  payload: { samples: Sample[] };
}
export interface TemplateItem {
  id: number; name: string; version: number;
  /** 当前生效版本状态；非 'approved'（含无生效版本）＝未审核通过，关联弹窗中禁选 */
  current_status?: string | null;
}
export interface RecordRow {
  id: number;
  template_id: number;
  order_no?: string | null;
  sample_external_id?: string | null;
  test_item_name?: string | null;
  tester_name?: string | null;
  tested_at?: string | null;
  reviewer_name?: string | null;
  reviewed_at?: string | null;
  audit_status?: 'draft' | 'pending' | 'reviewed' | 'rejected' | null;
  current_version?: number;
  reject_note?: string | null;
  updated_at?: string;
  submitted_at: string;
}
export interface AuditEvent {
  id: number;
  record_id: number;
  order_no?: string | null;
  action: 'submit' | 'update' | 'review' | 'reject';
  actor_name: string;
  actor_role?: string | null;
  note?: string | null;
  version_no?: number | null;
  data_snapshot?: Record<string, any> | null;
  status_after?: string | null;
  created_at: string;
  sample_external_id?: string | null;
  test_item_name?: string | null;
}

export interface RowVm {
  key: string;
  order_no: string;
  sample_id: string;
  sample_name: string;
  test_name: string;
  /** 同一测试项目的所有关联行共享的分组键（sample_id + test_name），用于表格 rowSpan */
  test_key: string;
  standard?: string;
  /** 本行对应的单个关联模板（一个测试项目可有多行，每行一个模板）；占位行为 null */
  linked_template_id?: number | null;
  linked_template_name?: string;
  /** 该测试项目当前已关联的全部模板 id（用于关联弹窗去重、占位行判断） */
  test_linked_ids: number[];
  record?: RecordRow;
}

export const ACTION_LABEL: Record<string, string> = { submit: '提交', update: '更新', review: '审核通过', reject: '退回' };
export const ACTION_COLOR: Record<string, string> = { submit: 'blue', update: 'orange', review: 'green', reject: 'red' };
/** 操作对应的 CSS 色值（历史版本卡片左侧色条用；与 ACTION_COLOR 的 antd 标签色对应）。 */
export const ACTION_HEX: Record<string, string> = { submit: '#1677ff', update: '#d97706', review: '#16a34a', reject: '#dc2626' };

/**
 * 找本行对应的录入记录。record_data 唯一键是 (template_id, order_no, sample, test_item)——
 * 必须按**当前关联的模板**过滤：换关联模板后，旧模板录的记录不再属于本行
 * （否则打开编辑永远进旧模板的记录，与当前关联不符）。旧记录仍保留在库与审计中。
 */
export function findRecord(
  records: RecordRow[], order_no: string, sample_id: string, test_name: string, template_id?: number | null,
): RecordRow | undefined {
  const matched = records.filter(r =>
    r.order_no === order_no && r.sample_external_id === sample_id && r.test_item_name === test_name
    && (!template_id || r.template_id === template_id)
  );
  if (!matched.length) return undefined;
  return matched.reduce((a, b) =>
    new Date(a.updated_at || a.submitted_at) > new Date(b.updated_at || b.submitted_at) ? a : b
  );
}

/**
 * 把一张订单展开成表格行。一个测试项目可关联多个模板 → 展开成多行（每行一个模板）；
 * 未关联的测试项目展开成一条占位行（linked_template_id=null），供添加关联。
 * 同一测试项目的多行共享 test_key，便于「样品」「测试项目」列做 rowSpan 合并。
 */
export function buildOrderRows(
  order: WorkOrder, records: RecordRow[], templateById: Map<number, TemplateItem>,
): RowVm[] {
  const out: RowVm[] = [];
  for (const s of order.payload.samples || []) {
    for (const t of s.test_infos || []) {
      const test_key = `${s.id}__${t.name}`;
      const ids = normalizeLinkedIds(t);
      const base = {
        order_no: order.order_no,
        sample_id: s.id,
        sample_name: s.name,
        test_name: t.name,
        test_key,
        standard: t.standard,
        test_linked_ids: ids,
      };
      if (ids.length === 0) {
        out.push({
          ...base,
          key: `${order.order_no}__${test_key}__none`,
          linked_template_id: null,
          record: undefined,
        });
      } else {
        for (const tid of ids) {
          out.push({
            ...base,
            key: `${order.order_no}__${test_key}__${tid}`,
            linked_template_id: tid,
            linked_template_name: templateById.get(tid)?.name,
            record: findRecord(records, order.order_no, s.id, t.name, tid),
          });
        }
      }
    }
  }
  return out;
}

/**
 * 订单进度统计（列表页用），按「样品 × 测试项目」格统计：
 *  - linked：该格已关联 ≥1 个模板
 *  - recorded：该格所有关联模板都已录入
 *  - reviewed：该格所有关联记录都已审核通过
 *  - rejected：该格有任一记录被退回
 */
export function orderProgress(order: WorkOrder, records: RecordRow[], _templateById?: Map<number, TemplateItem>) {
  let testTotal = 0, linked = 0, recorded = 0, reviewed = 0, rejected = 0, pending = 0;
  for (const s of order.payload.samples || []) {
    for (const t of s.test_infos || []) {
      testTotal++;
      const ids = normalizeLinkedIds(t);
      if (ids.length) linked++;
      const recs = ids.map(id => findRecord(records, order.order_no, s.id, t.name, id)).filter(Boolean) as RecordRow[];
      const allRecorded = ids.length > 0 && recs.length === ids.length;
      if (allRecorded) recorded++;
      if (allRecorded && recs.every(r => r.audit_status === 'reviewed')) reviewed++;
      if (recs.some(r => r.audit_status === 'rejected')) rejected++;
      if (recs.some(r => r.audit_status === 'pending')) pending++;
    }
  }
  return { sampleCount: order.payload.samples?.length || 0, testTotal, linked, recorded, reviewed, rejected, pending };
}

/**
 * 订单级派生状态（录入侧）——供列表「状态」列一眼看出该单当前所处环节 / 是否需处理。
 * 优先级：已退回 > 审核中 > 已审核 > 录入中 > 待关联 > 无项目。
 */
export type OrderStatusKey = 'rejected' | 'pending' | 'reviewed' | 'recording' | 'unlinked' | 'empty';
export interface OrderStatusVm { key: OrderStatusKey; label: string; color: string }
export function deriveOrderStatus(
  order: WorkOrder, records: RecordRow[], templateById?: Map<number, TemplateItem>,
): OrderStatusVm {
  const p = orderProgress(order, records, templateById);
  if (p.testTotal === 0) return { key: 'empty', label: '无项目', color: 'default' };
  if (p.rejected > 0) return { key: 'rejected', label: '已退回', color: 'red' };
  if (p.pending > 0) return { key: 'pending', label: '审核中', color: 'orange' };
  if (p.reviewed === p.testTotal) return { key: 'reviewed', label: '已审核', color: 'green' };
  if (p.linked === 0) return { key: 'unlinked', label: '待关联', color: 'default' };
  return { key: 'recording', label: '录入中', color: 'blue' };
}

// ─── 高级搜索 ───────────────────────────────────────────────────────────

export type OrderStatusFilter = 'unlinked' | 'unrecorded' | 'pending' | 'reviewed' | 'rejected';
export interface OrderSearchCriteria {
  keyword?: string;                         // 单号 / 客户 / 样品 / 项目
  /** 订单级派生状态（含某类即命中）。录入侧为 OrderStatusFilter；报告侧复用本搜索栏，状态为报告侧的派生键（故放宽为 string）。 */
  status?: OrderStatusFilter | (string & {});
  range?: [string | null, string | null];  // 接收日期范围（ISO）
  tester?: string;                          // 主检人
  reviewer?: string;                        // 审核人
}

export function isOrderSearchActive(c: OrderSearchCriteria): boolean {
  return !!(c.keyword?.trim() || c.status || c.tester?.trim() || c.reviewer?.trim()
    || (c.range && (c.range[0] || c.range[1])));
}

/** 纯前端过滤（订单数据整页加载）。 */
export function filterOrders(
  orders: WorkOrder[], records: RecordRow[], templateById: Map<number, TemplateItem>, c: OrderSearchCriteria,
): WorkOrder[] {
  if (!isOrderSearchActive(c)) return orders;
  const kw = c.keyword?.trim().toLowerCase();
  const tester = c.tester?.trim().toLowerCase();
  const reviewer = c.reviewer?.trim().toLowerCase();
  const from = c.range?.[0] ? new Date(c.range[0]) : null;
  const to = c.range?.[1] ? new Date(c.range[1]) : null;

  return orders.filter(o => {
    if (kw) {
      const hit = o.order_no.toLowerCase().includes(kw)
        || (o.customer_name || '').toLowerCase().includes(kw)
        || (o.payload.samples || []).some(s =>
          s.name.toLowerCase().includes(kw) || s.test_infos.some(t => t.name.toLowerCase().includes(kw)));
      if (!hit) return false;
    }
    if (from || to) {
      const d = o.received_at ? new Date(o.received_at) : null;
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
    }
    if (tester || reviewer) {
      const recs = records.filter(r => r.order_no === o.order_no);
      if (tester && !recs.some(r => (r.tester_name || '').toLowerCase().includes(tester))) return false;
      if (reviewer && !recs.some(r => (r.reviewer_name || '').toLowerCase().includes(reviewer))) return false;
    }
    if (c.status) {
      const p = orderProgress(o, records, templateById);
      if (c.status === 'unlinked' && !(p.linked < p.testTotal)) return false;
      if (c.status === 'unrecorded' && !(p.recorded < p.linked)) return false;
      if (c.status === 'pending' && !(p.pending > 0)) return false;
      if (c.status === 'rejected' && !(p.rejected > 0)) return false;
      if (c.status === 'reviewed' && !(p.testTotal > 0 && p.reviewed === p.testTotal)) return false;
    }
    return true;
  });
}

/** 字段级 diff（浅层 stringify 比较） */
export type Diff = { key: string; kind: 'added' | 'removed' | 'changed'; from?: any; to?: any };
export function computeDiff(prev: Record<string, any> | null, curr: Record<string, any> | null): Diff[] {
  const out: Diff[] = [];
  const keys = new Set([...Object.keys(prev || {}), ...Object.keys(curr || {})]);
  for (const k of keys) {
    const a = prev?.[k];
    const b = curr?.[k];
    const sa = stringify(a);
    const sb = stringify(b);
    if (sa === sb) continue;
    if (a === undefined) out.push({ key: k, kind: 'added', to: b });
    else if (b === undefined) out.push({ key: k, kind: 'removed', from: a });
    else out.push({ key: k, kind: 'changed', from: a, to: b });
  }
  return out;
}
export function stringify(v: any): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') {
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return String(v);
}
