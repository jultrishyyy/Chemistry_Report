export type SectionRole =
  | 'other'
  | 'basic'
  | 'results'
  | 'judgment'
  | 'conclusion'
  | 'notes'
  | 'signoff'
  | 'images';

export type FieldSemanticRole =
  | 'inspector'
  | 'inspector_date'
  | 'reviewer'
  | 'reviewer_date';

/** data_matrix 录入值 */
export interface DataMatrixValue {
  sample_ids: string[];
  parameters: MatrixParameterDef[];
  cells: Record<string, string | number | undefined>;
  sample_labels?: Record<string, string>;
  /** 录入时为每个参数列实际选用的单位/备注（仅当列配置了 unit_options 时有意义） */
  parameter_unit_overrides?: Record<string, string>;
  /** 录入时为汇总行实际选用的表头备注（仅当行配置了 note_options 时有意义）：key = summary row id */
  summary_note_overrides?: Record<string, string>;
  /** 录入时为汇总列实际选用的表头备注（仅当列配置了 unit_options 时有意义）：key = summary col id */
  sumcol_unit_overrides?: Record<string, string>;
  /** 录入时为样品行实际选用的表头备注（仅当行配置了 note_options 时有意义）：key = sample id */
  sample_note_overrides?: Record<string, string>;
  /** 录入型汇总行的值：key = summary row id。formula 型不经过这里。 */
  summary_inputs?: Record<string, any>;
  /** 逐列录入型汇总行的值（每个参数列一格）：key = `${summary row id}__${param code}`。per_column 手填行用；聚合/公式型不经过这里。 */
  summary_row_inputs?: Record<string, any>;
  /** 录入型汇总列的值（每个样品行一格）：key = `${summary col id}__${sample id}`。聚合/公式型不经过这里。 */
  sumcol_inputs?: Record<string, any>;
}

export interface MatrixParameterDef {
  id: string;
  code: string;
  label: string;
  unit?: string;
  /**
   * 分组表头：相邻、同名 group 的参数列在 PDF 表头里合并到一个上层"超级表头"下（多级表头）。
   * 纯表头展示——不改 code、不影响录入网格 / 公式 / 报告绑定 / 版本回放。空/未设＝该列不分组（表头里上下合并占两行）。
   */
  group?: string;
  /**
   * 录入时可供选择的单位/备注选项（替代固定 unit）。
   * - 非空时：录入端表头显示下拉，工程师从这里选；
   * - 空/未定义：表头括号里为固定文本 unit。
   * 统一表头模型：unit 即"表头备注"（括号显示），可固定也可配可选项。
   */
  unit_options?: string[];
  /** unit_options 模式下是否允许实验人员输入"其他"自定义单位 */
  unit_allow_custom?: boolean;
  /** 该列所有单元格在录入页的初始默认值（实验员可改） */
  default_value?: string;
  /** PDF 列宽（fr 或 cm 等长度；缺省 1fr）——模板画布列头右缘拖拽写入，双击复位 */
  width?: string;
  /**
   * 手填数字的显示小数位（PDF/报告端四舍五入并补零；缺省=按录入原样显示）。
   * 只作用于显示、在全部公式计算之后——公式仍按原始输入计算，不损失精度；
   * 配了 cell_formula 的列不受此项影响（公式列用 cell_formula_decimals）。
   */
  decimals?: number;
  /**
   * 列级"按行公式"：该列的每一行值由同行其他列计算而来。
   * 表达式支持 `+ - * / ( )` 和标识符（标识符必须是同矩阵的其他参数 code）。
   * 例："burn_distance / burn_time * 60"
   * 设置后录入端该列禁止手填，实时按同行其他列计算。
   */
  cell_formula?: string;
  /** cell_formula 结果保留小数位 */
  cell_formula_decimals?: number;
}

/** 数据矩阵底部汇总行（模式 A：首列标签 + 值跨多列）
 *
 * source_type:
 * - `literal`: 模板里写死的固定文字
 * - `input_text`: 录入时实验员手填文字
 * - `input_number`: 录入时实验员手填一个数字
 * - `input_choice`: 录入时实验员从给定选项里选一个
 * - `formula`: 模板里配公式自动算（值跨多列，整行一个值）
 * - `per_column_aggregate`: @deprecated 每列自动聚合（如"每列平均"）。P-Map-13a 起编辑器不再新建（自动统计已移除，改用手动公式）；仅保留渲染兜底兼容旧模板
 * - `computed_field`: (legacy) 引用模板中已有的独立计算字段——保留兼容旧数据，UI 不再暴露
 */
export interface MatrixSummaryRowDef {
  id: string;
  /** 表格首列文字，如「平均值」 */
  label: string;
  /**
   * 表头备注（统一表头模型）：以小括号显示在行标签后，如「判定要求 (客户要求)」。
   * - note：固定备注文字（如单位）；
   * - note_options 非空：录入端括号里变下拉（如「客户要求 / 标准要求」），
   *   所选值存 DataMatrixValue.summary_note_overrides；
   * 与参数列 unit / unit_options 同一模式。
   */
  note?: string;
  note_options?: string[];
  /** note_options 模式下是否允许实验人员输入"其他"自定义备注 */
  note_allow_custom?: boolean;
  /** input_text / input_number / input_choice 在录入页的初始默认值（实验员可改） */
  default_value?: string;
  source_type: 'computed_field' | 'literal' | 'formula' | 'input_text' | 'input_number' | 'input_choice' | 'per_column_aggregate';
  /**
   * true＝逐列（每个参数列各一格）；false/缺省＝跨列（整行一个值）。
   * - per_column_aggregate 永远是逐列（忽略此字段）。
   * - input_text/input_number/input_choice 配 per_column=true ⇒ 每列手动录入一格（值存 DataMatrixValue.summary_row_inputs，key=`${id}__${paramCode}`，
   *   展平到与 per_column_aggregate 同一键 `${code}__summary__${id}__${param}`，故出片/绑定一致）。
   * - formula/literal 仍跨列。需要逐列计算（如各列平均值）＝用 per_column_aggregate 或先建逐列数字行再点「配置公式」。
   */
  per_column?: boolean;
  /**
   * per_column 行（"其他行"）的【逐格公式】：key=参数列 code，值=与样品格完全相同的 `Formula`（经 PerCellFormulaPanel 配置，可选任意数据源单元格/字段）。
   * 设了公式的列＝该格按所选数据源自动算（录入时只读）；未设＝手填。其他行的格子在显示与公式录入上都复用样品格，只是该行不计入样品（不进平均/报告样品带）。
   */
  cell_formulas?: Record<string, Formula>;
  /** legacy: 模板内任意计算字段的 code */
  field_code?: string;
  /** source_type 为 formula 时与计算字段共用公式模型 */
  formula?: Formula;
  /** source_type 为 literal 时的固定内容 */
  literal?: string;
  /** input_choice 时的选项列表 */
  choices?: string[];
  /** input_choice 时是否允许"其他（自定义）" */
  allow_custom?: boolean;
  /** input_number / input_text 时的单位 */
  unit?: string;
  /** input_text 时的占位提示文字（可选） */
  placeholder?: string;
  /** per_column_aggregate 时的聚合方式 */
  aggregate?: 'average' | 'sum' | 'max' | 'min';
  /** per_column_aggregate / formula 结果的小数位 */
  decimals?: number;
  /**
   * 值单元格横跨的参数列数（不含「试样」列），默认等于当前参数列数。
   * 仅 formula / literal / input_text / input_number / input_choice 模式下生效。
   * per_column_aggregate 模式忽略此字段（每列各占一格）。
   */
  value_colspan?: number;
}

/** 数据矩阵底部汇总列（模式 B：列头标签 + 每行一个聚合值）
 *
 * source_type:
 * - `per_row_aggregate`：@deprecated 每行自动聚合（平均/求和/最值）。P-Map-13a 起编辑器不再新建（改用手动公式）；仅保留渲染兜底兼容旧模板
 * - `formula`：跨行公式（少见，预留）
 * - `literal`：固定文字
 * - `input_text` / `input_number` / `input_choice`：录入型
 */
export interface MatrixSummaryColDef {
  id: string;
  /** 列头文字，如「平均值」 */
  label: string;
  /**
   * P-Map-13b：true/缺省＝逐行（每个可视行一格，即「其他列」，与汇总行的 per_column 对偶）；
   * false＝跨行（整列一个值，即「汇总列」，渲染为右侧列的 rowspan 单格）。
   * 存量 summary_col 无此字段 → 视为逐行（其他列），行为不变。
   */
  per_row?: boolean;
  source_type: 'per_row_aggregate' | 'formula' | 'literal' | 'input_text' | 'input_number' | 'input_choice';
  /** per_row_aggregate 时的聚合方式 */
  aggregate?: 'average' | 'sum' | 'max' | 'min';
  /** 结果保留小数位 */
  decimals?: number;
  /** source_type 为 formula 时与汇总行共用公式模型（汇总列 per_row===false 跨行单值，或统计列整体） */
  formula?: Formula;
  /**
   * 统计列（per_row）的【逐格公式】：key=样品 id（s{idx}）→ `Formula`（与样品格/统计行 cell_formulas 完全同款，
   * 经 PerCellFormulaPanel 配置，数据源可选任意单元格/字段/符号列）。设了公式的格 ⇒ 该格按公式自动算（录入只读），
   * 结果写入 `{code}__sumcol__{colId}__{sampleId}`。仅 per_row（≠false）统计列生效。
   */
  cell_formulas?: Record<string, Formula>;
  /** literal 固定内容 */
  literal?: string;
  /** input_choice 时的选项 */
  choices?: string[];
  allow_custom?: boolean;
  /**
   * 表头备注（统一表头模型）：以小括号显示在列头标签后（如单位）。
   * unit_options 非空时录入端列头出下拉，所选值存 DataMatrixValue.sumcol_unit_overrides。
   */
  unit?: string;
  unit_options?: string[];
  unit_allow_custom?: boolean;
  placeholder?: string;
}
export interface ExcelImportMapping {
  enabled: boolean;
  sheet_name: string;
  /** 跳过的表头行数（0-based 起始索引）：2 = 数据从第 3 行开始 */
  data_start_row?: number;
  /** 数据从第几列开始（0=A 列）。数据块模式：从 (data_start_row, data_start_col) 起整块导入，
   *  行名/列头不读 Excel（由模板配置）。 */
  data_start_col?: number;
  /** @deprecated 旧"逐列映射"模式遗留，UI 已不再暴露 */
  column_mapping?: Record<number, string>;
  /** @deprecated 旧"行名列"模式遗留，UI 已不再暴露 */
  row_label_column?: number;
}

/** 试验结果等：动态样品行 × 参数列 */
export interface DataMatrixConfig {
  /**
   * 表格用途（决定是否带试样语义）：
   * - 'sample'（缺省）＝**试样数据表**：每行/列是一个试样，有「试样为行/列」轴、可被报告「试样带」按录入试样数自动展开。
   * - 'stats'＝**统计数据表**：行是固定的统计项（平均值/最大值…），**无试样轴、不出试样带**，表头为普通命名行；
   *   报告侧逐格绑定（record_cell / record_summary），不走试样带。
   * 底层存储不变（仍是 s{idx} 行 + parameters 列、键 {code}__{sid}__{param}），仅影响 UI 试样语义 + 报告是否提供试样带。
   */
  kind?: 'sample' | 'stats';
  default_sample_count: number;
  parameters: MatrixParameterDef[];
  cell_type: 'number' | 'text';
  allow_add_remove_samples: boolean;
  allow_add_remove_parameters: boolean;
  /**
   * P-Map-13：试样在表格里的排布方向（作者在原始记录模板里显式声明，是"哪条轴是试样"的唯一事实来源）。
   * - 'row'（缺省）＝试样为行、参数为列（默认布局，存量模板不变）；
   * - 'col'＝试样为列、参数为行（转置显示）。
   * 注意：底层存储恒为「试样 = s{idx} 维、参数 = parameters[]」（展平键 {code}__{sid}__{param} 不变），
   * 取数永远正确；sample_axis 只影响【画布 + PDF 的排版方向】，不改存储/公式/绑定语义。
   * 报告模板侧据此自动判定"直接拉 / 转置"（详见 报告映射方案.md P-Map-13）。【画布/PDF 转置渲染在 13b 落地】
   */
  sample_axis?: 'row' | 'col';
  /** 录入页是否允许改参数列显示名称（不改 code） */
  allow_edit_parameter_labels_at_entry?: boolean;
  /** 录入页是否允许改行名（样品标签） */
  allow_edit_sample_labels_at_entry?: boolean;
  /**
   * 样品行表头备注（统一表头模型）：索引对应默认行序号，以小括号显示在行名后。
   * 行列倒置使用矩阵（参数当行）时，行表头也能配单位/可选单位。
   * note_options 非空时录入端行头出下拉，所选值存 DataMatrixValue.sample_note_overrides（key=sample id）。
   * 录入期新增的行（超出默认行数）无备注配置。
   */
  sample_notes?: ({ note?: string; note_options?: string[]; note_allow_custom?: boolean } | null)[];
  /** PDF 试样列（行表头列）宽度（fr/cm；缺省 auto）——画布左上角格右缘拖拽写入 */
  axis_col_width?: string;
  /**
   * PDF 数据行最小行高（cm；null/缺省 = 按内容自适应）。索引对应默认行序号，
   * 渲染为行首格的零宽 #box(height: …)：行至少这么高、内容多时仍自动撑开。
   * 画布行头下缘拖拽写入，双击复位；录入期新增的行无此配置。
   */
  sample_row_heights?: (string | null)[];
  /** 表内汇总行（跨列）：本表公式、引用计算字段或固定文字 */
  summary_rows?: MatrixSummaryRowDef[];
  /** 表内汇总列（跨行）：每行对当前所有参数列做聚合（如平均值/求和/最大），或固定文字、按行公式 */
  summary_cols?: MatrixSummaryColDef[];
  /**
   * 单元格级公式：key = "s{idx}__{paramCode}"（与 matrixDataKey 一致）。
   * 优先级低于列级 cell_formula（列级覆盖整列时，per-cell 不生效）。
   * 录入时该格变为只读，显示计算结果。
   */
  cell_formulas?: Record<string, Formula>;
  /**
   * 模板预设的默认行名。索引对应样品序号。
   * 如 ["1#", "2#", "3#"] 或 ["上午", "下午"]。
   * 录入时 seed 到 sample_labels，用户仍可修改。
   * 长度不足时 fallback 到 "{row_header_prefix} {N}"。
   */
  default_sample_labels?: string[];
  /** 左上角表头文字（行轴 \ 列轴），默认 "试样 \ 参数" */
  axis_header?: string;
  /** 行表头前缀（当 default_sample_labels 不够时的 fallback），默认 "试样" */
  row_header_prefix?: string;
  /** 表格单元格对齐方式（PDF 渲染时生效），默认 'center' */
  cell_align?: 'left' | 'center' | 'right';
  /**
   * 尽量同页：PDF 里整张表（含标题）尽量不跨页——放不下当前页就整体移到下一页。
   * 缺省 = true（同页优先）。超过一整页的超长表仍会自动跨页（不丢数据）。
   * 渲染：外层 #block(breakable: false)。设 false = 允许在当前页就近跨页。
   */
  keep_together?: boolean;
  /**
   * 跨页时续页是否重复表头（仅当表格确实跨页时生效）。缺省 = true。
   * 渲染：table.header(repeat: …)。
   */
  repeat_header_on_break?: boolean;
  /**
   * 单元格上下内边距（"行距/行内留白"）：控制表格里**行与行的疏密**（长度，如 "5pt"/"0.2cm"）。
   * 缺省 = 不设（Typst 默认 5pt）。渲染：#table(inset: (y: …))。
   * 注意：这跟「分区·行距」(par leading，管段内多行文字) 不同——表格行距要调这里。
   */
  cell_inset_y?: string;
  /** Excel 导入配置：指定从哪个 sheet 导入数据到此表格 */
  excel_import?: ExcelImportMapping;
  /** 空单元格在 PDF 中的显示字符，默认 "—" */
  empty_cell_display?: string;
  /**
   * 整表统一手填小数位（显示期格式化，公式计算后；仅数字矩阵非公式列）。
   * 在矩阵工具栏配置。列级 MatrixParameterDef.decimals 保留为存量覆盖（优先），UI 已不再提供入口。
   */
  decimals?: number;
  /**
   * 单元格级默认值：key = "s{idx}__{paramCode}"（与 matrixDataKey / cell_formulas 同键空间，模板期行）。
   * 画布数据格右键「配置默认值」写入；createEmptyMatrixValue 初始化时优先于列级 default_value。
   * 录入期新增的行（模板外）无格级默认，回退列级 default_value。
   */
  cell_defaults?: Record<string, string>;
  /**
   * 样品行分组表头（与参数列 group 对偶）：索引对应默认行序号，相邻同名分组在
   * 画布/录入/PDF 中合并为最左侧一列竖向"超级行头"（rowspan）。null/空 = 该行不分组。
   * 纯表头展示——不影响展平键/公式/报告绑定/版本回放；录入期新增的行按未分组。
   */
  sample_groups?: (string | null)[];
}

export interface FieldDefinition {
  id: string;
  code: string;
  label: string;
  type:
    | 'text'
    | 'number'
    | 'date'
    | 'daterange'                 // 时间范围（如检测周期）：渲染「开始 ~ 结束」；两端各可手填或绑定一个字段（见 date_range）
    | 'select'
    | 'checkbox'
    | 'textarea'
    | 'computed'
    | 'reference'
    | 'image'
    | 'device_ref'
    | 'variant_list'
    | 'data_matrix'
    | 'free_grid'                 // F0 统一自由网格：所有格子平等、任意合并（含表头）；每格可标 header(表头)/input(录入格)；录入值存 raw_data[code] 的 `${rowId}::${colId}` 键。结构复用 free_table
    | 'spacer'                    // 版式·间隔：纯排版的空白块（在字段/分区之间留白，无数据），渲染成 #v(高度)
    | 'report_conclusion_table'   // 报告首页：检测结论汇总表（行 = 项目，自动展开）
    | 'report_result_table'       // 项目报告：检测结果表（画布 + 每格 binding）
    | 'report_equipment_table'    // 项目报告：设备信息表（自动从原始记录 device_ref 抓）
    | 'report_image_gallery'      // 项目报告：图片表（自动从原始记录 image_phase 抓）
    | 'report_photo_table'        // 报告首页：原样照片表（文员直接上传、无记录绑定；加粗标签+说明行 + 带表头图片表）
    | 'report_sample_table';      // 报告首页：样品信息表（多样品时自动从委托单样品 SampleSortNo/SampleName/Model 列出）
  unit?: string;
  required?: boolean;
  default_value?: any;
  options?: string[];
  allow_custom?: boolean;      // select/checkbox 允许工程师自定义输入"其他"
  variants?: VariantDef[];     // variant_list 字段的变体定义
  matrix?: DataMatrixConfig;   // data_matrix
  formula?: Formula;
  allow_override?: boolean;
  store_in_record?: boolean;
  removable?: boolean;         // 录入时允许删除该字段（variant 内部字段用）
  description?: string;        // 字段说明（UI 提示）
  /** 模板编辑器预览用的示例值（覆盖自动 mock） */
  example_value?: any;
  /** PDF 渲染时不显示该字段的标签（目前主要供 data_matrix 隐藏表格上方的标题文字） */
  hide_label?: boolean;
  /** 主检/审核等语义，供 UI 与报告映射 */
  semantic_role?: FieldSemanticRole;
  /** 图片字段：拍摄阶段（用于"图片记录"分区按阶段分组渲染） */
  image_phase?: 'before' | 'during' | 'after' | 'other';
  /** 图片字段：是否允许上传多张（默认 true） */
  allow_multiple?: boolean;
  /** 图片字段：单张图在 PDF 中的尺寸（cm），默认 8×7 */
  image_size?: { width_cm?: number; height_cm?: number };
  /** 图片字段：行内布局——'loose' 宽松(一行一张，独占整行) / 'compact' 紧凑(按占比与相邻紧凑图凑成一行)。默认 loose */
  image_layout?: 'loose' | 'compact';
  /** 图片字段：紧凑型时本图在一行中的宽度占比(0–1，默认 0.5)。相邻紧凑图占比累加 ≤1 则同行并排；落单则回退为宽松整行 */
  image_row_ratio?: number;
  /** 图片字段：本字段的【多张照片】每行排几张（缺省：loose=1、compact 走 ratio）。>1 时多张照片自动铺成栅格、换行；解决"上传多/少张"灵活铺排，并修正紧凑模式只显第一张。 */
  image_cols?: number;
  /** 图片字段：所在表格样式（边框粗细、内边距 pt）；只有"前/中/后"分组的第一个字段生效（控制整组） */
  image_table_style?: { stroke_pt?: number; inset_pt?: number };
  /** 图片【组级·无缝】：整组图片渲成【一张连续表格】（边框共享、框间无空隙）而非逐字段独立框。取分组第一个 image 字段（与 image_table_style 同口径）。缺省 false＝逐字段独立框（向后兼容）。 */
  image_seamless?: boolean;
  /** 图片字段·文员直接上传的照片（{name, server_path, url}[]）。用于【报告首页 content_doc】里 image 字段——
   *  首页走 generateTypst+inject、不经 record_data，故照片随 content_doc 存在字段上；渲染时 generateImageGroupContent 读它。
   *  录入端 image 字段照片仍在 record_data[code]，与此互不影响。 */
  image_photos?: any[];
  /**
   * 【项目报告模板】图片字段的绑定来源：关联原始记录里某个 image 字段的 code；报告渲染期照此从
   * ctx.record_raw_data 取照片（一个图片字段＝一个图位＝绑定一个原始记录图片来源）。未设＝回退按本字段 code 取。
   * 原始记录模板的 image 字段不用它（照片直接来自 record_data[code]）。
   */
  image_source_code?: string;
  /** 图片字段·标题模式：'shared'(缺省)=共用一个表内标题(label) + 直传 image_photos / 'per'=每行一个表内标题 + 单张图(image_items)。 */
  image_title_mode?: 'shared' | 'per';
  /** 图片字段·每张一个标题模式：每行＝表内标题 + 单张直传图（photos 取首张）。 */
  image_items?: Array<{ id: string; label?: string; photos?: any[] }>;
  /** 图片字段·单数独占：每行排满后剩 1 张时该张独占整行——'first' 第一张(在最上)/'last' 最后一张(在最下)。缺省 first。 */
  image_solo?: 'first' | 'last';
  /** 图片字段·跨页表头跟随（仅共用标题+粘连有效）：表格跨页时共用表头在新页顶部重复。缺省 true。 */
  image_header_follow?: boolean;
  /** 图片字段·左右边距(x,pt)/上下边距(y,pt)/表内标题行高(pt)。缺省回退 image_table_style.inset_pt。 */
  image_inset_x?: number;
  image_inset_y?: number;
  image_title_inset_y?: number;
  /** 字段级样式覆盖（P1，目前渲染作用于普通 #field 字段） */
  style?: StyleOverride;
  /** spacer 字段：空白高度（cm/pt/mm/em，裸数字按 pt）。缺省 0.5cm。固定值——页内留白用。 */
  spacer_height?: string;
  /** 强制分页：该字段前插 #pagebreak()，使本字段从新的一页开始（报告编辑器「强制分页」按钮）。 */
  page_break_before?: boolean;
  /** 签名栏：渲染成「标签 ＿＿＿＿」下划线签名格（编制/审核/批准/签发）。同组多个并排成等分行。值（签名）在线上居中。 */
  signature_line?: boolean;
  /** 字段名（标签）单独加粗/正常，覆盖文档级 label_weight。缺省＝跟随文档设置。
   *  @deprecated 改用 label_style.weight；保留以兼容存量模板（label_style 未设时回退读此值）。 */
  label_bold?: boolean;
  /**
   * 字段名（标签）的独立文字样式：字体/字号/加粗/斜体/颜色（P14·14.2）。
   * 与 value_style 把"字段名 vs 字段值"分开配。仅普通 `#field`（vertical 布局）生效，
   * 渲染为 #field 的 label_args（splat 进 text()）；加粗走 label_bold 通道以复用主题 faux-bold。
   * 缺省＝继承上层（区块/文档默认）。内联/矩阵/结果表单元格待后续期。
   */
  label_style?: StyleOverride;
  /**
   * 字段值的独立文字样式：字体/字号/加粗/斜体/颜色（P14·14.2）。
   * 仅普通 `#field` 生效，渲染为 #field 的 value_args。缺省＝继承上层。
   * 注意：字段整体的"版式"（段前/段后/对齐/行距/缩进）仍由 `style`（块级）承担。
   */
  value_style?: StyleOverride;
  /** 富文本字段：值按 Markdown 子集（粗/斜/列表/换行）渲染（report 正文用，hide_label 纯文本块）*/
  rich?: boolean;
  /**
   * 图/表的【备注信息】：填入后紧贴图片或表格【下方】以小字显示（如"注：试样取自批次 A"）。
   * 用于 data_matrix / image / report_result_table / report_equipment_table / report_image_gallery。
   * 模板期填默认值；报告生成后文员可在实例编辑器（InstanceEditor）改本份报告的备注。空＝不显示。
   */
  caption?: string;
  /**
   * 图/表【备注信息】相对图/表的位置：'below'（缺省，紧贴下方，传统题注）/ 'above'（紧贴上方）。
   * 仅报告自动表（report_result_table / report_equipment_table / report_image_gallery）的 wrapFigure 包装支持；
   * data_matrix / image 的 caption 仍固定在下方。
   */
  caption_position?: 'above' | 'below';
  /** 图/表【备注与图/表之间的距离】（pt/em 等长度）。缺省＝主题默认 0.35em。→ captionTypst 的图/表一侧间距。 */
  caption_gap?: string;
  /** 图/表【备注文字样式】（字体/字号/加粗/斜体/颜色）。缺省＝9pt 常规。→ captionTypst 套行内 text()。 */
  caption_style?: StyleOverride;
  /**
   * 报告自动表（report_result_table / report_equipment_table）的【整表文字样式】：
   * font/font_size 作用于全表；header_bold（缺省 true）控制表头加粗；body_bold（缺省 false）控制内容加粗。
   * 缺省（未设）＝表头加粗、内容常规、字体字号继承——与历史渲染一致。
   */
  table_style?: {
    font?: string;
    font_size?: string;
    header_bold?: boolean;
    body_bold?: boolean;
    /** 表格内容水平对齐（left/center/right）。缺省＝center。目前样品信息表 / 检测结论表的「版式」用它统一整表对齐。 */
    cell_align?: 'left' | 'center' | 'right';
  };
  /**
   * 图/表【标题与图/表之间的距离】（pt/em 等长度）。
   * 报告自动表（wrapFigure）与数据矩阵（embedDataMatrixTypst）的标题块 `below` 间距；缺省走各自默认。
   */
  label_gap?: string;
  /**
   * 字段级【字段间距】（pt/em/cm，普通文字字段的 #field 块上下间距）。缺省＝跟随【文档样式·字段间距】(line_gap)。
   * 仅对普通文字字段生效；图/表/图片不读此项（它们间距随文档字段间距）。
   */
  field_gap?: string;
  /** 报告字段：取值绑定（普通字段在报告 Cover/Project 模板中通过这个绑定数据源） */
  binding?: CellBinding;
  /**
   * daterange（时间范围，如检测周期）配置：两端各一个 CellBinding——
   * literal＝手填日期、order/record/…＝绑定字段（如委托单 检测开始/结束日期 test_start/test_end）。
   * 渲染＝`${start}${separator}${end}`（separator 缺省 ' ~ '；缺一端只显另一端、都缺为空）。
   */
  date_range?: { start?: CellBinding; end?: CellBinding; separator?: string };
  /** report_conclusion_table 字段配置 */
  conclusion_table?: {
    /** P-Map-7：可含 'sample'（样品列，按样品 rowspan 分组）。 */
    columns?: Array<'sample' | 'index' | 'project' | 'standard' | 'result'>;
    /** @deprecated 已不渲染——标题统一走标准 figure 机制：字段 hide_label 开关 + field.label（居左、跟随模板字体、走 wrapFigure）。 */
    show_title?: boolean;
    /** @deprecated 已不渲染——标题文字＝字段 label（见上）。 */
    title_text?: string;
    /** 列表头文字覆盖（缺省 样品/序号/项目/标准/结论）；如报告封面要求"检测项目"而非"项目" */
    column_labels?: Partial<Record<'sample' | 'index' | 'project' | 'standard' | 'result', string>>;
    /** @deprecated 改用 col_widths_map（按列名）。旧的位置数组（与 columns 同序），渲染端仍兜底读。 */
    col_widths?: string[];
    /** 列宽（按【列名】：sample/index/project/standard/result → 宽度串 fr/cm/pt/%）。空/缺＝默认（index/sample=auto、其余=1fr）。
     *  按名存：样品列因 sample_col 自动增减、或「列」重排时都不串位。 */
    col_widths_map?: Partial<Record<'sample' | 'index' | 'project' | 'standard' | 'result', string>>;
    /** 行高＝单元格上下留白（如 '10pt'）。空＝默认（8pt）。与结果表/设备表 cell_inset_y 同口径。 */
    cell_inset_y?: string;
    /** P-Map-7：样品列显示模式。'auto'(缺省)=多样品才显示、单样品自动隐藏；'show'/'hide'=强制。 */
    sample_col?: 'auto' | 'show' | 'hide';
    /** 解锁手动编辑：true 时用下面 rows 固化内容，不再按 ctx.project_summary 自动展开（实例编辑器「解锁编辑」置位）。 */
    manual?: boolean;
    /** 手动固化的行（manual=true 时生效）；每行按列键存字符串。 */
    rows?: Array<Partial<Record<'sample' | 'index' | 'project' | 'standard' | 'result', string>>>;
    /**
     * 自由编辑模式（free=true）：脱离"样品/序号/项目/标准/结论"语义列，变成一张任意网格——
     * 文员可任意增删行/列、改表头、调列宽(fr/cm)/行高(cm)、改单元格。生效后忽略 columns/rows 与自动展开，
     * 直接渲染 free_columns/free_rows/free_cells（实例编辑器「自由编辑表格」置位）。
     */
    free?: boolean;
    free_columns?: Array<{ id: string; label: string; width?: string }>;
    free_rows?: Array<{ id: string; height?: string }>;
    /** 单元格值：键 = `${rowId}::${colId}`。 */
    free_cells?: Record<string, string>;
  };
  /**
   * 统一「自由编辑表格」：任意文本网格（表头 + 单元格皆纯文本，列宽 fr/cm/pt/%、行高 cm）。
   * 三类报告表（report_conclusion_table / report_result_table / report_equipment_table）共用——
   * 实例编辑器「自由编辑表格」一键把当前渲染内容（含表头 / 汇总行 / 设备行）快照成此网格后，每格可改。
   * 置位后该字段忽略其类型专属渲染（绑定 / 自动展开 / 自动汇总），统一走 renderFreeTableTypst。
   */
  free_table?: {
    columns: Array<{ id: string; label: string; width?: string }>;
    rows: Array<{ id: string; height?: string }>;
    /** 单元格值：键 = `${rowId}::${colId}`（仅主格；被合并覆盖的格不存键、渲染时跳过）。 */
    cells: Record<string, string>;
    /**
     * 合并跨度：键 = `${rowId}::${colId}`（主格），值 = { colspan, rowspan }（按列/行顺序向右/下延展）。
     * 让"自由编辑"也保留合并外观（如结果表汇总列跨所有数据行、汇总行跨整行）。被覆盖的格不渲染、可由
     * 调整跨度恢复成独立格。空/缺＝该格不合并。 */
    spans?: Record<string, { colspan?: number; rowspan?: number }>;
    /** F0 free_grid：标记为「表头」的格（加粗 + 语义上跨页 repeat）。键 = `${rowId}::${colId}`。表头也是普通格、可自由合并。 */
    header_cells?: Record<string, true>;
    /** F0 free_grid：标记为「录入格」的格（数据录入时可填）。值不写模板，存进 record_data.raw_data[字段code] 的 `${rowId}::${colId}` 键。未标记的格＝固定文字（模板 cells）。 */
    input_cells?: Record<string, true>;
    /** F1 free_grid（报告侧）：每格绑定原始记录/接口取值。键 = `${rowId}::${colId}`。渲染时 `resolveBinding(ctx)` 优先于录入值/固定文字。 */
    cell_bindings?: Record<string, CellBinding>;
    /** F2 free_grid（报告侧）：样品带——把某一行/列按录入样品数自动展开成 N 份。`matrix_code`＝驱动样品数的原始记录矩阵；`ref`＝作模板的行/列 id。带内格子用 `record_cell_sample`/`record_sample_label`/`record_sample_index` 相对绑定，展开时按各样品落地（同 result_table 的 band）。 */
    sample_band?: { axis: 'row' | 'col'; matrix_code: string; ref: string };
  };
  /** report_result_table 字段配置（静态行列网格 + 可选试样带按试样自动展开） */
  result_table?: {
    /**
     * note＝列头括号备注/单位（显示为 标签（备注），与数据矩阵参数列同口径，回应"结果表列头也要能编备注"）；
     * group＝多级表头分组（相邻同组列合并成上层超级表头；空＝不分组）。
     */
    /** P-Map-9：label_binding/note_binding ⇒ 静态列头标题/备注可绑定数据来源（优先于字面量），统一走 resolveBinding。
     *  P-Map-13c：row_header=true ⇒ 该列是「行头列」——其每行的格子渲染为对应行的【行头】(行名+配置卡+名称/单位绑定)，
     *  而非数据格。用于试样为列(转置)时把参数放成行、且行头可像列头一样编辑/绑定。 */
    columns: Array<{ id: string; label: string; width?: string; note?: string; group?: string;
      label_binding?: CellBinding; note_binding?: CellBinding; row_header?: boolean;
      /** @deprecated P-Map-13c：旧「自动序号列」，已废弃（不再创建/不再特殊渲染）。 */
      auto_index?: boolean;
      /** P-Map-13c：true ⇒ 这是试样带的「试样序号」列（rebuildBand 打标）——表头固定「试样序号（自动设置）」、不可编辑、随录入试样自动 1,2,3…。仅此列被当序号，避免误判其他表头。 */
      sample_index?: boolean }>;
    rows: Array<{
      id: string;
      label?: string;
      is_conclusion?: boolean;
      conclusion_col_id?: string;
      /** 最小行高（cm/mm/pt 等）：渲染为行首格零宽 #box(height:…)——行至少这么高、内容多仍自动撑开。画布行头下缘拖拽，双击复位。 */
      height?: string;
      /** P-Map-13c：行头标题/备注可绑定（与列头同口径，走 resolveBinding）；用于试样为列时参数行的行头编辑。 */
      label_binding?: CellBinding;
      note?: string;
      note_binding?: CellBinding;
    }>;
    cells: Array<{
      rowId: string;
      colId: string;
      binding: CellBinding;
      /** 合并单元格：主格向右跨 colspan 列、向下跨 rowspan 行（默认 1）。被盖格按行列序号推算跳过，不单独存。仅在数据网格内有效。 */
      colspan?: number;
      rowspan?: number;
    }>;
    /** 汇总行：默认跨列单格 + binding；per_column=true 时改为【每个数据列一格】（如各列平均值），各格走 cells[]。表头(label/note)与数据列同口径可绑定（P-Map-12+）。 */
    summary_rows?: Array<{
      id: string;
      label: string;
      binding: CellBinding;
      /** 表头标题/备注可绑定（优先于字面量），统一走 resolveBinding，与数据列表头一致。 */
      label_binding?: CellBinding;
      note?: string;
      note_binding?: CellBinding;
      /** true＝按列汇总：首列为标签、其余每个数据列一格（值取 cells[].binding），用于"各列平均值"等需逐列求值的汇总。缺省 false＝整行跨列一个值（binding）。 */
      per_column?: boolean;
      /** per_column 时每个数据列的值绑定（按 colId 对应 result_table.columns）。 */
      cells?: Array<{ colId: string; binding: CellBinding }>;
    }>;
    /** 汇总列：默认整列合并为一个跨行单格（汇总列，单一 binding）；per_row=true 时改为【每个数据行一格】（其他列，逐行绑定，各格走 cells[]）。
     *  与汇总行的 per_column 对偶——统一为"其他列(逐行)/汇总列(跨行)"模型（P-Map-13c-3）。表头(label/note)可绑定。 */
    summary_cols?: Array<{
      id: string;
      label: string;
      /** 跨所有数据行的单一绑定（汇总列；per_row=true 时忽略，改用 cells[]） */
      binding: CellBinding;
      /** 列宽（fr/cm；缺省 1fr）——画布汇总列头右缘拖拽写入，双击复位 */
      width?: string;
      /** 表头标题/备注可绑定（优先于字面量），统一走 resolveBinding，与数据列表头一致。 */
      label_binding?: CellBinding;
      note?: string;
      note_binding?: CellBinding;
      /** P-Map-13c-3：true＝其他列（逐行，每个数据行一格，值取 cells[].binding by rowId）；缺省 false＝汇总列（跨行单值，binding）。 */
      per_row?: boolean;
      /** per_row 时每个数据行的值绑定（按 rowId 对应 result_table.rows）。 */
      cells?: Array<{ rowId: string; binding: CellBinding }>;
    }>;
    /**
     * P-Map-10：样品带（detail band）。在静态逐格网格上把**某一行或某一列**标记为"样品带"——
     * 绑一张数据矩阵，渲染时按【实际录入样品数】把这条带子复制成 N 行/列（带外格子只渲一次）。
     * 解决"模板设 K 行/列 vs 实录样品数不同"，又保留带外逐格绑定。
     * - axis='row'：样品纵向展开（每样品一行），ref_id = 作为样板的那一行 id；
     * - axis='col'：样品横向展开（每样品一列，转置），ref_id = 作为样板的那一列 id；
     * 带内单元格用 `record_cell_sample`（当前样品某参数）/ `record_sample_label`（当前样品名）绑定，
     * 其余来源（字面量/record_field/record_summary…）在带内每份重复出相同值。
     * 与动态模式 `source` 互斥（source 优先；source 即"覆盖整表的样品带"）。缺省未设＝纯静态，向后兼容。
     */
    band?: {
      axis: 'row' | 'col';
      matrix_code: string;
      ref_id: string;
    };
    /** 显示版式（与数据矩阵同口径，静态/动态两模式共用）：缺省走旧行为，出片不变。 */
    /** 尽量整表同页：缺省 true → 外层 #block(breakable:false)，放不下整体移到下一页（超一页的超长表仍自动跨页）。 */
    keep_together?: boolean;
    /** 跨页续页是否重复表头：缺省 true → table.header(repeat: true)（仅真跨页时生效）。 */
    repeat_header_on_break?: boolean;
    /** 行内留白（行与行的疏密，pt）→ #table(inset: (x: 8pt, y: …))。缺省＝8pt。 */
    cell_inset_y?: string;
    /** 单元格水平对齐：缺省 center。 */
    cell_align?: 'left' | 'center' | 'right';
    /** 空单元格显示符（绑定值为空时显示）：缺省 —。 */
    empty_cell_display?: string;
  };
  /** report_equipment_table 字段配置 */
  equipment_table?: {
    source_field_codes?: string[];
    /** 列：trace_date(溯源日期) / expire_date(到期日期) 均取自设备库（原合并的"校准有效期"已拆掉）。 */
    columns?: Array<'name' | 'model' | 'asset_code' | 'trace_date' | 'expire_date'>;
    /** 显示版式（与结果表同口径，缺省走旧行为）。 */
    keep_together?: boolean;
    repeat_header_on_break?: boolean;
    cell_inset_y?: string;
    cell_align?: 'left' | 'center' | 'right';
    empty_cell_display?: string;
  };
  /** report_image_gallery 字段配置 */
  image_gallery?: {
    /** 兼容旧/自动模式：未配 items 时，按这些 code（空=全部）从关联原始记录抓 image 字段铺排（继承其样式）。 */
    source_field_codes?: string[];
    layout?: 'auto';
    /** 组级·行是否粘连：true=整组渲成一张连续表格（行边框共享、无空隙）；false(缺省)=每行独立框。 */
    seamless?: boolean;
    /** 标题模式：'per'(缺省)=每张一个表内标题 / 'shared'=整组共用一个标题（shared_title）。 */
    title_mode?: 'shared' | 'per';
    /** 共用标题模式下的整组标题。 */
    shared_title?: string;
    /** 跨页表头跟随（仅共用标题+粘连有效）：表格跨页时共用表头在新页顶部重复。缺省 true。 */
    header_follow?: boolean;
    /** 组级·每行张数（图片按此数铺成网格，缺省 1）。 */
    cols?: number;
    /** 组级·单张图尺寸（cm，缺省 8×7）——所有图片统一大小。 */
    width_cm?: number;
    height_cm?: number;
    /** 单数独占：每行 cols 张、剩 1 张时该张独占整行——'last'(缺省)=最后一张独占 / 'first'=第一张独占。 */
    solo?: 'first' | 'last';
    /** 组级·表格样式：边框粗细 / 内边距（pt）。缺省 0.5 / 6。 */
    stroke_pt?: number;
    inset_pt?: number;
    /** 图片左右边距(x,pt)/上下边距(y,pt)/表内标题行高(标题格上下内边距,pt)。缺省回退 inset_pt。 */
    inset_x?: number;
    inset_y?: number;
    title_inset_y?: number;
    /**
     * 手动模式（推荐）：项目模板里直接定义图位 + 样式，每个图位【绑定】一个原始记录 image 字段作为照片来源。
     * 配了 items 即走手动模式（忽略 source_field_codes）；未配＝自动模式（按 source_field_codes 继承原始记录）。
     */
    items?: Array<{
      id: string;
      /** 绑定：照片来自关联原始记录的哪个 image 字段（code）。 */
      source_field_code: string;
      /** 标题覆盖：undefined＝用原始记录字段 label；''＝不显示标题（只出图）。 */
      label?: string;
      hide_label?: boolean;
      /** 行内布局：loose 独占整行 / compact 按占比与相邻 compact 图位并排。缺省 loose。 */
      layout?: 'loose' | 'compact';
      /** compact 时本图位在一行的宽度占比（0–1，缺省 0.5）。 */
      row_ratio?: number;
      /** 本图位照片每行张数（缺省取组级 cols）。 */
      cols?: number;
      width_cm?: number;
      height_cm?: number;
    }>;
  };

  /**
   * report_photo_table 字段配置（首页·原样照片表）。
   * 渲染成：一行「加粗标签：普通说明文字」 + 一张带表头的图片表。照片由文员在实例编辑器直接上传，
   * 存进 content_doc.cover.ctx.photo_tables[field.code]（不依赖关联原始记录）。
   */
  photo_table?: {
    /**
     * 文员上传的照片（ImageItem[]：{name, original_name, server_path, url}）。
     * 存在字段定义里（而非 ctx），这样随 content_doc.cover.groups → cover_groups_override carry 到每份报告
     * （与结论表手动行 conclusion_table.rows、字面量 binding 同一 carry 机制）。模板期为空。
     */
    photos?: any[];
    /** 标题模式：'shared'(缺省)=共用一个表头(header) + 直传 photos / 'per'=每行一个表内标题 + 单张图(items)。 */
    title_mode?: 'shared' | 'per';
    /** 跨页表头跟随（仅共用标题+粘连有效）：表格跨页时共用表头在新页顶部重复。缺省 true。 */
    header_follow?: boolean;
    /** 每张一个标题模式：每行＝表内标题 + 单张直传图（photos 取首张）。 */
    items?: Array<{ id: string; label?: string; photos?: any[] }>;
    /** 说明行的加粗标签（如「样品描述」，渲染时自动跟一个全角冒号）。空＝不显示说明行标签。 */
    caption_label?: string;
    /** 说明行的普通文字（如「见原始样品照片。」），不加粗。 */
    caption_text?: string;
    /** 图片表表头（如「原始样品」，渲染在表格首行）。空＝表格不显示表头行。 */
    header?: string;
    /** 每行张数（多张照片铺成网格，缺省 1）。 */
    cols?: number;
    /** 单张图尺寸（cm，缺省 8×7）。 */
    width_cm?: number;
    height_cm?: number;
    /** 单数独占：每行 cols 张、剩 1 张时该张独占整行——'last'(缺省)=最后一张独占 / 'first'=第一张独占。 */
    solo?: 'first' | 'last';
    /** 无缝：标题+图合并成一张连续表格（缺省 false）。 */
    seamless?: boolean;
    /** 表格样式：边框粗细 / 内边距（pt）。 */
    stroke_pt?: number;
    inset_pt?: number;
    /** 图片左右边距(x,pt)/上下边距(y,pt)/表内标题行高(pt)。缺省回退 inset_pt。 */
    inset_x?: number;
    inset_y?: number;
    title_inset_y?: number;
  };

  /**
   * report_sample_table 字段配置（首页·样品信息表）。多样品时自动从委托单样品列出
   * （ctx.order_samples 的 sort_no/name/model）。列默认 序号/样品名称/零件号。
   */
  sample_table?: {
    /**
     * 单/多样品自动切换（写进系统的固定渲染规则，文员无需每份报告判断）：
     * - 'auto'（缺省）：实际样品数 ≥2 才出表；=1（或 0）时自动折叠本表——单样品由首页「样品名称/零件号」字段直接显示。
     * - 'always'：无论几个样品都出表。
     * 对应检测结论表的 conclusion_table.sample_col:'auto' 同款约定。
     */
    mode?: 'auto' | 'always';
    /** 出哪几列、什么顺序。缺省 ['index','name','model']（样品编号/样品名称/零件号）。 */
    columns?: Array<'index' | 'name' | 'model'>;
    /** 列名覆盖（缺省 样品编号/样品名称/零件号）。index 列＝接口 SampleSortNo（样品编号）。 */
    column_labels?: { index?: string; name?: string; model?: string };
    /** @deprecated 改用 col_widths_map（按列名）。旧的位置数组，渲染端仍兜底读。 */
    col_widths?: string[];
    /** 列宽（按【列名】index/name/model → fr/cm/pt/%）。空/缺＝默认（均分页宽）。 */
    col_widths_map?: { index?: string; name?: string; model?: string };
    /** 行高＝单元格上下留白（如 '10pt'）。空＝默认（6pt）。 */
    cell_inset_y?: string;
  };
}

export interface VariantDef {
  id: string;
  label: string;
  render: 'inline_fields' | 'literal';
  fields?: FieldDefinition[];
  literal_value?: string;
  separator?: string;
}

/**
 * 样式覆盖（层叠模型，P1）：所有键可选，缺省＝继承上层。
 * 层叠顺序：文档默认(theme_config) → 区块(FieldGroup.style) → 字段(FieldDefinition.style)。
 * 渲染映射到 Typst set-rules（见 typst-generator 的 styleSetRules / applyBlockStyle）。
 */
export interface StyleOverride {
  font?: string;            // 字体族
  size?: string;            // 字号，如 "11pt"（裸数字按 pt）
  weight?: 'regular' | 'bold';
  italic?: boolean;
  color?: string;           // 十六进制，如 "#1a1a1a"
  align?: 'left' | 'center' | 'right';   // 水平对齐 → #align(...)
  line_height?: string;     // 行距（par leading），如 "0.8em"（裸数字按 em）
  tracking?: string;        // 字距（字与字间距），如 "0.3em"（裸数字按 pt）→ #set text(tracking: ...)。封面"检 验 报 告"那种拉开字距用
  /** 段/块间距：已渲染（applyBlockStyle → #v(段前/段后)）——块之间留白（Word 段前段后）的正解，替代手敲空格 */
  space_before?: string; space_after?: string;
  /**
   * 字段/表格间距（仅区块/分区级有效）：本分区内**字段之间、表格之间**的统一间距。
   * 渲染：`#set block(spacing: …)` 注入分区作用域，级联到内部所有块（含试验数据表格）。
   * 缺省 = 不设（用 Typst 默认块间距）。如 "20pt"/"1.2em"（裸数字按 pt）。
   */
  block_spacing?: string;
  /**
   * 垂直对齐：仅在「区块/部件」层有效，渲染成页流层的弹性 #v(1fr)，把内容在整页内分布。
   * 用于封面"标题/字段块在整页正中"。注意：1fr 只在页流层生效，故只对顶级分区起作用。
   *   top=不动 / center=上下各 1fr（居中）/ bottom=上方 1fr（钉底）
   */
  vertical_align?: 'top' | 'center' | 'bottom';
  /** 钉底/钉顶时的偏移量（如 "2cm"）：bottom 时把模块从页底再往上抬 offset（给印章/二维码留位）；top 时往下压。 */
  vertical_offset?: string;
  /** 整块不拆页：把本区块（含 module_span 覆盖的后续区块）包进 block(breakable:false)，不被分到两页。 */
  keep_together?: boolean;
  /** 以下进模型但渲染待后续期：页边距、宽度 */
  margin?: { top?: string; bottom?: string; left?: string; right?: string };
  width?: string;
}

export interface FieldGroup {
  id: string;
  label: string;
  /**
   * 嵌套分区（限一层）：指向同模板内某「顶级」分区的 id ⇒ 本分区是它的子分区。
   * 存储仍是平铺 groups[] 数组——顶级分区按数组顺序、同父子分区之间按数组顺序，
   * 子分区行在数组中的绝对位置不影响归属（渲染端经 shared/group-tree.ts 分桶）。
   * 指向不存在的分区时按顶级渲染（防御）。
   */
  parent_group_id?: string;
  /**
   * 字段排版方式（仅"纯字段分区"有意义；数据矩阵/图片/签名分区内容已定型，渲染端忽略 layout）。
   * UI 已收窄为三档：vertical(竖排) / grid(多列，配 grid_columns) / table(表格，配 table_header)。
   * 存量 'inline'(横排) / 'two-col'(两列) 保留渲染路径向后兼容，UI 不再作为新选项，按"多列"显示。
   */
  layout: 'vertical' | 'inline' | 'table' | 'two-col' | 'grid';
  /** 多列(grid)布局的列数（2-4）；缺省按字段数自适应（≤4）。 */
  grid_columns?: number;
  /** 表格(table)布局的表头：'none'=无表头（缺省，避免硬塞"项目|值"）/ 'custom'=用 columns 作两列标题。 */
  table_header?: 'none' | 'custom';
  /** 区块级样式覆盖（P1）——作用于分区【内容】（字段），不含标题。 */
  style?: StyleOverride;
  /** 分区【标题】文字样式（字体/字号/加粗/斜体/颜色）。缺省＝标题默认（加粗、heading_scale 字号）。
   *  与 style 分离：style 管内容、title_style 管标题。weight 走 faux-bold（仿宋等无粗体字体也能加粗）。 */
  title_style?: StyleOverride;
  /** 分区【标题与内容之间的距离】（pt/em 等长度）。缺省＝主题默认 0.4em。
   *  即"分区标题（如检测结果）"和其下第一块内容（表格/字段）之间的留白，渲染为 #section 的 #v(title_gap)。 */
  title_gap?: string;
  /**
   * 分区级「标签宽度 / 值对齐」覆盖（仅竖排字段有意义；多列本就紧贴）。覆盖文档级 theme_config.label_width。
   *  - undefined ＝ 跟随文档（继承全局 label_width；全局也没设＝紧贴）
   *  - 'none'    ＝ 紧贴：字段值紧跟在「标签：」后，无距离
   *  - '<len>'（如 '8em'）＝ 本分区按该宽度对齐（值对齐到同一制表位）
   */
  label_width?: string;
  /** 原始记录分区语义（可选，用于编辑导航与规范对齐） */
  section_role?: SectionRole;
  /**
   * 图片分区【分区级版式】（section_role='images'）：统一管本分区所有图片字段（图位）的版式——
   * 每个图片字段=一个图位，cols=每行几图位、尺寸、单数独占、独立框/粘连、标题模式（共用＝用分区标题作表内标题 / 每张＝各图位 label）。
   * 缺省(undefined)＝按旧逐字段属性渲染（向后兼容、零回退）；设了即走分区级模型（不再用逐字段 image_layout 宽松/紧凑）。
   */
  image_layout?: {
    title_mode?: 'shared' | 'per';
    cols?: number;
    width_cm?: number;
    height_cm?: number;
    solo?: 'first' | 'last';
    seamless?: boolean;
    header_follow?: boolean;
    /** 共用标题模式下的「表内共用标题」文字（title_mode='shared' 时用）。 */
    shared_title?: string;
    /** 分区级·表内标题样式（加粗/字体/字号/颜色）——取代逐图片字段的 label_style，共用标题与每张标题都用它。 */
    label_style?: StyleOverride;
    /** 分区级·标题与图的距离（如 '4pt'）。 */
    label_gap?: string;
    /** 图表【上方·左上角】的标签（类似说明，空＝无）。与「大标题」（分区 #section 标题）、「表内标题」都不同。 */
    top_label?: string;
    /** 上方标签样式。 */
    top_label_style?: StyleOverride;
    /** 上方标签与图的距离。 */
    top_label_gap?: string;
    /** 图表【下方】的备注（整分区一条，空＝无）。 */
    caption?: string;
    /** 下方备注样式。 */
    caption_style?: StyleOverride;
    /** 下方备注与图的距离。 */
    caption_gap?: string;
    /** 表内标题行高（标题单元格上下内边距，pt；缺省＝图片上下边距+6）。 */
    title_inset_y?: number;
    /** 图片左右边距（单元格 x 内边距，pt；缺省 6）。 */
    inset_x?: number;
    /** 图片上下边距（单元格 y 内边距，pt；缺省 6）。 */
    inset_y?: number;
  };
  /** PDF 渲染时不显示分组标题（仅用作组织字段，不出现 #section 标题文字） */
  hide_title?: boolean;
  /** 此分区前强制分页（PDF 渲染时插入 #pagebreak()） */
  page_break_before?: boolean;
  /**
   * 模块跨组数：本组的 vertical_align/vertical_offset/keep_together 把「本组 + 紧随其后的 (module_span-1) 组」
   * 当作一个整体（模块）来锚定/不拆页。缺省 1=只本组。例：签字模块=签字+签发+备注 → module_span:3。
   */
  module_span?: number;
  /** table 布局 + table_header='custom' 时的两列标题，如 ['信息项','内容']；缺省走无表头。 */
  columns?: string[];
  rows?: number;
  fields: FieldDefinition[];
}

export interface RecordTemplate {
  id?: number;
  name: string;
  test_project_id?: number; // @deprecated migration 015 已删该列，类型保留是为兼容旧 build artifact
  version: number;
  source_file?: string;
  groups: FieldGroup[];
  typst_source?: string;
  /** 见分步计划 V1：document_title 等为 PDF 大标题等元数据 */
  layout_options?: Record<string, any>;
}

export interface Formula {
  type: FormulaType;
  sources?: string[];
  params?: Record<string, any>;
  decimals?: number;
  expression?: string;
}

export type FormulaType =
  | 'average'
  | 'sum'
  | 'max'
  | 'min'
  | 'threshold'
  | 'range'
  | 'unit_convert'
  | 'percentage'
  | 'text_concat'
  | 'zh_en_map'
  | 'nd_sum'
  | 'multi_conclusion'
  | 'round_format'
  | 'custom';

// ─── 报告模板（v2：拆为首页 + 项目两类） ─────────────────────────────

// 'cover' = 首页（结论汇总页，历史命名保留）；'cover_page' = 真·封面（标题页，P3）；'project' = 项目报告
export type ReportTemplateKind = 'cover' | 'project' | 'cover_page';

export interface CoverMetaField {
  label: string;          // 显示的中文标签，如"报告编号"
  binding: CellBinding;   // 取值来源
}

export interface ResultTableColDef {
  id: string;
  label: string;
  width?: number;
}

export interface ResultTableCellDef {
  rowId: string;
  colId: string;
  binding: CellBinding;
  /**
   * 合并单元格：本格为合并主格时，向右跨 colspan 列、向下跨 rowspan 行（默认 1=不合并）。
   * 被覆盖的格子不单独存储，渲染/编辑时按行列序号从主格的 span 推算并跳过。
   * 跨度只在"数据网格(columns × rows)"内有效，不跨进汇总行/汇总列。
   */
  colspan?: number;
  rowspan?: number;
}

export interface ResultTableRowDef {
  id: string;
  label?: string;          // 行首列文字（如"密度"）；可选
  /** 是否作为该项目"结论"参与首页结论汇总表（每个项目模板里最多一行被标记） */
  is_conclusion?: boolean;
}

export type ReportBlock =
  | { id: string; kind: 'rich_text'; html: string }
  | { id: string; kind: 'cover_meta'; fields: CoverMetaField[] }
  | { id: string; kind: 'conclusion_table'; columns?: string[] }
  | { id: string; kind: 'sample_image_table'; columns: number; rows: number; image_field_codes?: string[] }
  | { id: string; kind: 'equipment_table' }
  | { id: string; kind: 'result_table'; columns: ResultTableColDef[]; rows: ResultTableRowDef[]; cells: ResultTableCellDef[] }
  | { id: string; kind: 'kv_list'; items: { label: string; binding: CellBinding }[] };

/**
 * 委托单【订单级】可绑定字段（来自外部接口 PushOrderInfos 1.1，存于 work_orders.payload.meta）。
 * 前 4 个为历史键（向后兼容），其余为接口扩展字段。详见《待实现内容.md》第 1 节字段映射表。
 */
export type OrderMetaKey =
  | 'order_no' | 'customer_name' | 'sample_name' | 'received_at'
  | 'company_address' | 'send_date' | 'time_required' | 'test_time_required'
  | 'report_deadline' | 'authorites' | 'authorites_address'
  | 'sale_name' | 'buyer' | 'status' | 'remark'
  // 检测周期（订单级派生）：跨全单材料分单 最早 StartDate ~ 最晚 EndDate。test_period=合成范围串；test_start/test_end=两端单值。
  | 'test_period' | 'test_start' | 'test_end';

/** 报告【样品信息】可绑定键——样品名称/样品编号(SampleSortNo)/零件号(Model)。
 *  概念上取自【报告编号接口 1.2】的报告样品（非委托单 1.1），首页单样品直接显示；多样品改用「样品信息表」字段。 */
export type ReportSampleKey = 'name' | 'sort_no' | 'model';

/** 委托单【样品级】可绑定字段（PushOrderInfos 1.1 样品属性）。 */
export type SampleMetaKey = 'sample_name' | 'barcode' | 'sort_no' | 'model';

/** 委托单【材料分单 / 测试项目级】可绑定字段（PushOrderInfos 1.1 TaskList 属性）。 */
export type TestMetaKey =
  | 'project_name' | 'standard' | 'main_engine_factory' | 'test_method'
  | 'test_condition' | 'sampling_mode' | 'sampling_requirement'
  | 'limit_name' | 'limit_content' | 'leader' | 'start_date' | 'end_date'
  | 'sample_description' | 'test_remark' | 'material_uploader' | 'remark';

/** 报告接口【页眉页脚 / 抬头字段】可绑定键（PushReportInfos 1.2 → ReportMeta）。
 *  让封面/首页正文能直接引用接口推送的公司/客户/备注/资质等（中英文按 Language 已在 buildReportMetaFromReq 选中）。 */
export type ReportMetaBindKey =
  | 'report_no' | 'cover_report_no' | 'verify_code' | 'issue_date'
  | 'company_name' | 'company_name_en'
  | 'company_address' | 'company_address2' | 'company_address_en' | 'company_address2_en'
  | 'fax' | 'fax_en' | 'phone' | 'phone_en' | 'website'
  | 'report_note' | 'report_note_en'
  | 'qualification_note' | 'qualification_note_en'
  | 'customer_name' | 'customer_address';

/** 报告内一个格子取值的统一描述 */
export type CellBinding =
  | { source: 'literal'; text: string }
  | { source: 'record_field'; field_code: string }
  | { source: 'record_cell'; matrix_code: string; sample_idx: number; param_code: string }
  | { source: 'record_summary'; matrix_code: string; row_id: string; param_code?: string }
  /** P-Map-10：样品带【当前样品】的某参数列值。仅用于 result_table 被标记为"样品带"的那一行/列里的单元格；
   *  渲染时由 expandResultTableBand 按实际样品逐个解析（读 flat `${matrix_code}__${sid}__${param_code}`）。
   *  裸调用（不在带内）resolveBinding 回退 '—'。 */
  | { source: 'record_cell_sample'; matrix_code: string; param_code: string }
  /** P-Map-10：样品带【当前样品】的样品名（取 record_raw_data[matrix_code].sample_labels[sid]，回退「{前缀} N」）。 */
  | { source: 'record_sample_label'; matrix_code: string }
  /** P-Map-10：样品带【当前样品】的自动序号（1,2,3… 按展开顺序）。用于「试样编号」列自动递增。 */
  | { source: 'record_sample_index'; matrix_code: string }
  /** P-Map-9：原始记录数据矩阵【表头】上录入时所选的备注/单位（存 DataMatrixValue.parameter_unit_overrides[param_code]）。
   *  用于让报告结果表的表头（单位、「客户要求/标准要求」等）跟随录入选择，而不是模板写死。
   *  无 override 时回退矩阵参数列的静态 unit；仍为空 ⇒ 返回 ''（表头渲染据此省略该括号备注）。 */
  | { source: 'record_header'; matrix_code: string; param_code: string }
  | { source: 'record_formula'; formula: Formula }
  | { source: 'record_meta'; key: 'tester_name' | 'tested_at' | 'reviewer_name' | 'reviewed_at' }
  | { source: 'order'; key: OrderMetaKey }
  /** 样品清单（报告范围，带编号）：把委托单全部样品拼成 "1#：名称、2#：名称…"。
   *  numbered 缺省 true（单样品自动不显编号）；layout='inline' 顿号一行 / 'lines' 每样品一行；separator 覆盖 inline 分隔符。 */
  | { source: 'order_samples'; numbered?: boolean; layout?: 'inline' | 'lines'; separator?: string }
  | { source: 'sample'; key: SampleMetaKey }
  | { source: 'test'; key: TestMetaKey }
  | { source: 'report_meta'; key: ReportMetaBindKey }
  | { source: 'report_sample'; key: ReportSampleKey; multi_text?: string }   // 报告样品（1.2）：样品名称/样品编号/零件号；单样品直显该样品值、多样品统一显示 multi_text（缺省「见后续页。」，详见首页样品信息表）
  | { source: 'system'; key: 'today' | 'now' };

/**
 * 项目报告模板的「检测结论声明」（6.7）。一条 = 检测结论表里一个结论框/一行。
 * 声明放在**项目报告模板**的 `layout_options.conclusions[]`；结论**值**生成时由 `binding`
 * 从关联原始记录解析（值本质是数据、只能来自原始记录）。子项目↔结论框一对一显式映射。
 * - `sub_name` 空＝项目级单结论（显示用 `layout_options.project_name`）；
 * - 多子项目＝多条，各带 `sub_name` + 指向原始记录该子项目判定值的 `binding`。
 * binding 来源限 record_*（record_field / record_cell / record_summary / record_formula）。
 */
export interface ProjectConclusionDecl {
  id: string;
  sub_name?: string;
  binding: CellBinding;
}

export interface ReportTemplate {
  id?: number;
  name: string;
  kind: ReportTemplateKind;
  version?: number;
  /** project 类型必填：关联的原始记录模板 */
  linked_record_template_id?: number;
  /** project 类型可选：关联的测试项目 code 列表 */
  test_project_codes?: string[];
  /** v3 模型：复用 RecordTemplate 的 groups 结构 */
  groups?: FieldGroup[];
  /** cover 用（旧版，仅兼容读取） */
  cover_blocks?: ReportBlock[];
  /** project 用（旧版，仅兼容读取） */
  project_blocks?: ReportBlock[];
  layout_options?: Record<string, any>;
}

// ─── 报告实例文档（P2：生成后冻结为自包含、可编辑的快照） ──────────────
//
// 生成时把"报告模板 + binding 解析结果"固化成本结构：groups 给结构、ctx 给
// 数据快照。之后报告与模板/record_data 解耦——文员编辑只改本结构（改值=把字段
// binding 改成 literal；增删字段/行=直接改 groups），重渲染复用同一渲染器，
// 永不回写 record_data。

/** ctx 即 typst-generator 的 ReportRenderCtx，这里宽松声明避免循环依赖 */
export type ReportRenderCtxSnapshot = Record<string, any>;

export interface ReportContentSection {
  /** 章节名（cover 模板名 / 项目模板名） */
  name: string;
  groups: FieldGroup[];
  layout_options?: Record<string, any>;
  /** 生成时冻结的渲染上下文快照（order / record_flat_data / record_meta / 设备 / 结论汇总 等） */
  ctx: ReportRenderCtxSnapshot;
}

export interface ReportContentDoc {
  /** 真·封面（标题页，P3，可选）。渲染在最前、其后 pagebreak；首页/项目仍由 cover 段的 #show 统管页眉页脚 */
  front_cover?: ReportContentSection;
  cover: ReportContentSection;
  projects: Array<ReportContentSection & { title: string; page_break: boolean; seq?: number }>;
}

/**
 * 报告页眉页脚"机构级元数据"——由外部系统按订单号生成回传（接口⑥/⑦ 见《待实现内容.md》第 6 节）。
 * 当前为 mock（services/external-report-meta.ts）。生成报告时注入首页主题 config 并快照进 content_doc。
 */
export interface ReportMeta {
  verify_code: string;       // 检验码
  report_no: string;         // 报告编号
  cover_report_no: string;   // 首页报告编号（首页与其余页可不同）
  issue_date: string;        // 签发日期 YYYY-MM-DD
  company_name: string;
  report_note: string;
  qualification_note: string; // 资质备注（CMA/CNAS 等）
  company_address: string;
  fax: string;
  phone: string;
  website?: string;          // 网址（页脚联系行末尾，如 www.grgtest.com）；缺省＝不显示
  // ─ 接口 1.2 PushReportInfos 扩展（可选，向后兼容 mock）─
  language?: string;             // 语种（中文/英文），决定页眉页脚用中/英文案
  company_name_en?: string;
  company_address2?: string;     // 公司地址2
  company_address_en?: string;
  company_address2_en?: string;
  fax_en?: string;
  phone_en?: string;
  report_note_en?: string;
  qualification_note_en?: string;
  customer_name?: string;        // 客户名称
  customer_address?: string;     // 客户地址
}

// ─── 报告取号单（接口 1.2 PushReportInfos）────────────────────────────────
// 文员在外部系统取号 → 外部推送每份报告的编号/检验码/页眉页脚/报告范围。
// 本系统按 样品名+项目名 回查 record_data/关联报告模板。见《待实现内容.md》第 6 节。

/** 匹配引擎为报告范围里一个"样品×项目"格子算出的一条关联 */
export interface ReportReqMatchAssignment {
  record_data_id: number;
  record_data_status?: string;        // record_data.audit_status
  record_template_id?: number;
  project_template_id?: number | null; // 反查的项目报告模板（null=需文员手选）
}
/** 报告范围里一个"样品×项目"格子的匹配结果 */
export interface ReportReqMatchEntry {
  sample_name: string;
  project_name: string;
  sample_external_id?: string | null;
  status: 'matched' | 'needs_record' | 'unmatched';
  note?: string;
  assignments: ReportReqMatchAssignment[];
}
export interface ReportRequisition {
  id: number;
  order_no: string;
  sys_number: string;
  report_number: string;
  check_code?: string | null;
  language?: string | null;
  sample_name?: string | null;
  issue_date?: string | null;
  header_footer?: Partial<ReportMeta> | null;
  scope?: { samples: any[] } | null;
  match_result?: ReportReqMatchEntry[] | null;
  report_id?: number | null;
  status: 'pending' | 'generated';
  stale?: boolean;
  /** 接口 1.4 回传状态：none=未回传 / sent=已回传递归智能 / failed=回传失败 */
  delivery_status?: 'none' | 'sent' | 'failed';
  delivered_at?: string | null;
  delivery_error?: string | null;
  /** 接口 1.3 外部审核状态（草稿/审核中/审核通过/审核不通过），仅展示 */
  record_state?: string | null;
  /** 接口 1.3 最近一次退回备注（Remark） */
  last_modify_remark?: string | null;
  /** 文员侧锁：该报告存在未关闭的 data_entry 返工工单（实验室数据退回中，待重审）。
   *  为 true 时文员不能重新生成 / 编辑 / 回传，须等数据重新审核通过自动解锁。 */
  data_rework_open?: boolean;
  created_at?: string;
  updated_at?: string;
}

/** 报告历史版本链中的一条（GET /api/reports/:id/versions）。 */
export interface ReportVersionEntry {
  id: number;
  report_no?: string | null;
  version: number;
  generated_at?: string | null;
  generated_by?: string | null;
  edited?: boolean;
  /** 是否为当前生效版本（链尾，superseded_by 为空） */
  is_current: boolean;
}

// ─── 退回 / 返工工单（P-Flow-1） ──────────────────────────────────────

/** 一条返工工单：在某阶段发现问题，退回某阶段，带原因，被处理，全程留痕。 */
export interface ReworkTicket {
  id?: number;
  order_no: string;
  scope: 'record' | 'report';
  record_data_id?: number | null;
  report_id?: number | null;
  origin_stage: 'report_gen' | 'data_review' | 'external';
  target_stage: 'data_entry' | 'report_gen';
  raised_by_name?: string | null;
  raised_by_role?: string | null;
  reason?: string | null;
  suggestion?: string | null;
  external_ref?: string | null;
  parent_ticket_id?: number | null;
  status: 'open' | 'in_progress' | 'resolved';
  resolved_by_name?: string | null;
  resolved_at?: string | null;
  resolution_note?: string | null;
  created_at?: string;
}

// ─── 模板版本管理（migration 022） ─────────────────────────────────

/**
 * 母子模板字段映射（fork 出的子模板的 base 行持有）。
 * 键 = 子模板侧 id，值 = 母模板侧 id。fork 时刻为恒等映射；
 * 之后母/子各自新增的字段不在映射内——同步永不触碰子模板自建字段。
 */
export interface TemplateFieldMapping {
  groups: Record<string, string>;
  fields: Record<string, string>;
}

/** 模板操作审计日志行（template_audit_log） */
export interface TemplateAuditEntry {
  id: number;
  version_id?: number | null;
  action:
    | 'create' | 'update_draft' | 'submit' | 'withdraw' | 'approve' | 'reject'
    | 'fork_out' | 'fork_in' | 'sync_out' | 'sync_in'
    | 'archive' | 'archive_request' | 'archive_request_cancel' | 'archive_reject'
    | 'restore' | 'rename' | 'controlled' | 'rollback';
  actor_name: string;
  actor_role?: string | null;
  detail?: Record<string, any> | null;
  created_at: string;
}

// ─── 设备库 ────────────────────────────────────────────────────────

export interface EquipmentRecord {
  id?: number;
  asset_code: string;
  name: string;
  model?: string;
  factory_serial?: string;
  cert_no?: string;
  trace_date?: string;
  expire_date?: string;
  status?: string;
  category?: string;
  department?: string;
  raw_payload?: Record<string, any>;
}
