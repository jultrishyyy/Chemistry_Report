import type { FieldGroup, FieldDefinition, SectionRole } from '../../../../shared/types';
import type { EditorMode } from './field-types';
import { judgmentChoiceDefaults } from '../../../../shared/conclusion-judgment-default';

/**
 * 签字栏 / 签发分区：含「签名行」字段（编制/审核/批准）。该分区版面按参考样张固化、
 * 内容（签发日期/备注）由接口取号自动填，故在各编辑器里**置灰只读**——不可改字段/值/排版，
 * 只允许整段【删除】或在别处【添加】分区。判定信号＝分区内有 signature_line 字段。
 */
export function isSignatureGroup(g: { fields?: { signature_line?: boolean }[] }): boolean {
  return (g.fields || []).some(f => !!f.signature_line);
}

export interface SectionPreset {
  key: string;
  label: string;
  icon: string;
  hint: string;
  /**
   * 该预设在哪些编辑器可见（白名单）。缺省 = 三种编辑器都显示。
   * 「什么编辑器就显示什么分区」：试验数据表/溯源信息只属原始记录；
   * 结论汇总/签字栏/样品照片只属首页；检测结果表/设备表/项目图片/说明只属项目报告。
   */
  editors?: EditorMode[];
  build: (id: () => string) => FieldGroup;
}

/**
 * 「分区预设」：基本信息 / 试验结果 / 图片记录 / 结论 / 溯源信息（通用）+ 签字栏（仅报告）。
 * 「添加分区」下拉直接调用 build()，工程师选预设即得带 section_role 和典型字段骨架的分区。
 *
 * 溯源信息预设的主检/审核/日期字段已**固化 semantic_role**（系统自动注入），
 * 不再需要在字段编辑里手选「自动填充来源」。
 * 签字栏预设（report 模式）= 编制/审核/批准签名行 + 签发日期(右对齐,接口取号) + 报告备注/资质备注(6pt)，
 * 钉在页面底部；空行间距按参考样张「3.1 报告首页」实测（编制↔签发 5em、签发↔备注 3em）。
 */
const coverHeading = (id: () => string, code: string, text: string): FieldDefinition => ({
  id: id(), code, type: 'text', label: text, hide_label: true,
  binding: { source: 'literal', text }, style: { font: 'FangSong', size: '10pt', weight: 'regular' },
});

export function sectionPresetsForEditor(mode: EditorMode): SectionPreset[] {
  const presets = SECTION_PRESETS.filter(preset => !preset.editors || preset.editors.includes(mode));
  if (mode !== 'report-cover') return presets;
  const order = ['basic', 'signature_block', 'cover_sample_table', 'cover_conclusion', 'cover_sample_photos'];
  return order.flatMap(key => presets.filter(preset => preset.key === key));
}

export const SECTION_PRESETS: SectionPreset[] = [
  {
    key: 'basic',
    label: '基本信息',
    icon: '📋',
    hint: '服务编号、样品编号、样品描述、检测方法、预处理等',
    editors: ['record', 'report-cover'],
    build: (id) => ({
      id: id(),
      label: '基本信息',
      layout: 'vertical',
      section_role: 'basic' as SectionRole,
      fields: [
        { id: id(), code: 'service_no', label: '服务编号', type: 'text', required: true },
        { id: id(), code: 'sample_no', label: '样品编号', type: 'text', required: true },
        { id: id(), code: 'sample_desc', label: '样品描述', type: 'text' },
      ],
    }),
  },
  {
    key: 'results',
    label: '试验结果',
    icon: '🧪',
    hint: '可自由设计行列、录入格和 Excel 式公式',
    editors: ['record'],
    build: (id) => ({
      id: id(),
      label: '试验结果',
      layout: 'vertical',
      section_role: 'results' as SectionRole,
      fields: [
        {
          id: id(),
          code: 'result_table',
          label: '试验数据表',
          type: 'free_grid',
          free_table: {
            columns: [{ id: 'c1', label: '', width: 'auto' }, { id: 'c2', label: '' }],
            rows: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }, { id: 'r4' }],
            cells: {
              'r1::c1': '试样', 'r1::c2': '参数1',
              'r2::c1': '1', 'r3::c1': '2', 'r4::c1': '3',
            },
            header_cells: {
              'r1::c1': true, 'r1::c2': true,
              'r2::c1': true, 'r3::c1': true, 'r4::c1': true,
            },
            input_cells: { 'r2::c2': true, 'r3::c2': true, 'r4::c2': true },
            cell_types: { 'r2::c2': 'number', 'r3::c2': 'number', 'r4::c2': 'number' },
            cell_inset_y: '5pt',
          },
        },
      ],
    }),
  },
  {
    key: 'images',
    label: '图片记录',
    icon: '📷',
    hint: '每张图一个图位；版式在图片设置中调整，说明或备注请添加文本字段',
    editors: ['record'],
    build: (id) => ({
      id: id(),
      label: '图片记录',
      layout: 'vertical',
      section_role: 'images' as SectionRole,
      image_layout: { cols: 2, title_mode: 'per' as const, solo: 'first' as const, width_cm: 7, height_cm: 6 },
      fields: [
        { id: id(), code: 'photos_before', label: '检测前', type: 'image' },
        { id: id(), code: 'photos_during', label: '检测中', type: 'image' },
        { id: id(), code: 'photos_after',  label: '检测后', type: 'image' },
      ] as FieldDefinition[],
    }),
  },
  {
    key: 'conclusion',
    label: '结论',
    icon: '✅',
    hint: '名称、判定要求、限值、结论四个独立字段；可继续添加子项目',
    editors: ['record'],
    build: (id) => ({
      id: id(),
      label: '结论',
      layout: 'vertical',
      section_role: 'conclusion' as SectionRole,
      conclusion_kind: 'project',
      fields: [
        { id: id(), code: 'conclusion_project_name', label: '项目名称', type: 'text', required: true, conclusion_role: 'project_name' },
        { id: id(), code: 'conclusion_judgment', label: '判定要求', ...judgmentChoiceDefaults, required: true, conclusion_role: 'judgment_requirement' },
        { id: id(), code: 'conclusion_limit', label: '限值', type: 'text', conclusion_role: 'limit' },
        { id: id(), code: 'conclusion_result', label: '结论', type: 'select', required: true,
          options: ['符合', '不符合'], allow_custom: true, conclusion_role: 'conclusion' },
      ] as FieldDefinition[],
    }),
  },
  {
    key: 'signoff',
    label: '溯源信息',
    icon: '✍️',
    hint: '主检 / 检测日期 / 审核 / 审核日期（系统自动填充，无需手动配置来源）',
    editors: ['record'],
    build: (id) => ({
      id: id(),
      label: '溯源信息',
      layout: 'two-col',
      section_role: 'signoff' as SectionRole,
      // semantic_role 已固化：录入时由系统自动注入（主检=登录用户 / 检测日期=提交时间 / 审核=审核员 / 审核日期=审核时间）
      fields: [
        { id: id(), code: 'inspector',      label: '主检',     type: 'text', semantic_role: 'inspector' },
        { id: id(), code: 'inspector_date', label: '检测日期', type: 'date', semantic_role: 'inspector_date' },
        { id: id(), code: 'reviewer',       label: '审核',     type: 'text', semantic_role: 'reviewer' },
        { id: id(), code: 'reviewer_date',  label: '审核日期', type: 'date', semantic_role: 'reviewer_date' },
      ] as FieldDefinition[],
    }),
  },
  {
    key: 'signature_block',
    label: '签署信息',
    icon: '🖊️',
    hint: '编制、审核、批准、签发日期及报告备注，默认固定在首页底部。',
    editors: ['report-cover'],
    build: (id) => ({
      id: id(),
      label: '签署信息',
      hide_title: true,           // 签名行自解释，不显示「签字栏」小标题
      layout: 'vertical',
      section_role: 'other' as SectionRole,
      // keep_together + 钉底：签名块整体留在页面底部（报告首页惯例）
      style: { keep_together: true, vertical_align: 'bottom', size: '10.5pt' },
      fields: [
        // 编制/审核/批准：signature_line=true → 渲染成等分下划线签名行（一行三格）
        { id: id(), code: 'sig_drafter',  label: '编制', type: 'text', signature_line: true },
        { id: id(), code: 'sig_reviewer', label: '审核', type: 'text', signature_line: true },
        { id: id(), code: 'sig_approver', label: '批准', type: 'text', signature_line: true },
        // 编制行 ↔ 签发日期 空行（实测 ≈52pt）
        { id: id(), code: 'sig_spacer_1', label: '空行', type: 'spacer', hide_label: true, spacer_height: '5em' },
        // 签发日期：右对齐，绑定接口取号的签发日期
        { id: id(), code: 'issue_date', label: '签发日期', type: 'text', style: { align: 'right' }, binding: { source: 'report_meta', key: 'issue_date' } },
        // 签发日期 ↔ 报告备注 空行（实测 ≈32pt）
        { id: id(), code: 'sig_spacer_2', label: '空行', type: 'spacer', hide_label: true, spacer_height: '3em' },
        // 报告备注 / 资质备注：6pt 小字，绑定接口字段
        { id: id(), code: 'report_note', label: '报告备注', type: 'text', hide_label: true, style: { size: '6pt' }, binding: { source: 'report_meta', key: 'report_note' } },
        { id: id(), code: 'qual_note',   label: '资质备注', type: 'text', hide_label: true, style: { size: '6pt' }, binding: { source: 'report_meta', key: 'qualification_note' } },
      ] as FieldDefinition[],
    }),
  },
  // ===== 首页（report-cover）专属预设 =====
  {
    key: 'cover_conclusion',
    label: '检测结论',
    icon: '📋',
    hint: '【首页】检测结论汇总表，行=各项目结论，生成报告时按订单项目自动展开',
    editors: ['report-cover'],
    build: (id) => ({
      id: id(),
      label: '检测结论',
      hide_title: true,
      layout: 'vertical',
      section_role: 'conclusion' as SectionRole,
      fields: [
        coverHeading(id, 'conclusion_heading', '检测结论：'),
        { id: id(), code: 'conclusion_summary', label: '检测结论表', type: 'report_conclusion_table', hide_label: true,
          conclusion_table: { columns: ['index', 'project', 'result'] } },
      ] as FieldDefinition[],
    }),
  },
  {
    key: 'cover_sample_table',
    label: '样品信息',
    icon: '🧾',
    hint: '样品信息标题和样品信息表；表格按原规则在多样品时显示。',
    editors: ['report-cover'],
    build: (id) => ({
      id: id(),
      label: '样品信息',
      hide_title: true,           // 标题由独立文字字段承担，避免重复。
      layout: 'vertical',
      section_role: 'other' as SectionRole,
      fields: [
        // 标题和表格分开，允许单独设置文字格式与间距。
        coverHeading(id, 'sample_info_heading', '样品信息：'),
        { id: id(), code: 'sample_info_table', label: '样品信息表', type: 'report_sample_table', hide_label: true,
          sample_table: { columns: ['index', 'name', 'model'] } },
      ] as FieldDefinition[],
    }),
  },
  {
    key: 'cover_sample_photos',
    label: '样品描述',
    icon: '📷',
    hint: '添加样品照片、说明文字和样品描述表。',
    editors: ['report-cover'],
    build: (id) => ({
      id: id(),
      label: '样品描述',
      hide_title: true,
      layout: 'vertical',
      section_role: 'images' as SectionRole,
      fields: [
        coverHeading(id, 'sample_description_heading', '样品描述：'),
        { id: id(), code: 'sample_description_table', label: '样品描述表', type: 'report_sample_description_table', hide_label: true,
          sample_description_table: { unique_label: '唯一性编号', description_label: '样品描述', default_description: '见原始样品照片', unique_width: '1fr', description_width: '3.5fr' } },
        { id: id(), code: 'cover_sample_photo', label: '原样照片表', type: 'report_photo_table', hide_label: true,
          photo_table: { caption_label: '', caption_text: '', header: '原始样品', cols: 1 } },
      ] as FieldDefinition[],
    }),
  },
  // ===== 项目报告（report-project）专属预设 =====
  {
    key: 'proj_result',
    label: '检测结果表',
    icon: '🧪',
    hint: '【项目】画布式结果表，每格绑定原始记录的字段/矩阵单元/汇总',
    editors: ['report-project'],
    build: (id) => ({
      id: id(),
      label: '检测结果',
      layout: 'vertical',
      section_role: 'results' as SectionRole,
      fields: [
        { id: id(), code: 'result_table', label: '检测结果', type: 'free_grid',
          free_table: {
            columns: [
              { id: 'col_item', label: '项目' },
              { id: 'col_standard', label: '标准要求' },
              { id: 'col_result', label: '测试结果' },
              { id: 'col_conclusion', label: '结论' },
            ],
            rows: [{ id: 'header' }, { id: 'r1' }],
            cells: { 'header::col_item': '项目', 'header::col_standard': '标准要求', 'header::col_result': '测试结果', 'header::col_conclusion': '结论' },
            header_cells: { 'header::col_item': true, 'header::col_standard': true, 'header::col_result': true, 'header::col_conclusion': true },
            repeat_header_rows: 1,
          } },
      ] as FieldDefinition[],
    }),
  },
  {
    key: 'proj_equipment',
    label: '设备表',
    icon: '⚙️',
    hint: '【项目】自动汇集原始记录中的设备引用 + 查设备库',
    editors: ['report-project'],
    build: (id) => ({
      id: id(),
      label: '设备信息',
      layout: 'vertical',
      section_role: 'other' as SectionRole,
      fields: [
        { id: id(), code: 'equipment_table', label: '设备信息', type: 'report_equipment_table',
          equipment_table: { columns: ['name', 'model', 'asset_code', 'trace_date', 'expire_date'] } },
      ] as FieldDefinition[],
    }),
  },
  {
    key: 'proj_images',
    label: '图片记录',
    icon: '🖼️',
    hint: '【项目】绑定原始记录图片分区，生成报告时整体拉取动态图片、名称和顺序；版式可在项目模板中独立调整',
    editors: ['report-project'],
    build: (id) => ({
      id: id(),
      label: '图片记录',
      layout: 'vertical',
      section_role: 'images' as SectionRole,
      image_layout: { cols: 2, title_mode: 'per' as const, solo: 'first' as const, width_cm: 7, height_cm: 6 },
      fields: [
        { id: id(), code: 'img_before', label: '检测前', type: 'image' },
        { id: id(), code: 'img_during', label: '检测中', type: 'image' },
        { id: id(), code: 'img_after',  label: '检测后', type: 'image' },
      ] as FieldDefinition[],
    }),
  },
  {
    key: 'proj_notes',
    label: '说明段落',
    icon: '📝',
    hint: '【项目】自由说明/备注段落（无字段名，整段文字）',
    editors: ['report-project'],
    build: (id) => ({
      id: id(),
      label: '说明',
      hide_title: true,
      layout: 'vertical',
      section_role: 'notes' as SectionRole,
      fields: [
        { id: id(), code: 'proj_note', label: '说明', type: 'textarea', hide_label: true },
      ] as FieldDefinition[],
    }),
  },
];

export const SECTION_ROLE_OPTIONS: { value: SectionRole; label: string }[] = [
  { value: 'basic', label: '基本信息' },
  { value: 'results', label: '试验结果' },
  { value: 'judgment', label: '判定要求' },
  { value: 'conclusion', label: '结论' },
  { value: 'images', label: '图片记录' },
  { value: 'notes', label: '备注' },
  { value: 'signoff', label: '溯源信息' },
  { value: 'other', label: '其他' },
];

export function sectionRoleLabel(role: SectionRole | undefined): string {
  if (!role) return '其他';
  return SECTION_ROLE_OPTIONS.find(o => o.value === role)?.label ?? '其他';
}
