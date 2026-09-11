export type DatePrecision = 'day' | 'hour' | 'minute';

/** 日期/时间统一显示格式；无法解析的值原样返回，避免误清空外部接口文本。 */
export function formatDateByPrecision(value: unknown, precision: DatePrecision = 'day', separator: '-' | '/' = '-'): string {
  if (value === null || value === undefined || value === '') return '';
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}${separator}${pad(date.getMonth() + 1)}${separator}${pad(date.getDate())}`;
  if (precision === 'day') return day;
  const hour = `${day} ${pad(date.getHours())}`;
  return precision === 'hour' ? `${hour}:00` : `${hour}:${pad(date.getMinutes())}`;
}
