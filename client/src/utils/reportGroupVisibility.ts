type Group = {
  id: number | string;
  templates?: { template_kind?: string | null }[];
};

/** Group visibility follows its members, never the tab in which it was created. */
export function visibleReportGroups<T extends Group>(
  groups: T[], kind: 'cover' | 'project' | 'cover_page',
  options: { all?: boolean; groupId?: number | null } = {},
): T[] {
  if (options.groupId != null) return groups.filter(group => Number(group.id) === Number(options.groupId));
  if (options.all) return groups;
  if (kind === 'cover_page') return [];
  return groups.filter(group => group.templates?.some(template => (template.template_kind || 'cover') === kind));
}
