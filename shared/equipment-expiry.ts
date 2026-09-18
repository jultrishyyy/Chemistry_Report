/** 到期当天仍有效；日期按使用者本地日历比较，不按毫秒比较。 */
export function equipmentExpiryWarning(device: { status?: string; expire_date?: string | null } | undefined, now = new Date()): string {
  if (!device) return '';
  const date = device.expire_date ? new Date(device.expire_date) : null;
  const day = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  const expiry = device.expire_date && /^\d{4}-\d{2}-\d{2}$/.test(device.expire_date)
    ? device.expire_date : date && !Number.isNaN(date.getTime()) ? day(date) : '';
  if (expiry && expiry < day(now)) return `已于 ${expiry} 到期`;
  return /超期|过期/.test(device.status || '') ? `设备状态为“${device.status}”` : '';
}
