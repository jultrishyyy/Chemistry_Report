import type { FieldDefinition, MatrixSummaryRowDef, MatrixSummaryColDef } from '../../../../shared/types';

/**
 * 工程师可见的「字段类别」（6 类）。
 * 与底层 FieldDefinition.type 不是一一对应：
 *   - 「文本」统一了 text / textarea（靠 rows 区分）
 *   - 「选择」统一了 select / checkbox / variant_list
 *       * 多选 ↔ checkbox
 *       * 单选 ↔ select
 *       * 选项挂子字段 ↔ variant_list
 */
export type FieldCategory = 'text' | 'number' | 'date' | 'daterange' | 'choice' | 'image' | 'matrix' | 'device' | 'spacer' | 'report_conclusion' | 'report_result' | 'report_equipment' | 'report_images' | 'report_photo_table' | 'report_sample_table';

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
  { key: 'image',  label: '图片',       icon: '📷', editors: ['record', 'report-cover'], hint: '上传图片（原始记录样品照片 / 首页录入的样品照片）' },
  { key: 'matrix', label: '数据表格',   icon: '▦',  editors: ['record'], hint: '样品×参数 的试验数据表，可配平均/最大等汇总行' },
  { key: 'device', label: '测试设备',   icon: '🔧', editors: ['record'], hint: '从设备库按管理编号查询；生成报告时自动展开为设备表' },
  { key: 'spacer', label: '间隔（空白）', icon: '↕',  hint: '纯版式的空白块，在字段/分区之间留白（封面排版常用）；可调高度，不产生数据' },
  { key: 'report_conclusion', label: '报告·结论汇总表', icon: '📋', editors: ['report-cover'],   hint: '【报告首页用】检测结论汇总表，行 = 项目，自动展开' },
  { key: 'report_result',     label: '报告·检测结果表', icon: '🧪', editors: ['report-project'], hint: '【项目报告用】画布式表格，每格绑定到原始记录的字段/矩阵单元/汇总' },
  { key: 'report_equipment',  label: '报告·设备表',     icon: '⚙️', editors: ['report-project'], hint: '【项目报告用】自动汇集原始记录中的设备引用 + 查设备库' },
  { key: 'report_images',     label: '报告·图片表',     icon: '🖼️', editors: ['report-project'], hint: '【项目报告用】抓原始记录 image 字段，按"检测前/中/后"布局' },
  { key: 'report_photo_table', label: '报告·原样照片表', icon: '🏷️', editors: ['report-cover'], hint: '【报告首页用】文员直接上传的原样照片表：加粗标签+说明行 + 带表头图片表（如"样品描述：见原始样品照片。" + "原始样品"）' },
  { key: 'report_sample_table', label: '报告·样品信息表', icon: '🧾', editors: ['report-cover'], hint: '【报告首页用】自动从委托单样品列出 样品编号/样品名称/零件号，放在检测结论表之前。系统按实际样品数自动切换：多样品出表、单样品自动折叠（由首页「样品名称/零件号」字段直接显示）。一套模板通吃单/多样品' },
];

/** 当前编辑器可插入的字段类别（按 editors 白名单过滤；缺省的类别三处都可见）。 */
export function categoriesForEditor(editorMode: EditorMode): FieldCategoryEntry[] {
  return FIELD_CATEGORIES.filter(c => !c.editors || c.editors.includes(editorMode));
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
    case 'computed':
    case 'reference':
      return 'text';
    case 'device_ref':
      return 'device';
    case 'spacer':
      return 'spacer';
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
    default:
      return 'text';
  }
}

export function getCategoryLabel(cat: FieldCategory): string {
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
      return { ...base, type: 'select', options: ['选项1', '选项2'], allow_custom: false };
    case 'image':
      return { ...base, type: 'image' };
    case 'device':
      return { ...base, type: 'device_ref', label: '测试设备', description: '从设备库按管理编号 / 仪器名称搜索' };
    case 'spacer':
      return { ...base, type: 'spacer', label: '间隔', hide_label: true, spacer_height: '1cm' };
    case 'report_conclusion':
      // hide_label:false → 默认显示标题＝字段 label（居左、跟随模板字体，走标准 figure/wrapFigure）。
      return { ...base, type: 'report_conclusion_table', label: '检测结论', hide_label: false,
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
        photo_table: { caption_label: '样品描述', caption_text: '见原始样品照片。', header: '原始样品', cols: 1 } };
    case 'report_sample_table':
      return { ...base, type: 'report_sample_table', label: '样品信息表', hide_label: true,
        sample_table: { columns: ['index', 'name', 'model'] } };
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
 * 对「选择」类别特殊处理：保留 options / allow_custom / variants；
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
  };

  switch (cat) {
    case 'text':
      return { ...common, type: 'text', unit: field.unit };
    case 'number':
      return { ...common, type: 'number', unit: field.unit };
    case 'date':
      return { ...common, type: 'date' };
    case 'choice': {
      const prevOpts = field.options?.length ? [...field.options] : ['选项1'];
      const prevVariants = field.type === 'variant_list' && field.variants?.length ? field.variants : [];
      const allow_custom = field.allow_custom ?? false;
      if (subOption === 'multi') {
        return { ...common, type: 'checkbox', options: prevOpts, allow_custom };
      }
      if (subOption === 'with_subfields') {
        return {
          ...common,
          type: 'variant_list',
          variants: prevVariants.length ? prevVariants : [],
        };
      }
      return { ...common, type: 'select', options: prevOpts, allow_custom };
    }
    case 'image':
      return { ...common, type: 'image' };
    case 'daterange':
      return { ...common, type: 'daterange', date_range: field.date_range || { separator: ' ~ ' } };
    case 'device':
      return { ...common, type: 'device_ref' };
    case 'spacer':
      return { ...common, type: 'spacer', hide_label: true, spacer_height: field.spacer_height || '1cm' };
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
  }
}

/** 「选择」子模式：单选 / 多选 / 挂子字段 */
export type ChoiceMode = 'single' | 'multi' | 'with_subfields';

export function choiceModeOf(field: FieldDefinition): ChoiceMode {
  if (field.type === 'checkbox') return 'multi';
  if (field.type === 'variant_list') return 'with_subfields';
  return 'single';
}
