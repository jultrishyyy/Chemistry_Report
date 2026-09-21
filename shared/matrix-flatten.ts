import type { RecordTemplate, FieldDefinition, DataMatrixConfig, DataMatrixValue, MatrixParameterDef } from './types';
import { execute, type Formula } from './formula-engine';
import { evalArithmetic } from './expr-eval';
import { recordSampleBands } from './free-grid-binding';
import { sampleAxesKey } from './free-grid-samples';
import { buildFreeGridLayout } from './free-grid-layout';
import { freeGridTextDefault } from './free-grid-defaults';
import { projectLegacyMatrices } from './legacy-matrix-bridge.ts';

export function matrixDataKey(sampleId: string, paramCode: string): string {
  return `${sampleId}__${paramCode}`;
}

/**
 * 符号列引用：公式数据源里 `col:{matrixCode}:{paramCode}` 表示"该矩阵该列的【全部当前样品】"。
 * 与具体单元格键（`{matrixCode}__{sid}__{param}`，固定那几个样品）相对——符号列在算的时候才用
 * `deriveMatrixSampleIdsFromFlat` 展开为实际样品，故录入期增删样品行时"整列平均/求和"自动跟随。
 */
export const MATRIX_COLUMN_SOURCE_PREFIX = 'col:';

export function makeMatrixColumnSource(matrixCode: string, paramCode: string): string {
  return `${MATRIX_COLUMN_SOURCE_PREFIX}${matrixCode}:${paramCode}`;
}

export function parseMatrixColumnSource(token: string): { matrixCode: string; paramCode: string } | null {
  if (!token.startsWith(MATRIX_COLUMN_SOURCE_PREFIX)) return null;
  const rest = token.slice(MATRIX_COLUMN_SOURCE_PREFIX.length);
  const i = rest.indexOf(':');
  if (i < 0) return null;
  return { matrixCode: rest.slice(0, i), paramCode: rest.slice(i + 1) };
}

/** 把 Formula.sources 里的符号列引用展开为当前实际样品的单元格键（普通字面源原样保留、去重）。 */
export function expandColumnSources(formula: Formula, flat: Record<string, any>): Formula {
  const srcs = formula.sources;
  if (!srcs || !srcs.some(s => s.startsWith(MATRIX_COLUMN_SOURCE_PREFIX))) return formula;
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (k: string) => { if (!seen.has(k)) { seen.add(k); out.push(k); } };
  for (const s of srcs) {
    const col = parseMatrixColumnSource(s);
    if (!col) { push(s); continue; }
    for (const sid of deriveMatrixSampleIdsFromFlat(flat, col.matrixCode)) {
      push(`${col.matrixCode}__${matrixDataKey(sid, col.paramCode)}`);
    }
  }
  return { ...formula, sources: out };
}

/**
 * 从已展平的 flat 数据里取某矩阵【实际存在】的样品 id（顺序＝出现顺序，排除 summary/sumcol 键）。
 * ⚠️ 录入时增删样品行用的是 `s{时间戳}` id，不再是 s0..s{n-1}——所以汇总行(平均值)/列级公式/汇总列
 *   必须按"实际样品"迭代，不能用 default_sample_count 的 s${i}（否则增删行后算不到、平均值不更新）。
 */
export function deriveMatrixSampleIdsFromFlat(flat: Record<string, any>, matrixCode: string): string[] {
  const prefix = `${matrixCode}__`;
  const seen: string[] = [];
  const set = new Set<string>();
  for (const k of Object.keys(flat)) {
    if (!k.startsWith(prefix)) continue;
    const seg = k.slice(prefix.length).split('__');
    if (seg.length < 2) continue;            // 需要 sid__param
    const sid = seg[0];
    if (sid === 'summary' || sid === 'sumcol') continue;
    if (!set.has(sid)) { set.add(sid); seen.push(sid); }
  }
  return seen;
}

/**
 * 生成不与已用编码冲突的 code：base 被占用时依次尝试 base_2、base_3…
 * 编码由系统自动生成、对用户不可见——所有生成点（加字段/加列/分区预设/录入加列）
 * 都必须经过这里，保证同一作用域（模板内字段 code / 矩阵内参数 code）永不重复。
 */
export function uniqueCode(base: string, used: Iterable<string>): string {
  const set = used instanceof Set ? used : new Set(used);
  if (!set.has(base)) return base;
  let i = 2;
  while (set.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

/**
 * 新建记录/试录的初始数据：把模板配置的字段默认值填进去
 * （文本/数字/日期/选择；多选默认值为数组。矩阵默认值走 createEmptyMatrixValue，不在此处）。
 * 录入页（Lab/Record）与模板编辑器「试录」预览共用。
 */
export function buildFieldDefaults(template: Pick<RecordTemplate, 'groups'>): Record<string, any> {
  const init: Record<string, any> = {};
  for (const g of template.groups) {
    for (const f of g.fields) {
      if (f.type === 'free_grid' && f.free_table) {
        const initial: Record<string, any> = {};
        for (const band of recordSampleBands(f.free_table)) {
          const axis = band.axis === 'row' ? f.free_table.rows : f.free_table.columns;
          initial[sampleAxesKey(band.id)] = axis.filter(item => band.refs.includes(item.id)).map(item => ({ ref: item.id, sample: 0 }));
        }
        const layout = buildFreeGridLayout(f.free_table, initial);
        layout.displayRows.forEach((row, ri) => layout.displayCols.forEach((col, ci) => {
          if (layout.covered.has(`${ri},${ci}`)) return;
          const key = `${row.id}::${col.id}`;
          const value = freeGridTextDefault(f.free_table!, key);
          if (value === '') return;
          const sample = layout.sampleForCell(row.id, col.id, row.sample, col.sample);
          initial[sample == null ? key : `${key}::s${sample}`] = value;
        }));
        if (Object.keys(initial).length) init[f.code] = initial;
      }
      if (f.default_value === undefined || f.default_value === null || f.default_value === '') continue;
      if (['text', 'textarea', 'number', 'date', 'select', 'checkbox'].includes(f.type)) {
        init[f.code] = f.default_value;
      }
    }
  }
  return init;
}

/**
 * 自愈模板里的重复标识（历史遗留：旧 id 生成器每次刷新从 f100 盲数，
 * 跨会话编辑过的模板可能存在重复的 字段/分区 id 甚至字段 code）。
 * 重复会导致：按 id 选中命中错字段（点 A 打开 B 的编辑）、PDF 反向跳转按 code 找错字段、
 * React key 冲突、raw_data 键碰撞。
 * 策略：保留首次出现，后续重复者改成 `xxx_2/xxx_3…`（id 是编辑器内部标识可安全改；
 * code 重复本身已是坏数据——双方共用一个数据槽——改名让后者拿回自己的槽）。
 * 编辑器加载模板时调用；fixes>0 时提示用户保存固化。
 */
export function dedupeTemplateIdentity(template: RecordTemplate): { template: RecordTemplate; fixes: number } {
  let fixes = 0;
  const usedIds = new Set<string>();
  const usedCodes = new Set<string>();
  // 分区 id 被防撞改名时记下来，子分区的 parent_group_id 要跟着改（否则悬空降级为顶级）
  const groupIdRenames = new Map<string, string>();
  let groups = template.groups.map(g => {
    let gid = g.id;
    if (usedIds.has(gid)) { gid = uniqueCode(gid, usedIds); groupIdRenames.set(g.id, gid); fixes++; }
    usedIds.add(gid);
    const fields = g.fields.map(f => {
      let id = f.id;
      let code = f.code;
      if (usedIds.has(id)) { id = uniqueCode(id, usedIds); fixes++; }
      usedIds.add(id);
      if (usedCodes.has(code)) { code = uniqueCode(code, usedCodes); fixes++; }
      usedCodes.add(code);
      return id === f.id && code === f.code ? f : { ...f, id, code };
    });
    return gid === g.id && fields.every((f, i) => f === g.fields[i]) ? g : { ...g, id: gid, fields };
  });
  if (groupIdRenames.size) {
    groups = groups.map(g =>
      g.parent_group_id && groupIdRenames.has(g.parent_group_id)
        ? { ...g, parent_group_id: groupIdRenames.get(g.parent_group_id) }
        : g
    );
  }
  return fixes ? { template: { ...template, groups }, fixes } : { template, fixes: 0 };
}

/** 公式编辑器：按模板默认尺寸展开矩阵单元 code */
export function expandMatrixFieldCodes(field: FieldDefinition): { code: string; label: string }[] {
  if (field.type !== 'data_matrix' || !field.matrix) return [];
  const cfg = field.matrix;
  const out: { code: string; label: string }[] = [];
  for (let i = 0; i < cfg.default_sample_count; i++) {
    const sid = `s${i}`;
    for (const p of cfg.parameters) {
      out.push({
        code: `${field.code}__${matrixDataKey(sid, p.code)}`,
        label: `${field.label} / 试样${i + 1} / ${p.label}`,
      });
    }
  }
  return out;
}

export function expandAllMatrixCodesForFormula(template: RecordTemplate): { code: string; label: string }[] {
  const list: { code: string; label: string }[] = [];
  for (const g of template.groups) {
    for (const f of g.fields) {
      if (f.type === 'data_matrix') list.push(...expandMatrixFieldCodes(f));
    }
  }
  return list;
}

/** 汇总行公式在展平数据中的键：matrixCode__summary__rowId */
export function matrixSummaryFlatKey(matrixCode: string, rowId: string): string {
  return `${matrixCode}__summary__${rowId}`;
}

/** per_column_aggregate 模式下，按参数列拆出的展平键：matrixCode__summary__rowId__paramCode */
export function matrixSummaryColumnFlatKey(matrixCode: string, rowId: string, paramCode: string): string {
  return `${matrixCode}__summary__${rowId}__${paramCode}`;
}

/** 汇总列 per_row_aggregate / formula / literal 的展平键：matrixCode__sumcol__colId__sampleId */
export function matrixSummaryColCellFlatKey(matrixCode: string, colId: string, sampleId: string): string {
  return `${matrixCode}__sumcol__${colId}__${sampleId}`;
}

/** 汇总列「跨行单值」（per_row===false）的展平键：matrixCode__sumcol__colId（无实体） */
export function matrixSummaryColSpanFlatKey(matrixCode: string, colId: string): string {
  return `${matrixCode}__sumcol__${colId}`;
}

/**
 * P-Map-13b：四类汇总/其他「逐格」单元格对齐的实体。
 * 汇总/其他 固定为可视的底部行 / 右侧列、不随试样轴转置；逐格的格子对齐到「当前可视轴」：
 * - summary_rows（底部行）的逐格 ↔ 可视列：试样为行时=参数、试样为列时=试样；
 * - summary_cols（右侧列）的逐格 ↔ 可视行：试样为行时=试样、试样为列时=参数。
 */
export function matrixVisibleColEntities(cfg: DataMatrixConfig, sids: string[]): string[] {
  return cfg.sample_axis === 'col' ? sids : (cfg.parameters || []).map(p => p.code);
}
export function matrixVisibleRowEntities(cfg: DataMatrixConfig, sids: string[]): string[] {
  return cfg.sample_axis === 'col' ? (cfg.parameters || []).map(p => p.code) : sids;
}

export function collectMatrixSummaryDataKeys(template: RecordTemplate, flat?: Record<string, any>): string[] {
  const keys: string[] = [];
  for (const g of template.groups) {
    for (const f of g.fields) {
      if (f.type !== 'data_matrix' || !f.matrix) continue;
      // 有 flat 时按实际样品行收 key（增删行后 id 是 s{时间戳}）；无 flat 回退 default_sample_count
      const sids = flat ? deriveMatrixSampleIdsFromFlat(flat, f.code)
        : Array.from({ length: f.matrix.default_sample_count || 1 }, (_, i) => `s${i}`);
      // 键恒为 canonical（与录入存储/展平一致，与显示是否转置【无关】）：
      //   · 统计行(per_column)→逐【参数】一键 summary__rowId__paramCode
      //   · 统计列(per_row)→逐【样品】一键 sumcol__colId__sid
      // （旧实现按"当前可视轴"收键、转置时会对调，导致转置布局读 canonical 键时字典缺键报错——已修正）
      const paramCodes = (f.matrix.parameters || []).map(p => p.code);
      for (const sr of (f.matrix.summary_rows || [])) {
        const isInput = sr.source_type === 'input_text' || sr.source_type === 'input_number' || sr.source_type === 'input_choice';
        if (sr.source_type === 'per_column_aggregate' || (sr.per_column && isInput)) {
          for (const pc of paramCodes) keys.push(matrixSummaryColumnFlatKey(f.code, sr.id, pc));
        } else if (sr.source_type === 'formula' || isInput) {
          keys.push(matrixSummaryFlatKey(f.code, sr.id));
        }
      }
      for (const sc of (f.matrix.summary_cols || [])) {
        if (sc.per_row === false) {
          keys.push(matrixSummaryColSpanFlatKey(f.code, sc.id));
        } else {
          for (const sid of sids) keys.push(matrixSummaryColCellFlatKey(f.code, sc.id, sid));
        }
      }
    }
  }
  return keys;
}

/** 为有 cell_formula 的列，按行计算写入 flat 数据。
 * 需要在 flatten 之后、applyPerCellFormulas / applyMatrixSummaryFormulas 之前调用。
 */
export function applyMatrixCellFormulas(template: RecordTemplate, flat: Record<string, any>): Record<string, any> {
  const out = { ...flat };
  for (const g of template.groups) {
    for (const f of g.fields) {
      if (f.type !== 'data_matrix' || !f.matrix) continue;
      const cfg = f.matrix;
      const cellFormulaCols = cfg.parameters.filter(p => p.cell_formula && p.cell_formula.trim());
      if (!cellFormulaCols.length) continue;
      // 按【实际样品行】迭代（增删行后 id 是 s{时间戳}，不能用 default_sample_count）
      const sids = deriveMatrixSampleIdsFromFlat(out, f.code);
      for (const sid of sids) {
        // 每行变量表：用本行其他列的 flat 值
        const vars: Record<string, any> = {};
        for (const p of cfg.parameters) {
          vars[p.code] = out[`${f.code}__${matrixDataKey(sid, p.code)}`];
        }
        for (const col of cellFormulaCols) {
          const r = evalArithmetic(col.cell_formula!, vars);
          const decimals = col.cell_formula_decimals;
          const final = r === null ? null : (decimals !== undefined ? Number(r.toFixed(decimals)) : r);
          out[`${f.code}__${matrixDataKey(sid, col.code)}`] = final;
        }
      }
    }
  }
  return out;
}

/**
 * 应用单元格级公式（cell_formulas）。
 * 优先级低于列级 cell_formula：如果某列已有 cell_formula，该列的 per-cell 公式不生效。
 * 在 applyMatrixCellFormulas 之后、applyMatrixSummaryFormulas 之前调用。
 */
export function applyPerCellFormulas(template: RecordTemplate, flat: Record<string, any>): Record<string, any> {
  const out = { ...flat };
  for (const g of template.groups) {
    for (const f of g.fields) {
      if (f.type !== 'data_matrix' || !f.matrix) continue;
      const cfg = f.matrix;
      const cellFormulas = cfg.cell_formulas;
      if (!cellFormulas || Object.keys(cellFormulas).length === 0) continue;
      const cellFormulaCols = new Set(
        cfg.parameters.filter(p => p.cell_formula && p.cell_formula.trim()).map(p => p.code)
      );
      for (const [cellKey, formula] of Object.entries(cellFormulas)) {
        // cellKey format: "s{idx}__{paramCode}"
        const m = cellKey.match(/^s\d+__(.+)$/);
        if (!m) continue;
        const paramCode = m[1];
        // Skip if column already has a column-level formula
        if (cellFormulaCols.has(paramCode)) continue;
        const flatKey = `${f.code}__${cellKey}`;
        try {
          out[flatKey] = execute(expandColumnSources(formula, out), out);
        } catch {
          out[flatKey] = null;
        }
      }
    }
  }
  return out;
}

/** 把录入人员确认过的公式修正值覆盖到展平数据。 */
export function applyMatrixFormulaOverrides(template: RecordTemplate, flat: Record<string, any>): Record<string, any> {
  const out = { ...flat };
  for (const group of template.groups) {
    for (const field of group.fields) {
      if (field.type !== 'data_matrix') continue;
      const matrixValue = out[field.code] as DataMatrixValue | undefined;
      const overrides = matrixValue?.formula_overrides;
      if (!overrides) continue;
      for (const [localKey, entry] of Object.entries(overrides)) {
        if (!entry || entry.value === undefined || entry.value === null) continue;
        out[`${field.code}__${localKey}`] = entry.value;
      }
    }
  }
  return out;
}

/** 在矩阵单元已展平到 flat 的前提下，写入各「本表公式」/「每列统计」汇总行的计算结果 */
export function applyMatrixSummaryFormulas(template: RecordTemplate, flat: Record<string, any>): Record<string, any> {
  // 先应用 per-cell 公式
  // 先套用一次人工修正，使后续汇总/判定使用修正后的明细结果。
  let out = applyMatrixFormulaOverrides(template, applyPerCellFormulas(template, flat));
  for (const g of template.groups) {
    for (const f of g.fields) {
      if (f.type !== 'data_matrix' || !f.matrix) continue;
      const cfg = f.matrix;
      // 按【实际录入的样品行】迭代——增删行后 id 是 s{时间戳}，default_sample_count 不再准（否则平均值算不到/不更新）
      const sids = deriveMatrixSampleIdsFromFlat(out, f.code);
      // —— 汇总行 ——
      for (const sr of (f.matrix.summary_rows || [])) {
        if (sr.source_type === 'formula' && sr.formula) {
          const k = matrixSummaryFlatKey(f.code, sr.id);
          try {
            out[k] = execute(expandColumnSources(sr.formula, out), out);
          } catch {
            out[k] = null;
          }
        } else if (sr.source_type === 'per_column_aggregate') {
          const aggregate = sr.aggregate || 'average';
          for (const p of cfg.parameters) {
            const sources = sids.map(sid => `${f.code}__${matrixDataKey(sid, p.code)}`);
            const key = matrixSummaryColumnFlatKey(f.code, sr.id, p.code);
            try {
              out[key] = execute({ type: aggregate, sources, decimals: sr.decimals }, out);
            } catch {
              out[key] = null;
            }
          }
        }
        // "其他行"（per_column 行）的逐格公式：与样品格同款 Formula，设了公式的列 ⇒ 该格按所选数据源自动算
        if (sr.per_column && sr.cell_formulas && Object.keys(sr.cell_formulas).length) {
          for (const [paramCode, formula] of Object.entries(sr.cell_formulas)) {
            if (!formula) continue;
            const key = matrixSummaryColumnFlatKey(f.code, sr.id, paramCode);
            try {
              out[key] = execute(expandColumnSources(formula, out), out);
            } catch {
              out[key] = null;
            }
          }
        }
      }
      // —— 汇总列：每行对所有参数列做聚合 ——
      for (const sc of (f.matrix.summary_cols || [])) {
        if (sc.source_type === 'per_row_aggregate') {
          const aggregate = sc.aggregate || 'average';
          for (const sid of sids) {
            const sources = cfg.parameters.map(p => `${f.code}__${matrixDataKey(sid, p.code)}`);
            const key = matrixSummaryColCellFlatKey(f.code, sc.id, sid);
            try {
              out[key] = execute({ type: aggregate, sources, decimals: sc.decimals }, out);
            } catch {
              out[key] = null;
            }
          }
        } else if (sc.source_type === 'formula' && sc.formula) {
          // 汇总列（per_row===false 跨行单值）：写跨行单键；统计列误设 formula 时兜底逐行写同值
          if (sc.per_row === false) {
            const key = matrixSummaryColSpanFlatKey(f.code, sc.id);
            try { out[key] = execute(expandColumnSources(sc.formula, out), out); } catch { out[key] = null; }
          } else {
            for (const sid of sids) {
              const key = matrixSummaryColCellFlatKey(f.code, sc.id, sid);
              try { out[key] = execute(expandColumnSources(sc.formula, out), out); } catch { out[key] = null; }
            }
          }
        }
        // 统计列（per_row≠false）的逐格公式：key=样品 id → Formula（与统计行 cell_formulas 同款）
        if (sc.per_row !== false && sc.cell_formulas && Object.keys(sc.cell_formulas).length) {
          for (const sid of sids) {
            const formula = sc.cell_formulas[sid];
            if (!formula) continue;
            const key = matrixSummaryColCellFlatKey(f.code, sc.id, sid);
            try { out[key] = execute(expandColumnSources(formula, out), out); } catch { out[key] = null; }
          }
        }
      }
    }
  }
  // 汇总公式自身也可修正；最终显示和 PDF 均以确认后的修正值为准。
  return applyMatrixFormulaOverrides(template, out);
}

export function collectTypstDataKeys(template: RecordTemplate): string[] {
  const keys: string[] = [];
  for (const g of template.groups) {
    for (const f of g.fields) {
      if (f.type === 'data_matrix' && f.matrix) {
        for (let i = 0; i < f.matrix.default_sample_count; i++) {
          for (const p of f.matrix.parameters) {
            keys.push(`${f.code}__${matrixDataKey(`s${i}`, p.code)}`);
          }
        }
      } else if (f.type === 'image' || f.type === 'spacer' || f.type === 'record_conclusion') {
        // image 字段由 __IMAGE_GROUP__ 锚点替换；spacer 是纯版式 #v()——都不引用 data，不进 #let data
        continue;
      } else if (f.type === 'report_conclusion_table' || f.type === 'report_result_table'
        || f.type === 'report_equipment_table' || f.type === 'report_image_gallery') {
        // 报告专属自动表：通过锚点替换，不进 #let data
        continue;
      } else {
        keys.push(f.code);
      }
    }
  }
  keys.push(...collectMatrixSummaryDataKeys(template));
  return keys;
}

export function normalizeMatrixValue(cfg: DataMatrixConfig, raw: any): DataMatrixValue {
  if (raw && typeof raw === 'object' && Array.isArray(raw.sample_ids) && raw.parameters && raw.cells) {
    return raw as DataMatrixValue;
  }
  return createEmptyMatrixValue(cfg);
}

export function createEmptyMatrixValue(cfg: DataMatrixConfig): DataMatrixValue {
  const sample_ids = Array.from({ length: cfg.default_sample_count }, (_, i) => `s${i}`);
  const parameters: MatrixParameterDef[] = cfg.parameters.map(p => ({ ...p }));
  const cells: Record<string, string | number | undefined> = {};
  for (const sid of sample_ids) {
    for (const p of parameters) {
      // 默认值：格级 cell_defaults 优先，列级 default_value 存量回退（录入页初始填充，实验员可改）
      const key = matrixDataKey(sid, p.code);
      const cellDefault = cfg.cell_defaults?.[key];
      cells[key] = (cellDefault ?? '') !== '' ? cellDefault
        : (p.default_value ?? '') !== '' ? p.default_value : undefined;
    }
  }
  const prefix = cfg.row_header_prefix || '试样';
  const sample_labels: Record<string, string> = {};
  for (let i = 0; i < sample_ids.length; i++) {
    sample_labels[sample_ids[i]] = cfg.default_sample_labels?.[i] ?? `${prefix} ${i + 1}`;
  }
  // 录入型汇总行默认值
  let summary_inputs: Record<string, any> | undefined;
  for (const sr of (cfg.summary_rows || [])) {
    if (['input_text', 'input_number', 'input_choice'].includes(sr.source_type) && (sr.default_value ?? '') !== '') {
      (summary_inputs ??= {})[sr.id] = sr.default_value;
    }
  }
  return { sample_ids, parameters, cells, sample_labels, ...(summary_inputs ? { summary_inputs } : {}) };
}

/** 公式计算：把 data_matrix 嵌套值展平为 code__sample__param */
export function flattenMatrixValuesToFlatData(template: RecordTemplate, data: Record<string, any>): Record<string, any> {
  const out = projectLegacyMatrices(template, data, { ...data }).flat;
  for (const g of template.groups) {
    for (const f of g.fields) {
      if (f.type !== 'data_matrix') continue;
      const val = data[f.code];
      if (val && typeof val === 'object') {
        if (val.cells) {
          for (const [k, v] of Object.entries(val.cells)) {
            out[`${f.code}__${k}`] = v;
          }
        }
        if (val.summary_inputs && typeof val.summary_inputs === 'object') {
          for (const [rowId, v] of Object.entries(val.summary_inputs)) {
            out[matrixSummaryFlatKey(f.code, rowId)] = v;
          }
        }
        // 逐列录入型汇总行：key = `${rowId}__${paramCode}` → 平铺到与 per_column_aggregate 同一键
        // `${code}__summary__${rowId}__${paramCode}`（出片/绑定与自动统计同口径）。input_choice 的「其他」解析。
        if (val.summary_row_inputs && typeof val.summary_row_inputs === 'object') {
          for (const [rk, v] of Object.entries(val.summary_row_inputs)) {
            const us = rk.indexOf('__');
            if (us < 0) continue;
            const rowId = rk.slice(0, us);
            const paramCode = rk.slice(us + 2);
            out[matrixSummaryColumnFlatKey(f.code, rowId, paramCode)] =
              (v && typeof v === 'object' && 'custom' in (v as any)) ? (v as any).custom : v;
          }
        }
        // 录入型汇总列：key = `${colId}__${sampleId}` → 平铺键 `${code}__sumcol__${colId}__${sampleId}`
        // input_choice 的「其他」存为 {custom}，展平时解析成字符串供显示/PDF。
        if (val.sumcol_inputs && typeof val.sumcol_inputs === 'object') {
          for (const [ck, v] of Object.entries(val.sumcol_inputs)) {
            out[`${f.code}__sumcol__${ck}`] = (v && typeof v === 'object' && 'custom' in (v as any)) ? (v as any).custom : v;
          }
        }
      }
    }
  }
  return out;
}

/** 从展平数据去掉矩阵虚拟键，保留矩阵对象本体（用于保存 raw_data） */
export function stripMatrixFlatKeys(template: RecordTemplate, data: Record<string, any>): Record<string, any> {
  const out = { ...data };
  const drop = new Set<string>();
  for (const g of template.groups) {
    for (const f of g.fields) {
      if (f.type !== 'data_matrix') continue;
      for (const k of Object.keys(out)) {
        if (k.startsWith(`${f.code}__`) && k !== f.code) drop.add(k);
      }
    }
  }
  for (const k of drop) delete out[k];
  return out;
}
