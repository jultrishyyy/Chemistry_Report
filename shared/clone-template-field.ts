import type { FieldDefinition, Formula, RecordTemplate } from './types';
import { decodeFreeGridCellReference, encodeFreeGridCellReference, remapFreeGridFormula } from './free-grid-formula';

/** Clone configuration, not record data. Cell/row/band IDs are local to their table. */
export function cloneTemplateField(source: FieldDefinition, template: RecordTemplate): FieldDefinition {
  const ids = new Set(template.groups.map(g => g.id));
  const codes = new Set<string>();
  const visit = (field: FieldDefinition, fn: (f: FieldDefinition) => void) => {
    fn(field);
    field.variants?.forEach(v => v.fields?.forEach(f => visit(f, fn)));
  };
  template.groups.forEach(g => g.fields.forEach(f => visit(f, child => {
    ids.add(child.id); codes.add(child.code);
    child.variants?.forEach(v => ids.add(v.id));
  })));
  const allocate = (base: string, used: Set<string>) => {
    let result = `${base}_copy`, n = 2;
    while (used.has(result)) result = `${base}_copy_${n++}`;
    used.add(result); return result;
  };
  const copy: FieldDefinition = JSON.parse(JSON.stringify(source));
  const renamed = new Map<string, string>();
  visit(copy, f => {
    f.id = allocate(f.id, ids);
    const code = allocate(f.code, codes);
    renamed.set(f.code, code); f.code = code;
    f.variants?.forEach(v => { v.id = allocate(v.id, ids); });
  });
  const mapSource = (source: string) => {
    const ref = decodeFreeGridCellReference(source);
    if (ref) return renamed.has(ref.fieldCode) ? encodeFreeGridCellReference(renamed.get(ref.fieldCode)!, ref.cellKey) : source;
    if (renamed.has(source)) return renamed.get(source)!;
    for (const [oldCode, newCode] of renamed) {
      if (source.startsWith(`${oldCode}__`)) return newCode + source.slice(oldCode.length);
      if (source.startsWith(`col:${oldCode}:`)) return `col:${newCode}:` + source.slice(`col:${oldCode}:`.length);
    }
    return source;
  };
  // Only calculation sources are local references. Report bindings deliberately
  // continue to refer to the original record, even when codes happen to coincide.
  const walk = (value: any): any => {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== 'object') return value;
    const next = typeof value.type === 'string' && Array.isArray(value.sources)
      ? remapFreeGridFormula(value as Formula, mapSource) : value;
    return Object.fromEntries(Object.entries(next).map(([key, child]) => [key,
      /(^|_)bindings?$/.test(key) ? child : walk(child)]));
  };
  return walk(copy);
}
