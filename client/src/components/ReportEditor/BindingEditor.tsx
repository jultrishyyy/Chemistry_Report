/**
 * BindingEditor — 配置一个 CellBinding（一个格子的取值方式）
 * 支持的来源：自定义 / 委托单字段 / 系统字段 / 原始记录字段 / 原始记录矩阵单元 / 原始记录汇总行
 */
import { useMemo } from 'react';
import { Select, Space, InputNumber } from 'antd';
import type { CellBinding, RecordTemplate, FieldDefinition } from '../../../../shared/types';
import AutoGrowTextArea from '../AutoGrowTextArea';

interface Props {
  value: CellBinding;
  onChange: (b: CellBinding) => void;
  linkedRecord?: RecordTemplate | null;
  /** 紧凑模式：在表格单元格内使用 */
  compact?: boolean;
}

const SOURCE_OPTIONS = [
  { value: 'literal', label: '自定义（写死）' },
  { value: 'order', label: '委托单·订单字段' },
  { value: 'sample', label: '委托单·样品字段' },
  { value: 'test', label: '委托单·测试项目字段' },
  { value: 'system', label: '系统字段' },
  { value: 'record_field', label: '原始记录字段' },
  { value: 'record_cell', label: '矩阵单元格' },
  { value: 'record_summary', label: '矩阵汇总行' },
  { value: 'record_meta', label: '主检 / 审核（自动）' },
];

// 订单级（接口 PushOrderInfos 1.1 订单字段）
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

// 样品级（接口 1.1 样品属性）
const SAMPLE_KEYS = [
  { value: 'sample_name', label: '样品名称' },
  { value: 'barcode', label: '样品条码' },
  { value: 'sort_no', label: '样品序号' },
  { value: 'model', label: '型号' },
];

// 材料分单 / 测试项目级（接口 1.1 TaskList 属性）
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

const SYSTEM_KEYS = [
  { value: 'today', label: '今天日期' },
  { value: 'now', label: '当前时间' },
];

const META_KEYS = [
  { value: 'tester_name', label: '主检姓名' },
  { value: 'tested_at', label: '检测时间' },
  { value: 'reviewer_name', label: '审核姓名' },
  { value: 'reviewed_at', label: '审核时间' },
];

export default function BindingEditor({ value, onChange, linkedRecord, compact }: Props) {
  const source = value.source;

  // 普通字段（非矩阵）选项
  const scalarFieldOptions = useMemo(() => {
    if (!linkedRecord) return [];
    const opts: { value: string; label: string }[] = [];
    for (const g of linkedRecord.groups) {
      for (const f of g.fields) {
        if (f.type !== 'data_matrix') opts.push({ value: f.code, label: f.label || '未命名字段' });
      }
    }
    return opts;
  }, [linkedRecord]);

  // 矩阵字段列表
  const matrixFields = useMemo(() => {
    if (!linkedRecord) return [];
    const list: FieldDefinition[] = [];
    for (const g of linkedRecord.groups) {
      for (const f of g.fields) {
        if (f.type === 'data_matrix' && f.matrix) list.push(f);
      }
    }
    return list;
  }, [linkedRecord]);

  const compactStyle: React.CSSProperties = compact ? { width: '100%' } : {};

  return (
    <Space direction="vertical" size={4} style={{ width: '100%' }}>
      <Select size="small" style={compactStyle}
        value={source}
        onChange={(v) => {
          // 切换 source 时重置具体字段
          if (v === 'literal') onChange({ source: 'literal', text: '' });
          else if (v === 'order') onChange({ source: 'order', key: 'order_no' });
          else if (v === 'sample') onChange({ source: 'sample', key: 'sample_name' });
          else if (v === 'test') onChange({ source: 'test', key: 'project_name' });
          else if (v === 'system') onChange({ source: 'system', key: 'today' });
          else if (v === 'record_meta') onChange({ source: 'record_meta', key: 'tester_name' });
          else if (v === 'record_field') onChange({ source: 'record_field', field_code: '' });
          else if (v === 'record_cell') onChange({ source: 'record_cell', matrix_code: matrixFields[0]?.code || '', sample_idx: 0, param_code: '' });
          else if (v === 'record_summary') onChange({ source: 'record_summary', matrix_code: matrixFields[0]?.code || '', row_id: '' });
        }}
        options={SOURCE_OPTIONS}
      />

      {value.source === 'literal' && (
        <AutoGrowTextArea size="small" placeholder="写死的文字" value={value.text}
          onChange={(e) => onChange({ source: 'literal', text: e.target.value })} />
      )}

      {value.source === 'order' && (
        <Select size="small" style={compactStyle} value={value.key}
          onChange={(k) => onChange({ source: 'order', key: k as any })}
          options={ORDER_KEYS} />
      )}

      {value.source === 'sample' && (
        <Select size="small" showSearch optionFilterProp="label" style={compactStyle} value={value.key}
          onChange={(k) => onChange({ source: 'sample', key: k as any })}
          options={SAMPLE_KEYS} />
      )}

      {value.source === 'test' && (
        <Select size="small" showSearch optionFilterProp="label" style={compactStyle} value={value.key}
          onChange={(k) => onChange({ source: 'test', key: k as any })}
          options={TEST_KEYS} />
      )}

      {value.source === 'system' && (
        <Select size="small" style={compactStyle} value={value.key}
          onChange={(k) => onChange({ source: 'system', key: k as any })}
          options={SYSTEM_KEYS} />
      )}

      {value.source === 'record_meta' && (
        <Select size="small" style={compactStyle} value={value.key}
          onChange={(k) => onChange({ source: 'record_meta', key: k as any })}
          options={META_KEYS} />
      )}

      {value.source === 'record_field' && (
        <Select size="small" showSearch optionFilterProp="label" style={compactStyle}
          placeholder={linkedRecord ? '选字段' : '先关联原始记录'}
          disabled={!linkedRecord}
          value={value.field_code || undefined}
          onChange={(c) => onChange({ source: 'record_field', field_code: c })}
          options={scalarFieldOptions} />
      )}

      {value.source === 'record_cell' && (
        <RecordCellPicker value={value} onChange={onChange} matrixFields={matrixFields} disabled={!linkedRecord} />
      )}

      {value.source === 'record_summary' && (
        <RecordSummaryPicker value={value} onChange={onChange} matrixFields={matrixFields} disabled={!linkedRecord} />
      )}
    </Space>
  );
}

function RecordCellPicker({ value, onChange, matrixFields, disabled }: {
  value: Extract<CellBinding, { source: 'record_cell' }>;
  onChange: (b: CellBinding) => void;
  matrixFields: FieldDefinition[];
  disabled?: boolean;
}) {
  const currentMatrix = matrixFields.find(m => m.code === value.matrix_code);
  const params = currentMatrix?.matrix?.parameters || [];
  const sampleCount = currentMatrix?.matrix?.default_sample_count || 1;
  return (
    <Space wrap size={4}>
      <Select size="small" style={{ width: 140 }} placeholder="矩阵" disabled={disabled}
        value={value.matrix_code || undefined}
        onChange={(v) => onChange({ ...value, matrix_code: v, sample_idx: 0, param_code: params[0]?.code || '' })}
        options={matrixFields.map(m => ({ value: m.code, label: m.label }))} />
      <span style={{ fontSize: 11 }}>试样</span>
      <InputNumber size="small" min={1} max={sampleCount} style={{ width: 60 }}
        value={value.sample_idx + 1}
        onChange={(v) => onChange({ ...value, sample_idx: Math.max(0, (v || 1) - 1) })} />
      <span style={{ fontSize: 11 }}>列</span>
      <Select size="small" style={{ width: 120 }} placeholder="参数" disabled={disabled || !params.length}
        value={value.param_code || undefined}
        onChange={(v) => onChange({ ...value, param_code: v })}
        options={params.map(p => ({ value: p.code, label: p.label }))} />
    </Space>
  );
}

function RecordSummaryPicker({ value, onChange, matrixFields, disabled }: {
  value: Extract<CellBinding, { source: 'record_summary' }>;
  onChange: (b: CellBinding) => void;
  matrixFields: FieldDefinition[];
  disabled?: boolean;
}) {
  const currentMatrix = matrixFields.find(m => m.code === value.matrix_code);
  const summaryRows = currentMatrix?.matrix?.summary_rows || [];
  const params = currentMatrix?.matrix?.parameters || [];
  const currentRow = summaryRows.find(r => r.id === value.row_id);
  // 逐列汇总行（统计行）：per_column_aggregate 或 per_column=true（如「平均值」）都按列存值，须选「参数列」补 param_code
  const isPerColumn = currentRow?.source_type === 'per_column_aggregate' || !!currentRow?.per_column;
  return (
    <Space wrap size={4}>
      <Select size="small" style={{ width: 140 }} placeholder="矩阵" disabled={disabled}
        value={value.matrix_code || undefined}
        onChange={(v) => onChange({ ...value, matrix_code: v, row_id: '', param_code: undefined })}
        options={matrixFields.map(m => ({ value: m.code, label: m.label }))} />
      <Select size="small" style={{ width: 140 }} placeholder="汇总行" disabled={disabled || !summaryRows.length}
        value={value.row_id || undefined}
        onChange={(v) => onChange({ ...value, row_id: v })}
        options={summaryRows.map(r => ({ value: r.id, label: r.label }))} />
      {isPerColumn && (
        <Select size="small" style={{ width: 120 }} placeholder="参数列"
          value={value.param_code || undefined}
          onChange={(v) => onChange({ ...value, param_code: v })}
          options={params.map(p => ({ value: p.code, label: p.label }))} />
      )}
    </Space>
  );
}
