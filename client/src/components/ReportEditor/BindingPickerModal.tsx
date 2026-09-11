/**
 * BindingPickerModal — 可视化数据源选取器
 *
 * 模式：
 *  1. 自定义 / 委托单字段 / 系统字段 —— 表单
 *  2. 原始记录字段 —— 按分组列出可点击的字段卡片
 *  3. 原始记录矩阵单元 —— 渲染矩阵骨架；用户直接点格选中（含样品行 + 列头）
 *  4. 原始记录汇总行 —— 渲染矩阵骨架；用户点汇总行的单元格
 */
import { useState, useEffect, useMemo } from 'react';
import { Modal, Tabs, Input, Select, Tag, Button, Empty, Space, Alert, Switch, Segmented } from 'antd';
import type { CellBinding, RecordTemplate, FieldDefinition } from '../../../../shared/types';
import { freeGridSourceBinding, recordSampleBands, sampleBandForCell } from '../../../../shared/free-grid-binding';
import AutoGrowTextArea from '../AutoGrowTextArea';

interface Props {
  open: boolean;
  value: CellBinding;
  linkedRecord: RecordTemplate | null;
  onChange: (b: CellBinding) => void;
  onClose: () => void;
  /**
   * P-Map-11：限制可见来源 tab（白名单 source 键）。缺省 undefined＝全部（按 linkedRecord 过滤）。
   * 项目检测结果表传 ['literal','record_field','record_cell','record_summary','record_header']
   * ——只暴露原始记录来源，统一两套绑定 UI。
   */
  allowedSources?: string[];
  /** 自定义弹窗标题（如「为 项目×标准 选择数据来源」）。 */
  title?: string;
  /** 只允许从指定原始记录自由表格选格（报告自由表格的受控参数轴使用）。 */
  freeGridFieldCode?: string;
  /** 自由表格专用紧凑模式：直接显示来源表格，不先展示通用来源页签。 */
  compactFreeGrid?: boolean;
  /** 紧凑映射器打开时默认编辑内容或单位。 */
  initialCompactTarget?: 'content' | 'unit';
  /** 单位来源是否随当前试样展开；仅逐试样目标格开启。 */
  sampleUnitMode?: boolean;
  unitValue?: CellBinding;
  /** 当前格是否已配置内容来源；用于只编辑单位时保留“无内容映射”状态。 */
  contentValuePresent?: boolean;
  onUnitChange?: (b: CellBinding | undefined) => void;
  /** 表头文字与单位一次提交，避免两次状态更新互相覆盖。 */
  onCombinedChange?: (value: CellBinding | undefined, unit: CellBinding | undefined) => void;
  /**
   * P-Map-11c：绑定的是"试样带"那一行/列里的单元格时，传带子绑定的矩阵 code——
   * 弹窗会出「试样带·当前试样」tab（参数列→record_cell_sample / 样品名→record_sample_label）。
   * 同时 allowedSources 要含 'record_cell_sample'。
   */
  bandMatrixCode?: string;
}

// 委托单【订单级】字段（接口 1.1 PushOrderInfos 订单属性）。与 BindingEditor.tsx 对齐。
const ORDER_KEYS = [
  { value: 'order_no', label: '委托单号' },
  { value: 'customer_name', label: '委托单位' },
  { value: 'sample_name', label: '样品名称（报告范围）' },
  { value: 'received_at', label: '接收日期' },
  { value: 'test_period', label: '检测周期（开始~结束）' },
  { value: 'test_start', label: '检测开始日期' },
  { value: 'test_end', label: '检测结束日期' },
  { value: 'company_address', label: '委托单位地址' },
  { value: 'send_date', label: '送检日期' },
  { value: 'time_required', label: '客户要求期限' },
  { value: 'test_time_required', label: '检测要求期限' },
  { value: 'report_deadline', label: '报告期限' },
  { value: 'authorites', label: '证书单位' },
  { value: 'english_authorites', label: '英文证书单位' },
  { value: 'authorites_address', label: '证书单位地址' },
  { value: 'english_authorites_address', label: '英文证书单位地址' },
  { value: 'sale_name', label: '业务员' },
  { value: 'job_no', label: '业务员工号' },
  { value: 'buyer', label: '买家' },
  { value: 'status', label: '委托单状态' },
  { value: 'remark', label: '订单备注' },
  { value: 'is_chinese_report', label: '是否需要中文报告' },
  { value: 'is_english_report', label: '是否需要英文报告' },
  { value: 'is_paper_report', label: '是否需要纸质报告' },
  { value: 'report_count', label: '报告数量' },
  { value: 'other_report_count', label: '其他报告数量' },
  { value: 'complete_way', label: '完工方式' },
];

// 报告【样品信息】字段（接口 1.2 报告样品；首页单样品直接显示，多样品改用「样品信息表」字段）。
const SAMPLE_REPORT_KEYS = [
  { value: 'name', label: '样品名称' },
  { value: 'sort_no', label: '样品编号' },
  { value: 'model', label: '零件号' },
];

// 委托单【样品级】字段（接口 1.1 样品属性）。
const SAMPLE_KEYS = [
  { value: 'sample_name', label: '样品名称' },
  { value: 'barcode', label: '样品条码' },
  { value: 'sort_no', label: '样品序号' },
  { value: 'model', label: '型号' },
];

// 委托单【材料分单 / 测试项目级】字段（接口 1.1 TaskList 属性）。
const TEST_KEYS = [
  { value: 'project_name', label: '检测项目' },
  { value: 'standard', label: '标准号' },
  { value: 'main_engine_factory', label: '主机厂' },
  { value: 'test_method', label: '测试方法' },
  { value: 'test_condition', label: '测试条件' },
  { value: 'sampling_mode', label: '制样方式' },
  { value: 'sampling_requirement', label: '制样要求' },
  { value: 'limit_name', label: '限值名称（牌号）' },
  { value: 'limit_content', label: '限值内容' },
  { value: 'leader', label: '分单负责人' },
  { value: 'start_date', label: '开始测试日期' },
  { value: 'end_date', label: '结束测试日期' },
  { value: 'sample_description', label: '样品描述' },
  { value: 'test_remark', label: '检测备注' },
  { value: 'material_uploader', label: '分单人' },
  { value: 'remark', label: '制样备注' },
];

// 报告接口【页眉页脚 / 抬头字段】（接口 1.2 PushReportInfos → ReportMeta）。
// 中英文按 Language 已在服务端 buildReportMetaFromReq 选中；这里仍列出 _en 以便英文报告显式绑定。
const REPORT_META_KEYS = [
  { value: 'report_no', label: '报告编号' },
  { value: 'cover_report_no', label: '首页报告编号' },
  { value: 'verify_code', label: '检验码' },
  { value: 'issue_date', label: '签发日期' },
  { value: 'company_name', label: '公司名称' },
  { value: 'company_name_en', label: '公司名称（英）' },
  { value: 'company_address', label: '公司地址' },
  { value: 'company_address2', label: '公司地址2' },
  { value: 'company_address_en', label: '公司地址（英）' },
  { value: 'company_address2_en', label: '公司地址2（英）' },
  { value: 'fax', label: '传真' },
  { value: 'fax_en', label: '传真（英）' },
  { value: 'phone', label: '电话' },
  { value: 'phone_en', label: '电话（英）' },
  { value: 'website', label: '网址' },
  { value: 'report_note', label: '报告备注' },
  { value: 'report_note_en', label: '报告备注（英）' },
  { value: 'qualification_note', label: '资质备注' },
  { value: 'qualification_note_en', label: '资质备注（英）' },
  { value: 'customer_name', label: '客户名称' },
  { value: 'customer_address', label: '客户地址' },
];

const SYSTEM_KEYS = [
  { value: 'today', label: '今天日期' },
  { value: 'now', label: '当前时间' },
];

const RECORD_META_KEYS = [
  { value: 'tester_name', label: '主检姓名' },
  { value: 'tested_at', label: '检测时间' },
  { value: 'reviewer_name', label: '审核姓名' },
  { value: 'reviewed_at', label: '审核时间' },
];

// P-Map-4：这些来源需要"某个具体样品/项目"的上下文（per-project resolve），只在**项目报告**（有关联原始记录）里有意义。
// 首页/封面是订单级、没有单一样品/项目上下文 → 隐藏它们，避免映射弹窗太杂乱（首页只留 自定义/委托单/报告接口/系统）。
const PROJECT_ONLY_KEYS = ['sample', 'test', 'record_field', 'record_field_unit', 'record_cell', 'record_summary', 'record_free_cell', 'record_free_cell_sample', 'record_free_template_cell', 'record_free_formula_cell', 'record_free_formula_cell_sample', 'record_free_cell_unit', 'record_free_cell_unit_sample'];

export default function BindingPickerModal({ open, value, linkedRecord, onChange, onClose, allowedSources, title, freeGridFieldCode, bandMatrixCode, compactFreeGrid = false, initialCompactTarget = 'content', sampleUnitMode = false, unitValue, contentValuePresent = true, onUnitChange, onCombinedChange }: Props) {
  // 从 value 推断初始 tab
  const initialTab = (() => {
    if (value.source === 'literal') return 'literal';
    if (value.source === 'order') return 'order';
    if (value.source === 'order_samples') return 'order_samples';
    if (value.source === 'sample') return 'sample';
    if (value.source === 'test') return 'test';
    if (value.source === 'report_meta') return 'report_meta';
    if (value.source === 'report_sample') return 'report_sample';
    if (value.source === 'system') return 'system';
    if (value.source === 'record_meta') return 'record_field';
    if (value.source === 'record_field' || value.source === 'record_field_unit') return 'record_field';
    if (value.source === 'record_cell' || value.source === 'record_summary' || value.source === 'record_header'
      || value.source === 'record_cell_sample' || value.source === 'record_sample_label' || value.source === 'record_sample_index'
      || value.source === 'record_free_cell' || value.source === 'record_free_cell_sample' || value.source === 'record_free_template_cell'
      || value.source === 'record_free_formula_cell' || value.source === 'record_free_formula_cell_sample'
      || value.source === 'record_free_cell_unit' || value.source === 'record_free_cell_unit_sample') return 'record_table';
    return 'literal';
  })();
  const [tab, setTab] = useState(initialTab);

  useEffect(() => { if (open) setTab(initialTab); /* eslint-disable-next-line */ }, [open]);

  // 当前临时值（本地编辑，确定后提交）
  const [draft, setDraft] = useState<CellBinding>(value);
  useEffect(() => { if (open) setDraft(value); }, [open, value]);
  const [unitDraft, setUnitDraft] = useState<CellBinding | undefined>(unitValue);
  const [compactTarget, setCompactTarget] = useState<'content' | 'unit'>(initialCompactTarget);
  const [contentTouched, setContentTouched] = useState(false);
  const [contentSourceMode, setContentSourceMode] = useState<'free_grid' | 'record_field'>(value.source === 'record_field' ? 'record_field' : 'free_grid');
  const unitModeOf = (binding?: CellBinding): 'free_grid' | 'record_field' | 'literal' =>
    binding?.source === 'record_field_unit' ? 'record_field' : binding?.source === 'literal' ? 'literal' : 'free_grid';
  const [unitSourceMode, setUnitSourceMode] = useState<'free_grid' | 'record_field' | 'literal'>(unitModeOf(unitValue));
  const recordDataModeOf = (binding: CellBinding): 'matrix' | 'free_grid' | 'header' | 'band' => {
    if (binding.source === 'record_header') return 'header';
    if (binding.source === 'record_cell_sample' || binding.source === 'record_sample_label' || binding.source === 'record_sample_index') return 'band';
    if (binding.source === 'record_free_cell' || binding.source === 'record_free_cell_sample' || binding.source === 'record_free_template_cell'
      || binding.source === 'record_free_formula_cell' || binding.source === 'record_free_formula_cell_sample'
      || binding.source === 'record_free_cell_unit' || binding.source === 'record_free_cell_unit_sample') return 'free_grid';
    return 'matrix';
  };
  const [recordDataMode, setRecordDataMode] = useState<'matrix' | 'free_grid' | 'header' | 'band'>(recordDataModeOf(value));
  useEffect(() => {
    if (open) {
      setUnitDraft(unitValue);
      setCompactTarget(initialCompactTarget);
      setContentTouched(false);
      setContentSourceMode(value.source === 'record_field' ? 'record_field' : 'free_grid');
      setUnitSourceMode(unitModeOf(unitValue));
      setRecordDataMode(recordDataModeOf(value));
    }
  }, [open, unitValue, initialCompactTarget, value.source]);

  const matrixFields = useMemo(() => {
    if (!linkedRecord) return [];
    const list: FieldDefinition[] = [];
    for (const g of linkedRecord.groups) {
      for (const f of g.fields) if (f.type === 'data_matrix' && f.matrix) list.push(f);
    }
    return list;
  }, [linkedRecord]);

  const freeGridFields = useMemo(() => {
    if (!linkedRecord) return [];
    const list: FieldDefinition[] = [];
    for (const g of linkedRecord.groups) {
      for (const f of g.fields) {
        if (f.type === 'free_grid' && f.free_table && (!freeGridFieldCode || f.code === freeGridFieldCode)) list.push(f);
      }
    }
    return list;
  }, [linkedRecord, freeGridFieldCode]);
  const unitFreeGridFields = useMemo(() => freeGridFields.filter(field => {
    const ft = field.free_table;
    return !!ft && (Object.values(ft.cell_units || {}).some(unit => !!unit?.trim())
      || Object.values(ft.cell_unit_options || {}).some(options => !!options?.length));
  }), [freeGridFields]);

  const scalarFieldsByGroup = useMemo(() => {
    if (!linkedRecord) return [];
    return linkedRecord.groups.map(g => ({
      group: g,
      // 排除矩阵、自由表格、图片与版式字段；semantic_role 审计字段由下方统一的
      // “主检与审核信息”入口绑定到 record_meta，避免同一信息出现两份且取值口径不同。
      fields: g.fields.filter(f => f.type !== 'data_matrix' && f.type !== 'free_grid' && f.type !== 'image' && f.type !== 'spacer' && !f.semantic_role),
    })).filter(g => g.fields.length > 0);
  }, [linkedRecord]);

  // 来源是否在当前模板可见：有关联原始记录（项目报告）= 全显示；否则（首页/封面）隐藏 per-project 来源。
  // P-Map-11：再叠加 allowedSources 白名单（如项目结果表只留原始记录来源）。
  const isVisible = (k: string) => {
    // 项目模板已有“当前样品”上下文，不再重复展示首页专用的样品展示/拼接入口；
    // 存量绑定仍保留入口，打开后可以继续查看和调整。
    if (linkedRecord && k === 'report_sample' && value.source !== 'report_sample' && !allowedSources) return false;
    if (linkedRecord && k === 'order_samples' && value.source !== 'order_samples' && !allowedSources) return false;
    // 主检/审核人员与时间并入“原始记录字段”；项目模板显示关联记录字段，首页仍可取聚合后的审计信息。
    if (k === 'record_field') {
      const scalarVisible = !!linkedRecord && (!allowedSources || allowedSources.includes('record_field') || allowedSources.includes('record_field_unit'));
      const auditVisible = !allowedSources || allowedSources.includes('record_meta');
      return scalarVisible || auditVisible;
    }
    // 'record_band' tab 覆盖 record_cell_sample + record_sample_label 两源
    if (k === 'record_band') return !!bandMatrixCode && (!allowedSources || allowedSources.includes('record_cell_sample') || allowedSources.includes('record_sample_label') || allowedSources.includes('record_sample_index'));
    // 所有原始记录表格类能力合并到一个入口，内部再选数据结果/自定义表格/单位/逐试样。
    if (k === 'record_table') return !!linkedRecord && (!allowedSources || [
      'record_cell', 'record_summary', 'record_header', 'record_cell_sample', 'record_sample_label', 'record_sample_index',
      'record_free_cell', 'record_free_cell_sample', 'record_free_template_cell', 'record_free_formula_cell',
      'record_free_formula_cell_sample', 'record_free_cell_unit', 'record_free_cell_unit_sample',
    ].some(source => allowedSources.includes(source)));
    // 'record_free_grid' tab 合并原始记录表格固定格(record_free_cell) + 当前试样格(record_free_cell_sample)
    if (k === 'record_free_grid') return !!linkedRecord && (!allowedSources || ['record_free_cell', 'record_free_cell_sample', 'record_free_template_cell', 'record_free_formula_cell', 'record_free_formula_cell_sample', 'record_free_cell_unit', 'record_free_cell_unit_sample'].some(source => allowedSources.includes(source)));
    return (!!linkedRecord || !PROJECT_ONLY_KEYS.includes(k)) &&
      (!allowedSources || allowedSources.includes(k));
  };
  const draftAllowed = !allowedSources || allowedSources.includes(draft.source);
  const draftComplete = draft.source !== 'record_free_cell_sample' || !!draft.cell_key;
  const contentCommitRequired = contentValuePresent || contentTouched;
  const canCommit = !contentCommitRequired || (draftAllowed && draftComplete);
  const commit = () => {
    if (!canCommit) return;
    if (onCombinedChange) onCombinedChange(contentValuePresent || contentTouched ? draft : undefined, unitDraft);
    else {
      onChange(draft);
      onUnitChange?.(unitDraft);
    }
    onClose();
  };
  const bandMatrixField = bandMatrixCode ? matrixFields.find(m => m.code === bandMatrixCode) : undefined;
  const recordDataModes = [
    ...((matrixFields.length && (!allowedSources || allowedSources.includes('record_cell') || allowedSources.includes('record_summary')))
      ? [{ value: 'matrix', label: '数据结果' }] : []),
    ...((freeGridFields.length && (!allowedSources || ['record_free_cell', 'record_free_cell_sample', 'record_free_template_cell', 'record_free_formula_cell', 'record_free_formula_cell_sample', 'record_free_cell_unit', 'record_free_cell_unit_sample'].some(source => allowedSources.includes(source))))
      ? [{ value: 'free_grid', label: '自定义表格' }] : []),
    ...((matrixFields.length && (!allowedSources || allowedSources.includes('record_header')))
      ? [{ value: 'header', label: '参数单位/要求' }] : []),
    ...((bandMatrixField && (!allowedSources || allowedSources.includes('record_cell_sample') || allowedSources.includes('record_sample_label') || allowedSources.includes('record_sample_index')))
      ? [{ value: 'band', label: '逐个试样' }] : []),
  ] as Array<{ value: 'matrix' | 'free_grid' | 'header' | 'band'; label: string }>;
  const effectiveRecordDataMode = recordDataModes.some(option => option.value === recordDataMode)
    ? recordDataMode
    : recordDataModes[0]?.value;
  const fallbackTab = isVisible('literal') ? 'literal'
    : isVisible('record_table') ? 'record_table'
      : isVisible('record_field') ? 'record_field'
        : tab;

  // 样品清单当前草稿（非该 source 时给默认值，便于 UI 受控）
  const osDraft = draft.source === 'order_samples'
    ? draft
    : { source: 'order_samples' as const, numbered: true, layout: 'inline' as const };

  if (compactFreeGrid) {
    const sourceSlotStyle = (active: boolean): React.CSSProperties => ({
      flex: 1,
      minWidth: 240,
      padding: '8px 10px',
      border: `1px solid ${active ? '#91caff' : '#e8edf3'}`,
      background: active ? '#e6f4ff' : '#fafbfc',
      borderRadius: 4,
      cursor: 'pointer',
    });
    return (
      <Modal
        title={compactTarget === 'unit'
          ? '设置单位'
          : title?.includes('逐试样') ? '选择每个试样的数据来源' : '选择内容来源'}
        open={open}
        onCancel={onClose}
        onOk={commit}
        okButtonProps={{ disabled: !canCommit }}
        okText="确定"
        width={780}
        styles={{ body: { maxHeight: 'calc(100vh - 180px)', overflowY: 'auto' } }}
        destroyOnClose
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <div style={sourceSlotStyle(compactTarget === 'content')} onClick={() => setCompactTarget('content')}>
            <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 3 }}>内容来源</div>
            <BindingSummary value={draft} linkedRecord={linkedRecord} />
          </div>
          <div style={sourceSlotStyle(compactTarget === 'unit')} onClick={() => setCompactTarget('unit')}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, color: '#8c8c8c', marginBottom: 3 }}>
              <span>单位</span>
              {unitDraft && <Button type="link" danger size="small" style={{ height: 18, padding: 0 }} onClick={(e) => { e.stopPropagation(); setUnitDraft(undefined); }}>清除</Button>}
            </div>
            {unitDraft ? <BindingSummary value={unitDraft} linkedRecord={linkedRecord} /> : <span style={{ color: '#bfbfbf' }}>未设置</span>}
          </div>
        </div>
        {compactTarget === 'content' ? <>
          <Tabs
            activeKey={contentSourceMode}
            onChange={(key) => setContentSourceMode(key as 'free_grid' | 'record_field')}
            items={[
              {
                key: 'free_grid',
                label: '原始记录表格',
                children: <FreeGridCellPicker
                  fields={freeGridFields}
                  value={draft}
                  onPick={(binding) => { setContentTouched(true); setDraft(binding); }}
                  allowFixed={!allowedSources || allowedSources.includes('record_free_cell')}
                  allowSample={!allowedSources || allowedSources.includes('record_free_cell_sample')}
                  allowTemplate={!allowedSources || allowedSources.includes('record_free_template_cell')}
                  onPickUnit={setUnitDraft}
                  compact
                />,
              },
              ...(!allowedSources || allowedSources.includes('record_field') ? [{
                key: 'record_field',
                label: '原始记录字段',
                children: <RecordScalarFieldPicker
                  groups={scalarFieldsByGroup}
                  value={draft}
                  onPick={(binding) => { setContentTouched(true); setDraft(binding); }}
                />,
              }] : []),
            ]}
          />
        </> : <>
          <Segmented
            block
            value={unitSourceMode}
            onChange={(mode) => setUnitSourceMode(mode as 'free_grid' | 'record_field' | 'literal')}
            options={[
              { value: 'free_grid', label: '从表格读取' },
              { value: 'record_field', label: '跟随字段单位' },
              { value: 'literal', label: '手动填写' },
            ]}
            style={{ marginBottom: 12 }}
          />
          {unitSourceMode === 'free_grid' && <FreeGridCellPicker
            fields={unitFreeGridFields}
            value={unitDraft || { source: 'literal', text: '' }}
            onPick={setUnitDraft}
            allowFixed={false}
            allowSample={false}
            allowTemplate={false}
            unitOnly
            sampleUnit={sampleUnitMode}
            compact
          />}
          {unitSourceMode === 'record_field' && <RecordScalarFieldPicker
            groups={scalarFieldsByGroup}
            value={unitDraft || { source: 'literal', text: '' }}
            onPick={setUnitDraft}
            unitOnly
          />}
          {unitSourceMode === 'literal' && <Input
            size="large"
            placeholder="输入单位，如 MPa"
            value={unitDraft?.source === 'literal' ? unitDraft.text : ''}
            onChange={(e) => setUnitDraft({ source: 'literal', text: e.target.value })}
          />}
        </>}
      </Modal>
    );
  }

  return (
    <Modal
      title={title || '选择这个位置要显示什么'}
      open={open}
      onCancel={onClose}
      onOk={commit}
      okButtonProps={{ disabled: !canCommit }}
      okText="确定"
      width={900}
      style={{ top: 24 }}
      // 内容过高时弹窗内容区限高并出纵向滚动条，不再溢出屏幕（标题/底部按钮固定，仅内容滚）
      styles={{ body: { maxHeight: 'calc(100vh - 160px)', overflowY: 'auto' } }}
      destroyOnClose
    >
      <Tabs
        className="binding-picker-source-tabs"
        popupClassName="binding-picker-tabs-popup"
        tabPosition="left"
        size="small"
        activeKey={isVisible(tab) ? tab : fallbackTab}
        onChange={(k) => {
          setTab(k);
          // 切 tab 时重置 draft 为该 source 的初始结构
          if (k === 'literal') setDraft({ source: 'literal', text: draft.source === 'literal' ? draft.text : '' });
          else if (k === 'order') setDraft({ source: 'order', key: draft.source === 'order' ? draft.key : 'order_no' });
          else if (k === 'order_samples') setDraft(draft.source === 'order_samples' ? draft : { source: 'order_samples', numbered: true, layout: 'inline' });
          else if (k === 'sample') setDraft({ source: 'sample', key: draft.source === 'sample' ? draft.key : 'sample_name' });
          else if (k === 'test') setDraft({ source: 'test', key: draft.source === 'test' ? draft.key : 'project_name' });
          else if (k === 'report_meta') setDraft({ source: 'report_meta', key: draft.source === 'report_meta' ? draft.key : 'company_name' });
          else if (k === 'system') setDraft({ source: 'system', key: draft.source === 'system' ? draft.key : 'today' });
          else if (k === 'record_field') setDraft(
            draft.source === 'record_field' || draft.source === 'record_meta'
              ? draft
              : { source: 'record_field', field_code: '' });
          else if (k === 'report_sample') setDraft(draft.source === 'report_sample' ? draft : { source: 'report_sample', key: 'name' });
          // 原始数据表格：不重置 draft，由内部的数据结果/自定义表格/单位/逐试样选择器更新。
          else if (k === 'record_table') { /* keep draft; pick by clicking a cell/summary */ }
        }}
        items={[
          {
            key: 'literal',
            label: '固定文字',
            children: (
              <div>
                <Alert type="info" showIcon style={{ marginBottom: 12 }}
                  message="固定文字：这个位置永远显示你输入的内容"
                  description="适合固定表头、固定说明、固定标准号等不随录入数据变化的内容。" />
                <AutoGrowTextArea
                  size="large"
                  placeholder="固定文字"
                  value={draft.source === 'literal' ? draft.text : ''}
                  onChange={(e) => setDraft({ source: 'literal', text: e.target.value })}
                />
                <div style={{ marginTop: 12, fontSize: 12, color: '#888' }}>
                  当前预览：<Tag color="default">{draft.source === 'literal' ? (draft.text || '(空)') : ''}</Tag>
                </div>
              </div>
            ),
          },
          {
            key: 'order',
            label: '委托单字段',
            children: (
              <div>
                <Alert type="info" showIcon style={{ marginBottom: 12 }}
                  message="委托单字段：生成报告时取自当前订单上下文"
                  description="这里都是整张委托单唯一的订单级信息，首页模板和项目模板均可安全复用。" />
                <SourceKeyList keys={ORDER_KEYS}
                  selectedKey={draft.source === 'order' ? draft.key : undefined}
                  onPick={(v) => setDraft({ source: 'order', key: v as any })}
                  placeholder="搜索委托单字段…" />
              </div>
            ),
          },
          {
            key: 'report_sample',
            label: '样品信息',
            children: (
              <div>
                <Alert type="info" showIcon style={{ marginBottom: 12 }}
                  message="样品信息（取自接口样品 SampleName / SampleSortNo / Model）"
                  description="系统按出报告时的实际样品数自动切换，无需为单/多样品分别建模板：【单样品】直接显示该样品的值；【多样品】首页不堆叠，统一显示下方占位文案（样品明细由检测结论表前的「样品信息表」字段自动列出）。" />
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
                    {SAMPLE_REPORT_KEYS.map(k => (
                      <Button key={k.value}
                        style={{ height: 40, textAlign: 'left', justifyContent: 'flex-start' }}
                        type={draft.source === 'report_sample' && draft.key === k.value ? 'primary' : 'default'}
                        onClick={() => setDraft({ source: 'report_sample', key: k.value as any, multi_text: draft.source === 'report_sample' ? draft.multi_text : undefined })}>
                        {k.label}
                      </Button>
                    ))}
                  </div>
                  {draft.source === 'report_sample' && (
                    <Input addonBefore="多样品占位文案" placeholder="见后续页。"
                      value={draft.multi_text ?? ''}
                      onChange={(e) => setDraft({ ...draft, multi_text: e.target.value || undefined })} />
                  )}
                </Space>
              </div>
            ),
          },
          {
            key: 'order_samples',
            label: '样品清单',
            children: (
              <div>
                <Alert type="info" showIcon style={{ marginBottom: 12 }}
                  message="样品清单（报告范围，带编号）"
                  description="把委托单里全部样品拼成「1#：名称、2#：名称…」。单个样品时自动不显编号。具体值生成报告时按订单样品自动填。" />
                <Space direction="vertical" size={14} style={{ width: '100%' }}>
                  <Space size={8}>
                    <span style={{ fontSize: 13, width: 48, display: 'inline-block' }}>带编号</span>
                    <Switch checked={osDraft.numbered !== false}
                      onChange={(v) => setDraft({ ...osDraft, numbered: v })} />
                    <span style={{ fontSize: 12, color: '#888' }}>如 <b>1#：中央通道</b>（单样品时自动不显编号）</span>
                  </Space>
                  <Alert type="warning" showIcon style={{ marginTop: 4 }}
                    message="多样品请改用「样品信息表」字段"
                    description="首页单样品直接绑「委托单字段 → 样品名称/零件号」；多样品在检测结论前加一个「样品信息表」字段自动列出。此处的拼接排版已不再使用。" />
                </Space>
              </div>
            ),
          },
          {
            key: 'sample',
            label: '当前样品',
            children: (
              <div>
                <Alert type="info" showIcon style={{ marginBottom: 12 }}
                  message="样品字段：取自当前报告项目所属样品（接口 1.1 样品属性）"
                  description="无需指定第几个样品。生成每个项目页时，系统会自动切换为该项目实际所属的样品。" />
                <SourceKeyList keys={SAMPLE_KEYS}
                  selectedKey={draft.source === 'sample' ? draft.key : undefined}
                  onPick={(v) => setDraft({ source: 'sample', key: v as any })}
                  placeholder="搜索样品字段…" />
              </div>
            ),
          },
          {
            key: 'test',
            label: '分单信息',
            children: (
              <div>
                <Alert type="info" showIcon style={{ marginBottom: 12 }}
                  message="分单字段：取自当前报告项目对应的材料分单（接口 1.1 TaskList 属性）"
                  description="系统按当前样品和当前测试项目自动匹配，不使用固定样品序号。" />
                <SourceKeyList keys={TEST_KEYS}
                  selectedKey={draft.source === 'test' ? draft.key : undefined}
                  onPick={(v) => setDraft({ source: 'test', key: v as any })}
                  placeholder="搜索测试项目字段…" />
              </div>
            ),
          },
          {
            key: 'report_meta',
            label: '报告抬头信息',
            children: (
              <div>
                <Alert type="info" showIcon style={{ marginBottom: 12 }}
                  message="报告抬头信息：报告的公司名称/地址/客户名称/报告备注/资质备注等页眉页脚与抬头信息"
                  description="出报告时由系统自动带入（来自报告取号推送），首页/封面正文可直接引用，无需文员手填。中英文按报告语种自动选中。" />
                <SourceKeyList keys={REPORT_META_KEYS}
                  selectedKey={draft.source === 'report_meta' ? draft.key : undefined}
                  onPick={(v) => setDraft({ source: 'report_meta', key: v as any })}
                  placeholder="搜索报告抬头字段…" />
              </div>
            ),
          },
          {
            key: 'system',
            label: '系统字段',
            children: (
              <div>
                <Alert type="info" showIcon style={{ marginBottom: 12 }} message="系统字段：生成报告时由系统自动计算" />
                <SourceKeyList keys={SYSTEM_KEYS}
                  selectedKey={draft.source === 'system' ? draft.key : undefined}
                  onPick={(v) => setDraft({ source: 'system', key: v as any })} />
              </div>
            ),
          },
          {
            key: 'record_field',
            label: '原始记录字段',
            children: (
              <div>
                <Alert type="info" showIcon style={{ marginBottom: 12 }}
                  message={linkedRecord ? `从「${linkedRecord.name}」里选择字段` : '选择原始记录中的主检或审核信息'}
                  description={linkedRecord
                    ? '主检、检测时间、审核人和审核时间也统一放在这里；其他字段取原始记录的实际录入值。'
                    : '首页会按报告范围汇总人员与时间：检测时间取最早值，审核时间取最晚值，人员自动去重。'} />
                {(!allowedSources || allowedSources.includes('record_meta')) && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontWeight: 600, marginBottom: 7, color: '#555' }}>主检与审核信息</div>
                    <SourceKeyList keys={RECORD_META_KEYS}
                      selectedKey={draft.source === 'record_meta' ? draft.key : undefined}
                      onPick={(v) => setDraft({ source: 'record_meta', key: v as any })}
                      placeholder="搜索主检或审核信息…" />
                  </div>
                )}
                {linkedRecord && scalarFieldsByGroup.map(({ group, fields }) => (
                  <div key={group.id} style={{ marginBottom: 16 }}>
                    <div style={{ fontWeight: 'bold', marginBottom: 6, color: '#555' }}>{group.label}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {fields.map(f => {
                        const selected = draft.source === 'record_field' && draft.field_code === f.code;
                        return (
                          <Button
                            key={f.code}
                            type={selected ? 'primary' : 'default'}
                            onClick={() => setDraft({ source: 'record_field', field_code: f.code })}
                            style={{ minWidth: 160, textAlign: 'left', height: 'auto', padding: '8px 12px' }}
                          >
                            <strong>{f.label || '未命名字段'}</strong>
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ),
          },
          {
            key: 'record_table',
            label: '原始数据表格',
            disabled: recordDataModes.length === 0,
            children: linkedRecord ? (
              <div>
                {recordDataModes.length > 1 && (
                  <Segmented
                    value={effectiveRecordDataMode}
                    onChange={(mode) => setRecordDataMode(mode as 'matrix' | 'free_grid' | 'header' | 'band')}
                    options={recordDataModes}
                    style={{ marginBottom: 14 }}
                  />
                )}
                {effectiveRecordDataMode === 'matrix' && (
                  <MatrixCellPicker matrixFields={matrixFields} value={draft} onPick={setDraft} mode="both" />
                )}
                {effectiveRecordDataMode === 'free_grid' && (
                  <FreeGridCellPicker
                    fields={freeGridFields}
                    value={draft}
                    onPick={setDraft}
                    allowFixed={!allowedSources || allowedSources.includes('record_free_cell')}
                    allowSample={!allowedSources || allowedSources.includes('record_free_cell_sample')}
                    allowTemplate={!allowedSources || allowedSources.includes('record_free_template_cell')}
                    unitOnly={false}
                    compact={false}
                  />
                )}
                {effectiveRecordDataMode === 'header' && (
                  <MatrixHeaderPicker matrixFields={matrixFields} value={draft} onPick={setDraft} />
                )}
                {effectiveRecordDataMode === 'band' && bandMatrixField && (
                  <BandCellPicker matrixField={bandMatrixField} value={draft} onPick={setDraft} />
                )}
              </div>
            ) : <Empty />,
          },
        ].filter(it => isVisible(it.key))}
      />

      {/* 底部预览当前选中的绑定 */}
      <div style={{ marginTop: 12, padding: 10, background: '#f0f5ff', border: '1px solid #91caff', borderRadius: 4 }}>
        <strong style={{ fontSize: 12 }}>当前选择：</strong>
        <span style={{ marginLeft: 8 }}>
          <BindingSummary value={draft} linkedRecord={linkedRecord} />
        </span>
      </div>
    </Modal>
  );
}

// ─── 固定字段列表（委托单/接口/系统等）：带搜索、可点击选中，不再显示英文代码 ───
// 字段多（委托单/报告接口各十几~二十个）时用搜索快速定位；英文代码对用户无意义故隐藏。
function RecordScalarFieldPicker({ groups, value, onPick, unitOnly = false }: {
  groups: Array<{ group: { id: string; label: string }; fields: FieldDefinition[] }>;
  value: CellBinding;
  onPick: (binding: CellBinding) => void;
  unitOnly?: boolean;
}) {
  const visibleGroups = groups
    .map(item => ({ ...item, fields: unitOnly ? item.fields.filter(field => !!field.unit?.trim()) : item.fields }))
    .filter(item => item.fields.length > 0);
  if (!visibleGroups.length) return <Empty description={unitOnly ? '此原始记录中没有配置单位的普通字段' : '此原始记录中没有可绑定的普通字段'} />;
  return <div>
    {visibleGroups.map(({ group, fields }) => (
      <div key={group.id} style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#595959', marginBottom: 7 }}>{group.label}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
          {fields.map(field => {
            const selected = unitOnly
              ? value.source === 'record_field_unit' && value.field_code === field.code
              : value.source === 'record_field' && value.field_code === field.code;
            return <Button
              key={field.code}
              type={selected ? 'primary' : 'default'}
              onClick={() => onPick(unitOnly
                ? { source: 'record_field_unit', field_code: field.code }
                : { source: 'record_field', field_code: field.code })}
              style={{ height: 'auto', minHeight: 44, padding: '7px 10px', textAlign: 'left' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <strong>{field.label || '未命名字段'}</strong>
                {unitOnly && <Tag color={selected ? 'blue' : 'cyan'} style={{ margin: 0 }}>{field.unit}</Tag>}
              </div>
            </Button>;
          })}
        </div>
      </div>
    ))}
  </div>;
}

function SourceKeyList({ keys, selectedKey, onPick, placeholder }: {
  keys: { value: string; label: string }[];
  selectedKey?: string;
  onPick: (v: string) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState('');
  const kw = q.trim().toLowerCase();
  const filtered = kw ? keys.filter(k => k.label.toLowerCase().includes(kw)) : keys;
  return (
    <div>
      {keys.length > 6 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <Input.Search allowClear placeholder={placeholder || '搜索字段名…'} value={q}
            onChange={(e) => setQ(e.target.value)} style={{ flex: 1, maxWidth: 420 }} />
          <span style={{ marginLeft: 'auto', color: '#98a2b3', fontSize: 12, whiteSpace: 'nowrap' }}>
            {kw ? `${filtered.length} / ${keys.length}` : `共 ${keys.length} 项`}
          </span>
        </div>
      )}
      {filtered.length > 0 ? (
        <div role="listbox" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))',
          gap: 8,
        }}>
          {filtered.map(k => {
            const selected = selectedKey === k.value;
            return (
              <Button key={k.value} role="option" aria-selected={selected}
                type={selected ? 'primary' : 'default'}
                onClick={() => onPick(k.value)}
                style={{
                  height: 'auto', minHeight: 40, padding: '7px 10px',
                  textAlign: 'left', whiteSpace: 'normal', lineHeight: 1.35,
                  justifyContent: 'flex-start',
                  borderColor: selected ? undefined : '#dfe5ee',
                  background: selected ? undefined : '#fbfcfe',
                }}>
                <span style={{ overflowWrap: 'anywhere' }}>{k.label}</span>
              </Button>
            );
          })}
        </div>
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无匹配字段" />
      )}
    </div>
  );
}

// ─── 矩阵格点选择器：渲染矩阵骨架供点击 ─────────────────────────────
function MatrixCellPicker({ matrixFields, value, onPick, mode }: {
  matrixFields: FieldDefinition[];
  value: CellBinding;
  onPick: (b: CellBinding) => void;
  mode: 'cell' | 'summary' | 'both';
}) {
  const canCell = mode === 'cell' || mode === 'both';
  const canSum = mode === 'summary' || mode === 'both';
  // 当前选中的矩阵：以 value 中的 matrix_code 为准，否则第一个
  const currentCode = (value.source === 'record_cell' || value.source === 'record_summary')
    ? value.matrix_code : matrixFields[0]?.code;
  const [active, setActive] = useState(currentCode || matrixFields[0]?.code || '');

  useEffect(() => { if (currentCode && currentCode !== active) setActive(currentCode); /* eslint-disable-next-line */ }, [currentCode]);

  const mf = matrixFields.find(m => m.code === active) || matrixFields[0];
  if (!mf || !mf.matrix) return <Empty description="此原始记录中没有原始数据表格" />;

  const cfg = mf.matrix;
  const params = cfg.parameters || [];
  const n = cfg.default_sample_count || 1;
  const summaries = cfg.summary_rows || [];
  const prefix = cfg.row_header_prefix || '试样';
  const labels = (cfg.default_sample_labels || []) as string[];
  const rowLabel = (i: number) => labels[i] ?? `${prefix}${i + 1}`;

  return (
    <div>
      {matrixFields.length > 1 && (
        <Select size="small" style={{ width: 300, marginBottom: 12 }}
          value={active} onChange={setActive}
          options={matrixFields.map(m => ({ value: m.code, label: m.matrix?.kind === 'stats' ? `${m.label}（统计）` : m.label }))} />
      )}

      <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message={mode === 'both' ? '点击数据格选择某个试样结果；汇总或统计结果请选择对应的汇总格'
          : mode === 'cell' ? '点击下方数据表格中的数据格进行绑定' : '汇总行可整行选择；逐列统计结果请选择对应列'}
        description={(() => {
          const statN = summaries.filter(s => s.source_type === 'per_column_aggregate' || !!s.per_column).length;
          const sumN = summaries.length - statN;
          const parts = [sumN ? `${sumN} 个汇总行` : '', statN ? `${statN} 个统计行(逐列)` : ''].filter(Boolean);
          return `当前数据表：${mf.label}，${n} 行 × ${params.length} 列${parts.length ? `，含 ${parts.join(' + ')}` : ''}`;
        })()} />

      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={th}>{cfg.axis_header || '试样'}</th>
              {params.map(p => <th key={p.code} style={th}>{p.label}{p.unit ? ` (${p.unit})` : ''}</th>)}
            </tr>
          </thead>
          <tbody>
            {/* 样品数据行 */}
            {Array.from({ length: n }, (_, i) => (
              <tr key={i}>
                <td style={{ ...th, fontWeight: 'bold' }}>{rowLabel(i)}</td>
                {params.map(p => {
                  const isSelected = value.source === 'record_cell'
                    && value.matrix_code === mf.code && value.sample_idx === i && value.param_code === p.code;
                  const clickable = canCell;
                  return (
                    <td key={p.code}
                      style={{
                        ...td, textAlign: 'center', minWidth: 80,
                        cursor: clickable ? 'pointer' : 'not-allowed',
                        background: isSelected ? '#1677ff' : clickable ? '#f6ffed' : '#fafafa',
                        color: isSelected ? '#fff' : '#389e0d',
                        fontWeight: isSelected ? 'bold' : 'normal',
                      }}
                      onClick={() => clickable && onPick({ source: 'record_cell', matrix_code: mf.code, sample_idx: i, param_code: p.code })}>
                      {isSelected ? '✓ 已选' : clickable ? '点击选中' : '—'}
                    </td>
                  );
                })}
              </tr>
            ))}

            {/* 汇总行 */}
            {summaries.map(sr => {
              // 逐列汇总行（统计行）：per_column_aggregate（自动统计）或 per_column=true（手填/逐格公式，如「平均值」）
              // 都按【每列一格】存值（键 …__summary__rowId__paramCode），故须逐列选中→绑定带 param_code，
              // 否则按整行绑（无 param_code）出报告时取不到值。与 matrix-flatten / typst-generator 的判定保持一致。
              const isPerCol = sr.source_type === 'per_column_aggregate' || !!sr.per_column;
              return (
                <tr key={sr.id}>
                  <td style={{ ...th, fontWeight: 'bold', background: '#fff7e6' }}>{sr.label}</td>
                  {isPerCol ? (
                    params.map(p => {
                      const isSelected = value.source === 'record_summary'
                        && value.matrix_code === mf.code && value.row_id === sr.id && value.param_code === p.code;
                      const clickable = canSum;
                      return (
                        <td key={p.code}
                          style={{
                            ...td, textAlign: 'center',
                            cursor: clickable ? 'pointer' : 'not-allowed',
                            background: isSelected ? '#1677ff' : clickable ? '#fffbe6' : '#fafafa',
                            color: isSelected ? '#fff' : '#d48806',
                            fontWeight: isSelected ? 'bold' : 'normal',
                          }}
                          onClick={() => clickable && onPick({ source: 'record_summary', matrix_code: mf.code, row_id: sr.id, param_code: p.code })}>
                          {isSelected ? '✓ 已选' : clickable ? '点击选中' : '—'}
                        </td>
                      );
                    })
                  ) : (
                    (() => {
                      const isSelected = value.source === 'record_summary'
                        && value.matrix_code === mf.code && value.row_id === sr.id && !value.param_code;
                      const clickable = canSum;
                      return (
                        <td colSpan={params.length}
                          style={{
                            ...td, textAlign: 'center',
                            cursor: clickable ? 'pointer' : 'not-allowed',
                            background: isSelected ? '#1677ff' : clickable ? '#fffbe6' : '#fafafa',
                            color: isSelected ? '#fff' : '#d48806',
                            fontWeight: isSelected ? 'bold' : 'normal',
                          }}
                          onClick={() => clickable && onPick({ source: 'record_summary', matrix_code: mf.code, row_id: sr.id })}>
                          {isSelected ? '✓ 已选' : clickable ? '点击选中此汇总行' : '—'}
                        </td>
                      );
                    })()
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── 矩阵表头（录入单位/备注）选择器：选矩阵 + 参数列 → record_header ───────
function MatrixHeaderPicker({ matrixFields, value, onPick }: {
  matrixFields: FieldDefinition[];
  value: CellBinding;
  onPick: (b: CellBinding) => void;
}) {
  const currentCode = value.source === 'record_header' ? value.matrix_code : matrixFields[0]?.code;
  const [active, setActive] = useState(currentCode || matrixFields[0]?.code || '');
  useEffect(() => { if (currentCode && currentCode !== active) setActive(currentCode); /* eslint-disable-next-line */ }, [currentCode]);
  const mf = matrixFields.find(m => m.code === active) || matrixFields[0];
  if (!mf || !mf.matrix) return <Empty description="此原始记录中没有原始数据表格" />;
  const params = mf.matrix.parameters || [];
  return (
    <div>
      <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message="选择参数的单位或要求"
        description="报告会使用数据录入时实际选择的单位或要求；没有选择时使用模板中的默认值。" />
      {matrixFields.length > 1 && (
        <div style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: '#888', marginRight: 6 }}>原始数据表：</span>
          <Select size="small" style={{ width: 240 }}
            value={active} onChange={setActive}
            options={matrixFields.map(m => ({ value: m.code, label: m.label }))} />
        </div>
      )}
      <div style={{ fontSize: 12, color: '#555', marginBottom: 6 }}>点一个参数列（取它的录入单位/备注）：</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {params.map(p => {
          const selected = value.source === 'record_header' && value.matrix_code === mf.code && value.param_code === p.code;
          const tag = p.unit_options?.length ? '录入可选' : (p.unit ? '固定单位' : '');
          return (
            <Button key={p.code}
              type={selected ? 'primary' : 'default'}
              onClick={() => onPick({ source: 'record_header', matrix_code: mf.code, param_code: p.code })}
              style={{ minWidth: 150, textAlign: 'left', height: 'auto', padding: '8px 12px' }}>
              <div><strong>{p.label}</strong>{tag ? <Tag color={p.unit_options?.length ? 'green' : 'default'} style={{ marginLeft: 6, fontSize: 10 }}>{tag}</Tag> : null}</div>
              <div style={{ fontSize: 10, color: selected ? 'rgba(255,255,255,0.8)' : '#888', marginTop: 2 }}>
                {p.unit_options?.length ? `录入时可选：${p.unit_options.join(' / ')}` : (p.unit ? `单位：${p.unit}` : '无单位/备注')}
              </div>
            </Button>
          );
        })}
        {params.length === 0 && <Empty description="此数据表没有参数列" />}
      </div>
    </div>
  );
}

// ─── 试样带·当前试样 选择器：点矩阵【列头】=取该列值 / 点【试样】列=取样品名 ─────
function BandCellPicker({ matrixField, value, onPick }: {
  matrixField: FieldDefinition;
  value: CellBinding;
  onPick: (b: CellBinding) => void;
}) {
  if (!matrixField.matrix) return <Empty description="该数据表没有参数列" />;
  const cfg = matrixField.matrix;
  const code = matrixField.code;
  const params = cfg.parameters || [];
  const n = Math.min(cfg.default_sample_count || 2, 3);
  const prefix = cfg.row_header_prefix || '试样';
  const labelSel = value.source === 'record_sample_label' && value.matrix_code === code;
  const indexSel = value.source === 'record_sample_index' && value.matrix_code === code;
  const paramSel = (pc: string) => value.source === 'record_cell_sample' && value.matrix_code === code && value.param_code === pc;
  return (
    <div>
      <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message={`「${matrixField.label}」里：每个【试样】是一行、每个参数是一列`}
        description="会按实际录入的试样数自动展开（一个试样一份）。下面三选一：① 点「试样序号」= 自动 1,2,3…；② 点最左「试样」列头 = 取试样名称；③ 点某【参数列头】= 每个试样取该列的值。" />
      <div style={{ marginBottom: 10 }}>
        <Button type={indexSel ? 'primary' : 'default'}
          onClick={() => onPick({ source: 'record_sample_index', matrix_code: code })}>
          试样序号（自动 1, 2, 3 …）{indexSel ? ' ✓' : ''}
        </Button>
        <span style={{ marginLeft: 8, fontSize: 11, color: '#888' }}>用于「试样编号」列：按展开顺序自动递增</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              <th
                onClick={() => onPick({ source: 'record_sample_label', matrix_code: code })}
                style={{ ...th, cursor: 'pointer', background: labelSel ? '#1677ff' : '#e6f4ff', color: labelSel ? '#fff' : '#1677ff', fontWeight: 'bold' }}
                title="点此：每个试样取【试样名称】">
                {cfg.axis_header || '试样'}{labelSel ? ' ✓' : ''}
              </th>
              {params.map(p => {
                const sel = paramSel(p.code);
                return (
                  <th key={p.code}
                    onClick={() => onPick({ source: 'record_cell_sample', matrix_code: code, param_code: p.code })}
                    style={{ ...th, cursor: 'pointer', minWidth: 90, background: sel ? '#1677ff' : '#f6ffed', color: sel ? '#fff' : '#389e0d', fontWeight: 'bold' }}
                    title={`点此：每个试样取【${p.label}】列的值`}>
                    {p.label}{p.unit ? ` (${p.unit})` : ''}{sel ? ' ✓' : ''}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: n }, (_, i) => (
              <tr key={i}>
                <td style={{ ...td, fontWeight: 'bold', color: '#888', background: '#fafafa' }}>{prefix}{i + 1}</td>
                {params.map(p => (
                  <td key={p.code} style={{ ...td, textAlign: 'center', color: '#ccc' }}>
                    {paramSel(p.code) ? '↑取此列' : '…'}
                  </td>
                ))}
              </tr>
            ))}
            <tr><td colSpan={params.length + 1} style={{ ...td, textAlign: 'center', color: '#bbb', background: '#fafafa' }}>…按实际试样数展开…</td></tr>
          </tbody>
        </table>
      </div>
      {params.length === 0 && <Empty description="此数据表没有参数列" />}
    </div>
  );
}

function FreeGridCellPicker({ fields, value, onPick, allowFixed, allowSample, allowTemplate, unitOnly = false, sampleUnit = false, onPickUnit, compact = false }: {
  fields: FieldDefinition[];
  value: CellBinding;
  onPick: (b: CellBinding) => void;
  allowFixed: boolean;
  allowSample: boolean;
  allowTemplate: boolean;
  unitOnly?: boolean;
  sampleUnit?: boolean;
  onPickUnit?: (b: CellBinding | undefined) => void;
  compact?: boolean;
}) {
  const [fieldCode, setFieldCode] = useState(
    (value.source === 'record_free_cell' || value.source === 'record_free_cell_sample' || value.source === 'record_free_template_cell' || value.source === 'record_free_formula_cell' || value.source === 'record_free_formula_cell_sample' || value.source === 'record_free_cell_unit' || value.source === 'record_free_cell_unit_sample')
      ? value.field_code
      : fields[0]?.code || ''
  );
  useEffect(() => {
    if (!fieldCode && fields[0]?.code) setFieldCode(fields[0].code);
  }, [fieldCode, fields]);
  const field = fields.find(f => f.code === fieldCode) || fields[0];
  const ft = field?.free_table;
  const rows = ft?.rows || [];
  const cols = ft?.columns || [];
  const cells = ft?.cells || {};
  const spans = ft?.spans || {};
  const inputCells = ft?.input_cells || {};
  const formulaCells = ft?.cell_formulas || {};
  const sampleIndexCells = ft?.sample_index_cells || {};
  const headerCells = ft?.header_cells || {};
  const bands = ft ? recordSampleBands(ft) : [];
  const covered = (() => {
    const rowIdx = new Map(rows.map((r, i) => [r.id, i]));
    const colIdx = new Map(cols.map((c, i) => [c.id, i]));
    const set = new Set<string>();
    for (const [key, span] of Object.entries(spans)) {
      const [rowId, colId] = key.split('::');
      const ri = rowIdx.get(rowId), ci = colIdx.get(colId);
      if (ri == null || ci == null) continue;
      const rowspan = Math.min(Math.max(span.rowspan ?? 1, 1), rows.length - ri);
      const colspan = Math.min(Math.max(span.colspan ?? 1, 1), cols.length - ci);
      for (let dr = 0; dr < rowspan; dr++) for (let dc = 0; dc < colspan; dc++) {
        if (dr || dc) set.add(`${ri + dr},${ci + dc}`);
      }
    }
    return set;
  })();
  const bandForKey = (key: string) => {
    const [rid, cid] = key.split('::');
    return bands.find(b => b.axis === 'row'
      ? b.refs.includes(rid) && (!b.cross_refs?.length || b.cross_refs.includes(cid))
      : b.refs.includes(cid) && (!b.cross_refs?.length || b.cross_refs.includes(rid)));
  };
  const inBand = (key: string) => !!bandForKey(key);
  const sampleCellForHeader = (key: string): string | null => {
    if (!headerCells[key]) return null;
    const headerText = (cells[key] || '').trim();
    if (!headerText) return null;
    const rowIdx = new Map(rows.map((r, i) => [r.id, i]));
    const colIdx = new Map(cols.map((c, i) => [c.id, i]));
    const [rid, cid] = key.split('::');
    for (const band of bands) {
      if (band.axis === 'row') {
        if (band.refs.includes(rid)) continue;
        const refIndexes = band.refs.map(id => rowIdx.get(id)).filter((i): i is number => i != null);
        const headerIndex = rowIdx.get(rid);
        if (!refIndexes.length || headerIndex == null) continue;
        const minRef = Math.min(...refIndexes);
        if (headerIndex >= minRef) continue;
        let nearestHeaderKey: string | null = null;
        for (let ri = minRef - 1; ri >= 0; ri--) {
          const candidateKey = `${rows[ri].id}::${cid}`;
          if (headerCells[candidateKey]) { nearestHeaderKey = candidateKey; break; }
        }
        if (nearestHeaderKey !== key) continue;
        const sampleKey = band.refs.map(rowId => `${rowId}::${cid}`).find(k => (!!inputCells[k] || !!formulaCells[k]) && !!ft && !!sampleBandForCell(ft, k));
        if (sampleKey) return sampleKey;
      } else {
        if (band.refs.includes(cid)) continue;
        const refIndexes = band.refs.map(id => colIdx.get(id)).filter((i): i is number => i != null);
        const headerIndex = colIdx.get(cid);
        if (!refIndexes.length || headerIndex == null) continue;
        const minRef = Math.min(...refIndexes);
        if (headerIndex >= minRef) continue;
        let nearestHeaderKey: string | null = null;
        for (let ci = minRef - 1; ci >= 0; ci--) {
          const candidateKey = `${rid}::${cols[ci].id}`;
          if (headerCells[candidateKey]) { nearestHeaderKey = candidateKey; break; }
        }
        if (nearestHeaderKey !== key) continue;
        const sampleKey = band.refs.map(colId => `${rid}::${colId}`).find(k => (!!inputCells[k] || !!formulaCells[k]) && !!ft && !!sampleBandForCell(ft, k));
        if (sampleKey) return sampleKey;
      }
    }
    return null;
  };
  const isSampleIndexHeader = (key: string) => {
    const sampleKey = sampleCellForHeader(key);
    return !!headerCells[key] && !!sampleKey && !!sampleIndexCells[sampleKey];
  };
  const sampleCellForClick = (key: string): string | null => {
    if (!allowSample) return null;
    if (headerCells[key]) return sampleCellForHeader(key);
    return null;
  };
  const bindingForClick = (key: string): CellBinding | null => {
    if (!field) return null;
    if (unitOnly) {
      if (!ft?.cell_units?.[key] && !ft?.cell_unit_options?.[key]?.length) return null;
      return { source: sampleUnit && inBand(key) ? 'record_free_cell_unit_sample' : 'record_free_cell_unit', field_code: field.code, cell_key: key };
    }
    if (allowTemplate && headerCells[key]) return freeGridSourceBinding(field, key);
    if (allowSample && ft && !headerCells[key] && sampleBandForCell(ft, key)) return freeGridSourceBinding(field, key);
    if (formulaCells[key] && allowFixed) return freeGridSourceBinding(field, key, false);
    if (allowSample && isSampleIndexHeader(key)) return { source: 'record_sample_index', matrix_code: '' };
    const sampleKey = sampleCellForClick(key);
    if (sampleKey) return freeGridSourceBinding(field, sampleKey);
    const fixedText = !!ft?.fixed_text_cells?.[key] || (!headerCells[key] && !inputCells[key] && !formulaCells[key]);
    if (allowFixed && (inputCells[key] || fixedText)) return { source: 'record_free_cell', field_code: field.code, cell_key: key };
    return null;
  };
  const fixedSelected = (key: string) => value.source === 'record_free_cell' && value.field_code === field?.code && value.cell_key === key;
  const templateSelected = (key: string) => value.source === 'record_free_template_cell' && value.field_code === field?.code && value.cell_key === key;
  const unitSelected = (key: string) => (value.source === 'record_free_cell_unit' || value.source === 'record_free_cell_unit_sample') && value.field_code === field?.code && value.cell_key === key;
  const formulaSelected = (key: string) => (value.source === 'record_free_formula_cell' || value.source === 'record_free_formula_cell_sample') && value.field_code === field?.code && value.cell_key === key;
  const sameSampleParameter = (selectedCellKey: string, key: string): boolean => {
    return selectedCellKey === key || (!allowTemplate && sampleCellForHeader(key) === selectedCellKey);
  };
  const sameSampleIndexArea = (key: string): boolean => {
    if (sampleIndexCells[key] && inBand(key)) return true;
    if (!isSampleIndexHeader(key) && !sampleCellForClick(key)) return false;
    const [rowId, colId] = key.split('::');
    for (const band of bands) {
      if (band.axis === 'row') {
        const headerKey = rows.map(r => `${r.id}::${colId}`).find(k => isSampleIndexHeader(k));
        if (headerKey && (headerKey === key || band.refs.includes(rowId))) return true;
      } else {
        const headerKey = cols.map(c => `${rowId}::${c.id}`).find(k => isSampleIndexHeader(k));
        if (headerKey && (headerKey === key || band.refs.includes(colId))) return true;
      }
    }
    return false;
  };
  const sampleSelected = (key: string) => {
    if (value.source === 'record_sample_index') return sameSampleIndexArea(key);
    if (value.source !== 'record_free_cell_sample' || value.field_code !== field?.code) return false;
    return sameSampleParameter(value.cell_key, key);
  };
  const canPick = (key: string) => !!bindingForClick(key);
  const pick = (key: string) => {
    const binding = bindingForClick(key);
    if (!binding) return;
    onPick(binding);
    if (onPickUnit && 'cell_key' in binding && 'field_code' in binding) {
      const sourceKey = binding.cell_key;
      const hasUnit = !!(ft?.cell_units?.[sourceKey] || ft?.cell_unit_options?.[sourceKey]?.length);
      onPickUnit(hasUnit ? {
        source: binding.source === 'record_free_cell_sample' || binding.source === 'record_free_formula_cell_sample' ? 'record_free_cell_unit_sample' : 'record_free_cell_unit',
        field_code: field!.code,
        cell_key: sourceKey,
      } : undefined);
    } else if (onPickUnit) onPickUnit(undefined);
  };

  if (!fields.length) return <Empty description={unitOnly ? '自定义记录表格中没有配置单位' : '关联原始记录里没有自定义记录表格'} />;
  return (
    <div>
      {!compact && <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={unitOnly ? '选择要使用的单位' : allowTemplate && !allowSample && !allowFixed ? '选择表头' : allowSample && !allowFixed ? '选择逐试样参数' : '选择自定义记录表格里的数据'}
        description={unitOnly
          ? '只有设置了固定单位或单位选项的格子可以选择。'
          : allowTemplate && !allowSample && !allowFixed
          ? '点击灰色表头即可关联其文字；原表头设置了单位时会同时关联单位。'
          : allowSample && !allowFixed
          ? '点击一份试样中的数据格；报告会为每个试样读取对应值，公式与单位自动跟随。'
          : allowFixed && !allowSample
            ? '点击录入格或“录入可改”的固定文字格，可绑定这个固定位置的值。未修改的固定文字会使用模板默认值。'
            : '点击来源格：试样区域的数据自动逐试样读取；表头读取文字，区域外的内容固定读取。'}
      />}
      <Space style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ color: '#595959', fontWeight: 600 }}>{field?.label || '原始记录表格'}</span>
        {fields.length > 1 && <Select
            style={{ width: 240 }}
            value={field?.code}
            onChange={setFieldCode}
            options={fields.map(f => ({ value: f.code, label: f.label || '未命名表格' }))}
          />}
      </Space>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', minWidth: 520 }}>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={r.id}>
                {cols.map((c, ci) => {
                  if (covered.has(`${ri},${ci}`)) return null;
                  const key = `${r.id}::${c.id}`;
                  const span = spans[key];
                  const colspan = Math.min(Math.max(span?.colspan ?? 1, 1), cols.length - ci);
                  const rowspan = Math.min(Math.max(span?.rowspan ?? 1, 1), rows.length - ri);
                  const isHeader = !!headerCells[key];
                  const isInput = !!inputCells[key];
                  const isFixedText = !!ft?.fixed_text_cells?.[key] || (!isHeader && !isInput && !formulaCells[key]);
                  const band = inBand(key);
                  const selected = fixedSelected(key) || templateSelected(key) || unitSelected(key) || formulaSelected(key) || sampleSelected(key);
                  const pickable = canPick(key);
                  const sampleByHeader = !!(isHeader && sampleCellForClick(key));
                  const configuredUnit = ft?.cell_units?.[key] || ft?.cell_unit_options?.[key]?.join(' / ');
                  const isFormula = !!formulaCells[key];
                  return (
                    <td
                      key={key}
                      colSpan={colspan > 1 ? colspan : undefined}
                      rowSpan={rowspan > 1 ? rowspan : undefined}
                      onClick={() => pick(key)}
                      title={pickable ? (sampleByHeader ? '点击绑定该参数的全部试样结果' : '点击绑定这个格子的值') : undefined}
                      style={{
                      ...td,
                      minWidth: 96,
                      textAlign: 'center',
                      cursor: pickable ? 'pointer' : 'default',
                      background: selected ? '#e6f4ff' : unitOnly && configuredUnit ? '#e6fffb' : isFormula ? '#f9f0ff' : sampleByHeader ? '#f6ffed' : isHeader ? '#fafafa' : band ? '#effcfb' : isFixedText ? '#fffaf5' : isInput ? '#fff7e6' : '#fff',
                      boxShadow: selected ? 'inset 0 0 0 2px #1677ff' : unitOnly && configuredUnit ? 'inset 0 0 0 1px #36cfc9' : undefined,
                    }}>
                      <div style={{ fontWeight: isHeader ? 700 : 400, color: isInput || isFixedText ? '#333' : '#595959', marginBottom: pickable || selected || isInput || isFixedText ? 6 : 0 }}>
                        {cells[key] || (isInput ? '录入格' : isFixedText ? '固定文字' : '—')}{ft?.cell_units?.[key]
                          ? `（${ft.cell_units[key]}）`
                          : ft?.cell_unit_options?.[key]?.length ? `（${ft.cell_unit_options[key].join(' / ')}）` : ''}
                      </div>
                      {selected && <Tag color="blue">已选择</Tag>}
                      {unitOnly && configuredUnit && !selected && <Tag color="cyan">单位：{configuredUnit}</Tag>}
                      {!unitOnly && isFormula && !selected && <Tag color="purple">公式结果</Tag>}
                      {!unitOnly && isFixedText && !selected && <Tag color="orange">固定文字</Tag>}
                      {!compact && !selected && sampleByHeader && <div style={{ fontSize: 11, color: '#52c41a' }}>绑定试样结果</div>}
                      {!compact && !selected && pickable && !sampleByHeader && <div style={{ fontSize: 11, color: '#1677ff' }}>点击选择</div>}
                      {!compact && isInput && !pickable && <div style={{ fontSize: 11, color: '#bbb' }}>{band ? '试样区' : '录入数据'}</div>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function describeFreeGridCellSource(fieldCode: string, cellKey: string, linkedRecord?: RecordTemplate | null, mode: 'cell' | 'sample' = 'cell') {
  const findField = (code: string) => {
    if (linkedRecord) for (const g of linkedRecord.groups) {
      const f = g.fields.find(x => x.code === code);
      if (f) return f;
    }
    return undefined;
  };
  const freeGridBands = (ft: FieldDefinition['free_table']) => {
    if (!ft) return [];
    return ft.sample_bands?.length
      ? ft.sample_bands.filter(b => b?.refs?.length)
      : (ft.sample_band?.ref ? [{ id: 'legacy', axis: ft.sample_band.axis, refs: [ft.sample_band.ref], matrix_code: ft.sample_band.matrix_code }] : []);
  };
  const f = findField(fieldCode);
  const ft = f?.free_table;
  const label = f?.label || '原始记录表格';
  if (!ft) return `${label} · 指定单元格`;
  const rows = ft.rows || [];
  const columns = ft.columns || [];
  const cells = ft.cells || {};
  const headerCells = ft.header_cells || {};
  const spans = ft.spans || {};
  const text = ft.cells?.[cellKey]?.trim();
  const [rowId, colId] = cellKey.split('::');
  const rowIndex = new Map(rows.map((r, i) => [r.id, i]));
  const colIndex = new Map(columns.map((c, i) => [c.id, i]));
  const ri = rowIndex.get(rowId);
  const ci = colIndex.get(colId);
  if (ri == null || ci == null) return `${label} · 指定单元格`;
  const keyAt = (r: number, c: number) => `${rows[r]?.id}::${columns[c]?.id}`;
  const spanRect = (() => {
    const own = spans[cellKey];
    if (own) return { minR: ri, maxR: ri + Math.max(own.rowspan ?? 1, 1) - 1, minC: ci, maxC: ci + Math.max(own.colspan ?? 1, 1) - 1 };
    for (const [k, sp] of Object.entries(spans)) {
      const [rid, cid] = k.split('::');
      const sr = rowIndex.get(rid), sc = colIndex.get(cid);
      if (sr == null || sc == null) continue;
      const maxR = sr + Math.max(sp.rowspan ?? 1, 1) - 1;
      const maxC = sc + Math.max(sp.colspan ?? 1, 1) - 1;
      if (ri >= sr && ri <= maxR && ci >= sc && ci <= maxC) return { minR: sr, maxR, minC: sc, maxC };
    }
    return { minR: ri, maxR: ri, minC: ci, maxC: ci };
  })();
  const headerText = (r: number, c: number) => {
    const k = keyAt(r, c);
    return headerCells[k] ? cells[k]?.trim() : '';
  };
  const nearestColHeader = () => {
    for (let r = spanRect.minR - 1; r >= 0; r--) {
      for (let c = spanRect.minC; c <= spanRect.maxC; c++) {
        const t = headerText(r, c);
        if (t) return t;
      }
    }
    return '';
  };
  const nearestRowHeader = () => {
    for (let c = spanRect.minC - 1; c >= 0; c--) {
      for (let r = spanRect.minR; r <= spanRect.maxR; r++) {
        const t = headerText(r, c);
        if (t) return t;
      }
    }
    return '';
  };
  const band = freeGridBands(ft).find(b => b.axis === 'row' ? b.refs.includes(rowId) : b.refs.includes(colId));
  const sampleParam = (() => {
    if (!band) return '';
    if (band.axis === 'row') return nearestColHeader();
    return nearestRowHeader();
  })();
  if (mode === 'sample') return `${label} · 所有试样 · ${sampleParam || text || '指定参数'}`;
  const rowHeader = nearestRowHeader();
  const colHeader = nearestColHeader();
  const parts: string[] = [];
  if (rowHeader) parts.push(`行「${rowHeader}」`);
  if (colHeader) parts.push(`列「${colHeader}」`);
  const merged = spanRect.maxR > spanRect.minR || spanRect.maxC > spanRect.minC;
  if (parts.length) return `${label} · ${merged ? '合并格 · ' : ''}${parts.join(' · ')}`;
  const pos = `第 ${ri + 1} 行第 ${ci + 1} 列`;
  return `${label} · ${text || (merged ? `合并格 · ${pos}` : pos)}`;
}

/** 紧凑型 binding 概要：用在单元格按钮上显示当前绑定内容 */
export function BindingSummary({ value, linkedRecord }: { value: CellBinding; linkedRecord?: RecordTemplate | null }) {
  const findField = (code: string) => {
    if (linkedRecord) for (const g of linkedRecord.groups) {
      const f = g.fields.find(x => x.code === code);
      if (f) return f;
    }
    return undefined;
  };
  const paramLabel = (code: string, param: string) => {
    if (linkedRecord) for (const g of linkedRecord.groups) {
      const mf = g.fields.find(x => x.code === code);
      if (mf && mf.matrix) { const p = mf.matrix.parameters.find(p => p.code === param); if (p) return p.label; }
    }
    return '未命名参数';
  };
  const freeCellText = (fieldCode: string, cellKey: string, mode: 'cell' | 'sample' = 'cell') => describeFreeGridCellSource(fieldCode, cellKey, linkedRecord, mode);
  if (value.source === 'record_header') {
    return <span><Tag color="cyan">参数单位</Tag><span style={{ marginLeft: 4 }}>「{paramLabel(value.matrix_code, value.param_code)}」的单位/要求</span></span>;
  }
  if (value.source === 'record_cell_sample') {
    return <span><Tag color="green">试样结果</Tag><span style={{ marginLeft: 4 }}>「{paramLabel(value.matrix_code, value.param_code)}」</span></span>;
  }
  if (value.source === 'record_sample_label') {
    return <span><Tag color="green">按试样</Tag><span style={{ marginLeft: 4 }}>每个试样的名称</span></span>;
  }
  if (value.source === 'record_sample_index') {
    return <span><Tag color="green">按试样</Tag><span style={{ marginLeft: 4 }}>自动编号 1、2、3…</span></span>;
  }
  if (value.source === 'literal') {
    return <span><Tag color="default">固定文字</Tag><span style={{ marginLeft: 4 }}>{value.text || '空白'}</span></span>;
  }
  if (value.source === 'order') {
    const label = ORDER_KEYS.find(k => k.value === value.key)?.label || value.key;
    return <span><Tag color="purple">委托单</Tag><span style={{ marginLeft: 4 }}>{label}</span></span>;
  }
  if (value.source === 'order_samples') {
    return <span><Tag color="purple">委托单</Tag><span style={{ marginLeft: 4 }}>样品清单{value.numbered !== false ? '（带编号' : '（无编号'}{value.layout === 'lines' ? '·分行）' : '·一行）'}</span></span>;
  }
  if (value.source === 'sample') {
    const label = SAMPLE_KEYS.find(k => k.value === value.key)?.label || value.key;
    return <span><Tag color="purple">样品</Tag><span style={{ marginLeft: 4 }}>{label}</span></span>;
  }
  if (value.source === 'test') {
    const label = TEST_KEYS.find(k => k.value === value.key)?.label || value.key;
    return <span><Tag color="purple">测试项目</Tag><span style={{ marginLeft: 4 }}>{label}</span></span>;
  }
  if (value.source === 'report_meta') {
    const label = REPORT_META_KEYS.find(k => k.value === value.key)?.label || value.key;
    return <span><Tag color="geekblue">报告抬头</Tag><span style={{ marginLeft: 4 }}>{label}</span></span>;
  }
  if (value.source === 'report_sample') {
    const label = SAMPLE_REPORT_KEYS.find(k => k.value === value.key)?.label || value.key;
    return <span><Tag color="cyan">样品信息</Tag><span style={{ marginLeft: 4 }}>{label}</span></span>;
  }
  if (value.source === 'system') {
    const label = SYSTEM_KEYS.find(k => k.value === value.key)?.label || value.key;
    return <span><Tag color="purple">系统</Tag><span style={{ marginLeft: 4 }}>{label}</span></span>;
  }
  if (value.source === 'record_field') {
    const label = findField(value.field_code)?.label || '未命名字段';
    return <span><Tag color="blue">原始记录</Tag><span style={{ marginLeft: 4 }}>取「{label || '未选择字段'}」</span></span>;
  }
  if (value.source === 'record_field_unit') {
    const field = findField(value.field_code);
    return <span><Tag color="cyan">单位</Tag><span style={{ marginLeft: 4 }}>跟随「{field?.label || '未命名字段'}」{field?.unit ? `（${field.unit}）` : ''}</span></span>;
  }
  if (value.source === 'record_cell') {
    let pLabel = value.param_code;
    let rowLabel = '';
    if (linkedRecord) {
      for (const g of linkedRecord.groups) {
        const mf = g.fields.find(x => x.code === value.matrix_code);
        if (mf && mf.matrix) {
          const p = mf.matrix.parameters.find(p => p.code === value.param_code);
          if (p) pLabel = p.label;
          // 行名直接取原表格的行标签（default_sample_labels），无则回退「{前缀} N」
          const prefix = mf.matrix.row_header_prefix || '试样';
          rowLabel = mf.matrix.default_sample_labels?.[value.sample_idx] || `${prefix} ${value.sample_idx + 1}`;
          break;
        }
      }
    }
    if (!rowLabel) rowLabel = `行${value.sample_idx + 1}`;  // 无关联记录时兜底
    return <span><Tag color="green">固定试样</Tag><span style={{ marginLeft: 4 }}>取「{rowLabel}」的「{pLabel}」</span></span>;
  }
  if (value.source === 'record_summary') {
    let rowLabel = '未命名汇总';
    if (linkedRecord) {
      for (const g of linkedRecord.groups) {
        const mf = g.fields.find(x => x.code === value.matrix_code);
        if (mf && mf.matrix) {
          const r = mf.matrix.summary_rows?.find(r => r.id === value.row_id);
          if (r) rowLabel = r.label;
          break;
        }
      }
    }
    return <span><Tag color="gold">汇总结果</Tag><span style={{ marginLeft: 4 }}>取「{rowLabel}」{value.param_code ? ` / ${paramLabel(value.matrix_code, value.param_code)}` : ''}</span></span>;
  }
  if (value.source === 'record_free_cell') {
    return <span><Tag color="blue">指定格</Tag><span style={{ marginLeft: 4 }}>「{freeCellText(value.field_code, value.cell_key)}」</span></span>;
  }
  if (value.source === 'record_free_template_cell') {
    return <span><Tag color="blue">表头文字</Tag><span style={{ marginLeft: 4 }}>「{freeCellText(value.field_code, value.cell_key)}」</span></span>;
  }
  if (value.source === 'record_free_formula_cell' || value.source === 'record_free_formula_cell_sample') {
    return <span><Tag color="purple">公式结果</Tag><span style={{ marginLeft: 4 }}>「{freeCellText(value.field_code, value.cell_key, value.source === 'record_free_formula_cell_sample' ? 'sample' : 'cell')}」</span></span>;
  }
  if (value.source === 'record_free_cell_unit' || value.source === 'record_free_cell_unit_sample') {
    return <span><Tag color="cyan">单位</Tag><span style={{ marginLeft: 4 }}>跟随「{freeCellText(value.field_code, value.cell_key, value.source === 'record_free_cell_unit_sample' ? 'sample' : 'cell')}」</span></span>;
  }
  if (value.source === 'record_free_cell_sample') {
    return <span><Tag color="green">试样结果</Tag><span style={{ marginLeft: 4 }}>「{freeCellText(value.field_code, value.cell_key, 'sample')}」</span></span>;
  }
  if (value.source === 'record_meta') {
    const label = ({ tester_name: '主检', tested_at: '检测时间', reviewer_name: '审核', reviewed_at: '审核时间' } as Record<string, string>)[value.key] || value.key;
    return <span><Tag color="magenta">记录</Tag><span style={{ marginLeft: 4 }}>{label}</span></span>;
  }
  return <span style={{ color: '#aaa' }}>（未配置）</span>;
}

const th: React.CSSProperties = { border: '1px solid #ddd', padding: '6px 10px', background: '#fafafa' };
const td: React.CSSProperties = { border: '1px solid #ddd', padding: '6px 10px' };
