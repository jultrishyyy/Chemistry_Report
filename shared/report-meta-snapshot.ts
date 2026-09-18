import type { ReportContentDoc, ReportMeta } from './types';

/** Interface 1.2 values that are frozen into every report section and the page header/footer. */
export const REPORT_META_SNAPSHOT_KEYS = [
  'verify_code', 'report_no', 'cover_report_no', 'issue_date',
  'company_name', 'company_name_en', 'company_address', 'company_address2',
  'company_address_en', 'company_address2_en', 'fax', 'fax_en', 'phone', 'phone_en',
  'website', 'report_note', 'report_note_en', 'qualification_note', 'qualification_note_en',
  'customer_name', 'customer_address', 'language',
] as const satisfies readonly (keyof ReportMeta)[];

function value(value: unknown): string {
  return value == null ? '' : String(value);
}

function sameMeta(actual: Record<string, any> | undefined, expected: ReportMeta): boolean {
  return REPORT_META_SNAPSHOT_KEYS.every(key => value(actual?.[key]) === value(expected[key]));
}

/** True only when the report body bindings and page header both contain the current interface values. */
export function reportMetaSnapshotMatches(contentDoc: ReportContentDoc | null | undefined, meta: ReportMeta): boolean {
  if (!contentDoc || !sameMeta(contentDoc.cover?.ctx?.report_meta, meta)) return false;
  const hf = contentDoc.cover?.layout_options?.header_footer;
  if (!hf || !['verify_code', 'report_no', 'cover_report_no', 'issue_date', 'company_name', 'company_address',
    'fax', 'phone', 'website', 'report_note', 'qualification_note'].every(key => value(hf[key]) === value((meta as any)[key]))) return false;
  return [contentDoc.front_cover, ...(contentDoc.projects || [])]
    .filter(Boolean).every(section => sameMeta(section!.ctx?.report_meta, meta));
}

/** Replace only interface-owned snapshots; report text, tables, images and manual edits remain untouched. */
export function applyReportMetaSnapshot(
  contentDoc: ReportContentDoc,
  meta: ReportMeta,
  headerFooter: Record<string, any>,
): ReportContentDoc {
  const next: ReportContentDoc = JSON.parse(JSON.stringify(contentDoc));
  const sections = [next.front_cover, next.cover, ...(next.projects || [])].filter(Boolean);
  for (const section of sections) {
    section!.ctx = { ...(section!.ctx || {}), report_meta: { ...meta } };
  }
  next.cover.layout_options = {
    ...(next.cover.layout_options || {}),
    header_footer: { ...(next.cover.layout_options?.header_footer || {}), ...headerFooter },
  };
  return next;
}
