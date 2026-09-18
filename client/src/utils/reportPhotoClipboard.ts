export const REPORT_PHOTO_MIME = 'application/x-report-source-photo';
type PhotoCopy = { photo: Record<string, any>; title: string };
const copies = new Map<string, PhotoCopy>();
export function copyReportPhoto(photo: Record<string, any>, title: string) {
  const token = crypto.randomUUID();
  copies.set(token, structuredClone({ photo, title }));
  if (copies.size > 20) copies.delete(copies.keys().next().value!);
  const escaped = title.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  return { token, text: title || '图片', html: `<span data-report-photo="${token}">${escaped || '图片'}</span>` };
}
export function readReportPhoto(data: Pick<DataTransfer, 'getData'>): PhotoCopy | undefined {
  const direct = data.getData(REPORT_PHOTO_MIME);
  const html = data.getData('text/html');
  const token = direct || (html.length < 2_000_000 ? new DOMParser().parseFromString(html, 'text/html').querySelector('[data-report-photo]')?.getAttribute('data-report-photo') : undefined);
  const copy = token ? copies.get(token) : undefined;
  return copy ? structuredClone(copy) : undefined;
}
