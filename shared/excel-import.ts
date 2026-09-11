import type { FieldDefinition, DataMatrixValue } from './types';
import { normalizeMatrixValue, matrixDataKey } from './matrix-flatten.ts';
import { buildFreeGridLayout } from './free-grid-layout.ts';
import { editSampleAxes } from './free-grid-samples.ts';

export type ImportValue = string | number | boolean;
export type ImportRange = { r0: number; c0: number; r1: number; c1: number };
export type ImportSheet = { name: string; grid: ImportValue[][]; merges: ImportRange[]; blocked: string[]; notices: string[]; hidden?: boolean; unavailable_reason?: string };
export type ImportParam = { id: string; label: string; unit?: string };
type Cell = { key: string; editable: boolean; options?: string[]; decimals?: number };
export type ImportTarget = { axis: 'row' | 'col'; params: ImportParam[]; cells: Cell[][]; value: any; grow: boolean; labels: string[] };
export const importConfig = (f: FieldDefinition) => f.type === 'free_grid' ? f.free_table?.excel_import : f.matrix?.excel_import;
export const chooseImportSheet = (configured: string | undefined, sheets: ImportSheet[]) => {
  const name = configured?.trim();
  if (name) return sheets.find(sheet => sheet.name === configured)?.name ?? sheets.find(sheet => sheet.name === name)?.name;
  return sheets.length === 1 ? sheets[0].name : undefined;
};
export const rangeName = (v: ImportRange) => `${columnName(v.c0)}${v.r0 + 1}:${columnName(v.c1)}${v.r1 + 1}`;
export function columnName(i: number): string { let out = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) out = String.fromCharCode(65 + (i - 1) % 26) + out; return out; }
export const rangesOverlap = (a: ImportRange, b: ImportRange) => a.r0 <= b.r1 && a.r1 >= b.r0 && a.c0 <= b.c1 && a.c1 >= b.c0;
export const normalizeImportLabel = (v: string) => v.normalize('NFKC').toLowerCase().replace(/[\s_·:：]/g, '');
const hasValue = (v: unknown) => v !== '' && v != null;
const numeric = (v: unknown) => typeof v === 'number' || (typeof v === 'string' && /^\s*[<>≤≥]?\s*[-+]?\d+(\.\d+)?([eE][-+]?\d+)?\s*%?\s*$/.test(v));
export function findImportRegions(sheet: ImportSheet, axis: 'row' | 'col', params: ImportParam[] = []): ImportRange[] {
  const n = axis === 'row' ? sheet.grid.length : Math.max(0, ...sheet.grid.map(r => r.length));
  const m = axis === 'row' ? Math.max(0, ...sheet.grid.map(r => r.length)) : sheet.grid.length;
  const at = (s: number, p: number) => axis === 'row' ? sheet.grid[s]?.[p] : sheet.grid[p]?.[s];
  const result: ImportRange[] = [];
  let start = -1, end = -1, lo = m, hi = -1;
  const flush = () => {
    if (start >= 0) result.push(axis === 'row' ? { r0: start, r1: end, c0: lo, c1: hi } : { c0: start, c1: end, r0: lo, r1: hi });
    start = -1; lo = m; hi = -1;
  };
  for (let s = 0; s < n; s++) {
    const numbers = Array.from({ length: m }, (_, p) => p).filter(p => numeric(at(s, p)) || /^(合格|不合格|未检出|通过|不通过)$/.test(String(at(s, p) ?? '')));
    if (!numbers.length) { flush(); continue; }
    if (start < 0) start = s;
    end = s; lo = Math.min(lo, numbers[0]); hi = Math.max(hi, numbers.at(-1)!);
  }
  flush();
  const score = (r: ImportRange) => suggestImportMapping(params, sourceParameterLabels(sheet, r, axis)).reasons.filter(reason => reason.startsWith('名称对应')).length * 1000000
    + (r.r1 - r.r0 + 1) * (r.c1 - r.c0 + 1);
  return result.map(range => ({ range, score: score(range) })).sort((a, b) => b.score - a.score).slice(0, 12).map(v => v.range);
}
function sheetText(sheet: ImportSheet, r: number, c: number) {
  const merge = sheet.merges.find(v => r >= v.r0 && r <= v.r1 && c >= v.c0 && c <= v.c1);
  return String(sheet.grid[merge?.r0 ?? r]?.[merge?.c0 ?? c] ?? '');
}
export function sourceParameterLabels(sheet: ImportSheet, range: ImportRange, axis: 'row' | 'col'): string[] {
  const n = axis === 'row' ? range.c1 - range.c0 + 1 : range.r1 - range.r0 + 1;
  const start = axis === 'row' ? range.r0 : range.c0;
  let headerStart = start;
  for (let i = start - 1; i >= Math.max(0, start - 1000); i--) {
    const stripe = Array.from({ length: n }, (_, p) => axis === 'row' ? sheetText(sheet, i, range.c0 + p) : sheetText(sheet, range.r0 + p, i));
    if (stripe.every(text => !text.trim())) break;
    if (stripe.some(numeric)) {
      if (headerStart < start) break;
      continue; // A selection starting halfway through the data still uses the preceding headers.
    }
    headerStart = i;
  }
  return Array.from({ length: n }, (_, p) => {
    const parts: string[] = [];
    for (let i = headerStart; i < start; i++) {
      const text = axis === 'row' ? sheetText(sheet, i, range.c0 + p) : sheetText(sheet, range.r0 + p, i);
      if (text.trim() && !numeric(text) && !parts.includes(text)) parts.push(text);
    }
    return parts.join(' / ') || (axis === 'row' ? `Excel列 ${columnName(range.c0 + p)}` : `Excel行 ${range.r0 + p + 1}`);
  });
}
export function suggestImportMapping(params: ImportParam[], labels: string[]): { indexes: number[]; reasons: string[] } {
  const labelOnly = (text: string) => normalizeImportLabel(text.replace(/[（(][^()（）]*[)）]\s*$/u, '').replace(/\s*[/／]\s*(mm|cm|m|kg|g|n|kn|mpa|pa|s|ms|°c|℃|%)\s*$/i, ''));
  const partsOf = (text: string) => text.split(' / ').map(labelOnly).filter(part => part && !/^(mm|cm|m|kg|g|n|kn|mpa|pa|s|ms|°c|℃|%)$/i.test(part));
  const scores = params.map(param => labels.map(label => {
    if (/^Excel[行列]\s/.test(label)) return 0;
    const wanted = partsOf(param.label), source = partsOf(label);
    return Math.max(0, ...wanted.flatMap(a => source.map(b => {
      if (a === b) return 1;
      if (a.length < 2 || b.length < 2) return 0;
      const bare = (name: string) => name.replace(/^(试样|样品|试件)/, '');
      if (bare(a).length >= 2 && bare(a) === bare(b)) return 0.95;
      const overlap = [...new Set(a)].filter(char => b.includes(char)).length;
      return overlap / Math.max(new Set(a).size, new Set(b).size) * 0.85;
    })));
  }));
  const indexes = params.map(() => -1), reasons = params.map(() => '未对应，请核对并手动选择来源，或保留原值');
  const used = new Set<number>();
  // Reserve all unambiguous exact matches before considering fuzzy matches. Never let
  // an absent earlier parameter consume the source of a later, correctly named one.
  for (const exact of [true, false]) {
    params.forEach((_, p) => {
      if (indexes[p] >= 0) return;
      const candidates = scores[p].map((score, i) => ({ i, score })).filter(v => !used.has(v.i) && (exact ? v.score === 1 : v.score >= 0.55 && v.score < 1)).sort((a, b) => b.score - a.score);
      const best = candidates[0];
      if (!best || best.score === candidates[1]?.score) return;
      // Require a unique best match on BOTH sides. Duplicate names stay unresolved.
      if (scores.some((row, other) => other !== p && row[best.i] >= best.score)) return;
      indexes[p] = best.i; used.add(best.i);
      reasons[p] = exact ? '名称对应，仍请核对单位' : '近似名称，请核对';
    });
  }
  // Positional fallback is only a suggestion for a completely headerless, same-size
  // selection. Named or partial selections must not shift unmatched parameters.
  if (labels.length === params.length && labels.every(label => /^Excel[行列]\s/.test(label))) {
    indexes.forEach((_, p) => { indexes[p] = p; reasons[p] = '按顺序建议，请核对'; });
  }
  return { indexes, reasons };
}

export function reviewImportAssignments(assignments: { code: string; sheet?: string; range?: ImportRange; skip: boolean; reviewed: boolean; valid: boolean }[], reuseConfirmed: boolean) {
  const active = assignments.filter(a => !a.skip), overlaps: [string, string][] = [];
  active.forEach((a, i) => active.slice(i + 1).forEach(b => {
    if (a.sheet && a.sheet === b.sheet && a.range && b.range && rangesOverlap(a.range, b.range)) overlaps.push([a.code, b.code]);
  }));
  const ready = active.length > 0 && active.every(a => a.sheet && a.range && a.reviewed && a.valid) && (!overlaps.length || reuseConfirmed);
  return { ready: !!ready, overlaps };
}

export function describeImportTarget(field: FieldDefinition, raw: any): ImportTarget {
  if (field.type === 'data_matrix' && field.matrix) {
    const cfg = field.matrix, value = normalizeMatrixValue(cfg, raw) as DataMatrixValue;
    return { axis: cfg.sample_axis || 'row', value, params: value.parameters.map(p => ({ id: p.code, label: p.label, unit: p.unit })),
      labels: value.sample_ids.map((id, i) => value.sample_labels?.[id] || `试样 ${i + 1}`), grow: cfg.kind !== 'stats' && cfg.allow_add_remove_samples !== false,
      cells: value.sample_ids.map(sid => value.parameters.map(p => ({ key: matrixDataKey(sid, p.code), editable: !p.cell_formula?.trim() && !cfg.cell_formulas?.[matrixDataKey(sid, p.code)], decimals: p.decimals ?? cfg.decimals }))) };
  }
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const instance = value.__free_table_structure__;
  const ft: NonNullable<FieldDefinition['free_table']> = instance && Array.isArray(instance.rows) && Array.isArray(instance.columns) ? instance : field.free_table!;
  const layout = buildFreeGridLayout(ft, value), band = layout.bands[0], axis = band?.axis || 'row';
  const canInput = (key: string) => !ft.header_cells?.[key] && !ft.cell_formulas?.[key] && !ft.sample_index_cells?.[key] && (!!ft.input_cells?.[key] || !!ft.cell_options?.[key]?.length);
  const sampleAxis = axis === 'row' ? layout.displayRows : layout.displayCols;
  const paramAxis = axis === 'row' ? ft.columns : ft.rows;
  const originals = axis === 'row' ? ft.rows : ft.columns;
  const keyOf = (sample: string, param: string) => axis === 'row' ? `${sample}::${param}` : `${param}::${sample}`;
  const legacyTarget = ft.excel_import?.mode !== 'auto' ? ft.excel_import?.target_cell?.split('::') : undefined;
  const firstSample = legacyTarget ? originals.findIndex(item => item.id === legacyTarget[axis === 'row' ? 0 : 1]) : 0;
  const firstParam = legacyTarget ? paramAxis.findIndex(item => item.id === legacyTarget[axis === 'row' ? 1 : 0]) : 0;
  const params = paramAxis.filter((p, index) => index >= firstParam && (!band?.cross_refs?.length || band.cross_refs.includes(p.id)) && originals.some(s => (!band || band.refs.includes(s.id)) && canInput(keyOf(s.id, p.id))));
  const chosenSamples = sampleAxis.filter(s => s.idx >= firstSample && (band ? band.refs.includes(s.id) && s.sample != null : params.some(p => canInput(keyOf(s.id, p.id)))));
  const labels = params.map(p => {
    const headers = originals.map(s => keyOf(s.id, p.id)).filter(k => ft.header_cells?.[k]).map(k => String(value[k] ?? ft.cells[k] ?? '')).filter(Boolean);
    const label = [...new Set(headers)].join(' / ') || ('label' in p ? String(p.label || '') : '') || `参数 ${paramAxis.findIndex(item => item.id === p.id) + 1}`;
    const unit = originals.map(s => ft.cell_units?.[keyOf(s.id, p.id)]).find(Boolean);
    return { id: p.id, label, unit };
  });
  return { axis, params: labels, labels: chosenSamples.map((_, i) => `试样 ${i + 1}`), grow: !!band && layout.bands.length === 1, value,
    cells: chosenSamples.map(s => params.map(p => {
      const key = keyOf(s.id, p.id), r = axis === 'row' ? s : layout.displayRows.find(r => r.id === p.id)!, c = axis === 'row' ? layout.displayCols.find(c => c.id === p.id)! : s;
      const sample = layout.sampleForCell(r.id, c.id, r.sample, c.sample);
      const ri = layout.displayRows.indexOf(r), ci = layout.displayCols.indexOf(c);
      return { key: sample == null ? key : `${key}::s${sample}`, editable: canInput(key) && !layout.covered.has(`${ri},${ci}`), options: ft.cell_options?.[key] };
    })) };
}

export type ImportPlan = { value: any; changes: { sample: string; parameter: string; before: any; after: ImportValue; source: string }[]; added: number; overwritten: number; skipped: number; issues: string[] };
export function planExcelImport(field: FieldDefinition, raw: any, sheet: ImportSheet, range: ImportRange, sourceAxis: 'row' | 'col', mapping: number[]): ImportPlan {
  let target = describeImportTarget(field, raw);
  const initialSamples = target.cells.length;
  let value = JSON.parse(JSON.stringify(target.value));
  const changes: ImportPlan['changes'] = [], issues: string[] = [];
  let added = 0, overwritten = 0, skipped = 0;
  const result = () => ({ value, changes, issues, added, overwritten, skipped });
  const sheetCols = Math.max(0, ...sheet.grid.map(r => r.length));
  if (range.r0 < 0 || range.c0 < 0 || range.r1 >= sheet.grid.length || range.c1 >= sheetCols || range.r1 < range.r0 || range.c1 < range.c0) { issues.push('来源区域无效，请重新框选'); return result(); }
  const count = sourceAxis === 'row' ? range.r1 - range.r0 + 1 : range.c1 - range.c0 + 1;
  const sourceParams = sourceAxis === 'row' ? range.c1 - range.c0 + 1 : range.r1 - range.r0 + 1;
  const used = mapping.filter(i => i >= 0);
  if (!used.length) { issues.push('请至少对应一个参数'); return result(); }
  if (new Set(used).size !== used.length || used.some(i => !Number.isInteger(i) || i >= sourceParams)) { issues.push('参数对应重复或超出来源区域，请核对'); return result(); }
  if (count > 50 && target.grow) { issues.push('来源超过50个试样，请缩小区域或拆分导入'); return result(); }
  if (count > target.cells.length) {
    if (!target.grow) { issues.push(`目标只有${target.cells.length}行/列，不能自动扩展；请缩小来源区域`); return result(); }
    if (field.type === 'data_matrix') {
      const v = value as DataMatrixValue;
      v.sample_labels = { ...v.sample_labels };
      while (v.sample_ids.length < count) {
        let n = v.sample_ids.length; while (v.sample_ids.includes(`s_import_${n}`)) n++;
        const id = `s_import_${n}`; v.sample_ids.push(id); v.sample_labels[id] = `${field.matrix?.row_header_prefix || '试样'} ${v.sample_ids.length}`;
        v.parameters.forEach(p => { if (p.default_value != null && p.default_value !== '' && !p.cell_formula?.trim()) v.cells[matrixDataKey(id, p.code)] = p.default_value; });
        added++;
      }
    } else {
      const ft = value.__free_table_structure__ || field.free_table!;
      while (target.cells.length < count) {
        const layout = buildFreeGridLayout(ft, value), band = layout.bands[0];
        const entries = (band.axis === 'row' ? layout.displayRows : layout.displayCols).filter(i => band.refs.includes(i.id) && i.sample != null).map(i => ({ ref: i.id, sample: i.sample! }));
        value = editSampleAxes(ft, value, band, entries);
        const next = describeImportTarget(field, value);
        if (next.cells.length <= target.cells.length) { issues.push('此试样区域无法安全扩展，请手动调整后重试'); return result(); }
        target = next; added++;
      }
    }
    target = describeImportTarget(field, value);
  }
  const blocked = new Set(sheet.blocked), destination = field.type === 'data_matrix' ? value.cells : value, touched = new Set<string>();
  target.cells.slice(0, count).forEach((cells, s) => cells.forEach((cell, p) => {
    const source = mapping[p]; if (source == null || source < 0) return;
    const r = range.r0 + (sourceAxis === 'row' ? s : source), c = range.c0 + (sourceAxis === 'row' ? source : s);
    let incoming = sheet.grid[r]?.[c];
    if (!hasValue(incoming)) return; // Empty cells never erase existing values.
    if (blocked.has(`${r},${c}`) || !cell.editable || touched.has(cell.key)) { skipped++; return; }
    if (cell.options?.length && !cell.options.includes(String(incoming))) { skipped++; return; }
    if (cell.decimals != null && typeof incoming !== 'boolean' && String(incoming).trim() !== '' && Number.isFinite(Number(incoming))) incoming = Number(incoming).toFixed(Math.max(0, Math.min(20, cell.decimals)));
    const before = destination[cell.key] ?? '';
    touched.add(cell.key);
    if (String(before) === String(incoming)) return;
    if (s < initialSamples && hasValue(before)) overwritten++;
    destination[cell.key] = incoming;
    changes.push({ sample: target.labels[s], parameter: target.params[p]?.label || '', before, after: incoming, source: `${columnName(c)}${r + 1}` });
  }));
  if (!changes.length) issues.push('没有可写入的变化（空值、表头、公式和非法选项不会写入）');
  return result();
}
