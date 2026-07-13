/**
 * 模板列表树形分组工具（RecordTemplate/List 与 ReportTemplate/List 共用）
 *
 * - 子模板（parent_template_id 指向列表内可见模板）嵌套到母模板行下（antd Table children）
 * - 母模板不可见（已归档/在别的 Tab）的子模板平铺在顶层
 * - 根节点按「自身与全部后代中最近的活动时间」降序（last_activity 由列表 API 提供）
 */

export interface TemplateListRow {
  id: number;
  parent_template_id?: number | null;
  last_activity?: string;
  updated_at: string;
  open_draft?: { status: string; author_name: string } | null;
  children?: TemplateListRow[];
  [k: string]: any;
}

export const activityTs = (r: TemplateListRow): number =>
  new Date(r.last_activity || r.updated_at).getTime();

export function buildTemplateTree<T extends TemplateListRow>(rows: T[]): T[] {
  const visible = new Set(rows.map((r) => r.id));
  const byParent = new Map<number, T[]>();
  const roots: T[] = [];
  for (const r of rows) {
    if (r.parent_template_id && visible.has(r.parent_template_id)) {
      const arr = byParent.get(r.parent_template_id) || [];
      arr.push(r);
      byParent.set(r.parent_template_id, arr);
    } else {
      roots.push(r);
    }
  }
  // 递归挂 children，并算子树最近活动时间用于根排序
  const attach = (r: T): { node: T; ts: number } => {
    const kids = (byParent.get(r.id) || []).map(attach);
    kids.sort((a, b) => b.ts - a.ts);
    const ts = Math.max(activityTs(r), ...kids.map((k) => k.ts));
    const node = kids.length ? { ...r, children: kids.map((k) => k.node) } : { ...r };
    return { node, ts };
  };
  return roots
    .map(attach)
    .sort((a, b) => b.ts - a.ts)
    .map((x) => x.node);
}

export type TemplateListFilter = 'all' | 'pending' | 'mine';

/** 「待审核 / 我的草稿」过滤（平铺展示，不嵌套） */
export function filterTemplateRows<T extends TemplateListRow>(
  rows: T[], filter: TemplateListFilter, userName?: string
): T[] {
  if (filter === 'pending') {
    return rows.filter((r) => r.open_draft?.status === 'pending').sort((a, b) => activityTs(b) - activityTs(a));
  }
  if (filter === 'mine') {
    return rows
      .filter((r) => r.open_draft && (r.open_draft.status === 'draft' || r.open_draft.status === 'rejected')
        && r.open_draft.author_name === userName)
      .sort((a, b) => activityTs(b) - activityTs(a));
  }
  return rows;
}

/** 高级搜索条件（两个列表页共用；全部前端过滤，列表数据已整页加载） */
export interface TemplateSearchCriteria {
  keyword?: string;                                  // 名称 / 对应项目名称 模糊
  status?: 'approved' | 'draft' | 'pending' | 'rejected';   // 流转状态（approved = 无未定稿）
  author?: string;                                   // 修改人：当前版本作者 或 未定稿作者
  range?: [string | null, string | null] | null;     // 最近修改时间范围（ISO，含端点）
  scope?: 'parent' | 'child';                        // 仅母模板（无 parent）/ 仅子模板
}

export const isSearchActive = (c: TemplateSearchCriteria): boolean =>
  !!(c.keyword?.trim() || c.status || c.author?.trim() || (c.range && (c.range[0] || c.range[1])) || c.scope);

export function applyTemplateSearch<T extends TemplateListRow>(rows: T[], c: TemplateSearchCriteria): T[] {
  let out = rows;
  const kw = c.keyword?.trim().toLowerCase();
  if (kw) {
    out = out.filter((r) =>
      String(r.name || '').toLowerCase().includes(kw) ||
      String(r.project_name || '').toLowerCase().includes(kw));
  }
  if (c.status) {
    out = c.status === 'approved'
      ? out.filter((r) => !r.open_draft)
      : out.filter((r) => r.open_draft?.status === c.status);
  }
  const author = c.author?.trim();
  if (author) {
    out = out.filter((r) => r.current_author?.includes(author) || r.open_draft?.author_name?.includes(author));
  }
  if (c.range && (c.range[0] || c.range[1])) {
    const from = c.range[0] ? new Date(c.range[0]).getTime() : -Infinity;
    const to = c.range[1] ? new Date(c.range[1]).getTime() : Infinity;
    out = out.filter((r) => { const ts = activityTs(r); return ts >= from && ts <= to; });
  }
  if (c.scope === 'parent') out = out.filter((r) => !r.parent_template_id);
  if (c.scope === 'child') out = out.filter((r) => !!r.parent_template_id);
  return out;
}

/** 有子节点的行 id（用于默认展开全部） */
export function parentRowKeys<T extends TemplateListRow>(tree: T[]): number[] {
  const out: number[] = [];
  const walk = (rows: T[]) => {
    for (const r of rows) {
      if (r.children?.length) { out.push(r.id); walk(r.children as T[]); }
    }
  };
  walk(tree);
  return out;
}
