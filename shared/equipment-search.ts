/** Search terms are literal text, not SQL wildcard expressions. */
export function equipmentSearchTerms(value: unknown): string[] {
  return typeof value === 'string' ? value.trim().split(/\s+/u).filter(Boolean).slice(0, 10) : [];
}
export function equipmentLikePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, char => `\\${char}`)}%`;
}
export function equipmentCodes(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && !!item.trim()))] : [];
}
