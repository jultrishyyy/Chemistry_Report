/** PostgreSQL integer primary keys; never accept a UI tree row key as an ID. */
export function isDatabaseId(value: unknown): boolean {
  if (typeof value !== 'number' && typeof value !== 'string') return false;
  if (!/^[1-9]\d*$/.test(String(value))) return false;
  return Number.isSafeInteger(Number(value)) && Number(value) <= 2147483647;
}
