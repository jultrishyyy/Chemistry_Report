/**
 * 嵌套分区（子分区）分桶工具——编辑器 / 录入端 / PDF 生成 三端共用的唯一实现。
 *
 * 存储是平铺 groups[]，FieldGroup.parent_group_id 指向顶级分区 id（限一层）。
 * 这里把平铺数组组织成 顶级分区 + 其子分区列表：
 *   - 顶级分区按数组顺序；同父的子分区之间按数组顺序
 *   - parent_group_id 悬空（指向不存在/非顶级的分区）→ 防御性按顶级处理
 */
import type { FieldGroup } from './types.js';

export interface GroupTreeEntry {
  group: FieldGroup;
  children: FieldGroup[];
}

export const isSubgroup = (g: FieldGroup, groups: FieldGroup[]): boolean =>
  !!g.parent_group_id && groups.some(p => p.id === g.parent_group_id && !p.parent_group_id);

export function buildGroupTree(groups: FieldGroup[]): GroupTreeEntry[] {
  const list = groups || [];
  const topLevel = list.filter(g => !isSubgroup(g, list));
  return topLevel.map(group => ({
    group,
    children: list.filter(c => c.parent_group_id === group.id && c !== group),
  }));
}
