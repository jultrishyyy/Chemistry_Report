/**
 * 项目模板继承原始记录（报告映射方案 §10.5 / §10.7，任务二）。
 *
 * `buildProjectGroupsFromRecord(record)` 把一个原始记录模板的字段结构【一次性快照】转换成一份
 * 报告项目模板的 groups，并【自动配好映射】——用户由此在原始记录基础上编辑，而非从零开始。
 *
 * 关键原则（见 §10.5）：
 *  1. 独立复制（快照），绝不建 fork/母子关联——之后各自演进，原始记录后改字段靠 validateReportBindings 实时告警。
 *  2. 转换器而非机械 1:1：
 *     - 普通值字段  → 恒等绑定 record_field（computed 亦然，其值在 derived_data 已并入 flat）；
 *     - 语义角色字段（主检/审核/日期）→ record_meta；
 *     - free_grid（原始记录表格）→ 结构镜像 + 逐格绑定 + 样品带随录入样品数动态展开：
 *         · 记录「录入格」→ 报告 cell_binding（带内=record_free_cell_sample、带外=record_free_cell）；
 *         · 记录「自引用样品带」→ 报告 source_field 带（source_band_id=记录带 id），报告渲染期按
 *           record_raw_data[recordCode]['__sample_count__::bandId'] 自动展开成 N 份 → 动态试样闭环；
 *         · 表头文字→record_free_template_cell，单位→独立 cell_unit_bindings；试样序号→record_sample_index；
 *         · 可编辑固定文字→固定格绑定（未修改时回退模板默认值）；合并/宽高/公式全拷；input_cells 清空（报告侧不录入）。
 *     - data_matrix（样品表）→ 报告 report_result_table 试样带一键成表（试样编号列 + 每参数一列 + band，
 *       渲染期按记录实际样品数展开；与 ReportResultTableCanvas 的 rebuildBand 同构）；统计表(kind='stats')/无参数列进 manual；
 *     - image（图片分区初始项）→ 保留标题/样式并写 image_source_code；运行期由该来源定位并整体拉取动态图片集合；
 *     - spacer（版式空白）→ 原样保留；
 *     - device_ref / 报告专属表 等 → 不自动映射，列入 manual 清单由用户手动处理。
 */
import type { FieldDefinition, FieldGroup, RecordTemplate, CellBinding, FieldSemanticRole, ProjectConclusionDecl } from './types';
import { sampleBandForCell } from './free-grid-binding';

/** 普通值字段：恒等绑定 record_field 即可自动取值。 */
const SIMPLE_VALUE_TYPES = new Set<FieldDefinition['type']>([
  'text', 'number', 'date', 'textarea', 'select', 'checkbox', 'reference', 'computed', 'daterange',
]);

const SEMANTIC_META: Record<FieldSemanticRole, 'tester_name' | 'tested_at' | 'reviewer_name' | 'reviewed_at'> = {
  inspector: 'tester_name',
  inspector_date: 'tested_at',
  reviewer: 'reviewer_name',
  reviewer_date: 'reviewed_at',
};

/**
 * 项目报告模板的【默认文档样式】——取自「弯曲强度&弯曲模量」模板（用户指定为样式基准）。
 * 拉取原始记录 / 新建项目模板时套用，保证字体/字号/字段间距/分区加粗/页边距一致。
 * 表格行高、备注间距等【字段级】样式在 convertDataMatrix 等处按需另设（见下）。
 */
export const DEFAULT_PROJECT_THEME_CONFIG: Record<string, any> = {
  font: 'FangSong_GB2312',   // 仿宋（无粗体字体，加粗走 faux-bold 描边）
  margin: 'wide',
  line_gap: 1.9,             // 字段间距
  body_size: 10.5,           // 正文字号
  paragraph_gap: 1.6,
  section_style: 'left-bold',// 分区标题：左对齐加粗
};

/** 报告表格【标签/备注与表格的距离】默认（取自弯曲模板 result_table.label_gap）。 */
const DEFAULT_TABLE_LABEL_GAP = '12pt';

export interface InheritMappedItem { code: string; label: string; kind: 'field' | 'free_grid' | 'result_table' | 'image' | 'meta' | 'spacer'; }
export interface InheritManualItem { code: string; label: string; type: string; reason: string; }
export interface InheritResult {
  groups: FieldGroup[];
  mapped: InheritMappedItem[];
  /** 未自动映射、需用户手动处理的字段（原样跳过，不进 groups）。 */
  manual: InheritManualItem[];
  /** 建议套用的文档样式（= DEFAULT_PROJECT_THEME_CONFIG）；调用方写进 layout_options.theme_config。 */
  theme_config: Record<string, any>;
}

/**
 * 从原始记录普通字段中识别项目结论的默认绑定。
 * 创建接口与项目模板编辑器共用同一套排序，避免首次创建和手动“重新识别”结果不一致。
 */
export function detectProjectConclusionBinding(record: Pick<RecordTemplate, 'groups'> | null): ProjectConclusionDecl | null {
  if (!record) return null;
  const scalarTypes = new Set<FieldDefinition['type']>(['text', 'number', 'select', 'checkbox', 'textarea', 'computed', 'reference']);
  const fields = (record.groups || []).flatMap(group => (group.fields || []).map(field => ({ field })))
    .filter(item => scalarTypes.has(item.field.type));
  const ranked = fields.map(({ field }, index) => {
    const code = String(field.code || '').trim().toLowerCase();
    const label = String(field.label || '').replace(/[\s：:]/g, '');
    let score = 0;
    if ((field as any).conclusion_field) score = 1000;
    else if (['conclusion', 'test_conclusion', 'inspection_conclusion', 'judgment', 'judgement'].includes(code)) score = 900;
    else if (['结论', '检测结论', '检验结论', '判定结论'].includes(label)) score = 850;
    else if (/(检测|检验|判定)结论/.test(label) || label.endsWith('结论')) score = 750;
    else if (/(conclusion|judg(e)?ment)/.test(code)) score = 700;
    return { field, index, score };
  }).filter(item => item.score > 0 && !!item.field.code)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const best = ranked[0]?.field;
  return best ? {
    id: `concl_auto_${best.id}`,
    binding: { source: 'record_field', field_code: best.code },
  } : null;
}

/** 归一记录 free_grid 的【自引用样品带】（无 matrix_code / source_field）：新 sample_bands 优先，兼容旧单带。 */
type SelfBand = { id: string; axis: 'row' | 'col'; refs: string[]; cross_refs?: string[] };
function recordSelfBands(ft: NonNullable<FieldDefinition['free_table']>): SelfBand[] {
  const bands = ft.sample_bands?.length
    ? ft.sample_bands
    : (ft.sample_band?.ref ? [{ id: 'legacy', axis: ft.sample_band.axis, refs: [ft.sample_band.ref], matrix_code: ft.sample_band.matrix_code }] : []);
  return bands
    .filter(b => b && b.refs?.length && !b.matrix_code && !(b as any).source_field)
    .map(b => ({ id: b.id, axis: b.axis, refs: b.refs, cross_refs: b.cross_refs }));
}

/** free_grid 记录 → 报告：结构镜像 + 录入格转绑定 + 自引用带转 source_field 带。 */
function convertFreeGrid(recordCode: string, rft: NonNullable<FieldDefinition['free_table']>): NonNullable<FieldDefinition['free_table']> {
  const oft: NonNullable<FieldDefinition['free_table']> = JSON.parse(JSON.stringify(rft));
  const selfBands = recordSelfBands(rft);
  const rowIndex = new Map((rft.rows || []).map((row, index) => [row.id, index]));
  const colIndex = new Map((rft.columns || []).map((col, index) => [col.id, index]));
  const spanCovering = (rowId: string, colId: string) => {
    const ri = rowIndex.get(rowId), ci = colIndex.get(colId);
    if (ri == null || ci == null) return undefined;
    for (const [key, span] of Object.entries(rft.spans || {})) {
      const [startRowId, startColId] = key.split('::');
      const sr = rowIndex.get(startRowId), sc = colIndex.get(startColId);
      if (sr == null || sc == null) continue;
      const rowspan = Math.max(span.rowspan ?? 1, 1);
      const colspan = Math.max(span.colspan ?? 1, 1);
      if (ri >= sr && ri < sr + rowspan && ci >= sc && ci < sc + colspan) return { sr, sc, rowspan, colspan };
    }
    return undefined;
  };
  const isPerSampleCell = (rowId: string, colId: string) => !!sampleBandForCell(rft, `${rowId}::${colId}`);
  const isSampleIndexCell = (rowId: string, colId: string) => !!rft.sample_index_cells?.[`${rowId}::${colId}`];

  // 记录「录入格」→ 报告 cell_binding（带内=逐样品、带外=固定格）
  const cellBindings: Record<string, CellBinding> = { ...(oft.cell_bindings || {}) };
  const cellUnitBindings: Record<string, CellBinding> = { ...(oft.cell_unit_bindings || {}) };
  // 表头不是运行期录入值，绑定到记录模板格文字；报告渲染时读取该记录所对应的模板版本。
  for (const key of Object.keys(rft.header_cells || {})) {
    cellBindings[key] = { source: 'record_free_template_cell', field_code: recordCode, cell_key: key };
  }
  for (const key of Object.keys(rft.input_cells || {})) {
    const [rowId, colId] = key.split('::');
    cellBindings[key] = isPerSampleCell(rowId, colId)
      ? (isSampleIndexCell(rowId, colId)
        ? { source: 'record_sample_index', matrix_code: '' }
        : { source: 'record_free_cell_sample', field_code: recordCode, cell_key: key })
      : { source: 'record_free_cell', field_code: recordCode, cell_key: key };
  }
  // 所有普通格都是“固定文字（模板预填、录入可改）”。旧模板即使没有 fixed_text_cells 标记也能自动映射；
  // 合并覆盖格不是独立视觉单元格，不为它生成隐藏绑定。
  for (const row of rft.rows || []) for (const col of rft.columns || []) {
    const key = `${row.id}::${col.id}`;
    if (rft.header_cells?.[key] || rft.input_cells?.[key] || rft.cell_formulas?.[key]) continue;
    const ri = rowIndex.get(row.id), ci = colIndex.get(col.id);
    const span = spanCovering(row.id, col.id);
    if (span && (ri !== span.sr || ci !== span.sc)) continue;
    cellBindings[key] = isPerSampleCell(row.id, col.id)
      ? { source: 'record_free_cell_sample', field_code: recordCode, cell_key: key }
      : { source: 'record_free_cell', field_code: recordCode, cell_key: key };
  }
  // 原始记录公式格不写入 raw_data，报告侧必须显式绑定到“原公式计算结果”，不能当普通录入格读取。
  for (const key of Object.keys(rft.cell_formulas || {})) {
    const [rowId, colId] = key.split('::');
    cellBindings[key] = isPerSampleCell(rowId, colId)
      ? { source: 'record_free_formula_cell_sample', field_code: recordCode, cell_key: key }
      : { source: 'record_free_formula_cell', field_code: recordCode, cell_key: key };
  }
  // 单位独立于格子内容映射。样品带内按当前试样取单位，带外读取固定格单位。
  const unitKeys = new Set([...Object.keys(rft.cell_units || {}), ...Object.keys(rft.cell_unit_options || {})]);
  for (const key of unitKeys) {
    const [rowId, colId] = key.split('::');
    cellUnitBindings[key] = isPerSampleCell(rowId, colId)
      ? { source: 'record_free_cell_unit_sample', field_code: recordCode, cell_key: key }
      : { source: 'record_free_cell_unit', field_code: recordCode, cell_key: key };
  }
  oft.cell_bindings = cellBindings;
  oft.cell_unit_bindings = cellUnitBindings;
  oft.source_field_code = recordCode;
  // Excel 是原始记录录入能力，不复制到报告项目模板；数字格式作为原始记录定义的只读显示规则继续随结构继承。
  delete oft.excel_import;
  // 报告公式格由上面的绑定读取原始记录公式结果，不在报告表内重复维护一份公式。
  delete oft.cell_formulas;
  // 报告侧不录入：清空录入格标记
  delete oft.input_cells;

  // 记录自引用带 → 报告 source_field 带
  oft.sample_bands = selfBands.length
    ? selfBands.map(b => ({ id: b.id, axis: b.axis, refs: b.refs, cross_refs: b.cross_refs, source_field: recordCode, source_band_id: b.id }))
    : undefined;
  oft.sample_band = undefined;   // 旧单带一并迁走
  return oft;
}

/** data_matrix（样品表）记录 → 报告 report_result_table：试样带一键成表（试样编号列 + 每参数一列 + 样板行 + band）。
 *  与 ReportResultTableCanvas 的 rebuildBand('row') 同构，渲染期 expandResultTableBand 按记录实际样品数展开。
 *  返回 null = 无法自动成表（统计表 / 无参数列），交调用方进 manual 清单。 */
function convertDataMatrix(f: FieldDefinition): FieldDefinition | null {
  const m = f.matrix;
  if (!m) return null;
  if (m.kind === 'stats') return null;              // 统计表不出试样带（逐格按行绑定，非本期）
  const params = m.parameters || [];
  if (!params.length) return null;
  const mc = f.code;                                // 报告结果表按记录矩阵 code 取数
  const idxCol = { id: `${f.code}__rt_idx`, label: '试样编号' };
  const pCols = params.map((p, i) => ({ id: `${f.code}__rt_p${i}`, label: p.label || `参数${i + 1}`, note: p.unit || undefined }));
  const bandRow = { id: `${f.code}__rt_band` };
  const cells = [
    { rowId: bandRow.id, colId: idxCol.id, binding: { source: 'record_sample_index', matrix_code: mc } as CellBinding },
    ...pCols.map((c, i) => ({ rowId: bandRow.id, colId: c.id, binding: { source: 'record_cell_sample', matrix_code: mc, param_code: params[i].code } as CellBinding })),
  ];
  return {
    id: f.id, code: f.code, label: f.label, type: 'report_result_table',
    table_title: (f as any).table_title,
    // 备注/标题与表格的距离：对齐弯曲模板（12pt）
    label_gap: DEFAULT_TABLE_LABEL_GAP,
    result_table: {
      columns: [idxCol, ...pCols],
      rows: [bandRow],
      cells,
      band: { axis: 'row', matrix_code: mc, ref_id: bandRow.id },
      // 行高对齐原始记录 data_matrix：记录设了就用记录的，否则用 Typst 默认 5pt（结果表渲染器缺省 10pt，故须显式设）
      cell_inset_y: m.cell_inset_y || '5pt',
    },
  } as FieldDefinition;
}

/** 把一个记录字段转成一个报告字段；返回 null = 不自动映射（进 manual 清单）。 */
function convertField(f: FieldDefinition): { field: FieldDefinition; kind: InheritMappedItem['kind'] } | null {
  // 语义角色字段（主检/审核/日期）：权威值在 record_data 五列，绑 record_meta
  if (f.semantic_role && SEMANTIC_META[f.semantic_role]) {
    const isDate = f.semantic_role === 'inspector_date' || f.semantic_role === 'reviewer_date';
    return {
      field: {
        id: f.id, code: f.code, label: f.label, type: isDate ? 'date' : 'text',
        date_precision: isDate ? (f.date_precision || 'day') : undefined,
        date_separator: isDate ? (f.date_separator || '-') : undefined,
        binding: { source: 'record_meta', key: SEMANTIC_META[f.semantic_role], ...(isDate ? { precision: f.date_precision || 'day', date_separator: f.date_separator || '-' } : {}) },
      },
      kind: 'meta',
    };
  }
  // 版式空白：原样保留
  if (f.type === 'spacer') {
    return { field: JSON.parse(JSON.stringify(f)), kind: 'spacer' };
  }
  // 图片字段：项目模板保留原始记录的初始图位和显示配置，并绑定来源字段。
  // 数据期只要任一来源 code 命中，图片渲染器会定位该来源分区的动态集合，
  // 因而录入时新增/删除/改名/排序的图片都能整体进入项目报告。
  if (f.type === 'image') {
    const out: FieldDefinition = JSON.parse(JSON.stringify(f));
    out.image_source_code = f.code;
    delete out.image_photos;
    delete out.image_items;
    return { field: out, kind: 'image' };
  }
  // 原始记录表格：结构镜像 + 自动映射
  if (f.type === 'free_grid' && f.free_table) {
    const out: FieldDefinition = JSON.parse(JSON.stringify(f));
    out.free_table = convertFreeGrid(f.code, f.free_table);
    return { field: out, kind: 'free_grid' };
  }
  // 数据矩阵（样品表）：一键成报告结果表（试样带动态展开）
  if (f.type === 'data_matrix') {
    const rt = convertDataMatrix(f);
    if (rt) return { field: rt, kind: 'result_table' };
    return null;   // 统计表/无参数列 → 进 manual
  }
  // 普通值字段：恒等绑定 record_field
  if (SIMPLE_VALUE_TYPES.has(f.type)) {
    // daterange 走 record_field 取展平值时，用 text 呈现避免报告端按 date_range 语义渲染
    const type: FieldDefinition['type'] = f.type === 'daterange' ? 'text' : f.type;
    const out: FieldDefinition = {
      id: f.id, code: f.code, label: f.label, type,
      unit: f.unit, required: f.required, options: f.options, allow_custom: f.allow_custom,
      date_precision: f.date_precision,
      date_separator: f.date_separator,
      binding: { source: 'record_field', field_code: f.code },
    };
    return { field: out, kind: 'field' };
  }
  return null;
}

/**
 * 记录模板 → 报告项目模板 groups（一次性快照 + 自动映射）。
 * @param record 关联的原始记录模板（其 groups = 记录字段定义）
 */
export function buildProjectGroupsFromRecord(record: Pick<RecordTemplate, 'groups'>): InheritResult {
  const mapped: InheritMappedItem[] = [];
  const manual: InheritManualItem[] = [];
  const outGroups: FieldGroup[] = [];

  for (const g of record.groups || []) {
    // 结论模块由报告生成器按字段角色直接读取：项目模板只保留结果版式，不复制名称/判定/结论字段，避免正文重复。
    if (g.section_role === 'conclusion' && (g.fields || []).some(field => field.conclusion_role)) continue;
    const outFields: FieldDefinition[] = [];
    for (const f of g.fields || []) {
      const r = convertField(f);
      if (r) {
        outFields.push(r.field);
        mapped.push({ code: f.code, label: f.label, kind: r.kind });
      } else {
        manual.push({ code: f.code, label: f.label, type: f.type, reason: manualReason(f.type) });
      }
    }
    // 保留分区外壳（即便字段全被跳过也保留结构，便于用户在其中手动补字段）
    outGroups.push({ ...JSON.parse(JSON.stringify(g)), fields: outFields });
  }

  return { groups: outGroups, mapped, manual, theme_config: { ...DEFAULT_PROJECT_THEME_CONFIG } };
}

function manualReason(type: string): string {
  switch (type) {
    case 'data_matrix': return '统计数据表（或无参数列）：请在报告结果表里逐格绑定，或改造为原始记录表格后再拉取';
    case 'device_ref': return '设备字段：请用报告「设备信息表」自动抓取';
    case 'variant_list': return '已废弃字段类型，跳过';
    case 'record_conclusion': return '结构化结论由报告生成器直接读取，不复制到项目报告正文，也不需要再配置结论绑定';
    default: return '该类型暂不支持自动映射，请手动配置';
  }
}
