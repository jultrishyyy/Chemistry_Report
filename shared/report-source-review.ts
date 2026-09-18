import type { RecordTemplate } from './types';

type Snapshot = {
  source_review_revision?: string;
  projects?: Array<{ title?: string; name?: string; ctx?: any }>;
};
// Exact canonical signatures, not a short lossy hash. Never include entered values or formatting.
function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}
export function collectReportSourceChanges(snapshot?: Snapshot | null) {
  return (snapshot?.projects || []).flatMap((section, index) => {
    const template = section.ctx?.linked_record_template as RecordTemplate | undefined;
    return (template?.groups || []).flatMap(group => group.fields || []).flatMap(field => {
      if (field.type !== 'free_grid') return [];
      const table = section.ctx?.record_raw_data?.[field.code]?.__free_table_structure__;
      if (!table?.rows?.some((row: any) => row?.entry_added) && !table?.columns?.some((col: any) => col?.entry_added)) return [];
      const signature = canonical({ version: 1, revision: snapshot?.source_review_revision || 'legacy',
        record: section.ctx?.source_record_data_id ?? null, project: index, field: field.code, templateVersion: template?.version,
        rows: (table.rows || []).map((row: any) => [row.id, !!row.entry_added]),
        columns: (table.columns || []).map((col: any) => [col.id, !!col.entry_added]), spans: table.spans || {} });
      return [{ index, code: field.code, signature, label: `${section.title || section.name || `项目${index + 1}`} · ${field.label || '表格'}` }];
    });
  });
}
/** Only accept acknowledgements for the authoritative generation snapshot. */
export function validSourceReviews(snapshot: Snapshot | null | undefined, reviews: unknown): string[] {
  const valid = new Set(collectReportSourceChanges(snapshot).map(change => change.signature));
  return Array.isArray(reviews) ? [...new Set(reviews.filter((item): item is string => typeof item === 'string' && valid.has(item)))].sort() : [];
}
