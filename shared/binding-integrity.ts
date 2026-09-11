/**
 * 报告映射引用完整性校验（P-Tpl-1）
 *
 * 报告模板的取值绑定（CellBinding）用字符串编码 `field_code / matrix_code / param_code`
 * 指向关联原始记录模板的字段。原始记录模板改了某字段 code（改名/删除）后，引用它的
 * 报告绑定会在渲染时静默解析为空（resolveBinding 落到 '—'），那格变空且无任何告警。
 *
 * 本模块收集报告模板里所有指向记录的绑定，逐个比对"关联原始记录模板当前版本"的字段集，
 * 返回失效（dangling）绑定清单，供编辑器标红 + 保存/审核期告警。
 *
 * shared/ 是单一事实来源：服务端（report-templates 路由）与前端（ProjectEditor）共用本文件，
 * 两侧校验口径一致。
 */
import type { FieldGroup, CellBinding } from './types';
import { recordSampleBands, sampleBandForCell } from './free-grid-binding';

/** 报告模板里一处指向原始记录的绑定 */
export interface BindingRef {
  /** 人类可读定位，如 "项目内容 / 检测结果表 · 单元格[r1/c1]" */
  path: string;
  label: string;
  binding: CellBinding;
}

/** 一条失效（dangling）绑定 */
export interface DanglingBinding {
  path: string;
  label: string;
  source: CellBinding['source'];
  /** 中文原因，如 "引用的记录字段不存在" */
  reason: string;
  /** 引用的具体编码，如 "字段编码 rate" */
  detail: string;
}

/** 收集报告模板（groups）里所有"指向原始记录"的绑定（普通字段 + 结果表单元格/汇总行/汇总列）。 */
export function collectReportBindings(groups: FieldGroup[] | undefined): BindingRef[] {
  const out: BindingRef[] = [];
  for (const g of groups ?? []) {
    const gLabel = g.label || g.id;
    for (const f of g.fields ?? []) {
      const base = `${gLabel} / ${f.label || f.code || f.id}`;
      if (f.binding) out.push({ path: base, label: f.label || f.code || f.id, binding: f.binding });
      const rt = f.result_table;
      if (rt) {
        for (const c of rt.cells ?? []) {
          if (c.binding) out.push({ path: `${base} · 单元格[${c.rowId}/${c.colId}]`, label: f.label || '结果表', binding: c.binding });
        }
        for (const sr of rt.summary_rows ?? []) {
          if (sr.binding) out.push({ path: `${base} · 汇总行[${sr.label}]`, label: sr.label || f.label || '汇总行', binding: sr.binding });
          // 按列汇总行的逐列绑定
          for (const cc of sr.cells ?? []) {
            if (cc.binding) out.push({ path: `${base} · 汇总行[${sr.label}/${cc.colId}]`, label: sr.label || '汇总行', binding: cc.binding });
          }
        }
        for (const sc of rt.summary_cols ?? []) {
          if (sc.binding) out.push({ path: `${base} · 汇总列[${sc.label}]`, label: sc.label || f.label || '汇总列', binding: sc.binding });
        }
        // P-Map-12：结果表【表头槽位】绑定（标题/单位/备注/样品列/结论列）也纳入校验
        const pushHdr = (b: CellBinding | undefined, where: string) => {
          if (b) out.push({ path: `${base} · 表头[${where}]`, label: f.label || '结果表表头', binding: b });
        };
        for (const c of rt.columns ?? []) {
          pushHdr(c.label_binding, `${c.label} 标题`);
          pushHdr(c.note_binding, `${c.label} 备注`);
        }
        for (const sr of rt.summary_rows ?? []) {
          pushHdr(sr.label_binding, `汇总行 ${sr.label} 标题`);
          pushHdr(sr.note_binding, `汇总行 ${sr.label} 备注`);
        }
        for (const sc of rt.summary_cols ?? []) {
          pushHdr(sc.label_binding, `汇总列 ${sc.label} 标题`);
          pushHdr(sc.note_binding, `汇总列 ${sc.label} 备注`);
        }
      }
      // free_grid（原始记录表格·从原始记录拉取生成）：每格 cell_bindings 指向记录字段/记录 free_grid 格
      const ftbl = f.free_table;
      if (ftbl?.cell_bindings) {
        for (const [key, b] of Object.entries(ftbl.cell_bindings)) {
          if (b) out.push({ path: `${base} · 原始记录表格[${key}]`, label: f.label || '原始记录表格', binding: b });
        }
      }
      if (ftbl?.cell_unit_bindings) {
        for (const [key, b] of Object.entries(ftbl.cell_unit_bindings)) {
          if (b) out.push({ path: `${base} · 原始记录表格单位[${key}]`, label: f.label || '原始记录表格单位', binding: b });
        }
      }
    }
  }
  return out;
}

/** 原始记录模板的"可被报告引用"的字段索引 */
export interface RecordFieldIndex {
  /** record_field 可指向的普通字段 code（含计算字段，不含 data_matrix） */
  fieldCodes: Set<string>;
  /** 原始记录里的 image 字段 code 集（供报告图片表图位绑定校验） */
  imageCodes: Set<string>;
  /** matrix_code → 该矩阵的参数列 code 集 + 汇总行 id 集 + 汇总列 id 集 */
  matrices: Map<string, { params: Set<string>; summaryRows: Set<string>; summaryCols: Set<string> }>;
  /** free_grid 字段 code → 该表所有合法格键（`${rowId}::${colId}`，行×列全组合）。供 record_free_cell(_sample) 校验。 */
  freeGrids: Map<string, Set<string>>;
}

/** 从原始记录模板的 groups 建索引。 */
export function buildRecordFieldIndex(groups: FieldGroup[] | undefined): RecordFieldIndex {
  const fieldCodes = new Set<string>();
  const imageCodes = new Set<string>();
  const matrices = new Map<string, { params: Set<string>; summaryRows: Set<string>; summaryCols: Set<string> }>();
  const freeGrids = new Map<string, Set<string>>();
  for (const g of groups ?? []) {
    for (const f of g.fields ?? []) {
      if (f.type === 'free_grid' && f.legacy_matrix) {
        const m = f.legacy_matrix.config;
        matrices.set(f.code, { params: new Set(m.parameters.map(p => p.code)),
          summaryRows: new Set((m.summary_rows || []).map(s => s.id)),
          summaryCols: new Set((m.summary_cols || []).map(s => s.id)) });
      }
      if (f.type === 'data_matrix' && f.matrix) {
        matrices.set(f.code, {
          params: new Set((f.matrix.parameters ?? []).map(p => p.code)),
          summaryRows: new Set((f.matrix.summary_rows ?? []).map(s => s.id)),
          summaryCols: new Set((f.matrix.summary_cols ?? []).map(c => c.id)),
        });
      } else if (f.type === 'free_grid' && f.free_table && f.code) {
        const keys = new Set<string>();
        for (const r of f.free_table.rows ?? []) for (const c of f.free_table.columns ?? []) keys.add(`${r.id}::${c.id}`);
        freeGrids.set(f.code, keys);
      } else if (f.code) {
        fieldCodes.add(f.code);
        if (f.type === 'image') imageCodes.add(f.code);
      }
    }
  }
  return { fieldCodes, imageCodes, matrices, freeGrids };
}

/**
 * 校验报告模板所有绑定是否命中原始记录字段集，返回失效项。
 *
 * - `record_field` → 字段 code 必须存在；
 * - `record_cell`  → matrix_code 必须存在，且 param_code 是该矩阵的参数列；
 * - `record_summary` → matrix_code 必须存在，row_id 是该矩阵的汇总行（param_code 若有则须是参数列）；
 * - `literal / order / sample / test / report_meta / system / record_meta / record_formula` → 取自委托单接口(1.1)/
 *   报告接口(1.2)/系统/字面量，不指向原始记录字段集，不会因记录改名/删字段而失效，跳过校验。
 *
 * recordGroups 为 undefined（未关联原始记录模板）时，所有 record_* 绑定都报"无法校验"。
 */
export function validateReportBindings(
  reportGroups: FieldGroup[] | undefined,
  recordGroups: FieldGroup[] | undefined,
  /** 6.7：项目报告模板的检测结论声明（layout_options.conclusions[]），每条 binding 指向原始记录判定值。 */
  conclusions?: Array<{ id?: string; sub_name?: string; binding: CellBinding }>,
): DanglingBinding[] {
  const linked = recordGroups !== undefined && recordGroups !== null;
  const idx = buildRecordFieldIndex(recordGroups);
  const out: DanglingBinding[] = [];
  // 单条 record_* 绑定校验（结果表绑定与检测结论声明共用）
  const checkRecordBinding = (b: CellBinding, push: (reason: string, detail: string) => void): void => {
    if (!linked && (b.source === 'record_field' || b.source === 'record_field_unit' || b.source === 'record_cell' || b.source === 'record_summary' || b.source === 'record_header' || b.source === 'record_cell_sample' || b.source === 'record_sample_label' || b.source === 'record_sample_index' || b.source === 'record_free_cell' || b.source === 'record_free_cell_sample' || b.source === 'record_free_formula_cell' || b.source === 'record_free_formula_cell_sample' || b.source === 'record_free_template_cell' || b.source === 'record_free_cell_unit' || b.source === 'record_free_cell_unit_sample')) {
      push('未关联原始记录模板，无法校验数据绑定', `来源 ${b.source}`);
      return;
    }
    switch (b.source) {
      case 'record_field':
      case 'record_field_unit':
        if (!idx.fieldCodes.has(b.field_code)) push('引用的记录字段不存在', `字段编码 ${b.field_code}`);
        break;
      case 'record_cell': {
        const m = idx.matrices.get(b.matrix_code);
        if (!m) push('引用的数据矩阵不存在', `矩阵编码 ${b.matrix_code}`);
        else if (!m.params.has(b.param_code)) push('数据矩阵里没有该参数列', `${b.matrix_code} 的参数 ${b.param_code}`);
        break;
      }
      case 'record_summary': {
        const m = idx.matrices.get(b.matrix_code);
        if (!m) push('引用的数据矩阵不存在', `矩阵编码 ${b.matrix_code}`);
        else {
          if (!m.summaryRows.has(b.row_id)) push('数据矩阵里没有该汇总行', `${b.matrix_code} 的汇总行 ${b.row_id}`);
          if (b.param_code && !m.params.has(b.param_code)) push('数据矩阵里没有该参数列', `${b.matrix_code} 的参数 ${b.param_code}`);
        }
        break;
      }
      case 'record_header': {
        // P-Map-9：表头绑定到矩阵参数列的录入单位/备注 override。
        const m = idx.matrices.get(b.matrix_code);
        if (!m) push('引用的数据矩阵不存在', `矩阵编码 ${b.matrix_code}`);
        else if (!m.params.has(b.param_code)) push('数据矩阵里没有该参数列', `${b.matrix_code} 的参数 ${b.param_code}`);
        break;
      }
      case 'record_cell_sample': {
        // P-Map-10：样品带单元格绑定到矩阵参数列（按当前样品取值）。
        const m = idx.matrices.get(b.matrix_code);
        if (!m) push('引用的数据矩阵不存在', `矩阵编码 ${b.matrix_code}`);
        else if (!m.params.has(b.param_code)) push('数据矩阵里没有该参数列', `${b.matrix_code} 的参数 ${b.param_code}`);
        break;
      }
      case 'record_sample_label':
      case 'record_sample_index': {
        // P-Map-10：矩阵样品带需要矩阵存在；原始记录表格样品带的序号不依赖矩阵，matrix_code 允许为空。
        if (b.matrix_code && !idx.matrices.get(b.matrix_code)) push('引用的数据矩阵不存在', `矩阵编码 ${b.matrix_code}`);
        break;
      }
      case 'record_free_cell':
      case 'record_free_cell_sample':
      case 'record_free_formula_cell':
      case 'record_free_formula_cell_sample':
      case 'record_free_template_cell':
      case 'record_free_cell_unit':
      case 'record_free_cell_unit_sample': {
        // F1/F2：绑定原始记录某 free_grid 字段的某个格（带内=逐样品）。
        const keys = idx.freeGrids.get(b.field_code);
        if (!keys) push('引用的原始记录表格字段不存在', `原始记录表格编码 ${b.field_code}`);
        else if (!keys.has(b.cell_key)) push('原始记录表格里没有该单元格', `${b.field_code} 的单元格 ${b.cell_key}`);
        else if (b.source === 'record_free_cell_sample' || b.source === 'record_free_formula_cell_sample' || b.source === 'record_free_cell_unit_sample') {
          const table = recordGroups?.flatMap(group => group.fields || []).find(field => field.code === b.field_code)?.free_table;
          if (table && !sampleBandForCell(table, b.cell_key)) push('来源格不属于可逐试样读取的区域', `${b.field_code} 的 ${b.cell_key}，请检查试样区域或重新选择来源`);
        }
        break;
      }
      // 其余来源不指向记录字段，跳过
    }
  };
  for (const ref of collectReportBindings(reportGroups)) {
    const b = ref.binding;
    checkRecordBinding(b, (reason, detail) =>
      out.push({ path: ref.path, label: ref.label, source: b.source, reason, detail }));
  }

  // 项目模板只使用一个检测结论；外层数组仅为存量数据结构兼容。
  for (const decl of (conclusions ?? []).slice(0, 1)) {
    const b = decl?.binding;
    if (!b) continue;
    const label = decl.sub_name ? `检测结论·${decl.sub_name}` : '检测结论';
    checkRecordBinding(b, (reason, detail) =>
      out.push({ path: `项目结论 / ${label}`, label, source: b.source, reason, detail }));
  }

  // 报告图片表 report_image_gallery：手动图位 items 的 source_field_code 须是关联原始记录的 image 字段
  for (const g of reportGroups ?? []) {
    const gLabel = g.label || g.id;
    for (const f of g.fields ?? []) {
      // 新图片分区模型：image 字段通过 image_source_code 定位来源分区，
      // 数据期再整体读取该分区的动态图片集合。
      if (f.type === 'image') {
        const source = f.image_source_code;
        const base = `${gLabel} / ${f.label || f.code || f.id} · 图片`;
        // 首页 image 是文员直接上传，不设置 image_source_code；仅校验明确声明了记录来源的项目图片。
        if (!source) continue;
        if (!linked) {
          out.push({ path: base, label: f.label || '图片', source: 'record_field', reason: '未关联原始记录模板，无法校验图片绑定', detail: `来源 ${source}` });
        } else if (!idx.imageCodes.has(source)) {
          out.push({ path: base, label: f.label || '图片', source: 'record_field', reason: '绑定的图片字段不存在', detail: `原始记录图片字段 ${source}` });
        }
        continue;
      }
      if (f.type !== 'report_image_gallery') continue;
      const base = `${gLabel} / ${f.label || f.code || f.id} · 图片表`;
      const pushG = (reason: string, detail: string) =>
        out.push({ path: base, label: f.label || '图片表', source: 'record_field', reason, detail });
      const items = f.image_gallery?.items;
      if (Array.isArray(items)) {
        for (const it of items) {
          if (!it.source_field_code) { pushG('图位未绑定照片来源', '来源字段为空'); continue; }
          if (!linked) { pushG('未关联原始记录模板，无法校验图位绑定', `来源 ${it.source_field_code}`); continue; }
          if (!idx.imageCodes.has(it.source_field_code)) pushG('绑定的图片字段不存在', `原始记录图片字段 ${it.source_field_code}`);
        }
      } else if (linked && f.image_gallery?.source_field_codes?.length) {
        // 自动模式：选中的来源字段也应是存在的 image 字段
        for (const c of f.image_gallery.source_field_codes) {
          if (!idx.imageCodes.has(c)) pushG('选中的图片字段不存在', `原始记录图片字段 ${c}`);
        }
      }
    }
  }

  // free_grid 样品带（source_field）：驱动样品数的记录 free_grid 字段须存在
  for (const g of reportGroups ?? []) {
    const gLabel = g.label || g.id;
    for (const f of g.fields ?? []) {
      const freeTable = f.free_table;
      const sourceBands = (freeTable?.sample_bands ?? []).filter(band => !!band.source_field);
      for (const band of sourceBands) {
        if (!band.source_field) continue;
        const base = `${gLabel} / ${f.label || f.code || f.id} · 样品带`;
        if (!linked) out.push({ path: base, label: f.label || '原始记录表格', source: 'record_free_cell_sample', reason: '未关联原始记录模板，无法校验样品带来源', detail: `来源原始记录表格 ${band.source_field}` });
        else if (!idx.freeGrids.has(band.source_field)) out.push({ path: base, label: f.label || '原始记录表格', source: 'record_free_cell_sample', reason: '样品带来源原始记录表格不存在', detail: `原始记录表格 ${band.source_field}` });
        else if (band.source_band_id) {
          const table = recordGroups?.flatMap(group => group.fields || []).find(field => field.code === band.source_field)?.free_table;
          if (table && !recordSampleBands(table).some(source => source.id === band.source_band_id)) out.push({ path: base, label: f.label || '原始记录表格', source: 'record_free_cell_sample', reason: '原始记录的试样区域已变更', detail: '请重新拉取表格或确认试样来源，不能继续按旧区域展开' });
        }
      }
      // 逐试样绑定必须落在报告侧对应的样品带内。普通新增行/列不能自由承担样品数量，
      // 否则模板轴长度与数据录入时的实际试样数不一致，展开后会错位。
      for (const [cellKey, binding] of [...Object.entries(freeTable?.cell_bindings ?? {}), ...Object.entries(freeTable?.cell_unit_bindings ?? {})]) {
        if (binding.source !== 'record_free_cell_sample' && binding.source !== 'record_free_formula_cell_sample' && binding.source !== 'record_free_cell_unit_sample' && binding.source !== 'record_sample_index') continue;
        if (binding.source === 'record_sample_index' && !sourceBands.length && freeTable?.sample_bands?.some(band => band.matrix_code === binding.matrix_code)) continue;
        const [rowId, colId] = cellKey.split('::');
        const matchingBand = sourceBands.find(band => {
          const inBand = band.axis === 'row'
            ? band.refs.includes(rowId) && (!band.cross_refs?.length || band.cross_refs.includes(colId))
            : band.refs.includes(colId) && (!band.cross_refs?.length || band.cross_refs.includes(rowId));
          if (!inBand) return false;
          return binding.source === 'record_sample_index' || band.source_field === binding.field_code;
        });
        if (matchingBand) continue;
        out.push({
          path: `${gLabel} / ${f.label || f.code || f.id} · 原始记录表格[${cellKey}]`,
          label: f.label || '原始记录表格',
          source: binding.source,
          reason: '逐试样来源不在报告对应的试样区域内',
          detail: 'field_code' in binding
            ? `来源 ${binding.field_code}，请选择对应试样区域中的格子`
            : '试样序号必须放在试样区域中',
        });
      }
    }
  }
  return out;
}

/**
 * 6.7：项目报告模板「检测结论声明」的必填校验（与失效校验 validateReportBindings 分开，这里管"有没有填"）。
 * 返回人类可读错误清单（空数组＝通过）。规则：
 *   ① 必须配置一条结论数据来源（非空 literal 视为未选）。
 * 项目名称不属于模板配置：生成报告时自动取委托单当前分单的项目名称。
 */
export function validateProjectConclusions(
  conclusions: Array<{ sub_name?: string; binding?: CellBinding }> | undefined,
): string[] {
  const errs: string[] = [];
  const conclusion = Array.isArray(conclusions) ? conclusions[0] : undefined;
  const isFilled = (b?: CellBinding) => !!b && !(b.source === 'literal' && !((b as any).text || '').trim());
  if (!isFilled(conclusion?.binding)) errs.push('结论未选择数据来源');
  return errs;
}
