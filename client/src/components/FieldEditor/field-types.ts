import type { FieldDefinition, MatrixSummaryRowDef, MatrixSummaryColDef, SectionRole } from '../../../../shared/types';

/**
 * 工程师可见的「字段类别」（6 类）。
 * 与底层 FieldDefinition.type 不是一一对应：
 *   - 「文本」统一了 text / textarea（靠 rows 区分）
 *   - 「选择」统一了 select / checkbox / variant_list
 *       * 多选 ↔ checkbox
 *       * 单选 ↔ select
 *       * 选项挂子字段 ↔ variant_list
 */
export type FieldCategory = 'text' | 'number' | 'date' | 'daterange' | 'choice' | 'image' | 'matrix' | 'free_grid' | 'device' | 'spacer' | 'static_content' | 'record_conclusion' | 'report_conclusion' | 'report_result' | 'report_equipment' | 'report_images' | 'report_photo_table' | 'report_sample_table' | 'report_sample_description_table';

/** free_grid 默认表：行表头＝「试样」+试样编号(1/2/3)，列表头＝参数1/2/3，数据格＝数字录入格。
 *  列宽：试样列 auto（窄，随内容）、参数列 1fr（等宽）；行高走标准表格内边距——与报告结果表一致。 */
function buildDefaultFreeTable(): NonNullable<FieldDefinition['free_table']> {
  const gc = ['c1', 'c2', 'c3', 'c4'], gr = ['r1', 'r2', 'r3', 'r4'];
  const header_cells: Record<string, true> = {}, input_cells: Record<string, true> = {};
  const cells: Record<string, string> = {}, cell_types: Record<string, 'text' | 'number' | 'choice'> = {};
  // 首行＝列表头：试样 | 参数1 | 参数2 | 参数3
  const colHeaders = ['试样', '参数1', '参数2', '参数3'];
  gc.forEach((c, ci) => { header_cells[`r1::${c}`] = true; cells[`r1::${c}`] = colHeaders[ci]; });
  // 首列（试样编号）：固定序号 1/2/3，且整列＝行表头（灰底，和「试样」角、新增行首列一致）；数据格＝数字录入格
  ['r2', 'r3', 'r4'].forEach((r, i) => {
    cells[`${r}::c1`] = String(i + 1);
    header_cells[`${r}::c1`] = true;
    ['c2', 'c3', 'c4'].forEach(c => { input_cells[`${r}::${c}`] = true; cell_types[`${r}::${c}`] = 'number'; });
  });
  const columns = [{ id: 'c1', label: '', width: 'auto' }, { id: 'c2', label: '' }, { id: 'c3', label: '' }, { id: 'c4', label: '' }];
  // 行高 5pt：与数据矩阵表（不设 cell_inset_y 时用 Typst 默认 5pt）一致，避免默认行高偏大
  return { columns, rows: gr.map(id => ({ id })), cells, header_cells, input_cells, cell_types, cell_inset_y: '5pt' };
}

/** 编辑器模式（与 FieldEditor/index.tsx 的 EditorMode 一致；此处独立声明以避免循环依赖）。 */
export type EditorMode = 'record' | 'report-cover' | 'report-project';

export interface FieldCategoryEntry {
  key: FieldCategory;
  label: string;
  icon: string;
  hint: string;
  /**
   * 该类别在哪些编辑器可插入（白名单）。缺省 = 三种编辑器都可插入。
   * 「什么编辑器就显示什么字段」：矩阵/设备只属原始记录；结论汇总表只属首页；
   * 结果表/设备表/图片表只属项目报告。
   */
  editors?: EditorMode[];
}

export const FIELD_CATEGORIES: FieldCategoryEntry[] = [
  { key: 'text',   label: '文本',       icon: 'A',  hint: '一行或多行文字（如服务编号、样品描述、备注）' },
  { key: 'number', label: '数字',       icon: '#',  hint: '数值（如温度、湿度）' },
  { key: 'date',   label: '日期',       icon: '📅', hint: '日期选择' },
  { key: 'daterange', label: '时间范围', icon: '📆', editors: ['report-cover', 'report-project'], hint: '【报告用】渲染「开始 ~ 结束」（如检测周期）。两端各可手填日期，或绑定字段（如委托单 检测开始/结束日期）' },
  { key: 'choice', label: '选择',       icon: '●',  hint: '单选 / 多选 / 可自定义；每个选项还能挂子字段' },
  { key: 'image',  label: '图片',       icon: '📷', editors: ['record', 'report-cover', 'report-project'], hint: '记录中用于录入图片；报告首页用于直接上传；项目报告中用于绑定原始记录图片分区' },
  { key: 'matrix', label: '旧版·数据表格', icon: '▦', editors: [], hint: '存量兼容类型；新模板统一使用自由表格' },
  { key: 'free_grid', label: '自由表格', icon: '⊞',  editors: ['record', 'report-project'], hint: '自定义行列和合并格；原始记录中设置录入格，项目报告中逐格绑定原始记录数据' },
  { key: 'device', label: '测试设备',   icon: '🔧', editors: ['record'], hint: '从设备库按管理编号查询；生成报告时自动展开为设备表' },
  { key: 'spacer', label: '间隔（空白）', icon: '↕',  hint: '纯版式的空白块，在字段/分区之间留白（封面排版常用）；可调高度，不产生数据' },
  { key: 'static_content', label: '说明 / 资料', icon: 'ⓘ', editors: ['record'], hint: '模板固定说明文字、图片或附件；录入时原位只读展示，不写入检测数据' },
  { key: 'record_conclusion', label: '旧版·项目结论', icon: '✅', editors: [], hint: '存量兼容类型；新模板请使用“结论”分区中的独立字段' },
  { key: 'report_conclusion', label: '报告·结论汇总表', icon: '📋', editors: ['report-cover'],   hint: '【报告首页用】检测结论汇总表，行 = 项目，自动展开' },
  { key: 'report_equipment',  label: '报告·设备表',     icon: '⚙️', editors: ['report-project'], hint: '【项目报告用】自动汇集原始记录中的设备引用 + 查设备库' },
  // 旧 report_image_gallery 仅为存量模板兼容；新项目统一使用 section_role='images' + image 字段，
  // 因此不再出现在新增字段菜单中（历史字段打开时仍可识别和迁移）。
  { key: 'report_images',     label: '旧版·报告图片表', icon: '🖼️', editors: [], hint: '存量兼容类型；新模板请使用“图片记录”分区中的图片字段' },
  { key: 'report_photo_table', label: '报告·原样照片表', icon: '🏷️', editors: ['report-cover'], hint: '【报告首页用】文员直接上传的原样照片表：加粗标签+说明行 + 带表头图片表（如"样品描述：见原始样品照片。" + "原始样品"）' },
  { key: 'report_sample_description_table', label: '报告·样品描述表', icon: '▤', editors: ['report-cover'], hint: '【报告首页用】两列显示“唯一性编号 / 样品描述”，默认描述为“见原始样品照片”，生成报告后可自由修改；建议放在原样照片前。' },
  { key: 'report_sample_table', label: '报告·样品信息表', icon: '🧾', editors: ['report-cover'], hint: '【报告首页用】自动从委托单样品列出 样品编号/样品名称/零件号，放在检测结论表之前。系统按实际样品数自动切换：多样品出表、单样品自动折叠（由首页「样品名称/零件号」字段直接显示）。一套模板通吃单/多样品' },
];

/** 当前编辑器可插入的字段类别（按 editors 白名单过滤；缺省的类别三处都可见）。 */
export function categoriesForEditor(editorMode: EditorMode): FieldCategoryEntry[] {
  const categories = FIELD_CATEGORIES.filter(c => !c.editors || c.editors.includes(editorMode));
  if (editorMode !== 'report-cover') return categories;
  const descriptions: Record<string, [string, string]> = {
    text: ['文字', '输入固定文字，或设置自动填入的数据来源。'],
    spacer: ['空行', '设置留白高度。'],
    report_conclusion: ['检测结论表', '自动汇总本报告各检测项目的结论。'],
    report_photo_table: ['原样照片表', '带表头和说明的样品照片表。'],
    report_sample_description_table: ['样品描述表', '按样品列出唯一性编号和描述。'],
    report_sample_table: ['样品信息表', '自动列出样品名称、编号及零件号；单样品时按原规则隐藏。'],
    image: ['样品照片', '生成报告时上传照片，可添加多张。'],
    daterange: ['日期范围', '设置开始和结束日期，支持自动取值。'],
  };
  return categories.map(category => descriptions[category.key] ? { ...category, label: descriptions[category.key][0], hint: descriptions[category.key][1] } : category);
}

/**
 * 分区内可新增的字段：
 * - 图片字段只能放在图片分区，确保整组版式、动态集合和报告拉取逻辑始终生效；
 * - 图片分区仍允许文字说明和空白间隔；
 * - 非图片分区不再出现“图片”，避免产生无法按整组渲染的孤立图位。
 */
export function categoriesForGroup(editorMode: EditorMode, sectionRole?: SectionRole): FieldCategoryEntry[] {
  const categories = categoriesForEditor(editorMode);
  if (sectionRole === 'images') {
    if (editorMode === 'report-project') return categories.filter(category => ['text', 'spacer'].includes(category.key));
    if (editorMode === 'report-cover') {
      const order: FieldCategory[] = ['image', 'text', 'report_sample_description_table', 'report_photo_table', 'spacer'];
      return order.flatMap(key => categories.filter(category => category.key === key));
    }
    // 报告首页的样品描述表需要与原样照片放在同一分区，并允许拖到照片前；
    // 原始记录/项目模板中该类别本身不在白名单，因此不会误出现在其它编辑器。
    return categories.filter(category => ['image', 'text', 'spacer', 'report_sample_description_table'].includes(category.key));
  }
  return categories.filter(category => category.key !== 'image');
}

/**
 * 编辑器能力开关：把"原始记录 / 首页 / 项目"三种模式的差异**集中**成一张能力表，
 * 替代散落在各组件里的 `editorMode === 'record'` 判断。加第四种编辑器或调整某项归属时只改这里。
 * 设计原则：这些差异都是"录入模板 vs 报告映射/版面"的**语义**差异，不是缺功能（编辑核心三者共用）。
 */
export interface EditorCapabilities {
  /** 「标题与副标题」文字+样式面板——仅原始记录（报告标题属封面/首页，不在此配） */
  titlePanel: boolean;
  /** 文档样式「只渲染字段（不出自动标题/副标题）」开关——原始记录 + 首页（项目段本就无正文大标题） */
  autoTitleToggle: boolean;
  /** 字段值＝取值绑定（手填/抓取接口字段）而非录入默认值——报告（首页/项目） */
  valueBinding: boolean;
  /** per-project 取值来源需关联原始记录上下文（矩阵单元/汇总等）——仅项目报告 */
  linkedRecordBinding: boolean;
}

export function editorCapabilities(mode: EditorMode): EditorCapabilities {
  const isReport = mode === 'report-cover' || mode === 'report-project';
  return {
    titlePanel: mode === 'record',
    autoTitleToggle: mode !== 'report-project',
    valueBinding: isReport,
    linkedRecordBinding: mode === 'report-project',
  };
}

/** 把底层 type 映射到可见类别（用于渲染 Tag / 打开属性面板时定位）。 */
export function categoryOfField(f: FieldDefinition): FieldCategory {
  switch (f.type) {
    case 'text':
    case 'textarea':
      return 'text';
    case 'number':
      return 'number';
    case 'date':
      return 'date';
    case 'select':
    case 'checkbox':
    case 'variant_list':
      return 'choice';
    case 'image':
      return 'image';
    case 'daterange':
      return 'daterange';
    case 'data_matrix':
      return 'matrix';
    case 'free_grid':
      return 'free_grid';
    case 'computed':
    case 'reference':
      return 'text';
    case 'device_ref':
      return 'device';
    case 'spacer':
      return 'spacer';
    case 'static_content':
      return 'static_content';
    case 'record_conclusion':
      return 'record_conclusion';
    case 'report_conclusion_table':
      return 'report_conclusion';
    case 'report_result_table':
      return 'report_result';
    case 'report_equipment_table':
      return 'report_equipment';
    case 'report_image_gallery':
      return 'report_images';
    case 'report_photo_table':
      return 'report_photo_table';
    case 'report_sample_table':
      return 'report_sample_table';
    case 'report_sample_description_table':
      return 'report_sample_description_table';
    default:
      return 'text';
  }
}

export function getCategoryLabel(cat: FieldCategory): string {
  if (cat === 'report_result') return '检测结果表（旧版）';
  return FIELD_CATEGORIES.find(c => c.key === cat)?.label ?? cat;
}

const DEFAULT_MATRIX = {
  // P-Map-13：新建试验数据表的默认骨架——试样 1/2/3 在行（表头只标数字）、参数在列、
  // 一个「平均值」汇总列（手填数字；需要计算时由用户自行配置公式）、一个「备注」汇总行（手填文本）。
  // 不预置自动聚合——所有计算都由用户手动配置公式。之后均可任意修改。sample_axis 缺省 'row'（试样为行）。
  sample_axis: 'row' as const,
  default_sample_count: 3,
  default_sample_labels: ['1', '2', '3'],
  parameters: [
    { id: 'p1', code: 'col_1', label: '参数1' },
    { id: 'p2', code: 'col_2', label: '参数2' },
  ],
  cell_type: 'number' as const,
  allow_add_remove_samples: true,
  allow_add_remove_parameters: false,
  summary_cols: [
    { id: 'avg', label: '平均值', source_type: 'input_number', placeholder: '请输入' },
  ] as MatrixSummaryColDef[],
  summary_rows: [
    { id: 'note', label: '备注', source_type: 'input_text', placeholder: '请输入' },
  ] as MatrixSummaryRowDef[],
};

/**
 * 从一个 FieldCategory 创建初始字段对象（由「添加字段」下拉调用）。
 */
export function createFieldForCategory(cat: FieldCategory, idSeed: string): FieldDefinition {
  const base: FieldDefinition = {
    id: idSeed,
    code: `field_${idSeed.replace(/^\D+/, '') || Date.now()}`,
    label: '新字段',
    type: 'text',
  };
  switch (cat) {
    case 'text':
      return { ...base, type: 'text' };
    case 'number':
      return { ...base, type: 'number' };
    case 'date':
      return { ...base, type: 'date' };
    case 'daterange':
      return { ...base, type: 'daterange', label: '检测周期', date_range: { separator: ' ~ ' } };
    case 'choice':
      return { ...base, type: 'select', options: ['选项1', '选项2'], allow_custom: true };
    case 'image':
      return { ...base, type: 'image' };
    case 'device':
      return { ...base, type: 'device_ref', label: '测试设备', description: '从设备库按管理编号 / 仪器名称搜索',
        device_ref_config: { preset_asset_codes: [], selection_mode: 'multiple', allow_library_search: true } };
    case 'spacer':
      return { ...base, type: 'spacer', label: '间隔', hide_label: true, spacer_height: '1cm' };
    case 'static_content':
      return { ...base, type: 'static_content', label: '说明 / 资料', hide_label: true, static_kind: 'text', static_text: '请在此填写操作说明。', static_display: 'both' };
    case 'record_conclusion':
      return {
        ...base,
        code: `report_conclusion_${idSeed.replace(/^\D+/, '') || Date.now()}`,
        type: 'record_conclusion',
        label: '报告结论',
        required: true,
        record_conclusion: {
          mode: 'overall',
          project_name: '检测项目',
          allow_project_name_override: true,
          items: [{
            id: `conclusion_${idSeed}`,
            code: 'overall',
            name_mode: 'inherit_project',
            judgment_options: ['标准要求', '客户要求'],
            conclusion_options: ['符合', '不符合'],
            judgment_required: true,
            conclusion_required: true,
            default_report_enabled: true,
          }],
        },
      };
    case 'report_conclusion':
      // 首页标题使用独立文字字段；新增表格默认不重复显示标题。
      return { ...base, type: 'report_conclusion_table', label: '检测结论表', hide_label: true,
        conclusion_table: { columns: ['index', 'project', 'result'] } };
    case 'report_result':
      return { ...base, type: 'report_result_table', label: '检测结果',
        result_table: {
          // 不使用试样带时：最左「试样编号」行头列（每行行头默认 1/2/3，可编辑）+ 数据列；默认 3 行
          columns: [
            { id: 'col_sn', label: '试样编号', row_header: true },
            { id: 'col_item', label: '项目' },
            { id: 'col_standard', label: '标准要求' },
            { id: 'col_result', label: '测试结果' },
            { id: 'col_conclusion', label: '结论' },
          ],
          rows: [
            { id: 'r1', label: '1' },
            { id: 'r2', label: '2' },
            { id: 'r3', label: '3' },
          ],
          cells: [],
        } };
    case 'report_equipment':
      return { ...base, type: 'report_equipment_table', label: '设备信息',
        equipment_table: { columns: ['name', 'model', 'asset_code', 'trace_date', 'expire_date'] } };
    case 'report_images':
      return { ...base, type: 'report_image_gallery', label: '图片记录', image_gallery: {} };
    case 'report_photo_table':
      return { ...base, type: 'report_photo_table', label: '原样照片表', hide_label: true,
        photo_table: { caption_label: '', caption_text: '', header: '原始样品', cols: 1 } };
    case 'report_sample_table':
      return { ...base, type: 'report_sample_table', label: '样品信息表', hide_label: true,
        sample_table: { columns: ['index', 'name', 'model'] } };
    case 'report_sample_description_table':
      return { ...base, type: 'report_sample_description_table', label: '样品描述表', hide_label: true,
        sample_description_table: {
          unique_label: '唯一性编号', description_label: '样品描述',
          default_description: '见原始样品照片', unique_width: '1fr', description_width: '3.5fr',
        } };
    case 'free_grid':
      return { ...base, type: 'free_grid', label: '原始记录表格', free_table: buildDefaultFreeTable() };
    case 'matrix':
      return {
        ...base,
        label: '试验数据表',
        code: `matrix_${idSeed.replace(/^\D+/, '') || Date.now()}`,
        type: 'data_matrix',
        matrix: {
          ...DEFAULT_MATRIX,
          default_sample_labels: [...DEFAULT_MATRIX.default_sample_labels],
          parameters: DEFAULT_MATRIX.parameters.map(p => ({ ...p })),
          summary_cols: DEFAULT_MATRIX.summary_cols.map(c => ({ ...c })),
          summary_rows: DEFAULT_MATRIX.summary_rows.map(r => ({ ...r })),
        },
      };
  }
}

/**
 * 切换字段类别时生成完整字段对象（去除与新类别无关的属性，避免脏数据）。
 *
 * 对「选择」类别特殊处理：仅在原字段本身也是选择类别时保留选项配置；
 * 从文字/数字等其它类别切回选择时必须使用全新配置，不能让旧选项“复活”。
 * 并接受 subOption 参数进一步细化为 select / checkbox / variant_list 其中一种。
 */
export function rebuildFieldForCategory(
  field: FieldDefinition,
  cat: FieldCategory,
  subOption?: 'single' | 'multi' | 'with_subfields',
): FieldDefinition {
  const next = rebuildFieldForCategoryInner(field, cat, subOption);
  // 底层 type 变了就清默认值——类型不匹配的默认值（如文本默认值挂在选择字段上）会在录入端产生脏数据
  if (next.type !== field.type) next.default_value = undefined;
  return next;
}

function rebuildFieldForCategoryInner(
  field: FieldDefinition,
  cat: FieldCategory,
  subOption?: 'single' | 'multi' | 'with_subfields',
): FieldDefinition {
  const id = field.id;
  const label = field.label || '新字段';
  const code = field.code || 'field';
  const common = {
    id,
    code,
    label,
    required: field.required,
    description: field.description,
    default_value: field.default_value,
    semantic_role: field.semantic_role,
    conclusion_role: field.conclusion_role,
  };

  switch (cat) {
    case 'text':
      return { ...common, type: 'text', unit: field.unit };
    case 'number':
      return { ...common, type: 'number', unit: field.unit };
    case 'date':
      return { ...common, type: 'date', date_precision: field.date_precision, date_separator: field.date_separator };
    case 'choice': {
      const wasChoice = categoryOfField(field) === 'choice';
      const prevOpts = wasChoice && field.options?.length ? [...field.options] : ['选项1'];
      const prevVariants = wasChoice && field.type === 'variant_list' && field.variants?.length ? field.variants : [];
      // 选择字段统一默认允许“其他（自定义）”；只有用户明确关闭并保存 false 时才禁用。
      const allow_custom = wasChoice ? (field.allow_custom ?? true) : true;
      if (subOption === 'multi') {
        return { ...common, type: 'checkbox', options: prevOpts, allow_custom, choice_display: field.choice_display };
      }
      if (subOption === 'with_subfields') {
        return {
          ...common,
          type: 'variant_list',
          variants: prevVariants.length ? prevVariants : [],
        };
      }
      return { ...common, type: 'select', options: prevOpts, allow_custom, choice_display: field.choice_display };
    }
    case 'image':
      return { ...common, type: 'image' };
    case 'daterange':
      return { ...common, type: 'daterange', date_precision: field.date_precision, date_separator: field.date_separator, date_range: field.date_range || { separator: ' ~ ' } };
    case 'device':
      return { ...common, type: 'device_ref',
        device_ref_config: field.type === 'device_ref'
          ? (field.device_ref_config || { preset_asset_codes: [], selection_mode: 'multiple', allow_library_search: true })
          : { preset_asset_codes: [], selection_mode: 'multiple', allow_library_search: true } };
    case 'spacer':
      return { ...common, type: 'spacer', hide_label: true, spacer_height: field.spacer_height || '1cm' };
    case 'static_content':
      return {
        ...common, type: 'static_content', hide_label: true,
        static_kind: (field.static_kind as any) === 'attachments' ? 'table' : (field.static_kind || (field.static_content?.some(block => block.kind === 'image') ? 'images' : field.static_content?.some(block => (block as any).kind === 'attachment') ? 'table' : 'text')),
        static_text: field.static_text ?? field.static_content?.filter(block => block.kind === 'text').map(block => block.text || '').join('\n'),
        static_images: field.static_images || field.static_content?.filter(block => block.kind === 'image').map(({ id, name, url, rel_path, mime_type, size_bytes }) => ({ id, name, url, rel_path, mime_type, size_bytes })),
        static_table: field.static_table,
        static_display: field.static_display || 'both',
      };
    case 'record_conclusion':
      return {
        ...common,
        type: 'record_conclusion',
        label: label === '新字段' ? '报告结论' : label,
        required: field.required ?? true,
        record_conclusion: field.record_conclusion || {
          mode: 'overall', project_name: '检测项目', allow_project_name_override: true,
          items: [{ id: `conclusion_${Date.now()}`, code: 'overall', name_mode: 'inherit_project',
            judgment_options: ['标准要求', '客户要求'], conclusion_options: ['符合', '不符合'], judgment_required: true, conclusion_required: true, default_report_enabled: true }],
        },
      };
    case 'report_conclusion':
      return { ...common, type: 'report_conclusion_table',
        conclusion_table: field.conclusion_table || { columns: ['index', 'project', 'result'] } };
    case 'report_result':
      return { ...common, type: 'report_result_table',
        result_table: field.result_table || {
          // 不使用试样带：最左「试样编号」行头列（行头默认 1/2/3，可编辑）+ 数据列；默认 3 行
          columns: [
            { id: 'col_sn', label: '试样编号', row_header: true },
            { id: 'col_item', label: '项目' },
            { id: 'col_standard', label: '标准要求' },
            { id: 'col_result', label: '测试结果' },
            { id: 'col_conclusion', label: '结论' },
          ],
          rows: [
            { id: 'r1', label: '1' },
            { id: 'r2', label: '2' },
            { id: 'r3', label: '3' },
          ],
          cells: [],
        } };
    case 'report_equipment':
      return { ...common, type: 'report_equipment_table',
        equipment_table: field.equipment_table || { columns: ['name', 'model', 'asset_code', 'trace_date', 'expire_date'] } };
    case 'report_images':
      return { ...common, type: 'report_image_gallery', image_gallery: field.image_gallery || {} };
    case 'report_photo_table':
      return { ...common, type: 'report_photo_table', hide_label: true,
        photo_table: field.photo_table || { caption_label: '样品描述', caption_text: '见原始样品照片。', header: '原始样品', cols: 1 } };
    case 'report_sample_table':
      return { ...common, type: 'report_sample_table', hide_label: true,
        sample_table: field.sample_table || { columns: ['index', 'name', 'model'] } };
    case 'report_sample_description_table':
      return { ...common, type: 'report_sample_description_table',
        sample_description_table: field.sample_description_table || {
          unique_label: '唯一性编号', description_label: '样品描述', default_description: '见原始样品照片',
          unique_width: '1fr', description_width: '3.5fr',
        } };
    case 'matrix': {
      const nextCode = field.type === 'data_matrix' && field.matrix
        ? code
        : `matrix_${String(id).replace(/^f/, '') || Date.now()}`;
      return {
        ...common,
        type: 'data_matrix',
        label: label === '新字段' ? '试验数据表' : label,
        code: nextCode,
        matrix: field.type === 'data_matrix' && field.matrix
          ? {
              ...field.matrix,
              parameters: field.matrix.parameters.map(p => ({ ...p })),
              summary_rows: field.matrix.summary_rows?.map(r => ({ ...r })) ?? [],
            }
          : {
              ...DEFAULT_MATRIX,
              default_sample_labels: [...DEFAULT_MATRIX.default_sample_labels],
              parameters: DEFAULT_MATRIX.parameters.map(p => ({ ...p })),
              summary_cols: DEFAULT_MATRIX.summary_cols.map(c => ({ ...c })),
              summary_rows: DEFAULT_MATRIX.summary_rows.map(r => ({ ...r })),
            },
      };
    }
    case 'free_grid': {
      if (field.free_table) return { ...common, type: 'free_grid', label: label === '新字段' ? '原始记录表格' : label, free_table: field.free_table };
      return { ...common, type: 'free_grid', label: label === '新字段' ? '原始记录表格' : label, free_table: buildDefaultFreeTable() };
    }
  }
}

/** 「选择」子模式：单选 / 多选 / 挂子字段 */
export type ChoiceMode = 'single' | 'multi' | 'with_subfields';

export function choiceModeOf(field: FieldDefinition): ChoiceMode {
  if (field.type === 'checkbox') return 'multi';
  if (field.type === 'variant_list') return 'with_subfields';
  return 'single';
}
