import type { FieldGroup, ProjectConclusionDecl } from './types';
import { validateReportBindings } from './binding-integrity';

/** User-facing issues retain a stable editor target, never discard the original binding. */
export interface ReportBindingReviewItem {
  fieldCode?: string;
  groupName: string;
  fieldName: string;
  conclusion?: boolean;
  reasons: string[];
  count: number;
}

export function reportBindingReview(
  groups: FieldGroup[], source: FieldGroup[], conclusions: ProjectConclusionDecl[] = [],
): ReportBindingReviewItem[] {
  const result: ReportBindingReviewItem[] = [];
  for (const group of groups) {
    for (const field of group.fields || []) {
      const issues = validateReportBindings([{ ...group, fields: [field] }], source, []);
      if (issues.length) result.push({
        fieldCode: field.code, groupName: group.label || '未命名分区',
        fieldName: field.label || '未命名字段',
        reasons: [...new Set(issues.map(issue => issue.reason))], count: issues.length,
      });
    }
  }
  const structured = source.some(group =>
    (group.section_role === 'conclusion' && group.fields?.some(f => f.conclusion_role === 'project_name'))
    || group.fields?.some(f => f.type === 'record_conclusion' && f.record_conclusion));
  const issues = validateReportBindings([], source, structured ? [] : conclusions);
  if (issues.length) result.push({ groupName: '检测结论', fieldName: '结论来源', conclusion: true,
    reasons: [...new Set(issues.map(issue => issue.reason))], count: issues.length });
  return result;
}
