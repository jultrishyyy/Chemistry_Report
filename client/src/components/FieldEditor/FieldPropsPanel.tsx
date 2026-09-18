import { Form, Input, Switch, Select as AntSelect, Button, Space, Tag, InputNumber, Radio, Alert, Tabs, DatePicker, Tooltip, Modal } from 'antd';
import dayjs from 'dayjs';
import { useEquipmentSearch } from '../../hooks/useEquipmentSearch';
import { equipmentCodes } from '../../../../shared/equipment-search';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PlusOutlined, DeleteOutlined, HolderOutlined, SnippetsOutlined, LinkOutlined, ArrowUpOutlined, ArrowDownOutlined, QuestionCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { useDrag, useDrop } from 'react-dnd';
import type { FieldDefinition, RecordTemplate } from '../../../../shared/types';
import AutoGrowTextArea from '../AutoGrowTextArea';
import { formatChoiceValue } from '../../../../shared/choice-display';
import { canArrangeRecordField } from '../../../../shared/record-layout';
import CoverInlineEditor from '../ReportEditor/CoverInlineEditor';
import { coverCanEditInline } from '../../../../shared/cover-template-editing';
import { storedReportRichDocument } from '../../../../shared/report-rich-document';
import {
  FIELD_CATEGORIES,
  categoriesForGroup,
  categoryOfField,
  choiceModeOf,
  editorCapabilities,
  createFieldForCategory,
  rebuildFieldForCategory,
  type ChoiceMode,
  type FieldCategory,
} from './field-types';
import MatrixEditor from './MatrixEditor';
import FormatPanel from './FormatPanel';
import ImageLayoutControls from './ImageLayoutControls';
import ReportResultTableCanvas from './MatrixEditor/ReportResultTableCanvas';
import FreeGridCanvas from './MatrixEditor/FreeGridCanvas';
import BindingPickerModal, { BindingSummary } from '../ReportEditor/BindingPickerModal';
import ClosablePopover from '../ClosablePopover';
import StaticContentEditor from './StaticContentEditor';

interface Props {
  field: FieldDefinition;
  /** 整张模板（汇总行公式编辑器需要它，以支持跨矩阵/字段选数据源） */
  template: RecordTemplate;
  onChange: (patch: Partial<FieldDefinition>) => void;
  /** 切换字段类型时用完整对象替换，避免旧类型字段残留 */
  onReplaceField?: (field: FieldDefinition) => void;
  /** 数据矩阵汇总行可选的计算字段列表（全模板） */
  computedFieldOptions?: { code: string; label: string }[];
  /** 编辑器模式：record / report-cover / report-project */
  editorMode?: 'record' | 'report-cover' | 'report-project';
  /** 报告项目模式下关联的原始记录模板（供 BindingEditor 使用） */
  linkedRecord?: RecordTemplate | null;
  onDetailFocus?: (detailCode: string) => void;
}

const DATE_PRECISION_OPTIONS = [
  { value: 'day', label: '日' },
  { value: 'hour', label: '时' },
  { value: 'minute', label: '分' },
];
const datePickerFormat = (precision: FieldDefinition['date_precision'], separator: FieldDefinition['date_separator']) => {
  const day = separator === '/' ? 'YYYY/MM/DD' : 'YYYY-MM-DD';
  return precision === 'minute' ? `${day} HH:mm` : precision === 'hour' ? `${day} HH:00` : day;
};
const dateStorageFormat = (precision: FieldDefinition['date_precision']) =>
  precision === 'minute' ? 'YYYY-MM-DDTHH:mm' : precision === 'hour' ? 'YYYY-MM-DDTHH:00' : 'YYYY-MM-DD';

const SEMANTIC_ROLE_LABEL: Record<string, string> = {
  inspector: '主检 = 登录用户',
  inspector_date: '检测日期 = 提交时间',
  reviewer: '审核 = 审核员',
  reviewer_date: '审核日期 = 审核时间',
};

/** 自动表/复杂表类型 + 版式间隔：无字段级格式与普通取值绑定 */
const NO_FORMAT_BINDING = [
  'data_matrix', 'free_grid', 'image', 'spacer', 'record_conclusion', 'report_conclusion_table', 'report_result_table',
  'report_equipment_table', 'report_image_gallery', 'report_sample_table', 'report_sample_description_table', 'report_photo_table',
  'daterange',  // 取值＝date_range.start/end 两个绑定（在「类型配置」里配），不走通用单 binding
  // free_grid：格子级绑定/格式都在「类型配置」画布里逐格设，字段级「格式」「取值绑定」Tab 无意义 → 排除。
];

/**
 * 报告自动表/图：渲染端走 wrapFigure 统一包装（标题/题注/对齐/间距）。
 * 这些类型获得一个「版式」Tab：图/表标题（显示开关+样式）+ 题注位置 + 对齐 + 段前后间距，
 * 让项目报告里的表格也能像首页文本字段一样逐个调版式。
 */
const FIGURE_LAYOUT_TYPES = ['report_result_table', 'report_equipment_table', 'report_image_gallery', 'report_sample_table', 'report_sample_description_table', 'report_photo_table', 'report_conclusion_table'];

/**
 * 「标签 / 备注拆成独立 Tab」的表格类型（所有非图片表格）：数据表格 + 报告结果表/设备表/样品信息表/检测结论表。
 * 这些字段的「基础」Tab 精简为 类别 + 必填；表格【标题】移到「标签」Tab、下方【备注】移到「备注」Tab、
 * 整表版式（字体/字号/表头加粗/内容对齐/对齐间距）留在「版式」Tab。
 * 不含图片类表格（image / report_photo_table / report_image_gallery）——它们的标题/备注仍在图片版式里统一设。
 * free_grid（原始记录表格）也纳入：与数据表格一致地拆出「版式/标签/备注」三个独立 Tab（标题/备注均为纯文本框，填了才显示）。
 */
const LABEL_NOTE_TAB_TYPES = ['data_matrix', 'free_grid', 'report_result_table', 'report_equipment_table', 'report_sample_table', 'report_sample_description_table', 'report_conclusion_table'];

/** 「版式」Tab 里出现「整表文字」（字体/字号/表头加粗/内容对齐）配置的表格类型。 */
const TABLE_TEXT_STYLE_TYPES = ['report_result_table', 'report_equipment_table', 'report_sample_table', 'report_sample_description_table', 'report_conclusion_table'];

/** 统一表格编辑工具栏覆盖的字段类型，以及各自需要恢复默认的结构配置键。 */
const TABLE_CONFIG_KEYS: Partial<Record<FieldDefinition['type'], keyof FieldDefinition>> = {
  data_matrix: 'matrix',
  free_grid: 'free_table',
  report_result_table: 'result_table',
  report_equipment_table: 'equipment_table',
  report_sample_table: 'sample_table',
  report_sample_description_table: 'sample_description_table',
  report_conclusion_table: 'conclusion_table',
  report_photo_table: 'photo_table',
};

const cloneField = (value: FieldDefinition): FieldDefinition => JSON.parse(JSON.stringify(value));

/** 整表文字「字体」可选项（与 FormatPanel/DocumentStylePanel 同口径，仅 demo_v1/fonts/ 已打包字体）。 */
const TABLE_FONT_OPTIONS = [
  { value: 'Songti SC', label: '宋体' },
  { value: 'SimHei', label: '黑体' },
  { value: 'KaiTi', label: '楷体' },
  { value: 'FangSong', label: '仿宋' },
  { value: 'FangSong_GB2312', label: '仿宋_GB2312' },
  { value: 'STSong', label: '华文宋体' },
  { value: 'Arial', label: 'Arial' },
  { value: 'Times New Roman', label: 'Times New Roman' },
];

/** 去掉 undefined 键；全空则返回 undefined（避免存空对象）。 */
function cleanTableStyle(ts: Record<string, any> | undefined): any {
  const o: Record<string, any> = { ...(ts || {}) };
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return Object.keys(o).length ? o : undefined;
}

type EquipmentOption = {
  asset_code: string;
  name: string;
  model?: string;
  status?: string;
};

/** 原始记录模板：为 device_ref 配置常用设备。保存的始终是设备管理编号，不复制设备名称等易变信息。 */
function DeviceRefConfigEditor({ field, onChange }: { field: FieldDefinition; onChange: (patch: Partial<FieldDefinition>) => void }) {
  const config = field.device_ref_config || {};
  const presetCodes = useMemo(() => equipmentCodes(config.preset_asset_codes), [config.preset_asset_codes]);
  const [options, setOptions] = useState<EquipmentOption[]>([]);
  const { keyword, setKeyword: searchEquipment, items: searchItems, loading, error: searchError } = useEquipmentSearch();

  useEffect(() => {
    if (!presetCodes.length) return;
    fetch(`/api/equipment/lookup?codes=${encodeURIComponent(presetCodes.join(','))}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((rows: EquipmentOption[]) => setOptions(prev => {
        if (!Array.isArray(rows)) return prev;
        const merged = new Map(prev.map(item => [item.asset_code, item]));
        rows.forEach(item => { if (typeof item?.asset_code === 'string' && typeof item?.name === 'string') merged.set(item.asset_code, item); });
        return Array.from(merged.values());
      }))
      .catch(() => undefined);
  }, [presetCodes]);

  // Details of selected values are retained separately; previous search hits are not candidates.
  const visibleOptions = keyword.trim() ? searchItems : options.filter(item => presetCodes.includes(item.asset_code));

  const setConfig = (patch: Partial<NonNullable<FieldDefinition['device_ref_config']>>) =>
    onChange({ device_ref_config: { ...config, ...patch } });

  return (
    <>
      <Form.Item label="选择方式">
        <Radio.Group optionType="button" buttonStyle="solid"
          value={config.selection_mode || 'multiple'}
          onChange={e => setConfig({ selection_mode: e.target.value })}
          options={[{ value: 'single', label: '单台设备' }, { value: 'multiple', label: '多台设备' }]} />
      </Form.Item>
      <Form.Item label="模板常用设备" tooltip="输入仪器名称、型号或管理编号搜索设备库，可配置多个快捷候选。">
        <AntSelect
          mode="multiple"
          showSearch
          filterOption={false}
          loading={loading}
          value={presetCodes}
          onSearch={searchEquipment}
          onChange={codes => setConfig({ preset_asset_codes: codes })}
          placeholder="搜索并选择常用设备"
          notFoundContent={loading ? '搜索中…' : searchError || (keyword.trim() ? '未找到匹配设备' : '输入关键字搜索设备库')}
          options={visibleOptions.map(item => ({
            value: item.asset_code,
            label: `${item.name}${item.model ? `（${item.model}）` : ''} — ${item.asset_code}${item.status ? ` [${item.status}]` : ''}`,
          }))}
        />
      </Form.Item>
      <Form.Item label="允许选择其他设备" tooltip="开启后，录入人可搜索整个设备库；关闭后只能选择上面的常用设备。">
        <Switch checked={config.allow_library_search !== false}
          onChange={value => setConfig({ allow_library_search: value })} />
      </Form.Item>
    </>
  );
}

export default function FieldPropsPanel({ field, template, onChange: commitChange, onReplaceField: commitReplaceField, editorMode = 'record', linkedRecord = null, onDetailFocus }: Props) {
  const category = categoryOfField(field);
  const caps = editorCapabilities(editorMode);
  const isReportMode = caps.valueBinding;
  const tableConfigKey = TABLE_CONFIG_KEYS[field.type];
  const historyEnabled = !!tableConfigKey;

  const onChange = (patch: Partial<FieldDefinition>) => {
    commitChange(patch);
  };

  const replaceField = (next: FieldDefinition) => {
    if (!commitReplaceField) return;
    commitReplaceField(next);
  };

  const resetTableToDefault = () => {
    if (!tableConfigKey || !commitReplaceField) return;
    const defaultField = createFieldForCategory(category, field.id);
    const defaultConfig = defaultField[tableConfigKey];
    Modal.confirm({
      title: '重置为默认表格',
      content: '将清除当前表格的行列结构、合并、公式及格子绑定，恢复该表格类型的默认结构。字段名、标签、备注和外层格式保持不变。',
      okText: '确认重置',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => {
        const next = cloneField(field) as any;
        next[tableConfigKey] = defaultConfig === undefined ? undefined : JSON.parse(JSON.stringify(defaultConfig));
        replaceField(next);
      },
    });
  };
  // 「什么编辑器就显示什么字段」：按 editors 白名单过滤（与添加字段下拉同一口径）
  const parentGroup = template.groups.find(group => group.fields.some(candidate => candidate.id === field.id));
  const groupCategories = categoriesForGroup(editorMode, parentGroup?.section_role);
  const allowedCategories = field.conclusion_role
    ? groupCategories.filter(candidate =>
        field.conclusion_role === 'project_name' || field.conclusion_role === 'item_name'
          ? candidate.key === 'text'
          : candidate.key === 'text' || candidate.key === 'choice')
    : groupCategories;
  // 防御：存量字段若其类别不在本编辑器白名单（罕见的历史脏数据），仍把它列进下拉，避免类别选框显示空白
  const visibleCategories = allowedCategories.some(c => c.key === category)
    ? allowedCategories
    : [...allowedCategories, ...FIELD_CATEGORIES.filter(c => c.key === category)];

  const handleCategoryChange = (cat: FieldCategory) => {
    if (!commitReplaceField) return;
    replaceField(rebuildFieldForCategory(field, cat));
  };

  const isSimpleValue = ['text', 'number', 'date', 'choice'].includes(category);
  // 时间范围（检测周期）：取值是两端日期绑定（非单 binding），但仍像简单字段一样需要「字段名 / 字段值 / 版式」三页
  const isDateRange = category === 'daterange';
  // 非图片表格：标签/备注拆成独立 Tab，「基础」只留 类别 + 必填
  const hasLabelNoteTabs = LABEL_NOTE_TAB_TYPES.includes(field.type);

  // 录入端「默认值」控件（仅原始记录场景；报告场景值=手填literal/抓取binding，不用 default_value）
  const defaultValueControl = (
    category === 'number' ? (
      <InputNumber
        style={{ width: 200 }}
        value={field.default_value === undefined || field.default_value === '' ? undefined : Number(field.default_value)}
        onChange={(v) => onChange({ default_value: v === null || v === undefined ? undefined : v })}
        placeholder="输入数字"
        addonAfter={field.unit || undefined}
      />
    ) : category === 'date' ? (
      <DatePicker
        style={{ width: 200 }}
        showTime={field.date_precision && field.date_precision !== 'day' ? { format: field.date_precision === 'minute' ? 'HH:mm' : 'HH' } : false}
        format={datePickerFormat(field.date_precision, field.date_separator)}
        value={field.default_value ? dayjs(String(field.default_value)) : undefined}
        onChange={(d) => onChange({ default_value: d ? d.format(dateStorageFormat(field.date_precision)) : undefined })}
      />
    ) : category === 'choice' ? (
      field.type === 'checkbox' ? (
        <AntSelect
          mode="multiple" allowClear style={{ width: '100%' }}
          placeholder="从选项中选默认勾选项"
          value={Array.isArray(field.default_value) ? field.default_value : undefined}
          onChange={(v) => onChange({ default_value: v && v.length ? v : undefined })}
          options={(field.options || []).map(o => ({ value: o, label: o }))}
        />
      ) : (
        <AntSelect
          allowClear style={{ width: '100%' }}
          placeholder="从选项中选一个默认值"
          value={typeof field.default_value === 'string' && field.default_value ? field.default_value : undefined}
          onChange={(v) => onChange({ default_value: v || undefined })}
          options={(field.options || []).map(o => ({ value: o, label: o }))}
        />
      )
    ) : (
      <AutoGrowTextArea autoSize={{ minRows: 3, maxRows: 12 }} value={field.default_value ?? ''} onChange={(e) => onChange({ default_value: e.target.value || undefined })} />
    )
  );

  // 文档级默认 字体/字号：字体/字号控件在"未设本级"时直接显示这两个【实际生效值】（所见即所得），不再显示"跟随默认"。
  // 主题内建默认＝宋体(Songti SC) / 10pt（与 record-theme 的 _cfg-get("font","Songti SC")、DocumentStylePanel body_size?？10 一致）。
  const _themeCfg = template.layout_options?.theme_config as Record<string, any> | undefined;
  const docFont = _themeCfg?.font || 'Songti SC';
  const docSize = typeof _themeCfg?.body_size === 'number' ? _themeCfg.body_size : 10;
  // 文档级「字段名默认粗细」(label_weight，缺省 bold)：字段名/标题的「加粗」控件未设本级时直接显示 加粗/正常，不再显示"跟随"。
  const docLabelBold = (_themeCfg?.label_weight ?? 'bold') !== 'regular';
  // 「距离」旋钮未设时显示的【当前默认值】(pt)：标题/备注与表格的间距，渲染端缺省跟随文档「字段间距」(line_gap，缺省 0.6em)。
  // 换算成 pt 展示（em×正文字号），让旋钮"目前是多少就填多少"，而不是空着写"默认"。
  const docGapPt = (() => {
    const lg = _themeCfg?.line_gap;
    if (lg == null || lg === '') return Math.round(0.6 * docSize * 10) / 10;
    if (typeof lg === 'number') return Math.round(lg * docSize * 10) / 10;   // 裸数字视作 em
    const s = String(lg);
    if (/em$/.test(s)) return Math.round(parseFloat(s) * docSize * 10) / 10;
    if (/pt$/.test(s)) return Math.round(parseFloat(s) * 10) / 10;
    return Math.round(0.6 * docSize * 10) / 10;
  })();

  // —— Tab 区上方【常驻行】：字段类别 + 必填（+ 自动注入提示）——
  // 「类别切换」是跨所有类型的高频操作、且表格类的「基础」Tab 精简后近乎空白，故提到 Tab 上方常驻，
  // 顺带把「必填」也放这里；表格类因此不再需要单独的「基础」Tab（见 items 组装处）。
  const categoryRow = (
    <div style={{ marginBottom: 10, padding: '8px 10px', background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 6 }}>
      <Space wrap size={14} align="center">
        <Space size={6}>
          <span style={{ fontSize: 12, color: '#888' }}>字段类别</span>
          <AntSelect size="small" style={{ width: 150 }} value={category}
            onChange={(v) => handleCategoryChange(v as FieldCategory)}
            options={visibleCategories.map(c => ({ value: c.key, label: `${c.icon}  ${c.label}` }))} />
        </Space>
        {/* 表格类字段名：仅编辑器显示名（字段列表/选择器里用），【不进渲染】；表格标题在「标签」Tab 单独设。 */}
        {hasLabelNoteTabs && (
          <Space size={6}>
            <Tooltip title="仅作字段列表里的显示名，不会渲染进 PDF；表格标题请在「标签」Tab 设。">
              <span style={{ fontSize: 12, color: '#888' }}>字段名</span>
            </Tooltip>
            <AutoGrowTextArea size="small" style={{ width: 150 }} value={field.label}
              placeholder="仅编辑器显示，不渲染"
              onChange={(e) => onChange({ label: e.target.value })} />
          </Space>
        )}
        {/* 「必填」只对【录入时要填】的字段有意义；报告模板(值来自绑定映射、不录入)与间隔(空白块)都不显示。 */}
        {field.type !== 'spacer' && field.type !== 'static_content' && !isReportMode && (
          <span style={{ fontSize: 12, color: '#888' }}>必填
            <Tooltip title="开启后，录入页此字段不填写就无法提交；关闭＝可留空（非必填）。">
              <QuestionCircleOutlined style={{ marginLeft: 3, color: '#bbb' }} />
            </Tooltip>
            <Switch size="small" style={{ marginLeft: 6 }} checked={field.required || false}
              onChange={(v) => onChange({ required: v })} />
          </span>
        )}
        {field.semantic_role && (
          <Tooltip title="该字段由系统按「溯源信息」自动填写（如主检=登录人、检测日期=提交时间），录入时只读、无需手填。">
            <Tag color="blue" style={{ margin: 0 }}>系统自动注入（{SEMANTIC_ROLE_LABEL[field.semantic_role] || field.semantic_role}）</Tag>
          </Tooltip>
        )}
        {field.conclusion_role && (
          <Tooltip title="该标记用于稳定生成报告；修改字段名称或在文本/选择之间切换都不会断开映射。">
            <Tag color="green" style={{ margin: 0 }}>结论模块字段 · {{
              project_name: '总项目名称', item_name: '子项目名称', judgment_requirement: '判定要求', limit: '限值', conclusion: '结论',
            }[field.conclusion_role]}</Tag>
          </Tooltip>
        )}
        {!isReportMode && !field.semantic_role && !['data_matrix', 'free_grid', 'image', 'record_conclusion', 'static_content', 'spacer'].includes(field.type) && (
          <Tooltip title="允许同一项目的其他原始记录手动拉取已保存的内容。填充后各份记录独立保存，后续修改不会同步。">
            <span style={{ fontSize: 12, color: '#888' }}>允许其他记录拉取
              <Switch size="small" style={{ marginLeft: 6 }} checked={field.data_scope === 'batch_shared'}
                onChange={(checked) => onChange({ data_scope: checked ? 'batch_shared' : 'record' })} />
            </span>
          </Tooltip>
        )}
      </Space>
    </div>
  );

  // —— 「标签/显示标题/备注/说明」元信息块（原「基础」Tab 内容，去掉 Form 外壳）——
  // 简单值/时间范围已各自并入 字段名/字段值；此块现只服务 设备(device_ref) / 图片表(report_photo_table) /
  // 图片组(report_image_gallery)——注入它们各自的「类型配置」Tab 顶部，故【不再单出「基础」Tab】。
  // （单位/行数已并入简单值的「字段值」Tab；此块不含它们。）
  const basicMetaBlock = (
    <>
      {/* 复杂类型（设备/图片表/图片组）在此给一个标签输入；简单值/时间范围在「字段名/字段值」编辑、非图片表格在「标签」Tab。 */}
      {editorMode === 'record' && canArrangeRecordField(field) && <Form.Item label="独占一行">
        <Switch checked={!!field.full_width} onChange={full_width => onChange({ full_width })} />
      </Form.Item>}
      {!isSimpleValue && !isDateRange && !hasLabelNoteTabs && (
        <Form.Item label="标签（显示名称）">
          <AutoGrowTextArea value={field.label} onChange={(e) => onChange({ label: e.target.value })} />
        </Form.Item>
      )}

      {/* 是否把标签显示成表/图标题：紧贴标签输入（标题文字＝该标签）。样式在「版式」Tab 调。
          数据表缺省显示标题；报告自动表缺省不显示（多在带标题分区里，避免与分区标题重复）——语义相反，按 type 分流。
          非图片表格已把此开关移到「标签」Tab（!hasLabelNoteTabs 排除）。 */}
      {!hasLabelNoteTabs && (FIGURE_LAYOUT_TYPES.includes(field.type) || field.type === 'data_matrix' || field.type === 'image') && (() => {
        // 数据表 / 图片＝缺省显示标题（关掉才隐藏）；报告自动表＝缺省隐藏（仅显式 false 才显示）。
        const defaultShown = field.type === 'data_matrix' || field.type === 'image';
        const shown = defaultShown ? !field.hide_label : field.hide_label === false;
        const labelText = field.type === 'data_matrix' ? '显示表格标题' : field.type === 'image' ? '显示表内标题（每张图表头）' : '显示为标题';
        return (
          <Form.Item label={labelText}
            tooltip="打开后在表/图上方加一行标题，文字＝上面的「标签」（居左、字体跟随模板）。标题与表/图的距离随「文档样式·字段间距」一起变。">
            <Space size={6}>
              <Switch checked={shown}
                onChange={(v) => onChange({ hide_label: defaultShown ? (v ? undefined : true) : (v ? false : undefined) })} />
              <span style={{ fontSize: 11, color: '#888' }}>
                {shown ? `显示标题「${field.label || ''}」` : (defaultShown ? '不显示标题' : '不显示标题（缺省）')}
              </span>
            </Space>
          </Form.Item>
        );
      })()}

      {/* 图/表的备注信息：图片＝表格【上方】的描述（如「样品描述：见原始样品照片。」，与表内表头 label 是两层不同标题）；其余图表＝下方小字题注。
          非图片表格已把备注移到独立「备注」Tab（!hasLabelNoteTabs 排除）。 */}
      {!hasLabelNoteTabs && (['data_matrix', 'image', 'report_result_table', 'report_equipment_table', 'report_image_gallery', 'report_sample_table', 'report_sample_description_table', 'report_photo_table', 'report_conclusion_table'] as string[]).includes(field.type) && (
        <Form.Item label="备注信息（紧贴图/表下方显示）"
          tooltip="填入后在 PDF 里紧贴该图片/表格的下方以小字显示（如「注：试样取自批次 A」）。图片的主标题＝上面的「标签」（表内表头行、跟随文档字号）；这里只是下方小字题注。留空＝不显示。">
          <AutoGrowTextArea autoSize={{ minRows: 2, maxRows: 3 }} value={field.caption || ''}
            onChange={(e) => onChange({ caption: e.target.value || undefined })} />
        </Form.Item>
      )}

      {/* 字段说明（录入时的提示）——对表格类无意义、报告模板不录入，均隐藏。 */}
      {!hasLabelNoteTabs && !isReportMode && (
        <Form.Item label="字段说明（录入时的提示）">
          <AutoGrowTextArea autoSize={{ minRows: 2, maxRows: 3 }} value={field.description || ''} onChange={(e) => onChange({ description: e.target.value || undefined })} />
        </Form.Item>
      )}
    </>
  );

  // —— Tab:标签 ——（表格标题，显示在表格左上方；【与「字段名」解耦】）
  // 标题存独立字段 `table_title`（渲染端 wrapFigure/embedDataMatrixTypst 只认它）；「字段名」`label` 只作编辑器
  // 显示名、不进渲染（在 Tab 上方常驻行编辑）。填了才显示、留空＝不显示（所见即所得），默认留空。
  const labelTab = (
    <Form layout="vertical" size="small">
      <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message="表格标签（显示在表格上方）" />
      <Form.Item label="标签内容">
        <AutoGrowTextArea autoSize={{ minRows: 2, maxRows: 3 }} value={field.table_title ?? ''} placeholder="填写作为表格标题；留空＝不显示"
          onChange={(e) => onChange({ table_title: e.target.value || undefined })} />
      </Form.Item>
      <Form.Item label="标签与表格的距离"
        tooltip="标签和它下方表格之间的留白（pt）。留空＝默认紧贴。需先填了标签内容才有效果。">
        <InputNumber min={0} max={60} step={1} style={{ width: 140 }} addonAfter="pt"
          value={field.label_gap ? parseFloat(field.label_gap) : docGapPt}
          onChange={(v) => onChange({ label_gap: v != null ? `${v}pt` : undefined })} />
      </Form.Item>
      <Form.Item label="标签样式" style={{ marginBottom: 0 }}>
        <FormatPanel inheritedFont={docFont} inheritedSize={docSize} inheritedBold={true} variant="text" value={field.label_style}
          onChange={(ls) => onChange({ label_style: ls, label_bold: undefined })} />
      </Form.Item>
    </Form>
  );

  // —— Tab:备注 ——（非图片表格：显示在表格下方的备注）
  const notesTab = (
    <Form layout="vertical" size="small">
      <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message="表格备注（显示在表格下方）" />
      <Form.Item label="备注内容">
        <AutoGrowTextArea autoSize={{ minRows: 2, maxRows: 3 }} value={field.caption || ''} placeholder="填写作为表格备注；留空＝不显示"
          onChange={(e) => onChange({ caption: e.target.value || undefined })} />
      </Form.Item>
      {/* 备注固定显示在表格下方（缺省 caption_position=below）——不再提供「表格上方/下方」切换。 */}
      <Form.Item label="备注与表格的距离"
        tooltip="备注和表格之间的留白（pt）。留空＝默认。需先填了备注内容才有效果。">
        <InputNumber min={0} max={40} step={1} style={{ width: 140 }} addonAfter="pt"
          value={field.caption_gap ? parseFloat(field.caption_gap) : docGapPt}
          onChange={(v) => onChange({ caption_gap: v != null ? `${v}pt` : undefined })} />
      </Form.Item>
      <Form.Item label="备注样式" style={{ marginBottom: 0 }}>
        <FormatPanel inheritedFont={docFont} inheritedSize={docSize} variant="text" value={field.caption_style}
          onChange={(cs) => onChange({ caption_style: cs })} />
      </Form.Item>
    </Form>
  );

  // —— Tab：字段名（标签）——（仅简单值类型）
  const nameTab = (
    <Form layout="vertical" size="small">
      <Form.Item label="显示字段名"
        tooltip="开 = PDF 里显示「字段名：内容」；关 = 只显示内容、不显示字段名（如声明那种无标签段落）。">
        <Space size={6}>
          <Switch checked={!field.hide_label}
            onChange={(v) => onChange({ hide_label: v ? undefined : true })} />
          <span style={{ fontSize: 11, color: '#888' }}>
            {field.hide_label ? '只显示内容（无字段名）' : '显示「字段名：内容」'}
          </span>
        </Space>
      </Form.Item>
      {!field.hide_label ? (
        <>
          <Form.Item label="文字">
            <AutoGrowTextArea value={field.label} onChange={(e) => onChange({ label: e.target.value })} />
          </Form.Item>
          <Form.Item label="样式（字体/字号/加粗/斜体/颜色）" style={{ marginBottom: 0 }}>
            <FormatPanel inheritedFont={docFont} inheritedSize={docSize} inheritedBold={true} variant="text" value={field.label_style}
              onChange={(ls) => onChange({ label_style: ls, label_bold: undefined })} />
          </Form.Item>
        </>
      ) : (
        <div style={{ fontSize: 12, color: '#999' }}>字段名已隐藏——只显示内容（如声明/备注）。打开上面的开关可设字段名文字与样式。</div>
      )}
    </Form>
  );

  // —— Tab：字段值 ——（仅简单值类型；含原「基础」的 单位/行数/说明——简单值不再单出「基础」Tab）
  const valueTab = (
    <Form layout="vertical" size="small">
      {category === 'date' && (
        <Space wrap size={16} align="start">
          <Form.Item label="时间精度" tooltip="控制原始记录及报告中的显示范围；系统自动注入的检测/审核时间也遵循此设置。">
            <Radio.Group size="small" optionType="button" buttonStyle="solid"
              value={field.date_precision || 'day'}
              onChange={(e) => onChange({ date_precision: e.target.value === 'day' ? undefined : e.target.value })}
              options={DATE_PRECISION_OPTIONS} />
          </Form.Item>
          <Form.Item label="日期分隔符" tooltip="控制年月日显示为 2026-08-06 或 2026/08/06；时间部分仍使用冒号。">
            <Radio.Group size="small" optionType="button" buttonStyle="solid"
              value={field.date_separator || '-'}
              onChange={(e) => onChange({ date_separator: e.target.value === '-' ? undefined : e.target.value })}
              options={[{ value: '-', label: '-' }, { value: '/', label: '/' }]} />
          </Form.Item>
        </Space>
      )}
      {/* 单位 / 行数＝录入设置：报告模板值来自绑定映射、不录入，隐藏 */}
      {!isReportMode && (category === 'text' || category === 'number') && (
        <Space direction="horizontal" wrap style={{ marginBottom: 4 }}>
          <Form.Item label="单位" style={{ marginBottom: 0 }}>
            <Input style={{ width: 100 }} value={field.unit || ''}
              onChange={(e) => onChange({ unit: e.target.value || undefined })} placeholder="如 ℃ / mm" />
          </Form.Item>
          {category === 'text' && (
            <Form.Item label="行数" style={{ marginBottom: 0 }}
              tooltip="只影响录入控件：单行=一行输入框（回车不换行）；多行=可敲回车分段的文本域，换行会原样进 PDF。两种在 PDF 上超宽都会自动折行">
              <Radio.Group value={field.type === 'textarea' ? 'multi' : 'single'}
                onChange={(e) => onChange({ type: e.target.value === 'multi' ? 'textarea' : 'text' })}
                optionType="button"
                options={[{ value: 'single', label: '单行' }, { value: 'multi', label: '多行' }]} />
            </Form.Item>
          )}
        </Space>
      )}
      {/* 选择字段：选项列表/单选多选/允许自定义＝录入设置；报告模板不录入，隐藏（值走绑定） */}
      {!isReportMode && category === 'choice' && commitReplaceField && (
        <ChoiceEditor field={field} onReplace={commitReplaceField} onChange={onChange} />
      )}
      {isReportMode ? (
        <ReportValueSource
          key={field.id}
          field={field}
          linkedRecord={caps.linkedRecordBinding ? linkedRecord : null}
          onChange={onChange}
        />
      ) : (
        <Form.Item label="默认值"
          tooltip="录入页打开时预填的初始值，实验员可修改；留空 = 无默认值">
          {defaultValueControl}
        </Form.Item>
      )}
      {/* 录入提示＝录入页帮助文字；报告模板不录入，隐藏 */}
      {!isReportMode && (
        <Form.Item label="录入提示（说明）"
          tooltip="录入页此字段的灰色提示文字，帮助实验员填写；不进 PDF。留空＝无提示。">
          <AutoGrowTextArea autoSize={{ minRows: 2, maxRows: 3 }} value={field.description || ''}
            onChange={(e) => onChange({ description: e.target.value || undefined })} />
        </Form.Item>
      )}
      <Form.Item label="样式（字体/字号/加粗/斜体/颜色）" style={{ marginBottom: 0 }}>
        <FormatPanel inheritedFont={docFont} inheritedSize={docSize} variant="text" value={field.value_style}
          onChange={(vs) => onChange({ value_style: vs })} />
      </Form.Item>
    </Form>
  );

  // —— 字段名↔字段值 距离（label_width 字段级覆盖）——
  // 复用 #field 的 label_width（标签固定列宽/值起始位置）：字段 ＞ 分区 ＞ 文档。仅竖排 #field 有效（图/表无此项）。
  // undefined＝跟随分区/文档；'none'＝紧贴；长度(如 8em)＝标签占该列宽、值右移。与「分区头·字段值对齐」同款交互。
  const labelValueGapControl = (
    <div style={{ marginTop: 10 }}>
      <Tooltip title="字段「名」与「值」之间的距离：跟随分区=用分区/文档统一设置；紧凑=值紧接在字段名后、无额外间距；对齐=字段名占固定列宽、各字段的值对齐到同一竖线（仅竖排字段有效，多列本就紧凑）。">
        <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>字段名 ↔ 字段值 距离</div>
      </Tooltip>
      <Space size={8}>
        <Radio.Group size="small" optionType="button" buttonStyle="solid"
          value={isReportMode
            ? (field.label_width && field.label_width !== 'none' ? 'align' : 'tight')   // 报告模板：无「跟随」，未设＝实际默认「紧凑」
            : (field.label_width === undefined ? 'inherit' : field.label_width === 'none' ? 'tight' : 'align')}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'inherit') onChange({ label_width: undefined });
            else if (v === 'tight') onChange({ label_width: 'none' });
            else onChange({ label_width: (field.label_width && field.label_width !== 'none') ? field.label_width : '8em' });
          }}
          options={isReportMode
            ? [{ label: '紧凑', value: 'tight' }, { label: '对齐', value: 'align' }]
            : [{ label: '跟随分区', value: 'inherit' }, { label: '紧凑', value: 'tight' }, { label: '对齐', value: 'align' }]} />
        {field.label_width && field.label_width !== 'none' && (
          <InputNumber size="small" style={{ width: 92 }} min={1} max={30} step={0.5} addonAfter="em"
            value={parseFloat(field.label_width) || 8}
            onChange={(v) => onChange({ label_width: `${v ?? 8}em` })} />
        )}
      </Space>
    </div>
  );

  // —— Tab：版式 ——（仅简单值类型；字段整体在版面上的对齐/段前后）
  // 字段级「字段间距」编辑已按需求移除（原始记录 + 报告首页/项目均不再单字段设间距）——
  // 间距统一在「分区头·格式」或「文档样式」里设（应全篇一致）。存量 field_gap 值仍按渲染路径生效，只是不再可编辑。
  const layoutTab = (
    <div>
      <FormatPanel variant="layout" value={field.style} alignNoInherit={isReportMode}
        onChange={(st) => onChange({ style: st })} />
      {labelValueGapControl}
      <div style={{ fontSize: 11, color: '#aaa', marginTop: 6 }}>
        想统一调<b>行距 / 字段间距</b>？请到「分区头 · 格式」或「文档样式」里设——它们应全篇一致，不在单字段配。
      </div>
    </div>
  );

  // —— Tab 2:类型配置（按类别，无配置的类别不出此页）——
  let configTab: React.ReactNode = null;
  // 选择字段：选项/单选多选/允许自定义 已并入「字段值」Tab（valueTab），不再单出「类型配置」。
  // 设备字段：本身无类型配置——把「标签/说明」元信息块作为其「类型配置」内容，从而不再单出近乎空白的「基础」Tab。
  if (field.type === 'record_conclusion') {
    configTab = <RecordConclusionConfigEditor field={field} onChange={onChange} />;
  } else if (field.type === 'device_ref') {
    configTab = (
      <Form layout="vertical" size="small">
        {basicMetaBlock}
        <DeviceRefConfigEditor field={field} onChange={onChange} />
      </Form>
    );
  } else if (category === 'matrix') {
    configTab = (
      // component={false}：不渲染 <form> 元素——MatrixEditor 内部自带 Form，避免 form 嵌套
      <Form layout="vertical" size="small" component={false}>
        {/* 「显示表格标题」开关已移到「基础」Tab 标签输入旁；标题样式/距离在「版式」Tab */}
        <MatrixEditor
          field={field}
          template={template}
          config={field.matrix || { default_sample_count: 3, parameters: [], cell_type: 'number', allow_add_remove_samples: true, allow_add_remove_parameters: false }}
          onChange={(matrix) => onChange({ matrix })}
        />
      </Form>
    );
  } else if (field.type === 'spacer') {
    configTab = (
      <Form layout="vertical" size="small">
        <Alert type="info" showIcon style={{ marginBottom: 12 }}
          message="间隔（空白块）"
          description="排版用：在两个字段/分区之间插入一段固定高度的空白，本身不填任何内容。" />
        <Form.Item label="空白高度">
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            <Space>
              <InputNumber min={0.1} max={20} step={0.1} style={{ width: 110 }}
                value={parseFloat(field.spacer_height || '1') || 1}
                onChange={(v) => onChange({ spacer_height: `${v ?? 1}${(field.spacer_height || '1cm').replace(/[\d.]/g, '') || 'cm'}` })}
                addonAfter={(field.spacer_height || '1cm').replace(/[\d.]/g, '') || 'cm'} />
              <Radio.Group size="small" optionType="button"
                value={(field.spacer_height || '1cm').replace(/[\d.]/g, '') || 'cm'}
                onChange={(e) => onChange({ spacer_height: `${parseFloat(field.spacer_height || '1') || 1}${e.target.value}` })}
                options={[{ value: 'cm', label: 'cm' }, { value: 'pt', label: 'pt' }, { value: 'em', label: 'em' }]} />
            </Space>
            <Space.Compact size="small">
              <Button onClick={() => onChange({ spacer_height: '0.5em' })} type={field.spacer_height === '0.5em' ? 'primary' : 'default'}>半行</Button>
              <Button onClick={() => onChange({ spacer_height: '1em' })} type={field.spacer_height === '1em' ? 'primary' : 'default'}>一行</Button>
              <Button onClick={() => onChange({ spacer_height: '2em' })} type={field.spacer_height === '2em' ? 'primary' : 'default'}>两行</Button>
            </Space.Compact>
          </Space>
        </Form.Item>
      </Form>
    );
  } else if (field.type === 'static_content') {
    configTab = <Form layout="vertical" size="small">
      <Form.Item label="模板说明 / 资料"><StaticContentEditor field={field} templateId={(template as any).id} inheritedFont={docFont} inheritedSize={docSize} onChange={onChange}
        onItemFocus={(itemId) => onDetailFocus?.(`__image_item__:${itemId}`)} /></Form.Item>
    </Form>;
  } else if (field.type === 'image') {
    // 图片字段使用下方的轻量专用面板：仅编辑名称（以及项目模板的数据来源），不生成通用配置 Tab。
    configTab = null;
  } else if (field.type === 'report_conclusion_table') {
    const cTbl = field.conclusion_table || {};
    const baseCols = (cTbl.columns && cTbl.columns.length ? cTbl.columns : ['index', 'project', 'result']).filter((c) => c !== 'sample');
    // 兼容旧位置数组 col_widths：按名取现值，供编辑器回显。
    const legacyByName: Record<string, string> = {};
    (cTbl.columns && cTbl.columns.length ? cTbl.columns : ['index', 'project', 'result']).forEach((c, i) => { if (cTbl.col_widths?.[i]) legacyByName[c] = cTbl.col_widths[i]; });
    const widthOf = (c: string) => (cTbl.col_widths_map as Record<string, string> | undefined)?.[c] ?? legacyByName[c] ?? '';
    const setColWidth = (c: string, v: string) => {
      const m = { ...(cTbl.col_widths_map || {}) } as Record<string, string>;
      if (v) m[c] = v; else delete m[c];
      onChange({ conclusion_table: { ...cTbl, col_widths_map: m } });
    };
    const W_UNITS = [{ value: 'fr', label: 'fr' }, { value: '%', label: '%' }, { value: 'cm', label: 'cm' }, { value: 'pt', label: 'pt' }];
    const parseW = (s: string): { num: number | undefined; unit: string } => {
      const m = /^([\d.]+)(fr|cm|mm|pt|in|%)$/.exec(s || '');
      return m ? { num: parseFloat(m[1]), unit: m[2] } : { num: undefined, unit: 'fr' };
    };
    // 逐列（勾选显示 · 改列名 · 调列宽），与样品信息表同款 UI。样品列的显示由上方「样品列」模式控制、仅在此调宽。
    const cLbl = cTbl.column_labels || {};
    const CC_COLS = [
      { key: 'index', label: '序号' },
      { key: 'project', label: '项目' },
      { key: 'standard', label: '标准' },
      { key: 'result', label: '结论' },
    ] as const;
    const ccShown = baseCols as Array<'index' | 'project' | 'standard' | 'result'>;
    const setCcShown = (k: 'index' | 'project' | 'standard' | 'result', on: boolean) => {
      const order = ['index', 'project', 'standard', 'result'] as const;
      const nonSample = order.filter(x => x === k ? on : ccShown.includes(x));
      const finalNon = nonSample.length ? nonSample : ['index', 'project', 'result'];
      // 保留样品列（若原本在 columns 里，或样品列模式非「不显示」）——放最前，与渲染端 sample_col 处理一致。
      const keepSample = (cTbl.columns || []).includes('sample');
      onChange({ conclusion_table: { ...cTbl, columns: (keepSample ? ['sample', ...finalNon] : finalNon) as any } });
    };
    const setCLabel = (k: string, v: string) => onChange({ conclusion_table: { ...cTbl, column_labels: { ...cLbl, [k]: v || undefined } } });
    configTab = (
      <Form layout="vertical" size="small">
        <Alert type="info" showIcon style={{ marginBottom: 12 }}
          message="生成报告时自动展开"
          description="行 = 各项目的检测结论（来自原始记录里标了「作为检测结论」的字段，一个项目可有多个子结论）。多样品时同一样品的多行会合并显示。标题在「标签」Tab 设、整表字体/加粗/对齐在「格式」Tab、下方备注在「备注」Tab。" />
        <Form.Item label="样品列"
          tooltip="按样品分组显示（同一样品的多行在样品列合并成一格）。自动＝多样品才显示、单样品自动隐藏；始终显示/不显示＝强制。">
          <Radio.Group optionType="button" buttonStyle="solid" size="small"
            value={field.conclusion_table?.sample_col || 'auto'}
            onChange={(e) => onChange({ conclusion_table: { ...(field.conclusion_table || {}), sample_col: e.target.value } })}
            options={[
              { value: 'auto', label: '自动（单样品隐藏）' },
              { value: 'show', label: '始终显示' },
              { value: 'hide', label: '不显示' },
            ]} />
        </Form.Item>
        <Form.Item label="列（勾选显示 · 改列名 · 调列宽）"
          tooltip="每行一列：开关＝是否显示该列；中间＝列名（留空用默认）；右侧＝列宽旋钮+单位（fr 比例 / % 页宽 / cm / pt，留空＝默认）。样品列的显示由上方「样品列」模式控制，此处仅调宽。">
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            {/* 样品列：显隐由上方「样品列」模式控制；不显示时不出现在此，仅调宽 */}
            {cTbl.sample_col !== 'hide' && (() => {
              const cur = parseW(widthOf('sample'));
              return (
                <Space key="sample" size={8}>
                  <Tag color="blue" style={{ margin: 0, width: 62, textAlign: 'center' }}>样品列</Tag>
                  <Input size="small" style={{ width: 150 }} addonBefore="列名" placeholder="样品"
                    value={cLbl.sample ?? ''} onChange={(e) => setCLabel('sample', e.target.value)} />
                  <InputNumber size="small" style={{ width: 138 }} placeholder="自适应"
                    min={0} step={cur.unit === '%' ? 5 : cur.unit === 'pt' ? 1 : 0.5} value={cur.num}
                    onChange={(v) => setColWidth('sample', v == null ? '' : `${v}${cur.unit}`)}
                    addonAfter={<AntSelect size="small" style={{ width: 58 }} value={cur.unit}
                      onChange={(u) => setColWidth('sample', cur.num != null ? `${cur.num}${u}` : '')} options={W_UNITS} />} />
                </Space>
              );
            })()}
            {CC_COLS.map((col, i) => {
              const on = ccShown.includes(col.key);
              const cur = parseW(widthOf(col.key));
              return (
                <Space key={col.key} size={8}>
                  <Switch size="small" checked={on} onChange={(v) => setCcShown(col.key, v)} />
                  <Input size="small" style={{ width: 150 }} addonBefore={`列${i + 1}`} placeholder={col.label} disabled={!on}
                    value={cLbl[col.key] ?? ''} onChange={(e) => setCLabel(col.key, e.target.value)} />
                  <InputNumber size="small" style={{ width: 138 }} placeholder={col.key === 'index' ? '自适应' : '均分'} disabled={!on}
                    min={0} step={cur.unit === '%' ? 5 : cur.unit === 'pt' ? 1 : 0.5} value={cur.num}
                    onChange={(v) => setColWidth(col.key, v == null ? '' : `${v}${cur.unit}`)}
                    addonAfter={<AntSelect size="small" style={{ width: 58 }} value={cur.unit}
                      onChange={(u) => setColWidth(col.key, cur.num != null ? `${cur.num}${u}` : '')} options={W_UNITS} />} />
                </Space>
              );
            })}
          </Space>
        </Form.Item>
        <Form.Item label="行高（单元格上下留白）"
          tooltip="加大＝每行更高更疏松；留空＝默认 8pt。">
          <InputNumber min={0} max={40} step={1} style={{ width: 150 }} addonAfter="pt" placeholder="默认 8"
            value={cTbl.cell_inset_y ? parseFloat(cTbl.cell_inset_y) : undefined}
            onChange={(v) => onChange({ conclusion_table: { ...cTbl, cell_inset_y: v != null ? `${v}pt` : undefined } })} />
        </Form.Item>
      </Form>
    );
  } else if (field.type === 'report_result_table') {
    configTab = <ReportResultTableCanvas field={field} onChange={onChange} linkedRecord={linkedRecord} />;
  } else if (field.type === 'free_grid') {
    configTab = <FreeGridCanvas
      field={field}
      template={template}
      onChange={onChange}
      linkedRecord={linkedRecord}
      editorMode={editorMode}
      documentFont={docFont}
      documentSize={docSize}
      onCellFocus={(rowId) => onDetailFocus?.(`${field.code}::__detail__:row:${rowId}`)}
    />;
  } else if (field.type === 'report_equipment_table') {
    configTab = (
      <Form layout="vertical" size="small">
        <Alert type="info" showIcon style={{ marginBottom: 12 }}
          message="生成报告时自动汇集"
          description="从关联原始记录中所有「设备」字段填的设备编号，反查设备库；输出列「设备名称 / 设备型号 / 设备编号 / 溯源日期 / 到期日期」。溯源日期、到期日期均从设备库直接取；缺日期的设备会跳过并在顶部提示。" />
        <Form.Item label="数据来源（留空 = 全部设备字段）">
          <AntSelect mode="multiple" allowClear style={{ width: '100%' }}
            value={field.equipment_table?.source_field_codes || []}
            onChange={(v) => onChange({ equipment_table: { ...(field.equipment_table || {}), source_field_codes: v as string[] } })}
            placeholder="选关联原始记录中的某些设备字段；不选 = 全部"
            options={(linkedRecord?.groups || []).flatMap(g => g.fields)
              .filter(f => f.type === 'device_ref')
              .map(f => ({ value: f.code, label: f.label || '未命名设备字段' }))} />
        </Form.Item>
        <Form.Item label="列">
          <AntSelect mode="multiple" style={{ width: '100%' }}
            value={field.equipment_table?.columns || ['name', 'model', 'asset_code', 'trace_date', 'expire_date']}
            onChange={(v) => onChange({ equipment_table: { ...(field.equipment_table || {}), columns: v as any } })}
            options={[
              { value: 'name', label: '设备名称' },
              { value: 'model', label: '设备型号' },
              { value: 'asset_code', label: '设备编号' },
              { value: 'trace_date', label: '溯源日期' },
              { value: 'expire_date', label: '到期日期' },
            ]} />
        </Form.Item>
        <Form.Item label="表格版式" tooltip="设备多时可能跨页。与检测结果表/数据表格同口径。">
          <Space wrap size={[16, 8]}>
            <span style={{ fontSize: 12 }}>
              <Switch size="small" checked={field.equipment_table?.keep_together !== false}
                onChange={(v) => onChange({ equipment_table: { ...(field.equipment_table || {}), keep_together: v } })} /> 尽量同页
            </span>
            <span style={{ fontSize: 12 }}>
              <Switch size="small" checked={field.equipment_table?.repeat_header_on_break !== false}
                onChange={(v) => onChange({ equipment_table: { ...(field.equipment_table || {}), repeat_header_on_break: v } })} /> 跨页重复表头
            </span>
            <span style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>对齐：
              <Radio.Group size="small" optionType="button" buttonStyle="solid"
                value={field.equipment_table?.cell_align || 'center'}
                onChange={(e) => onChange({ equipment_table: { ...(field.equipment_table || {}), cell_align: e.target.value } })}
                options={[{ value: 'left', label: '左' }, { value: 'center', label: '中' }, { value: 'right', label: '右' }]} />
            </span>
            <span style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>行内留白：
              <InputNumber size="small" style={{ width: 70 }} min={0} max={40} step={1} placeholder="默认"
                value={field.equipment_table?.cell_inset_y ? parseFloat(field.equipment_table.cell_inset_y) : undefined}
                onChange={(v) => onChange({ equipment_table: { ...(field.equipment_table || {}), cell_inset_y: v == null ? undefined : `${v}pt` } })} /> pt
            </span>
            <span style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>空值符：
              <Input size="small" style={{ width: 64 }} placeholder="—"
                value={field.equipment_table?.empty_cell_display ?? ''}
                onChange={(e) => onChange({ equipment_table: { ...(field.equipment_table || {}), empty_cell_display: e.target.value || undefined } })} />
            </span>
          </Space>
        </Form.Item>
      </Form>
    );
  } else if (field.type === 'report_image_gallery') {
    const gal = field.image_gallery || {};
    const setGal = (patch: any) => onChange({ image_gallery: { ...gal, ...patch } });
    const recImgFields = (linkedRecord?.groups || []).flatMap(g => g.fields).filter(f => f.type === 'image');
    const imgOptions = recImgFields.map(f => ({ value: f.code, label: f.label || '未命名图片字段' }));
    const isManual = Array.isArray(gal.items);
    const items = gal.items || [];
    const setItems = (next: any[]) => setGal({ items: next });
    const updItem = (id: string, patch: any) => setItems(items.map((it: any) => it.id === id ? { ...it, ...patch } : it));
    const addItem = () => setItems([...items, { id: `gi_${Date.now()}_${Math.floor(Math.random() * 1e4)}`, source_field_code: recImgFields[0]?.code || '', layout: 'loose' }]);
    const rmItem = (id: string) => setItems(items.filter((it: any) => it.id !== id));
    const mvItem = (idx: number, dir: -1 | 1) => {
      const t = idx + dir; if (t < 0 || t >= items.length) return;
      const next = [...items]; [next[idx], next[t]] = [next[t], next[idx]]; setItems(next);
    };
    configTab = (
      <Form layout="vertical" size="small">
        {/* 原「基础」的 标签/显示标题/备注/说明 并入此处顶部——不再单出「基础」Tab */}
        {basicMetaBlock}
        <Alert type="info" showIcon style={{ marginBottom: 12 }}
          message="项目模板拥有图片排版，照片来自关联原始记录"
          description="自动：按下面所选 image 字段直接铺排（继承其样式）。手动（推荐）：在此定义图位+排版，每个图位「绑定」一个原始记录 image 字段作为照片来源——生成时照片填进来、排版以本模板为准。" />
        {!linkedRecord && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="未关联原始记录模板，无法绑定照片来源。" />}
        <Form.Item label="模式">
          <Radio.Group optionType="button" buttonStyle="solid" value={isManual ? 'manual' : 'auto'}
            onChange={(e) => { if (e.target.value === 'manual') { setGal({ items: recImgFields.map((f, i) => ({ id: `gi_${Date.now()}_${i}`, source_field_code: f.code, layout: f.image_layout || 'loose', row_ratio: f.image_row_ratio, cols: f.image_cols })) }); } else setGal({ items: undefined }); }}
            options={[{ value: 'auto', label: '自动（继承原始记录）' }, { value: 'manual', label: '手动（定义图位+绑定）' }]} />
        </Form.Item>
        {/* 版式：与「生成报告」编辑器**共用同一组件**（ImageLayoutControls）+ 同一份 image_gallery 配置 → 两处 UI/可调项完全一致、不漂移；模板设好即带到报告 */}
        <Form.Item label="图片版式" extra="每张一个标题＝每个图位各自标题；共用＝整组一个表内标题（下方填）。独立框/粘连、尺寸、每行张数、单数独占同「生成报告」编辑器。">
          <ImageLayoutControls value={gal} onChange={setGal} onTitleModeChange={(m) => setGal({ title_mode: m })} />
        </Form.Item>
        {(gal.title_mode || 'per') === 'shared' && (
          <Form.Item label="共用表内标题">
            <AutoGrowTextArea size="small" value={gal.shared_title ?? ''} placeholder="整组共用的表内标题（空＝不显示）"
              onChange={(e) => setGal({ shared_title: e.target.value })} />
          </Form.Item>
        )}
        {!isManual && (
          <Form.Item label={<span><LinkOutlined /> 照片来源（绑定原始记录的图片字段；留空 = 全部）</span>}>
            <AntSelect mode="multiple" allowClear style={{ width: '100%' }}
              value={gal.source_field_codes || []}
              onChange={(v) => setGal({ source_field_codes: v as string[] })}
              placeholder="选关联原始记录中的图片字段；不选 = 全部"
              options={imgOptions} />
          </Form.Item>
        )}
        {isManual && (
          <Form.Item label="图位（每个图位 = 一处照片 + 排版；先绑定来源再调排版）">
            {items.length === 0 && <div style={{ fontSize: 12, color: '#999', marginBottom: 6 }}>暂无图位，点下方「添加图位」</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {items.map((it: any, idx: number) => {
                const bound = !!it.source_field_code;
                return (
                <div key={it.id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 10, background: '#fff' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <Tag color="blue" style={{ marginRight: 0 }}>图位 {idx + 1}</Tag>
                    <div style={{ flex: 1 }} />
                    <Tooltip title="上移"><Button size="small" type="text" icon={<ArrowUpOutlined />} disabled={idx === 0} onClick={() => mvItem(idx, -1)} /></Tooltip>
                    <Tooltip title="下移"><Button size="small" type="text" icon={<ArrowDownOutlined />} disabled={idx === items.length - 1} onClick={() => mvItem(idx, 1)} /></Tooltip>
                    <Tooltip title="删除图位"><Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => rmItem(it.id)} /></Tooltip>
                  </div>
                  {/* 绑定来源——显著标注，避免用户不知道是绑定 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, background: bound ? '#f6ffed' : '#fff7e6', border: `1px solid ${bound ? '#b7eb8f' : '#ffe58f'}` }}>
                    <span style={{ fontSize: 12, color: bound ? '#389e0d' : '#d48806', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <LinkOutlined /> 照片来源
                    </span>
                    <AntSelect size="small" style={{ flex: 1 }} status={bound ? undefined : 'warning'}
                      placeholder="选择原始记录中的图片字段（绑定后照片会填进来）"
                      value={it.source_field_code || undefined} options={imgOptions}
                      onChange={(v) => updItem(it.id, { source_field_code: v })} />
                  </div>
                  {!bound && <div style={{ fontSize: 11, color: '#d48806', marginTop: 3 }}>⚠ 未绑定照片来源，生成报告时本图位为空</div>}
                  {/* 排版 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, color: '#888', whiteSpace: 'nowrap' }}>排版</span>
                    <AutoGrowTextArea size="small" style={{ width: 130 }} placeholder="标题(空=不显示)"
                      value={it.label ?? ''} onChange={(e) => updItem(it.id, { label: e.target.value })} />
                    <Radio.Group size="small" optionType="button" value={it.layout || 'loose'}
                      onChange={(e) => updItem(it.id, { layout: e.target.value })}
                      options={[{ value: 'loose', label: '整行' }, { value: 'compact', label: '并排' }]} />
                    {it.layout === 'compact' && (
                      <InputNumber size="small" style={{ width: 92 }} min={0.1} max={1} step={0.05} addonAfter="占比"
                        value={it.row_ratio ?? 0.5} onChange={(v) => updItem(it.id, { row_ratio: v ?? 0.5 })} />
                    )}
                    <InputNumber size="small" style={{ width: 90 }} min={1} max={6} addonAfter="张/行"
                      value={it.cols ?? 1} onChange={(v) => updItem(it.id, { cols: v && v > 1 ? v : undefined })} />
                  </div>
                </div>
                );
              })}
            </div>
            <Button size="small" type="dashed" icon={<PlusOutlined />} style={{ marginTop: 8 }} onClick={addItem} disabled={!recImgFields.length}>添加图位</Button>
          </Form.Item>
        )}
      </Form>
    );
  } else if (field.type === 'report_photo_table') {
    const pt = field.photo_table || {};
    const setPT = (patch: any) => onChange({ photo_table: { ...pt, ...patch } });
    configTab = (
      <Form layout="vertical" size="small">
        {/* 原「基础」的 标签/显示标题/备注/说明 并入此处顶部——不再单出「基础」Tab */}
        {basicMetaBlock}
        <Alert type="info" showIcon style={{ marginBottom: 12 }}
          message="原样照片表（首页用）"
          description="模板里只设标准文案（标签 / 说明 / 表头）与位置。照片上传和图片版式（每行张数 / 尺寸）由文员在「生成报告 → 编辑首页」时设置——模板期不编辑图片。" />
        <Form.Item label="说明行·加粗标签" extra="渲染时自动跟一个全角冒号；留空＝不显示标签。">
          <AutoGrowTextArea value={pt.caption_label ?? ''} placeholder="如 样品描述"
            onChange={(e) => setPT({ caption_label: e.target.value })} />
        </Form.Item>
        <Form.Item label="说明行·普通文字" extra="不加粗，跟在标签后面。">
          <AutoGrowTextArea value={pt.caption_text ?? ''} placeholder="如 见原始样品照片。"
            onChange={(e) => setPT({ caption_text: e.target.value })} />
        </Form.Item>
        <Form.Item label="图片表表头" extra="渲染在图片表格首行；留空＝不显示表头行。">
          <AutoGrowTextArea value={pt.header ?? ''} placeholder="如 原始样品"
            onChange={(e) => setPT({ header: e.target.value })} />
        </Form.Item>
      </Form>
    );
  } else if (field.type === 'report_sample_description_table') {
    const sd = field.sample_description_table || {};
    const setSD = (patch: any) => onChange({ sample_description_table: { ...sd, ...patch } });
    configTab = (
      <Form layout="vertical" size="small">
        <Alert type="info" showIcon style={{ marginBottom: 12 }}
          message="样品描述表（报告首页）"
          description="按本报告包含的样品生成“唯一性编号 / 样品描述”两列表。建议将该字段拖到原样照片字段前；生成报告后可进入自由编辑表格，逐个修改样品描述。" />
        <Form.Item label="第一列表头">
          <Input value={sd.unique_label ?? ''} placeholder="唯一性编号" onChange={event => setSD({ unique_label: event.target.value })} />
        </Form.Item>
        <Form.Item label="第二列表头">
          <Input value={sd.description_label ?? ''} placeholder="样品描述" onChange={event => setSD({ description_label: event.target.value })} />
        </Form.Item>
        <Form.Item label="默认样品描述" extra="生成报告时写入每个样品行，之后文员可以分别修改。">
          <AutoGrowTextArea value={sd.default_description ?? ''} placeholder="见原始样品照片"
            onChange={event => setSD({ default_description: event.target.value })} />
        </Form.Item>
        <Space size={8} style={{ width: '100%' }}>
          <Form.Item label="唯一性编号列宽" style={{ flex: 1 }}>
            <Input value={sd.unique_width ?? ''} placeholder="1fr" onChange={event => setSD({ unique_width: event.target.value })} />
          </Form.Item>
          <Form.Item label="样品描述列宽" style={{ flex: 1 }}>
            <Input value={sd.description_width ?? ''} placeholder="3.5fr" onChange={event => setSD({ description_width: event.target.value })} />
          </Form.Item>
        </Space>
      </Form>
    );
  } else if (field.type === 'report_sample_table') {
    const st = field.sample_table || {};
    const setST = (patch: any) => onChange({ sample_table: { ...st, ...patch } });
    const lbl = st.column_labels || {};
    const ST_COLS = [
      { key: 'index', label: '样品编号' },
      { key: 'name', label: '样品名称' },
      { key: 'model', label: '零件号' },
    ] as const;
    const stShown = (st.columns && st.columns.length ? st.columns : ['index', 'name', 'model']) as Array<'index' | 'name' | 'model'>;
    const setStShown = (k: 'index' | 'name' | 'model', on: boolean) => {
      const next = (['index', 'name', 'model'] as const).filter(x => x === k ? on : stShown.includes(x));
      setST({ columns: next.length ? next : ['index', 'name', 'model'] });
    };
    const stLegacy: Record<string, string> = {};
    stShown.forEach((c, i) => { if (st.col_widths?.[i]) stLegacy[c] = st.col_widths[i]; });
    const stWidthOf = (c: string) => (st.col_widths_map as Record<string, string> | undefined)?.[c] ?? stLegacy[c] ?? '';
    const setStWidth = (c: string, v: string) => {
      const m = { ...(st.col_widths_map || {}) } as Record<string, string>;
      if (v) m[c] = v; else delete m[c];
      setST({ col_widths_map: m });
    };
    const ST_W_UNITS = [{ value: 'fr', label: 'fr' }, { value: '%', label: '%' }, { value: 'cm', label: 'cm' }, { value: 'pt', label: 'pt' }];
    const stParseW = (s: string): { num: number | undefined; unit: string } => {
      const m = /^([\d.]+)(fr|cm|mm|pt|in|%)$/.exec(s || '');
      return m ? { num: parseFloat(m[1]), unit: m[2] } : { num: undefined, unit: 'fr' };
    };
    configTab = (
      <Form layout="vertical" size="small">
        <Alert type="info" showIcon style={{ marginBottom: 12 }}
          message="样品信息表"
          description="默认列出报告对应样品的编号、名称和零件号，只有一个样品也显示。可按需要选择单样品时折叠。" />
        <Form.Item label="单/多样品" tooltip="自动＝多样品出表、单样品折叠（首页直接显示样品名称/零件号）。始终显示＝不论几个样品都出表。">
          <Radio.Group optionType="button" buttonStyle="solid" size="small"
            value={st.mode || 'always'}
            onChange={(e) => setST({ mode: e.target.value })}
            options={[{ label: '自动（多样品出表 / 单样品折叠）', value: 'auto' }, { label: '始终显示', value: 'always' }]} />
        </Form.Item>
        <Form.Item label="列（勾选显示 · 改列名 · 调列宽）"
          tooltip="每行一列：开关＝是否显示该列；中间＝列名（留空用默认）；右侧＝列宽旋钮+单位（fr 比例 / % 页宽 / cm / pt，留空＝均分页宽）。">
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            {ST_COLS.map((col, i) => {
              const on = stShown.includes(col.key);
              const cur = stParseW(stWidthOf(col.key));
              return (
                <Space key={col.key} size={8}>
                  <Switch size="small" checked={on} onChange={(v) => setStShown(col.key, v)} />
                  <Input size="small" style={{ width: 150 }} addonBefore={`列${i + 1}`} placeholder={col.label} disabled={!on}
                    value={lbl[col.key] ?? ''} onChange={(e) => setST({ column_labels: { ...lbl, [col.key]: e.target.value } })} />
                  <InputNumber size="small" style={{ width: 138 }} placeholder="均分" disabled={!on}
                    min={0} step={cur.unit === '%' ? 5 : cur.unit === 'pt' ? 1 : 0.5} value={cur.num}
                    onChange={(v) => setStWidth(col.key, v == null ? '' : `${v}${cur.unit}`)}
                    addonAfter={<AntSelect size="small" style={{ width: 58 }} value={cur.unit}
                      onChange={(u) => setStWidth(col.key, cur.num != null ? `${cur.num}${u}` : '')} options={ST_W_UNITS} />} />
                </Space>
              );
            })}
          </Space>
        </Form.Item>
        <Form.Item label="行高（单元格上下留白）" tooltip="加大＝每行更高更疏松；留空＝默认 6pt。">
          <InputNumber min={0} max={40} step={1} style={{ width: 150 }} addonAfter="pt" placeholder="默认 6"
            value={st.cell_inset_y ? parseFloat(st.cell_inset_y) : undefined}
            onChange={(v) => setST({ cell_inset_y: v != null ? `${v}pt` : undefined })} />
        </Form.Item>
      </Form>
    );
  } else if (field.type === 'daterange') {
    const dr = field.date_range || {};
    const setDR = (patch: any) => onChange({ date_range: { ...dr, ...patch } });
    const lr = caps.linkedRecordBinding ? linkedRecord : null;
    configTab = (
      <Form layout="vertical" size="small">
        <Alert type="info" showIcon style={{ marginBottom: 12 }}
          message="时间范围（如检测周期）"
          description="渲染成「开始 ~ 结束」。每一端点下方按钮：选「自定义」可手填日期；选「委托单字段」等可绑定（如 检测开始日期 / 检测结束日期）。缺一端只显另一端。" />
        <Space wrap size={16} align="start">
          <Form.Item label="时间精度" tooltip="开始和结束两端统一按该精度显示。">
            <Radio.Group size="small" optionType="button" buttonStyle="solid"
              value={field.date_precision || 'day'}
              onChange={(e) => onChange({ date_precision: e.target.value === 'day' ? undefined : e.target.value })}
              options={DATE_PRECISION_OPTIONS} />
          </Form.Item>
          <Form.Item label="日期分隔符">
            <Radio.Group size="small" optionType="button" buttonStyle="solid"
              value={field.date_separator || '-'}
              onChange={(e) => onChange({ date_separator: e.target.value === '-' ? undefined : e.target.value })}
              options={[{ value: '-', label: '-' }, { value: '/', label: '/' }]} />
          </Form.Item>
        </Space>
        <Form.Item label="开始日期">
          <CellBindingButton binding={dr.start || { source: 'literal', text: '' }} linkedRecord={lr} onChange={(b) => setDR({ start: b })} />
        </Form.Item>
        <Form.Item label="结束日期">
          <CellBindingButton binding={dr.end || { source: 'literal', text: '' }} linkedRecord={lr} onChange={(b) => setDR({ end: b })} />
        </Form.Item>
        <Form.Item label="分隔符" tooltip="开始与结束之间的连接符，缺省「 ~ 」。可填「 至 」「 — 」等。">
          <Input style={{ width: 140 }} value={dr.separator ?? ''} placeholder=" ~ "
            onChange={(e) => setDR({ separator: e.target.value })} />
        </Form.Item>
        {/* 原「基础」的 说明 并入此处——daterange 也收成 字段名/字段值/格式 三页 */}
        <Form.Item label="录入提示（说明）"
          tooltip="录入页此字段的灰色提示文字，帮助实验员填写；不进 PDF。留空＝无提示。">
          <AutoGrowTextArea autoSize={{ minRows: 2, maxRows: 3 }} value={field.description || ''}
            onChange={(e) => onChange({ description: e.target.value || undefined })} />
        </Form.Item>
        <Form.Item label="字段值样式（字体/字号/加粗/斜体/颜色）" style={{ marginBottom: 0 }}>
          <FormatPanel inheritedFont={docFont} inheritedSize={docSize} variant="text" value={field.value_style}
            onChange={(vs) => onChange({ value_style: vs })} />
        </Form.Item>
      </Form>
    );
  }

  // —— Tab:版式（报告自动表/图：标题显隐+样式 / 题注位置 / 对齐 / 段前后间距）——
  // 渲染端走 wrapFigure，故这些 field.style/label_style/caption_position 都会生效。
  // 标题是否显示：原始记录数据表＝默认显示（hide_label 缺省=显示、=true 才隐藏）；报告自动表＝默认隐藏（仅 ===false 才显示）。
  const titleShown = (field.type === 'data_matrix' || field.type === 'image') ? !field.hide_label : field.hide_label === false;
  const showTableTextStyle = TABLE_TEXT_STYLE_TYPES.includes(field.type);
  // 原始记录表格 / 试验数据表格：表头与内容【分开】设 加粗+字体+字号（渲染端 cellStylePair 逐格生效）。
  const showHeaderBodyTextStyle = field.type === 'free_grid' || field.type === 'data_matrix';
  const figureLayoutTab = (
    <Form layout="vertical" size="small">
      {/* 标题（标签）：非图片表格已移到独立「标签」Tab；此处仅图片表/图（!hasLabelNoteTabs）保留。 */}
      {!hasLabelNoteTabs && (titleShown ? (
        <>
          <Form.Item label="标题样式（字体/字号/加粗/斜体/颜色）" style={{ marginBottom: 8 }}
            extra={field.type === 'data_matrix' ? '标题的「显示/隐藏」开关在「类型配置」Tab。' : '标题的「显示/隐藏」开关在「基础」Tab。'}>
            <FormatPanel inheritedFont={docFont} inheritedSize={docSize} inheritedBold={true} variant="text" value={field.label_style}
              onChange={(ls) => onChange({ label_style: ls })} />
          </Form.Item>
          {/* 图片标题渲染为表格内表头行（框内），没有"标题↔图距离"可调——故仅非图片类型显示此项 */}
          {field.type !== 'image' && (
            <Form.Item label="标题与图/表的距离"
              tooltip="标题和它下方表/图之间的留白（pt）。留空＝默认紧贴。">
              <InputNumber min={0} max={60} step={1} style={{ width: 140 }} addonAfter="pt"
                value={field.label_gap ? parseFloat(field.label_gap) : docGapPt}
                onChange={(v) => onChange({ label_gap: v != null ? `${v}pt` : undefined })} />
            </Form.Item>
          )}
        </>
      ) : (
        <div style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>
          表/图标题已关闭。要显示标题并调标题样式，请到「{field.type === 'data_matrix' ? '类型配置' : '基础'}」Tab 打开标题。
        </div>
      ))}
      {/* 整表文字（有表头/内容的报告表：结果表/设备表/样品信息表/检测结论表）：字体/字号/表头·内容加粗 + 内容对齐 */}
      {showTableTextStyle && (
        <Form.Item label="整表文字（字体/字号/表头·内容加粗/内容对齐）"
          tooltip="作用于整张表的字体、字号，表头/内容是否加粗，以及表格内容的水平对齐（类似原始记录里的试验数据表格）。缺省＝表头加粗、内容常规、居中、字体字号继承。">
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Space size={8} wrap>
              <span style={{ fontSize: 12, color: '#888' }}>字体</span>
              <AntSelect size="small" style={{ width: 150 }} allowClear
                value={field.table_style?.font ?? docFont}
                onChange={(v) => onChange({ table_style: cleanTableStyle({ ...field.table_style, font: v || undefined }) })}
                options={TABLE_FONT_OPTIONS} />
              <span style={{ fontSize: 12, color: '#888' }}>字号</span>
              <InputNumber size="small" style={{ width: 92 }} min={6} max={20} step={0.5} addonAfter="pt"
                value={field.table_style?.font_size ? parseFloat(field.table_style.font_size) : docSize}
                onChange={(v) => onChange({ table_style: cleanTableStyle({ ...field.table_style, font_size: v != null ? `${v}pt` : undefined }) })} />
            </Space>
            <Space size={20} wrap>
              <span style={{ fontSize: 12, color: '#888' }}>表头加粗
                <Switch size="small" style={{ marginLeft: 6 }}
                  checked={field.table_style?.header_bold !== false}
                  onChange={(v) => onChange({ table_style: cleanTableStyle({ ...field.table_style, header_bold: v ? undefined : false }) })} />
              </span>
              <span style={{ fontSize: 12, color: '#888' }}>内容加粗
                <Switch size="small" style={{ marginLeft: 6 }}
                  checked={field.table_style?.body_bold === true}
                  onChange={(v) => onChange({ table_style: cleanTableStyle({ ...field.table_style, body_bold: v ? true : undefined }) })} />
              </span>
            </Space>
            {/* 内容对齐：样品信息表 / 检测结论表用 table_style.cell_align 统一整表对齐；
                结果表/设备表另有各自的对齐设置（结果表画布 / 设备表「类型配置」），此处不重复给以免冲突。 */}
            {(field.type === 'report_sample_table' || field.type === 'report_conclusion_table') && (
              <Space size={8}>
                <span style={{ fontSize: 12, color: '#888' }}>内容对齐</span>
                <Radio.Group size="small" optionType="button" buttonStyle="solid"
                  value={field.table_style?.cell_align || 'center'}
                  onChange={(e) => onChange({ table_style: cleanTableStyle({ ...field.table_style, cell_align: e.target.value === 'center' ? undefined : e.target.value }) })}
                  options={[{ value: 'left', label: '靠左' }, { value: 'center', label: '居中' }, { value: 'right', label: '靠右' }]} />
              </Space>
            )}
          </Space>
        </Form.Item>
      )}
      {/* 表头/内容默认文字样式；自由表格画布中设置的单元格格式优先覆盖。 */}
      {showHeaderBodyTextStyle && (() => {
        const tsv = field.table_style;
        const setTS = (patch: Record<string, any>) => onChange({ table_style: cleanTableStyle({ ...tsv, ...patch }) });
        // 未设本级字体/字号时，直接显示【当前实际生效值】：本级 ＞ 整表 table_style.font/font_size ＞ 文档默认(docFont/docSize)。
        const fbFont = tsv?.font || docFont;
        const fbSize = tsv?.font_size ? parseFloat(tsv.font_size) : docSize;
        const fontRow = (fontVal: string | undefined, sizeVal: string | undefined, onFont: (v?: string) => void, onSize: (v: number | null) => void) => (
          <Space size={8} wrap>
            <span style={{ fontSize: 12, color: '#888' }}>字体</span>
            <AntSelect size="small" style={{ width: 150 }} allowClear
              value={fontVal ?? fbFont} onChange={(v) => onFont(v || undefined)} options={TABLE_FONT_OPTIONS} />
            <span style={{ fontSize: 12, color: '#888' }}>字号</span>
            <InputNumber size="small" style={{ width: 92 }} min={6} max={20} step={0.5} addonAfter="pt"
              value={sizeVal ? parseFloat(sizeVal) : fbSize} onChange={onSize} />
          </Space>
        );
        return (
          <>
            <Form.Item label="表头默认文字（加粗 / 字体 / 字号）"
              tooltip="作为所有表头格的默认样式；画布中给单元格单独设置的格式优先。字体/字号留空＝跟随文档默认。">
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <span style={{ fontSize: 12, color: '#888' }}>加粗
                  <Switch size="small" style={{ marginLeft: 6 }}
                    checked={tsv?.header_bold !== false}
                    onChange={(v) => setTS({ header_bold: v ? undefined : false })} />
                </span>
                {fontRow(tsv?.header_font, tsv?.header_font_size,
                  (v) => setTS({ header_font: v }),
                  (v) => setTS({ header_font_size: v != null ? `${v}pt` : undefined }))}
              </Space>
            </Form.Item>
            <Form.Item label="内容默认文字（加粗 / 字体 / 字号）"
              tooltip="作为所有数据/内容格的默认样式；画布中给单元格单独设置的格式优先。字体/字号留空＝跟随文档默认。">
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <span style={{ fontSize: 12, color: '#888' }}>加粗
                  <Switch size="small" style={{ marginLeft: 6 }}
                    checked={tsv?.body_bold === true}
                    onChange={(v) => setTS({ body_bold: v ? true : undefined })} />
                </span>
                {fontRow(tsv?.body_font, tsv?.body_font_size,
                  (v) => setTS({ body_font: v }),
                  (v) => setTS({ body_font_size: v != null ? `${v}pt` : undefined }))}
              </Space>
            </Form.Item>
          </>
        );
      })()}
      {/* 备注（题注）：非图片表格已移到独立「备注」Tab；此处仅图片表/图（!hasLabelNoteTabs）保留。 */}
      {!hasLabelNoteTabs && (
        <>
          {field.type !== 'image' && (
            <Form.Item label="备注（题注）位置"
              tooltip="备注信息（在「基础」里填）相对图/表的位置。">
              <Radio.Group optionType="button" buttonStyle="solid" size="small"
                value={field.caption_position || 'below'}
                onChange={(e) => onChange({ caption_position: e.target.value === 'below' ? undefined : e.target.value })}
                options={[{ value: 'above', label: '表/图上方' }, { value: 'below', label: '表/图下方' }]} />
            </Form.Item>
          )}
          <Form.Item label="备注与图/表的距离"
            tooltip="备注和图/表之间的留白（pt）。留空＝默认。需先在「基础」里填了备注信息才有效果。">
            <InputNumber min={0} max={40} step={1} style={{ width: 140 }} addonAfter="pt"
              value={field.caption_gap ? parseFloat(field.caption_gap) : docGapPt}
              onChange={(v) => onChange({ caption_gap: v != null ? `${v}pt` : undefined })} />
          </Form.Item>
          <Form.Item label="备注样式（字体/字号/加粗/斜体/颜色）"
            tooltip="备注文字的样式。缺省 9pt 常规。需先在「基础」里填了备注信息才有效果。">
            <FormatPanel inheritedFont={docFont} inheritedSize={docSize} variant="text" value={field.caption_style}
              onChange={(cs) => onChange({ caption_style: cs })} />
          </Form.Item>
        </>
      )}
      <Form.Item label="对齐与间距" style={{ marginBottom: 0 }}>
        <FormatPanel variant="layout" value={field.style}
          onChange={(st) => onChange({ style: st })} />
        <div style={{ fontSize: 11, color: '#aaa', marginTop: 6 }}>
          对齐＝整张表/图左中右；段前/段后＝与上下内容之间的留白。
        </div>
      </Form.Item>
    </Form>
  );

  // —— Tab 3:格式（样式层叠：文档 → 区块 → 字段）——
  // 简单值类型（text/number/date/choice）的格式/绑定已折进「字段」Tab 的 字段名/字段值/版式 三段；
  // 仅非简单值但仍可格式化的类型（计算/设备/引用等）保留独立「格式」「取值绑定」Tab。
  const formatAllowed = !NO_FORMAT_BINDING.includes(field.type) && !isSimpleValue && field.type !== 'static_content';

  // —— Tab 4:取值绑定（报告专属）——
  const bindingAllowed = isReportMode && !NO_FORMAT_BINDING.includes(field.type) && !isSimpleValue;

  const items = [
    // 【不再有独立「基础」Tab】：类别/必填在 Tab 上方常驻行；其余原「基础」内容按类型分流——
    //   · 简单值(文本/数字/日期/选择)+时间范围：单位/行数/说明/选项 → 各自「字段值」Tab；
    //   · 设备/图片表/图片组：标签/说明(+显示标题/备注) → 各自「类型配置」Tab（basicMetaBlock）；
    //   · 间隔(spacer)：标签/说明对空白块无意义，直接丢弃；
    //   · 表格类(hasLabelNoteTabs)：标签/备注在独立 Tab，基础本就空白。
    // 简单值类型：字段名 / 字段值 / 格式 三个顶层 Tab（与原来一样在上方分区）
    ...(isSimpleValue ? [
      { key: 'name', label: '字段名', children: nameTab },
      { key: 'value', label: '字段值', children: valueTab },
      { key: 'layout', label: '格式', children: layoutTab },
    ] : []),
    // 时间范围（检测周期）：与简单字段一样给 字段名/字段值/格式 三页；
    // 字段值＝两端日期绑定 + 分隔符 + 值样式（即上面的 configTab），故不再单出「类型配置」页。
    ...(isDateRange ? [
      { key: 'name', label: '字段名', children: nameTab },
      { key: 'value', label: '字段值', children: configTab },
      { key: 'layout', label: '格式', children: layoutTab },
    ] : []),
    ...(configTab && !isDateRange ? [{ key: 'config', label: '类型配置', children: configTab }] : []),
    // 报告自动表/图 + 原始记录数据表 + 原始记录表格：统一「格式」顶层 Tab（标题显隐+样式 / 备注位置/样式 / 对齐 / 段前后间距）
    // free_grid 属 hasLabelNoteTabs，故此 Tab 里只留「对齐与间距」+「表头/内容文字」（标题在「标签」、备注在「备注」Tab），与数据表格一致。
    ...((FIGURE_LAYOUT_TYPES.includes(field.type) || field.type === 'data_matrix' || field.type === 'image' || field.type === 'free_grid') ? [{ key: 'figure-layout', label: '格式', children: figureLayoutTab }] : []),
    // 非图片表格：把表格【标题】与【备注】拆成独立 Tab（标签＝表格左上方标题；备注＝表格下方说明）
    ...(hasLabelNoteTabs ? [
      { key: 'label', label: '标签', children: labelTab },
      { key: 'notes', label: '备注', children: notesTab },
    ] : []),
    ...(formatAllowed ? [{
      key: 'format',
      label: '格式',
      children: (
        <div>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 10 }}>
            字段级样式覆盖区块/文档默认（未设 = 继承上层）。
          </div>
          <div style={{ marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: '#888', marginRight: 8 }}>字段名（标签）</span>
            <Radio.Group size="small" optionType="button"
              value={field.label_bold === undefined ? (docLabelBold ? 'bold' : 'regular') : (field.label_bold ? 'bold' : 'regular')}
              onChange={(e) => onChange({ label_bold: e.target.value === 'bold' })}
              options={[
                { value: 'bold', label: '加粗' },
                { value: 'regular', label: '正常' },
              ]} />
            <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>单独控制这个字段名是否加粗（如"检测要求/检测结果"）。仿宋等无粗体字体会用描边模拟。</div>
          </div>
          <FormatPanel inheritedFont={docFont} inheritedSize={docSize} value={field.style} onChange={(style) => onChange({ style })} />
          {labelValueGapControl}
        </div>
      ),
    }] : []),
    ...(bindingAllowed ? [{
      key: 'binding',
      label: '取值绑定',
      children: (
        <Form layout="vertical" size="small">
          <Form.Item extra="点击下方按钮可视化选取数据来源：自定义 / 委托单字段 / 系统字段 / 原始记录字段 / 矩阵单元 / 矩阵汇总">
            <CellBindingButton
              binding={field.binding || { source: 'literal', text: '' }}
              linkedRecord={caps.linkedRecordBinding ? linkedRecord : null}
              onChange={(b) => onChange({ binding: b })}
            />
          </Form.Item>
        </Form>
      ),
    }] : []),
  ];

  // 图片字段：点击单张图片时只编辑“图片名称”（每张标题模式下作为表内标题）。
  // 尺寸、排布、边距和文字样式仍全部收敛在图片分区卡中，避免字段级与分区级配置互相覆盖。
  if (field.type === 'image') {
    const canBindImageSource = isReportMode && caps.linkedRecordBinding;
    const recImgFields = canBindImageSource
      ? (linkedRecord?.groups || []).flatMap(g => g.fields).filter(f => f.type === 'image')
      : [];
    const imgOptions = recImgFields.map(f => ({ value: f.code, label: f.label || '未命名图片字段' }));
    const bound = !!field.image_source_code;
    return (
      <div style={{ padding: 8 }}>
        <Form layout="vertical" size="small">
          <Form.Item
            label="图片名称（表内标题）"
            extra="图片分区使用“每张一个标题”时显示此名称；同时作为数据录入时该图片项的初始名称。"
          >
            <AutoGrowTextArea
              value={field.label || ''}
              placeholder="请输入图片名称"
              autoSize={{ minRows: 1, maxRows: 3 }}
              onChange={(event) => onChange({ label: event.target.value })}
            />
          </Form.Item>

          {canBindImageSource && (
            <Form.Item
              label={<span><LinkOutlined /> 图片来源（原始记录）</span>}
              extra="仅决定从关联原始记录的哪个图片分区取图，不控制图片版式。"
            >
              {!linkedRecord && <Alert type="warning" showIcon style={{ marginBottom: 8 }} message="未关联原始记录模板，无法绑定来源。" />}
              <AntSelect
                showSearch
                optionFilterProp="label"
                allowClear
                style={{ width: '100%' }}
                status={bound ? undefined : 'warning'}
                placeholder="选择原始记录图片来源"
                value={field.image_source_code || undefined}
                options={imgOptions}
                onChange={(value) => onChange({ image_source_code: (value as string) || undefined })}
              />
              {!bound && <div style={{ fontSize: 11, color: '#d48806', marginTop: 4 }}>⚠ 未绑定来源，生成报告时本图位为空。</div>}
            </Form.Item>
          )}
        </Form>

        <Alert
          type="info"
          showIcon
          message="其他图片设置由分区统一管理"
          description="每行数量、图片尺寸、边距、单数排布以及表内标题字体和字号，请在图片分区标题栏的“图片版式 / 格式”中设置。"
        />
      </div>
    );
  }

  // key 含 field.id + category：切换字段 / 切换类别时回到首个 tab，避免停留在已消失的 tab
  return (
    <div>
      {categoryRow}
      {historyEnabled && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', marginBottom: 8, background: '#f7f9fc', border: '1px solid #eef0f3', borderRadius: 6 }}>
          <Tooltip title="恢复当前表格类型的默认结构；字段名、标签、备注和外层格式不变">
            <Button size="small" icon={<ReloadOutlined />} disabled={!commitReplaceField} onClick={resetTableToDefault}>重置默认</Button>
          </Tooltip>
        </div>
      )}
      <Tabs size="small" key={`${field.id}:${category}`} items={items} />
    </div>
  );
}

// ============ 字段面板辅助组件 ============
function RecordConclusionConfigEditor({ field, onChange }: {
  field: FieldDefinition;
  onChange: (patch: Partial<FieldDefinition>) => void;
}) {
  const cfg = field.record_conclusion || {
    mode: 'overall' as const,
    project_name: '检测项目',
    allow_project_name_override: true,
    items: [],
  };
  const setCfg = (patch: Partial<NonNullable<FieldDefinition['record_conclusion']>>) =>
    onChange({ record_conclusion: { ...cfg, ...patch } });
  const updateItem = (index: number, patch: Record<string, any>) => {
    const items = cfg.items.map((item, i) => i === index ? { ...item, ...patch } : item);
    setCfg({ items });
  };
  const removeItem = (index: number) => setCfg({ items: cfg.items.filter((_, i) => i !== index) });
  const addItem = () => {
    const seq = cfg.items.length + 1;
    setCfg({ items: [...cfg.items, {
      id: `conclusion_${Date.now()}_${seq}`,
      code: `item_${seq}`,
      name_mode: cfg.mode === 'overall' ? 'inherit_project' : 'custom',
      name: cfg.mode === 'children' ? `子项目${seq}` : undefined,
      allow_name_override: true,
      judgment_options: ['标准要求', '客户要求'],
      conclusion_options: ['符合', '不符合'],
      judgment_required: true,
      conclusion_required: true,
      default_report_enabled: true,
    }] });
  };
  const changeMode = (mode: 'overall' | 'children') => {
    const existing = cfg.items.length ? cfg.items : [{
      id: `conclusion_${Date.now()}`, code: 'overall', judgment_required: true, conclusion_required: true, default_report_enabled: true,
      judgment_options: ['标准要求', '客户要求'], conclusion_options: ['符合', '不符合'],
    }];
    const items = mode === 'overall'
      ? [{ ...existing[0], code: existing[0].code || 'overall', name_mode: 'inherit_project' as const, name: undefined }]
      : existing.map((item, index) => ({ ...item, name_mode: 'custom' as const, name: item.name || `子项目${index + 1}` }));
    setCfg({
      mode,
      items,
      ...(mode === 'children' && !cfg.project_summary ? {
        project_summary: {
          judgment_enabled: true,
          conclusion_enabled: true,
          judgment_requirement: existing[0]?.judgment_requirement,
          judgment_options: existing[0]?.judgment_options || ['标准要求', '客户要求'],
          conclusion_options: existing[0]?.conclusion_options || ['符合', '不符合'],
          judgment_required: false,
          conclusion_required: false,
        },
      } : {}),
    });
  };
  // 旧版 children 配置没有 project_summary，按“两个总项目可选字段均已删除”回放，避免静默改变存量模板。
  const projectSummary = cfg.project_summary || { judgment_enabled: false, conclusion_enabled: false };
  const setProjectSummary = (patch: Partial<NonNullable<NonNullable<FieldDefinition['record_conclusion']>['project_summary']>>) =>
    setCfg({ project_summary: { ...projectSummary, ...patch } });

  return (
    <Form layout="vertical" size="small">
      <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message="报告结论的单一数据来源"
        description="整体模式在首页生成一行；子项目模式按每个已完成且允许进报告的子项目生成多行。项目名称和子项目名称可在录入时按下方权限修改。" />
      <Form.Item label="结论展示模式">
        <Radio.Group optionType="button" buttonStyle="solid" value={cfg.mode}
          onChange={(event) => changeMode(event.target.value)}
          options={[{ value: 'overall', label: '整体项目结论' }, { value: 'children', label: '按子项目展开' }]} />
      </Form.Item>
      <Form.Item label="报告项目名称" required>
        <AutoGrowTextArea value={cfg.project_name || ''} placeholder="例如：弯曲性能"
          onChange={(event) => setCfg({ project_name: event.target.value })} />
      </Form.Item>
      <Space wrap style={{ marginBottom: 12 }}>
        <span>录入时允许修改项目名称</span>
        <Switch checked={cfg.allow_project_name_override !== false}
          onChange={(checked) => setCfg({ allow_project_name_override: checked })} />
        <span style={{ color: '#999', fontSize: 11 }}>系统会自动维护稳定的匹配标识</span>
      </Space>
      {cfg.mode === 'children' && <div style={{ padding: 10, marginBottom: 12, border: '1px solid #d6e4ff', borderRadius: 6, background: '#f7faff' }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>总项目字段</div>
        <div style={{ color: '#7a8599', fontSize: 11, marginBottom: 10 }}>
          总项目名称始终保留并用作报告项目名称；判定要求和总结论可按模板需要保留或删除。首页检测结论表仍只显示下方子项目。
        </div>
        <Space wrap style={{ marginBottom: 10 }}>
          <span>保留判定要求</span>
          <Switch size="small" checked={projectSummary.judgment_enabled !== false}
            onChange={(checked) => setProjectSummary({ judgment_enabled: checked })} />
          <span>保留总结论</span>
          <Switch size="small" checked={projectSummary.conclusion_enabled !== false}
            onChange={(checked) => setProjectSummary({ conclusion_enabled: checked })} />
        </Space>
        {projectSummary.judgment_enabled !== false && <>
          <Form.Item label="默认总项目判定要求" style={{ marginBottom: 8 }}>
            <AutoGrowTextArea value={projectSummary.judgment_requirement || ''} placeholder="可留空，录入时填写"
              onChange={(event) => setProjectSummary({ judgment_requirement: event.target.value || undefined })} />
          </Form.Item>
          <Form.Item label="总项目判定要求常用选项" style={{ marginBottom: 8 }}>
            <AntSelect mode="tags" value={projectSummary.judgment_options || ['标准要求', '客户要求']}
              onChange={(values) => setProjectSummary({ judgment_options: values })} />
          </Form.Item>
        </>}
        {projectSummary.conclusion_enabled !== false && <Form.Item label="总结论选项" style={{ marginBottom: 8 }}>
          <AntSelect mode="tags" value={projectSummary.conclusion_options || ['符合', '不符合']}
            onChange={(values) => setProjectSummary({ conclusion_options: values })} />
        </Form.Item>}
        <Space wrap>
          {projectSummary.judgment_enabled !== false && <><span>总项目判定要求必填</span><Switch size="small"
            checked={projectSummary.judgment_required === true}
            onChange={(checked) => setProjectSummary({ judgment_required: checked })} /></>}
          {projectSummary.conclusion_enabled !== false && <><span>总结论必填</span><Switch size="small"
            checked={projectSummary.conclusion_required === true}
            onChange={(checked) => setProjectSummary({ conclusion_required: checked })} /></>}
        </Space>
      </div>}
      <Form.Item label="允许整份记录没有已完成项目"
        tooltip="开启后，所有结论项都标记为未检测/不适用/无法检测时仍可提交审核归档；该方法不会出现在报告检测结论表中。">
        <Switch checked={cfg.allow_no_completed_items === true}
          onChange={(checked) => setCfg({ allow_no_completed_items: checked })} />
      </Form.Item>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <b>{cfg.mode === 'overall' ? '整体结论' : '子项目结论'}</b>
        {cfg.mode === 'children' && <Button size="small" type="dashed" icon={<PlusOutlined />} style={{ marginLeft: 'auto' }} onClick={addItem}>添加子项目</Button>}
      </div>
      {cfg.items.map((item, index) => (
        <div key={item.id} style={{ padding: 10, marginBottom: 10, border: '1px solid #e8e8e8', borderRadius: 6, background: '#fafafa' }}>
          <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 8 }}>
            <b>{cfg.mode === 'overall' ? '整体项目' : `子项目 ${index + 1}`}</b>
            {cfg.mode === 'children' && cfg.items.length > 1 && <Button size="small" danger type="text" icon={<DeleteOutlined />} onClick={() => removeItem(index)}>删除</Button>}
          </Space>
          {cfg.mode === 'children' && <Form.Item label="子项目名称" required style={{ marginBottom: 8 }}>
            <Input value={item.name || ''} onChange={(event) => updateItem(index, { name: event.target.value })} />
          </Form.Item>}
          <Form.Item label="默认判定要求" style={{ marginBottom: 8 }}>
            <AutoGrowTextArea value={item.judgment_requirement || ''} placeholder="可留空，录入时填写"
              onChange={(event) => updateItem(index, { judgment_requirement: event.target.value || undefined })} />
          </Form.Item>
          <Form.Item label="判定要求常用选项" style={{ marginBottom: 8 }}>
            <AntSelect mode="tags" value={item.judgment_options || []}
              onChange={(values) => updateItem(index, { judgment_options: values })} />
          </Form.Item>
          <Form.Item label="结论选项" style={{ marginBottom: 8 }}>
            <AntSelect mode="tags" value={item.conclusion_options || ['符合', '不符合']}
              onChange={(values) => updateItem(index, { conclusion_options: values })} />
          </Form.Item>
          <Space wrap>
            <span>录入时可改名称</span><Switch size="small" checked={item.allow_name_override !== false}
              onChange={(checked) => updateItem(index, { allow_name_override: checked })} />
            <span>判定要求必填</span><Switch size="small"
              checked={item.judgment_required ?? item.required !== false}
              onChange={(checked) => updateItem(index, { judgment_required: checked })} />
            <span>结论必填</span><Switch size="small"
              checked={item.conclusion_required ?? item.required !== false}
              onChange={(checked) => updateItem(index, { conclusion_required: checked })} />
            <span>默认进入报告</span><Switch size="small" checked={item.default_report_enabled !== false}
              onChange={(checked) => updateItem(index, { default_report_enabled: checked })} />
          </Space>
        </div>
      ))}
      {!cfg.items.length && <Button block type="dashed" icon={<PlusOutlined />} onClick={addItem}>添加结论项</Button>}
    </Form>
  );
}

/** 报告模式·字段值来源：手填(literal) / 抓取(binding)。本组件按 field.id key 化，切字段重置 intent。 */
function ReportValueSource({ field, linkedRecord, onChange }: {
  field: FieldDefinition;
  linkedRecord: RecordTemplate | null;
  onChange: (patch: Partial<FieldDefinition>) => void;
}) {
  const isLiteral = !field.binding || field.binding.source === 'literal';
  const [intent, setIntent] = useState<'manual' | 'fetch'>(isLiteral ? 'manual' : 'fetch');
  // binding 被 picker 改成非自定义后，intent 跟到「抓取」（保持显示一致）
  const mode = !isLiteral ? 'fetch' : intent;
  const literalText = field.binding && field.binding.source === 'literal' ? (field.binding.text || '') : '';
  if (field.rich && coverCanEditInline(field) && storedReportRichDocument(literalText)) {
    return <CoverInlineEditor field={field} sources={[]} onChange={text => onChange({ binding: { source: 'literal', text } })} />;
  }
  return (
    <>
      <Form.Item label="来源" style={{ marginBottom: 8 }}
        tooltip="自定义=文员直接写固定文字（声明/备注）；映射=从委托单 / 接口字段 / 原始记录字段取值，具体来源在下方选。">
        <Radio.Group optionType="button" buttonStyle="solid" size="small" value={mode}
          onChange={(e) => {
            const m = e.target.value as 'manual' | 'fetch';
            setIntent(m);
            if (m === 'manual') onChange({ binding: { source: 'literal', text: literalText } });
          }}
          options={[{ value: 'manual', label: '自定义' }, { value: 'fetch', label: '映射' }]} />
      </Form.Item>
      {mode === 'manual' ? (
        <Form.Item label="自定义内容" style={{ marginBottom: 8 }} extra="文员直接写的固定文字">
          <AutoGrowTextArea autoSize={{ minRows: 2, maxRows: 3 }} value={literalText}
            onChange={(e) => onChange({ binding: { source: 'literal', text: e.target.value } })} />
        </Form.Item>
      ) : (
        <Form.Item label="数据来源" style={{ marginBottom: 8 }}
          extra="自定义 / 委托单字段 / 系统字段 / 原始记录字段 / 矩阵单元 / 矩阵汇总">
          <CellBindingButton
            binding={field.binding || { source: 'literal', text: '' }}
            linkedRecord={linkedRecord}
            onChange={(b) => onChange({ binding: b })}
          />
        </Form.Item>
      )}
      {/* 报告模板字段不走录入 default_value，故此处不展示「默认值」控件 */}
    </>
  );
}

// ============ 「选择」统一编辑面板 ============
// 单选 (select) / 多选 (checkbox)
// 注：variant_list（选项挂子字段）已废弃；遇到旧数据展示提示并允许一键转为普通单选。
function ChoiceEditor({
  field,
  onReplace,
  onChange,
}: {
  field: FieldDefinition;
  onReplace: (f: FieldDefinition) => void;
  onChange: (patch: Partial<FieldDefinition>) => void;
}) {
  const mode = choiceModeOf(field);
  const isLegacyVariant = field.type === 'variant_list';

  const handleModeChange = (next: ChoiceMode) => {
    onReplace(rebuildFieldForCategory(field, 'choice', next));
  };

  const convertToSingle = () => {
    // 把每个 variant.label 作为选项；丢弃子字段
    const opts = (field.variants || []).map(v => v.label).filter(Boolean);
    onReplace(rebuildFieldForCategory({ ...field, options: opts.length ? opts : ['选项1'] }, 'choice', 'single'));
  };

  return (
    <>
      {isLegacyVariant && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="此字段使用了已废弃的「选项挂子字段」模式"
          description={
            <Space direction="vertical" size={4}>
              <span>建议拆成独立字段（如把"试验环境"拆为"试验环境温度"+"试验环境湿度"两个数字字段），或一键转为普通单选（仅保留选项标签，丢弃子字段）。</span>
              <Button size="small" danger onClick={convertToSingle}>转为普通单选</Button>
            </Space>
          }
        />
      )}

      <Form.Item label="选择模式">
        <Radio.Group
          value={mode === 'with_subfields' ? 'single' : mode}
          onChange={(e) => handleModeChange(e.target.value as ChoiceMode)}
          optionType="button"
          buttonStyle="solid"
          disabled={isLegacyVariant}
        >
          <Radio.Button value="single">单选</Radio.Button>
          <Radio.Button value="multi">多选</Radio.Button>
        </Radio.Group>
        <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
          {mode === 'single' && '实验人员只能选一项'}
          {mode === 'multi' && '实验人员可勾选多项'}
        </div>
      </Form.Item>

      {!isLegacyVariant && (
        <>
          <Form.Item label="选项列表">
            <OptionsEditor
              options={field.options || []}
              onChange={(options) => onChange({ options })}
            />
          </Form.Item>
          <Form.Item label="允许「其他（自定义）」">
            <Switch checked={field.allow_custom !== false} onChange={(v) => onChange({ allow_custom: v })} />
            <span style={{ fontSize: 11, color: '#888', marginLeft: 8 }}>
              打开后实验人员可选「其他」并手动输入
            </span>
          </Form.Item>
          {mode === 'multi' && <>
            <Form.Item label="选中内容排版"><AntSelect value={field.choice_display?.layout || 'inline'} options={[{ value: 'inline', label: '同一行，用符号分隔' }, { value: 'lines', label: '每项一行' }]} onChange={layout => onChange({ choice_display: { ...field.choice_display, layout } })} /></Form.Item>
            {field.choice_display?.layout === 'lines' ? <>
              <Form.Item label="行首标记"><AntSelect value={field.choice_display.marker || 'none'} options={[{ value: 'none', label: '无' }, { value: 'number', label: '编号：1. 2. 3.' }, { value: 'number_parentheses', label: '编号：（1）（2）（3）' }, { value: 'bullet', label: '分点：•' }]} onChange={marker => onChange({ choice_display: { ...field.choice_display, marker } })} /></Form.Item>
              <Form.Item label="每项结尾符号"><Input value={field.choice_display.ending ?? ''} placeholder="可填句号、逗号、分号，或留空" onChange={e => onChange({ choice_display: { ...field.choice_display, ending: e.target.value } })} /></Form.Item>
              {field.choice_display.marker && field.choice_display.marker !== 'none' && <div style={{ border: '1px solid #dce2eb', borderRadius: 8, padding: 12, marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <span>仅选一项时显示行首标记</span>
                  <Switch aria-label="仅选一项时显示行首标记" checked={field.choice_display.show_marker_for_single !== false}
                    onChange={show_marker_for_single => onChange({ choice_display: { ...field.choice_display, show_marker_for_single } })} />
                </div>
                <div style={{ color: '#888', fontSize: 12, marginTop: 12, marginBottom: 6 }}>仅选一项时的显示效果</div>
                <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: '#f5f7fa', padding: 10, borderRadius: 4 }}>
                  {formatChoiceValue((field.options?.length ? field.options : ['选项一']).slice(0, 1), field.choice_display)}
                </div>
              </div>}
            </> : <Form.Item label="分隔符"><Input value={field.choice_display?.separator ?? '、'} placeholder="可填顿号、逗号、分号、空格等" onChange={e => onChange({ choice_display: { ...field.choice_display, separator: e.target.value } })} /></Form.Item>}
          </>}
        </>
      )}
    </>
  );
}

// ============ 选项编辑器（select/checkbox 共用）：拖拽排序 + 批量粘贴 ============
let optListSeq = 0;
function OptionsEditor({ options, onChange, placeholder }: { options: string[]; onChange: (opts: string[]) => void; placeholder?: string }) {
  // 每个编辑器实例一个 listId，多个选项列表（如同屏多面板）拖拽互不串
  const listIdRef = useRef('');
  if (!listIdRef.current) listIdRef.current = `optlist-${++optListSeq}`;
  const listId = listIdRef.current;

  const [batchOpen, setBatchOpen] = useState(false);
  const [batchText, setBatchText] = useState('');

  const moveOption = (from: number, insertIdx: number) => {
    const next = [...options];
    const [opt] = next.splice(from, 1);
    let ins = insertIdx;
    if (from < insertIdx) ins -= 1;
    ins = Math.max(0, Math.min(ins, next.length));
    next.splice(ins, 0, opt);
    onChange(next);
  };

  const applyBatch = () => {
    const opts = batchText.split('\n').map(s => s.trim()).filter(Boolean);
    if (opts.length) onChange(opts);
    setBatchOpen(false);
  };

  return (
    <div>
      {options.map((opt, i) => (
        <OptionRow
          key={i}
          listId={listId}
          index={i}
          value={opt}
          placeholder={placeholder}
          onValueChange={(v) => {
            const next = [...options];
            next[i] = v;
            onChange(next);
          }}
          onRemove={() => onChange(options.filter((_, j) => j !== i))}
          onMove={moveOption}
        />
      ))}
      <Space.Compact block>
        <Button size="small" icon={<PlusOutlined />} onClick={() => onChange([...options, ''])} type="dashed" style={{ flex: 1 }}>添加选项</Button>
        <ClosablePopover
          trigger="click"
          open={batchOpen}
          onOpenChange={(v) => { setBatchOpen(v); if (v) setBatchText(options.filter(Boolean).join('\n')); }}
          title="批量编辑选项（一行一个，确定后替换整个列表）"
          content={
            <div style={{ width: 280 }}>
              <Input.TextArea rows={8} value={batchText} onChange={(e) => setBatchText(e.target.value)}
                placeholder={'选项1\n选项2\n选项3'} />
              <div style={{ textAlign: 'right', marginTop: 8 }}>
                <Button size="small" type="primary" onClick={applyBatch}>确定</Button>
              </div>
            </div>
          }
        >
          <Button size="small" type="dashed" icon={<SnippetsOutlined />}>批量粘贴</Button>
        </ClosablePopover>
      </Space.Compact>
    </div>
  );
}

function OptionRow({ listId, index, value, placeholder, onValueChange, onRemove, onMove }: {
  listId: string;
  index: number;
  value: string;
  placeholder?: string;
  onValueChange: (v: string) => void;
  onRemove: () => void;
  onMove: (from: number, insertIdx: number) => void;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<'above' | 'below'>('above');
  const [{ isDragging }, drag, preview] = useDrag(() => ({
    type: 'fe-option',
    item: { listId, index },
    collect: m => ({ isDragging: m.isDragging() }),
  }), [listId, index]);
  const [{ isOver }, drop] = useDrop<{ listId: string; index: number }, void, { isOver: boolean }>(() => ({
    accept: 'fe-option',
    collect: m => {
      const item = m.getItem();
      return { isOver: m.isOver() && item?.listId === listId && item?.index !== index };
    },
    hover: (item, monitor) => {
      if (item.listId !== listId) return;
      const rect = rowRef.current?.getBoundingClientRect();
      const y = monitor.getClientOffset()?.y;
      if (rect && y != null) setPos(y < rect.top + rect.height / 2 ? 'above' : 'below');
    },
    drop: (item, monitor) => {
      if (item.listId !== listId || item.index === index) return;
      const rect = rowRef.current?.getBoundingClientRect();
      const y = monitor.getClientOffset()?.y ?? 0;
      const before = rect ? y < rect.top + rect.height / 2 : true;
      onMove(item.index, before ? index : index + 1);
    },
  }), [listId, index, onMove]);

  return (
    <div
      ref={(node) => { rowRef.current = node; preview(drop(node)); }}
      style={{
        display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4,
        opacity: isDragging ? 0.35 : 1,
        boxShadow: isOver ? (pos === 'above' ? 'inset 0 2px 0 #1366d9' : 'inset 0 -2px 0 #1366d9') : undefined,
      }}
    >
      <span ref={(n) => { drag(n); }}><HolderOutlined className="fe-drag" /></span>
      <AutoGrowTextArea size="small" value={value} placeholder={placeholder}
        onChange={(e) => onValueChange(e.target.value)} />
      <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={onRemove} />
    </div>
  );
}

/** 单元格绑定按钮：显示当前绑定摘要；点击打开 BindingPickerModal */
function CellBindingButton({ binding, linkedRecord, onChange }: {
  binding: any;
  linkedRecord: RecordTemplate | null;
  onChange: (b: any) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="small" type="dashed" block style={{ textAlign: 'left', height: 'auto', padding: '4px 8px', whiteSpace: 'normal' }}
        onClick={() => setOpen(true)}>
        <BindingSummary value={binding} linkedRecord={linkedRecord} />
      </Button>
      <BindingPickerModal
        open={open}
        value={binding}
        linkedRecord={linkedRecord}
        // 配【项目模板】映射（已关联原始记录）时，除原始记录外也允许取订单级字段、当前样品和当前分单；
        // sample/test 均由生成报告时的项目上下文动态解析，不依赖固定样品序号。
        // 首页/封面（linkedRecord=null）只给 自定义 / 委托单字段 / 样品信息 / 报告字段 四类——
        // 样品信息(report_sample)单独成组（取自报告 1.2，非委托单）；去掉样品清单/样品/测试项目/系统等。
        allowedSources={linkedRecord
          ? ['literal', 'order', 'sample', 'test', 'record_field', 'record_cell', 'record_summary', 'record_header', 'record_meta']
          : ['literal', 'order', 'report_sample', 'report_meta', 'record_meta']}
        onChange={onChange}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
