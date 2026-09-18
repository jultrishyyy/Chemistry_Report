import type { FieldDefinition } from './types';
/** Match PDF visibility without deleting template fields or manual table overrides. */
export function hideAutomaticSampleTable(field: FieldDefinition, ctx: { blank_scope?: boolean; order_samples?: unknown[] } | undefined): boolean {
  return field.type === 'report_sample_table' && !ctx?.blank_scope && !field.free_table?.columns?.length
    && (field.sample_table?.mode || 'always') === 'auto' && (ctx?.order_samples?.length || 0) <= 1;
}
