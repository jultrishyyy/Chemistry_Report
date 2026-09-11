import type { RecordTemplate, FieldDefinition } from './types';
import { executeWithFullPrecision } from './formula-engine.ts';
import { applyNumericRounding } from './numeric-rounding.ts';
import { resolveFreeGridCellReference } from './free-grid-formula.ts';
import { readSampleAxes } from './free-grid-samples.ts';

const textValue = (v: any): any => v && typeof v === 'object' && 'custom' in v ? v.custom : v;
const projected = Symbol('legacyMatrixProjection');

/** Read-only compatibility view. Never put a matrix object into the saved free-grid raw data. */
export function projectLegacyMatrices(template: RecordTemplate | null | undefined, data: Record<string, any>, flat: Record<string, any> = {}, format = false) {
  const fields = template?.groups?.flatMap(g => g.fields || []) || [];
  const targets = fields.filter(f => f.type === 'free_grid' && f.free_table && f.legacy_matrix?.version === 1);
  if (!targets.length) return { raw: data, flat };
  const resultRaw = { ...data }, resultFlat = { ...flat };
  const cache = new Map<string, any>(), visiting = new Set<string>();
  const tableOf = (f: FieldDefinition) => data[f.code]?.__free_table_structure__ || f.free_table;
  const evaluate = (f: FieldDefinition, key: string, sample?: number): any => {
    const node = `${f.code}/${key}/${sample ?? 'fixed'}`;
    if (cache.has(node)) return cache.get(node);
    if (visiting.has(node)) return '';
    visiting.add(node);
    const ft = tableOf(f), raw = data[f.code] || {};
    const runtime = sample == null ? key : `${key}::s${sample}`;
    const formula = ft?.cell_formulas?.[key];
    const override = raw[`__formula_override__::${runtime}`];
    let value: any;
    if (formula && override?.value !== undefined) value = override.value;
    else if (formula) {
      const sources: string[] = [], values: Record<string, any> = {};
      for (const source of formula.sources || []) {
        const ref = resolveFreeGridCellReference(source, f.code);
        const owner = fields.find(x => x.code === ref.fieldCode);
        if (!owner?.free_table) { sources.push(source); values[source] = ''; continue; }
        const sourceTable = tableOf(owner);
        const [r, c] = ref.cellKey.split('::');
        const band = sourceTable.sample_bands?.find((b: any) => !b.source_field && !b.matrix_code && b.refs.includes(b.axis === 'row' ? r : c));
        const entries = band && (readSampleAxes(data[owner.code] || {}, band.id) || band.refs.map((ref: string) => ({ ref, sample: 0 })));
        if (sample == null && formula.type !== 'custom' && entries) {
          for (const entry of entries.filter((e: any) => e.ref === (band.axis === 'row' ? r : c) && (formula.sample_scope !== 'selected' || e.sample === 0))) {
            const token = `${source}::s${entry.sample}`;
            sources.push(token); values[token] = evaluate(owner, ref.cellKey, entry.sample);
          }
        } else { sources.push(source); values[source] = evaluate(owner, ref.cellKey, sample); }
      }
      value = executeWithFullPrecision({ ...formula, sources }, values);
    } else value = textValue(raw[runtime] ?? raw[key] ?? ft?.cells?.[key] ?? '');
    const isData = ft?.input_cells?.[key] || ft?.cell_formulas?.[key] || ft?.cell_types?.[key] === 'number';
    value = applyNumericRounding(value, ft?.cell_rounding?.[key] ?? (isData ? ft?.default_rounding : undefined));
    visiting.delete(node); cache.set(node, value); return value;
  };
  for (const f of targets) {
    const meta = f.legacy_matrix!, ft = tableOf(f), raw = data[f.code] || {};
    // Remove stale virtual keys before rebuilding in active sample order (deleted samples must disappear).
    for (const k of Object.keys(resultFlat)) if (k.startsWith(`${f.code}__`)) delete resultFlat[k];
    const band = ft.sample_bands?.find((b: any) => b.id === 'migrated_samples');
    const entries = band ? readSampleAxes(raw, band.id) || band.refs.map((ref: string) => ({ ref, sample: 0 }))
      : meta.sample_refs.map(ref => ({ ref, sample: 0 }));
    const labels: Record<string, any> = {}, cells: Record<string, any> = {}, units: Record<string, any> = {};
    const displayed = (key: string, sample?: number) => {
      const value = evaluate(f, key, sample);
      const fmt = ft.cell_number_fmt?.[key] || ft.default_number_fmt;
      if (format && fmt?.mode === 'decimals' && value !== '' && value != null && Number.isFinite(Number(value))) return Number(value).toFixed(Math.min(20, Math.max(0, fmt.digits)));
      return value;
    };
    const sampleIds: string[] = [];
    for (const entry of entries) {
      const sid = entry.sample === 0 ? entry.ref : `${entry.ref}_added_${entry.sample}`;
      sampleIds.push(sid);
      labels[sid] = evaluate(f, meta.sample_headers[entry.ref], entry.sample);
      for (const p of meta.config.parameters) {
        const k = meta.keys[`${entry.ref}__${p.code}`];
        if (!k) continue;
        cells[`${sid}__${p.code}`] = displayed(k, entry.sample);
        resultFlat[`${f.code}__${sid}__${p.code}`] = cells[`${sid}__${p.code}`];
      }
      for (const sc of meta.config.summary_cols || []) {
        const k = meta.keys[`sumcol__${sc.id}__${entry.ref}`];
        if (k) resultFlat[`${f.code}__sumcol__${sc.id}__${sid}`] = displayed(k, entry.sample);
      }
    }
    for (const [old, key] of Object.entries(meta.keys)) if (old.startsWith('summary__')) resultFlat[`${f.code}__${old}`] = displayed(key);
    for (const [p, k] of Object.entries(meta.parameter_headers)) units[p] = raw[`${k}::__unit__`] ?? ft.cell_unit_options?.[k]?.[0] ?? ft.cell_units?.[k] ?? '';
    resultRaw[f.code] = { ...raw, sample_ids: sampleIds, sample_labels: labels, parameter_unit_overrides: units, cells };
  }
  return { raw: resultRaw, flat: resultFlat };
}

export function legacyMatrixReportContext<T extends { linked_record_template?: RecordTemplate | null; record_raw_data?: Record<string, any>; record_flat_data?: Record<string, any> }>(ctx: T): T {
  if ((ctx as any)[projected]) return ctx;
  const view = projectLegacyMatrices(ctx.linked_record_template, ctx.record_raw_data || {}, ctx.record_flat_data || {}, true);
  return { ...ctx, record_raw_data: view.raw, record_flat_data: view.flat, [projected]: true };
}
