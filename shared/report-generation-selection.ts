import type { ReportReqMatchEntry } from './types';
import { preferredReportTemplate } from './report-template-preference';

export interface ReportGenerationChoice {
  scope_key: string;
  enabled?: boolean;
  record_data_id?: number;
  project_template_id?: number;
  title?: string;
  page_break?: boolean;
}

/** Each record template is a separate test method, while revisions remain alternatives. */
export function splitReportMethodMatches<T extends ReportReqMatchEntry>(matches: T[]): Array<T & { base_scope_key?: string; method_name?: string }> {
  return matches.flatMap(entry => {
    if (entry.scope_key.includes(':method:') || !entry.assignments.length) return [entry];
    const methods = new Map<string, typeof entry.assignments>();
    for (const assignment of entry.assignments) {
      const key = assignment.record_template_id == null ? 'legacy' : String(assignment.record_template_id);
      const list = methods.get(key) || []; list.push(assignment); methods.set(key, list);
    }
    return [...methods].map(([method, assignments]) => method === 'legacy' ? { ...entry, assignments } : {
      ...entry, scope_key: `${entry.scope_key}:method:${method}`, base_scope_key: entry.scope_key, assignments,
      method_name: assignments[0].record_template_name || `原始记录模板 #${method}`,
    });
  });
}

/** Resolve only ready projects within this report's selected/default scope. */
export function availableReportAssignments(
  matches: Array<ReportReqMatchEntry & { default_enabled?: boolean }>,
  choices: ReportGenerationChoice[] = [], manufacturerId?: number | null,
) {
  const byScope = new Map(choices.map(choice => [String(choice.scope_key), choice]));
  return splitReportMethodMatches(matches).flatMap(entry => {
    const choice = byScope.get(String(entry.scope_key)) || (entry.base_scope_key ? byScope.get(entry.base_scope_key) : undefined);
    if ((choice ? choice.enabled === false : entry.default_enabled === false) || entry.status !== 'matched') return [];
    const ready = entry.assignments.filter(a => a.record_data_status === 'reviewed' && a.project_template_candidates?.length);
    const assignment = ready.find(a => Number(a.record_data_id) === Number(choice?.record_data_id)) || ready[0];
    if (!assignment) return [];
    const candidates = assignment.project_template_candidates!;
    const candidate = preferredReportTemplate(candidates, manufacturerId,
      (Number(choice?.record_data_id) === Number(assignment.record_data_id) ? choice?.project_template_id : undefined) ?? assignment.project_template_id) || candidates[0];
    return [{ scope_key: entry.scope_key, enabled: true, record_data_id: assignment.record_data_id,
      project_template_id: candidate.id, project_template_version_id: candidate.version_id,
      title: choice?.title || undefined, page_break: choice?.page_break !== false }];
  });
}
