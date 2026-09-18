/** A valid manual choice takes precedence; OEM matching is a default, not a restriction. */
export function preferredReportTemplate<T extends { id: number; host_manufacturer_id?: number | null }>(
  candidates: T[], manufacturerId?: number | null, selectedId?: number | null,
): T | undefined {
  const selected = candidates.find(c => selectedId != null && Number(c.id) === Number(selectedId));
  if (selected) return selected;
  return manufacturerId == null ? undefined
    : candidates.find(c => Number(c.host_manufacturer_id) === Number(manufacturerId));
}
