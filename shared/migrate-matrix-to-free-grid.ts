import type { FieldDefinition, FieldGroup } from './types';
import type { Formula } from './formula-engine';
import { encodeFreeGridCellReference } from './free-grid-formula.ts';

/** Deliberately fail closed for layouts not covered by this migration. Never flatten a formula to text. */
export function migrateMatrixField(source: FieldDefinition): FieldDefinition {
  if (source.type !== 'data_matrix') return structuredClone(source);
  const m = source.matrix;
  const fail = (message: string): never => { throw new Error(`${source.code}: ${message}`); };
  if (!m || !m.parameters?.length || !Number.isInteger(m.default_sample_count) || m.default_sample_count < 1) fail('空矩阵或无效试样数');
  if (m!.parameters.some(p => p.group || p.cell_formula || p.unit_allow_custom) || m!.sample_groups?.some(Boolean)) fail('分组表头/列级表达式/自定义单位尚未验证，禁止自动转换');
  if (m!.sample_notes?.some(n => n?.note_allow_custom)) fail('自定义试样备注尚未验证');
  const cfg = m!;
  const axis = cfg.sample_axis || 'row';
  const params = cfg.parameters;
  if (new Set(params.map(p => p.code)).size !== params.length) fail('重复参数编码');
  const refs = Array.from({ length: cfg.default_sample_count }, (_, i) => `s${i}`);
  const rows = ['header', ...refs, ...(cfg.summary_rows || []).map(s => `summary_${s.id}`)];
  const cols = ['axis', ...params.map(p => p.code), ...(cfg.summary_cols || []).map(s => `sumcol_${s.id}`)];
  if (new Set(rows).size !== rows.length || new Set(cols).size !== cols.length) fail('行列标识冲突');
  const key = (r: string, c: string) => axis === 'row' ? `${r}::${c}` : `${c}::${r}`;
  const ft: NonNullable<FieldDefinition['free_table']> = {
    rows: (axis === 'row' ? rows : cols).map(id => ({ id,
      ...(axis === 'row' && /^s\d+$/.test(id) && cfg.sample_row_heights?.[Number(id.slice(1))]
        ? { height: cfg.sample_row_heights[Number(id.slice(1))]! } : {}),
    })),
    columns: (axis === 'row' ? cols : rows).map(id => ({ id, label: '',
      ...(axis === 'row' ? { width: id === 'axis' ? cfg.axis_col_width || 'auto' : params.find(p => p.code === id)?.width || '1fr' } : {}),
    })),
    cells: {}, header_cells: {}, input_cells: {}, spans: {}, cell_types: {}, cell_units: {},
    cell_unit_options: {}, cell_options: {}, cell_option_allow_custom: {}, cell_formulas: {}, cell_number_fmt: {}, cell_styles: {},
    cell_inset_y: cfg.cell_inset_y || '5pt',
    repeat_header_rows: cfg.repeat_header_on_break === false ? 0 : 1,
    ...(cfg.excel_import ? { excel_import: structuredClone(cfg.excel_import) } : {}),
  };
  if (cfg.kind !== 'stats') ft.sample_bands = [{ id: 'migrated_samples', axis, refs, cross_refs: [...cols] }];
  // In column orientation the cross axis consists of the original columns, now rows.
  const keys: Record<string, string> = {};
  const parameter_headers: Record<string, string> = {};
  const sample_headers: Record<string, string> = {};
  const header = (k: string, text: string, unit?: string, options?: string[]) => {
    ft.cells[k] = text; ft.header_cells![k] = true;
    if (unit) ft.cell_units![k] = unit;
    if (options?.length) ft.cell_unit_options![k] = [...options];
  };
  const bodyHeaderStyle = (k: string) => {
    ft.cell_styles![k] = { weight: source.table_style?.body_bold ? 'bold' : 'regular',
      ...(source.table_style?.body_font ? { font: source.table_style.body_font } : {}),
      ...(source.table_style?.body_font_size ? { size: source.table_style.body_font_size } : {}),
    };
  };
  const cell = (k: string, value: unknown, type: 'text' | 'number' | 'choice', formula?: Formula, decimals?: number, choices?: string[], custom?: boolean) => {
    ft.cells[k] = value == null ? '' : String(value);
    ft.input_cells![k] = true; ft.cell_types![k] = type;
    if (formula) ft.cell_formulas![k] = { ...structuredClone(formula), preserve_legacy_precision: true };
    if (decimals !== undefined) ft.cell_number_fmt![k] = { mode: 'decimals', digits: decimals };
    else if (formula) ft.cell_number_fmt![k] = { mode: 'none', digits: 0 };
    if (choices?.length) ft.cell_options![k] = [...choices];
    if (custom) ft.cell_option_allow_custom![k] = true;
  };
  header(key('header', 'axis'), cfg.axis_header ?? '试样');
  params.forEach(p => { const k = key('header', p.code); parameter_headers[p.code] = k; header(k, p.label, p.unit, p.unit_options); });
  refs.forEach((sid, i) => {
    const k = key(sid, 'axis'); sample_headers[sid] = k;
    const note = cfg.sample_notes?.[i];
    header(k, cfg.default_sample_labels?.[i] ?? `${cfg.row_header_prefix || '试样'} ${i + 1}`, note?.note, note?.note_options);
    bodyHeaderStyle(k);
    params.forEach(p => {
      const old = `${sid}__${p.code}`, target = key(sid, p.code); keys[old] = target;
      const formula = cfg.cell_formulas?.[old];
      const defaultValue = cfg.cell_defaults?.[old];
      cell(target, defaultValue != null && defaultValue !== '' ? defaultValue : p.default_value, cfg.cell_type, formula, formula?.decimals ?? p.decimals ?? cfg.decimals);
    });
  });
  for (const sr of cfg.summary_rows || []) {
    const r = `summary_${sr.id}`;
    if (sr.note_allow_custom || sr.source_type === 'computed_field') fail(`汇总行 ${sr.id} 含未验证的引用/自定义备注`);
    header(key(r, 'axis'), sr.label, sr.note, sr.note_options);
    bodyHeaderStyle(key(r, 'axis'));
    const per = sr.per_column || sr.source_type === 'per_column_aggregate';
    for (const [i, p] of params.entries()) {
      if (!per && i > 0) continue;
      const k = key(r, p.code); keys[`summary__${sr.id}${per ? `__${p.code}` : ''}`] = k;
      const formula = sr.cell_formulas?.[p.code] || sr.formula || (sr.source_type === 'per_column_aggregate'
        ? { type: sr.aggregate || 'average', sources: [`col:${source.code}:${p.code}`], decimals: sr.decimals } as Formula : undefined);
      cell(k, sr.source_type === 'literal' ? sr.literal : sr.default_value,
        sr.source_type === 'input_choice' ? 'choice' : sr.source_type === 'input_number' ? 'number' : 'text', formula, formula?.decimals ?? sr.decimals, sr.choices, sr.allow_custom);
      if (sr.source_type === 'literal') delete ft.input_cells![k];
      if (sr.unit) ft.cell_units![k] = sr.unit;
      if (!per) {
        const span = Math.min(params.length, Math.max(1, sr.value_colspan ?? params.length));
        ft.spans![k] = axis === 'row' ? { colspan: span } : { rowspan: span };
      }
    }
  }
  for (const sc of cfg.summary_cols || []) {
    if (sc.per_row === false || sc.unit_allow_custom) fail(`跨行汇总列 ${sc.id} 尚未验证`);
    const c = `sumcol_${sc.id}`; header(key('header', c), sc.label, sc.unit, sc.unit_options);
    refs.forEach(sid => {
      const k = key(sid, c); keys[`sumcol__${sc.id}__${sid}`] = k;
      const formula = sc.cell_formulas?.[sid] || sc.formula || (sc.source_type === 'per_row_aggregate'
        ? { type: sc.aggregate || 'average', sources: params.map(p => `${source.code}__${sid}__${p.code}`), decimals: sc.decimals } as Formula : undefined);
      cell(k, sc.literal, sc.source_type === 'input_choice' ? 'choice' : sc.source_type === 'input_number' ? 'number' : 'text', formula, formula?.decimals ?? sc.decimals, sc.choices, sc.allow_custom);
      if (sc.source_type === 'literal') delete ft.input_cells![k];
    });
  }
  const result = structuredClone(source);
  result.type = 'free_grid'; result.free_table = ft; delete result.matrix;
  result.legacy_matrix = { version: 1, config: structuredClone(cfg), keys, sample_refs: refs, parameter_headers, sample_headers };
  if (cfg.cell_align) result.table_style = { ...result.table_style, cell_align: cfg.cell_align };
  return result;
}

/** Convert together so cross-table formula sources can be translated by stable identifiers. */
export function migrateMatrixGroups(groups: FieldGroup[]): { groups: FieldGroup[]; count: number } {
  const migrated = structuredClone(groups);
  const converting = new Set(groups.flatMap(g => g.fields).filter(f => f.type === 'data_matrix').map(f => f.code));
  let count = 0;
  for (const g of migrated) g.fields = g.fields.map(f => { if (f.type === 'data_matrix') count++; return migrateMatrixField(f); });
  const fields = migrated.flatMap(g => g.fields);
  const sourceKeys = new Map<string, { field: string; key: string }>();
  for (const f of fields) if (f.legacy_matrix) for (const [old, key] of Object.entries(f.legacy_matrix.keys)) sourceKeys.set(`${f.code}__${old}`, { field: f.code, key });
  for (const f of fields) if (converting.has(f.code) && f.legacy_matrix && f.free_table) {
    for (const formula of Object.values(f.free_table.cell_formulas || {})) {
      const translated: string[] = [];
      for (const src of formula.sources || []) {
        const match = /^col:([^:]+):(.+)$/.exec(src);
        const sources = match ? fields.find(x => x.code === match[1])?.legacy_matrix?.sample_refs.map(sid => `${match[1]}__${sid}__${match[2]}`) : [src];
        if (!sources) throw new Error(`${f.code}: 无法转换公式来源 ${src}`);
        for (const s of sources) {
          const ref = sourceKeys.get(s);
          if (!ref) throw new Error(`${f.code}: 无法无损转换公式来源 ${s}`);
          translated.push(ref.field === f.code ? ref.key : encodeFreeGridCellReference(ref.field, ref.key));
        }
      }
      formula.sources = translated;
    }
  }
  return { groups: migrated, count };
}
