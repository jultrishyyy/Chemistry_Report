import type { FieldDefinition } from './types';
export type SampleAxisEntry = { ref: string; sample: number };
export const sampleAxesKey = (bandId: string) => `__sample_axes__::${bandId}`;
export function readSampleAxes(raw: Record<string, any>, bandId: string): SampleAxisEntry[] | undefined {
  const value = raw[sampleAxesKey(bandId)];
  if (!Array.isArray(value)) return undefined;
  return value.filter(item => item && typeof item.ref === 'string' && Number.isInteger(item.sample) && item.sample >= 0);
}

export function sampleAxisErrors(table: NonNullable<FieldDefinition['free_table']>, raw: Record<string, any>): string[] {
  const errors: string[] = [];
  const bands = table.sample_bands?.length ? table.sample_bands
    : table.sample_band?.ref ? [{ id: 'legacy', refs: [table.sample_band.ref] }] : [];
  for (const band of bands) {
    const value = raw[sampleAxesKey(band.id)];
    if (value === undefined) continue;
    if (!Array.isArray(value) || !value.length) { errors.push('请至少保留一个试样'); continue; }
    const seen = new Set<string>();
    if (value.some(entry => {
      const key = `${entry?.ref}:${entry?.sample}`;
      if (!entry || !band.refs.includes(entry.ref) || !Number.isInteger(entry.sample) || entry.sample < 0 || seen.has(key)) return true;
      seen.add(key); return false;
    })) errors.push('试样行列信息无效或重复，请重新检查试样');
  }
  return errors;
}

/** Existing values keep their ref/sample address, including after deleting a middle row. */
export function editSampleAxes(
  table: NonNullable<FieldDefinition['free_table']>, raw: Record<string, any>,
  band: { id: string; axis: 'row' | 'col'; refs: string[]; cross_refs?: string[] },
  current: SampleAxisEntry[], remove?: SampleAxisEntry,
): Record<string, any> {
  if (remove) return { ...raw, [sampleAxesKey(band.id)]: current.filter(e => e.ref !== remove.ref || e.sample !== remove.sample) };
  const ref = current.at(-1)?.ref ?? band.refs.at(-1);
  if (!ref || current.length >= 50) return raw;
  const sequenceKey = `__sample_next__::${band.id}`;
  let next = Math.max(Number(raw[sequenceKey]) || 0, ...current.map(e => e.sample + 1), 1);
  // Never reuse keys from deleted/legacy samples (including formula and unit overrides).
  for (const key of Object.keys(raw)) {
    const match = /::s(\d+)(?:::__unit__)?$/.exec(key);
    if (match) next = Math.max(next, Number(match[1]) + 1);
  }
  const result = { ...raw, [sampleAxesKey(band.id)]: [...current, { ref, sample: next }], [sequenceKey]: next + 1 };
  const cross = band.axis === 'row' ? table.columns : table.rows;
  for (const item of cross) {
    if (band.cross_refs?.length && !band.cross_refs.includes(item.id)) continue;
    const key = band.axis === 'row' ? `${ref}::${item.id}` : `${item.id}::${ref}`;
    // Retain layout, options, units and formulas, but never copy a measured value.
    if (table.input_cells?.[key] && !table.header_cells?.[key] && !table.cell_formulas?.[key]) result[`${key}::s${next}`] = '';
  }
  return result;
}
