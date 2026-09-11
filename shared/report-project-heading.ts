import { encodeReportRichDocument } from './report-rich-document';

export interface ReportProjectHeading {
  name?: string; title?: string; seq?: number;
  /** Report-only editable heading, including its displayed sequence number. */
  report_heading?: string;
}

export function reportProjectHeadingValue(project: ReportProjectHeading): string | null {
  if (typeof project.report_heading === 'string') return project.report_heading;
  const name = (project.title || project.name || '').trim();
  if (!project.seq || !name) return null;
  return encodeReportRichDocument({ type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: `${project.seq}) ${name}`, marks: [{ type: 'bold' }] },
  ] }] });
}
