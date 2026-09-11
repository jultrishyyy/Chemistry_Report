import type { FieldDefinition, FieldGroup, RecordTemplate } from './types';

export interface RecordConclusionItemSnapshot {
  name: string;
  judgment_requirement?: string;
  conclusion: string;
  status: 'completed' | 'not_tested' | 'not_applicable' | 'unable';
  report_enabled: boolean;
  name_field?: FieldDefinition;
  judgment_field?: FieldDefinition;
  conclusion_field?: FieldDefinition;
}

export interface RecordConclusionSnapshot {
  source: 'module' | 'legacy';
  mode: 'overall' | 'children';
  project_name: string;
  judgment_requirement?: string;
  conclusion?: string;
  project_name_field?: FieldDefinition;
  judgment_field?: FieldDefinition;
  conclusion_field?: FieldDefinition;
  items: RecordConclusionItemSnapshot[];
  allow_no_completed_items?: boolean;
}

export function recordFieldText(field: FieldDefinition | undefined, rawData: Record<string, any>): string {
  if (!field) return '';
  const value = Object.prototype.hasOwnProperty.call(rawData || {}, field.code) ? rawData[field.code] : field.default_value;
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(item => String(item ?? '')).filter(Boolean).join('、');
  if (typeof value === 'object' && 'custom' in value) return String(value.custom ?? '').trim();
  return String(value).trim();
}

function roleField(group: FieldGroup, role: FieldDefinition['conclusion_role']): FieldDefinition | undefined {
  return (group.fields || []).find(field => field.conclusion_role === role);
}

/**
 * 读取原始记录结论。新模板优先使用“结论分区 + 独立字段”；旧 record_conclusion 复合字段仅作回放兼容。
 */
export function extractRecordConclusion(template: RecordTemplate, rawData: Record<string, any>): RecordConclusionSnapshot | null {
  const projectGroup = (template.groups || []).find(group =>
    group.section_role === 'conclusion'
    && !group.parent_group_id
    && (group.conclusion_kind === 'project' || group.fields?.some(field => field.conclusion_role === 'project_name')));

  if (projectGroup) {
    const projectNameField = roleField(projectGroup, 'project_name');
    const judgmentField = roleField(projectGroup, 'judgment_requirement');
    const conclusionField = roleField(projectGroup, 'conclusion');
    const children = (template.groups || []).filter(group =>
      group.parent_group_id === projectGroup.id
      && group.section_role === 'conclusion'
      && (group.conclusion_kind === 'item' || group.fields?.some(field => field.conclusion_role === 'item_name')));
    const projectName = recordFieldText(projectNameField, rawData);
    const childItems = children.map(group => {
      const nameField = roleField(group, 'item_name');
      const childJudgment = roleField(group, 'judgment_requirement');
      const childConclusion = roleField(group, 'conclusion');
      return {
        name: recordFieldText(nameField, rawData),
        judgment_requirement: recordFieldText(childJudgment, rawData) || undefined,
        conclusion: recordFieldText(childConclusion, rawData),
        status: 'completed' as const,
        report_enabled: true,
        name_field: nameField,
        judgment_field: childJudgment,
        conclusion_field: childConclusion,
      };
    });
    return {
      source: 'module',
      mode: childItems.length ? 'children' : 'overall',
      project_name: projectName,
      judgment_requirement: recordFieldText(judgmentField, rawData) || undefined,
      conclusion: recordFieldText(conclusionField, rawData) || undefined,
      project_name_field: projectNameField,
      judgment_field: judgmentField,
      conclusion_field: conclusionField,
      items: childItems.length ? childItems : [{
        name: projectName,
        judgment_requirement: recordFieldText(judgmentField, rawData) || undefined,
        conclusion: recordFieldText(conclusionField, rawData),
        status: 'completed',
        report_enabled: true,
        name_field: projectNameField,
        judgment_field: judgmentField,
        conclusion_field: conclusionField,
      }],
    };
  }

  const legacyField = (template.groups || []).flatMap(group => group.fields || [])
    .find(field => field.type === 'record_conclusion' && field.record_conclusion);
  if (!legacyField?.record_conclusion) return null;
  const cfg = legacyField.record_conclusion;
  const stored = rawData?.[legacyField.code] && typeof rawData[legacyField.code] === 'object' ? rawData[legacyField.code] : {};
  const storedItems: any[] = Array.isArray(stored.items) ? stored.items : [];
  const projectName = String(stored.project_name ?? cfg.project_name ?? '').trim();
  const items = (cfg.items || []).map(definition => {
    const value = storedItems.find(item => item?.item_code === definition.code || item?.code === definition.code) || {};
    return {
      name: cfg.mode === 'children' ? String(value.display_name ?? definition.name ?? '').trim() : projectName,
      judgment_requirement: String(value.judgment_requirement ?? definition.judgment_requirement ?? '').trim() || undefined,
      conclusion: String(value.conclusion ?? '').trim(),
      status: (value.execution_status || 'completed') as RecordConclusionItemSnapshot['status'],
      report_enabled: value.report_enabled ?? definition.default_report_enabled !== false,
    };
  });
  return {
    source: 'legacy',
    mode: cfg.mode,
    project_name: projectName,
    judgment_requirement: cfg.mode === 'children' && cfg.project_summary?.judgment_enabled !== false && cfg.project_summary
      ? String(stored.project_judgment_requirement ?? cfg.project_summary.judgment_requirement ?? '').trim() || undefined
      : items[0]?.judgment_requirement,
    conclusion: cfg.mode === 'children' && cfg.project_summary?.conclusion_enabled !== false && cfg.project_summary
      ? String(stored.project_conclusion ?? '').trim() || undefined
      : items[0]?.conclusion,
    items,
    allow_no_completed_items: cfg.allow_no_completed_items,
  };
}
