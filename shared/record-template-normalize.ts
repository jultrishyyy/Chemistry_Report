import type { FieldDefinition, FieldGroup } from './types';

const isService = (field: FieldDefinition) => field.code === 'service_no' || field.label?.trim() === '服务编号';
const isSample = (field: FieldDefinition) => field.code === 'sample_no' || field.label?.trim() === '样品编号';

/** 所有原始记录模板统一具备可编辑的“服务编号 / 样品编号”基础字段（幂等）。 */
export function ensureRecordIdentityFields(groups: FieldGroup[] | null | undefined): FieldGroup[] {
  const source = Array.isArray(groups) && groups.length ? groups : [{ id: 'g_basic', label: '基本信息', layout: 'vertical' as const, section_role: 'basic' as const, fields: [] }];
  let service: FieldDefinition | undefined;
  let sample: FieldDefinition | undefined;
  const cleaned = source.map(group => ({
    ...group,
    fields: (group.fields || []).filter(field => {
      if (isService(field)) { service ||= field; return false; }
      if (isSample(field)) { sample ||= field; return false; }
      return true;
    }),
  }));
  let basicIndex = cleaned.findIndex(group => group.section_role === 'basic');
  if (basicIndex < 0) basicIndex = cleaned.findIndex(group => /基本信息|基础信息/.test(group.label || ''));
  if (basicIndex < 0) basicIndex = 0;
  const normalizedService: FieldDefinition = {
    ...(service || {}), id: service?.id || 'f_service_no', code: service?.code || 'service_no',
    label: '服务编号', type: 'text', required: service?.required ?? true,
  };
  const normalizedSample: FieldDefinition = {
    ...(sample || {}), id: sample?.id || 'f_sample_no', code: sample?.code || 'sample_no',
    label: '样品编号', type: 'text', required: sample?.required ?? true,
  };
  cleaned[basicIndex] = { ...cleaned[basicIndex], fields: [normalizedService, normalizedSample, ...cleaned[basicIndex].fields] };
  return cleaned;
}
