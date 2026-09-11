import { Fragment, useState, useEffect, useMemo, useRef } from 'react';
import dayjs from 'dayjs';
import { Input, Select, Checkbox, DatePicker, Tag, Card, Button, Space, Upload, Modal, message, Alert, Dropdown, Tooltip, InputNumber } from 'antd';
import { BoldOutlined, ItalicOutlined, AlignLeftOutlined, AlignCenterOutlined, AlignRightOutlined, QuestionCircleOutlined, PlusOutlined, DeleteOutlined, CameraOutlined, InfoCircleOutlined, FileImageOutlined, ToolOutlined, EditOutlined, MergeCellsOutlined, SplitCellsOutlined } from '@ant-design/icons';
import type { FieldDefinition, FieldGroup, RecordTemplate, VariantDef, DataMatrixValue } from '../../../../shared/types';
import { buildGroupTree } from '../../../../shared/group-tree';
import { findImageCollection, imageCollectionFromLegacy, imageCollectionKey, type RecordImageCollection } from '../../../../shared/image-collection';
import { figureCaptionFieldKey, figureCaptionGroupKey } from '../../../../shared/figure-caption';
import { resolveFreeGridCellReference } from '../../../../shared/free-grid-formula';
import { applyNumericRounding } from '../../../../shared/numeric-rounding';
import { freeGridNumberText } from '../../../../shared/free-grid-number';
import { freeGridAddress, freeGridFormulaLabel } from '../../../../shared/free-grid-formula-label';
import { columnName } from '../../../../shared/excel-import';
import FreeGridNumberInput from '../FreeGridNumberInput';
import FreeGridNumberSettings from '../FreeGridNumberSettings';
import { editSampleAxes, readSampleAxes, type SampleAxisEntry } from '../../../../shared/free-grid-samples';
import { entryRangeOnly, entrySpanRanges, rangesIntersect, entryInsertionIndex, resolveEntrySelection, ORIGINAL_STRUCTURE_MESSAGE } from '../../../../shared/free-grid-entry-structure';
import { buildFreeGridLayout } from '../../../../shared/free-grid-layout';
import { BRAND } from '../../theme';
import { IS_TOUCH } from '../../utils/device';
import { parseSpreadsheetClipboard } from '../../utils/spreadsheetClipboard';
import { prepareImageForUpload } from '../../utils/imageProcessing';
import axios from 'axios';
import ExcelImportWizard from '../ExcelImportWizard';
import ImageProcessButton, { formatFileBytes } from '../ImageProcessButton';
import AutoGrowTextArea from '../AutoGrowTextArea';
import RecordImageCollectionEditor from '../RecordImageCollectionEditor';
import { handleExcelTableKeyDown, markSpreadsheetActiveCell } from '../../utils/excelTableNavigation';

const datePickerFormat = (precision: FieldDefinition['date_precision'], separator: FieldDefinition['date_separator']) => {
  const day = separator === '/' ? 'YYYY/MM/DD' : 'YYYY-MM-DD';
  return precision === 'minute' ? `${day} HH:mm` : precision === 'hour' ? `${day} HH:00` : day;
};
const dateStorageFormat = (precision: FieldDefinition['date_precision']) =>
  precision === 'minute' ? 'YYYY-MM-DDTHH:mm' : precision === 'hour' ? 'YYYY-MM-DDTHH:00' : 'YYYY-MM-DD';
const FREE_GRID_STRUCTURE_KEY = '__free_table_structure__';
const FREE_GRID_STRUCTURE_CHANGED_KEY = '__structure_changed__';
const dateInput = (field: FieldDefinition, value: any, onChange: (v: any) => void) => (
  <DatePicker size="small"
    showTime={field.date_precision && field.date_precision !== 'day' ? { format: field.date_precision === 'minute' ? 'HH:mm' : 'HH' } : false}
    format={datePickerFormat(field.date_precision, field.date_separator)}
    value={value && dayjs(String(value)).isValid() ? dayjs(String(value)) : null}
    onChange={(d) => onChange(d ? d.format(dateStorageFormat(field.date_precision)) : '')} />
);

function RecordConclusionField({ field, value, onChange }: {
  field: FieldDefinition;
  value: any;
  onChange: (value: any) => void;
}) {
  const cfg = field.record_conclusion;
  if (!cfg) return null;
  const stored = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const storedItems = Array.isArray(stored.items) ? stored.items : [];
  const items = (cfg.items || []).map((definition) => {
    const actual = storedItems.find((entry: any) => entry?.item_code === definition.code || entry?.code === definition.code) || {};
    return {
      item_code: definition.code,
      display_name: actual.display_name ?? (definition.name_mode === 'inherit_project' ? '' : definition.name || ''),
      execution_status: actual.execution_status || 'completed',
      judgment_requirement: actual.judgment_requirement ?? definition.judgment_requirement ?? '',
      conclusion: actual.conclusion ?? '',
      report_enabled: actual.report_enabled ?? definition.default_report_enabled !== false,
    };
  });
  const current = {
    mode: cfg.mode,
    project_code: cfg.project_code || '',
    project_name: stored.project_name ?? cfg.project_name,
    project_judgment_requirement: stored.project_judgment_requirement ?? cfg.project_summary?.judgment_requirement ?? '',
    project_conclusion: stored.project_conclusion ?? '',
    items,
  };
  const patchItem = (index: number, patch: Record<string, any>) => {
    const next = current.items.map((item, i) => i === index ? { ...item, ...patch } : item);
    onChange({ ...current, items: next });
  };
  const statusOptions = [
    { value: 'completed', label: '已完成' },
    { value: 'not_tested', label: '未检测' },
    { value: 'not_applicable', label: '不适用' },
    { value: 'unable', label: '无法检测' },
  ];

  return (
    <div style={{ margin: '8px 0 12px', padding: '12px', border: '1px solid #b7ebc6', borderLeft: '4px solid #389e0d', borderRadius: 6, background: '#fbfff9' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontWeight: 700, color: '#237804' }}>{field.label || '报告结论'}</span>
        <Tag color={cfg.mode === 'children' ? 'blue' : 'green'}>{cfg.mode === 'children' ? '按子项目展开' : '整体项目结论'}</Tag>
        <span style={{ color: '#8c8c8c', fontSize: 11 }}>已完成且“进入报告”的项目才会出现在检测结论表</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ width: 92, color: '#596579', fontSize: 12 }}>报告项目名称</span>
        <Input size="small" style={{ maxWidth: 420 }} value={current.project_name}
          disabled={cfg.allow_project_name_override === false}
          onChange={(event) => onChange({ ...current, project_name: event.target.value })} />
        {cfg.allow_project_name_override === false && <Tag>模板固定</Tag>}
      </div>
      {cfg.mode === 'children' && cfg.project_summary &&
        (cfg.project_summary.judgment_enabled !== false || cfg.project_summary.conclusion_enabled !== false) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) minmax(180px, 0.7fr)', gap: 10, marginBottom: 10, padding: 10, border: '1px solid #d6e4ff', borderRadius: 6, background: '#f7faff' }}>
          {cfg.project_summary.judgment_enabled !== false ? <div>
            <div style={{ color: '#596579', fontSize: 12, marginBottom: 4 }}>总项目判定要求</div>
            <AutoGrowTextArea size="small" value={current.project_judgment_requirement}
              placeholder={(cfg.project_summary.judgment_options || []).join(' / ') || '请输入总项目判定要求'}
              onChange={(event) => onChange({ ...current, project_judgment_requirement: event.target.value })} />
            {!!cfg.project_summary.judgment_options?.length && <Space size={[3, 3]} wrap style={{ marginTop: 3 }}>
              {cfg.project_summary.judgment_options.map(option => <Tag key={option} style={{ cursor: 'pointer', margin: 0 }}
                onClick={() => onChange({ ...current, project_judgment_requirement: option })}>{option}</Tag>)}
            </Space>}
          </div> : <div />}
          {cfg.project_summary.conclusion_enabled !== false && <div>
            <div style={{ color: '#596579', fontSize: 12, marginBottom: 4 }}>总结论</div>
            <Select size="small" showSearch allowClear style={{ width: '100%' }}
              value={current.project_conclusion || undefined}
              options={(cfg.project_summary.conclusion_options || ['符合', '不符合']).map(option => ({ value: option, label: option }))}
              onChange={(project_conclusion) => onChange({ ...current, project_conclusion: project_conclusion || '' })} />
          </div>}
        </div>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760, fontSize: 12 }}>
          <thead><tr>
            {cfg.mode === 'children' && <th style={conclusionHeadStyle}>子项目名称</th>}
            <th style={conclusionHeadStyle}>实施状态</th>
            <th style={conclusionHeadStyle}>判定要求</th>
            <th style={conclusionHeadStyle}>结论</th>
            <th style={{ ...conclusionHeadStyle, width: 82 }}>进入报告</th>
          </tr></thead>
          <tbody>{items.map((item, index) => {
            const definition = cfg.items[index];
            const completed = item.execution_status === 'completed';
            return <tr key={item.item_code}>
              {cfg.mode === 'children' && <td style={conclusionCellStyle}>
                <Input size="small" value={item.display_name} disabled={definition.allow_name_override === false}
                  onChange={(event) => patchItem(index, { display_name: event.target.value })} />
              </td>}
              <td style={conclusionCellStyle}><Select size="small" style={{ width: 110 }} value={item.execution_status}
                options={statusOptions} onChange={(execution_status) => patchItem(index, {
                  execution_status,
                  ...(execution_status === 'completed' ? {} : { report_enabled: false }),
                })} /></td>
              <td style={conclusionCellStyle}>
                <AutoGrowTextArea size="small" value={item.judgment_requirement}
                  placeholder={(definition.judgment_options || []).join(' / ') || '请输入判定要求'}
                  onChange={(event) => patchItem(index, { judgment_requirement: event.target.value })} />
                {!!definition.judgment_options?.length && <Space size={[3, 3]} wrap style={{ marginTop: 3 }}>
                  {definition.judgment_options.map(option => <Tag key={option} style={{ cursor: 'pointer', margin: 0 }}
                    onClick={() => patchItem(index, { judgment_requirement: option })}>{option}</Tag>)}
                </Space>}
              </td>
              <td style={conclusionCellStyle}><Select size="small" showSearch allowClear style={{ width: '100%' }}
                disabled={!completed} value={item.conclusion || undefined}
                options={(definition.conclusion_options || ['符合', '不符合']).map(option => ({ value: option, label: option }))}
                onChange={(conclusion) => patchItem(index, { conclusion: conclusion || '' })} /></td>
              <td style={{ ...conclusionCellStyle, textAlign: 'center' }}><Checkbox checked={completed && item.report_enabled}
                disabled={!completed} onChange={(event) => patchItem(index, { report_enabled: event.target.checked })} /></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </div>
  );
}

const conclusionHeadStyle: React.CSSProperties = { padding: '7px 8px', border: '1px solid #d9e8d5', background: '#f0f8ed', textAlign: 'left' };
const conclusionCellStyle: React.CSSProperties = { padding: '6px 8px', border: '1px solid #d9e8d5', verticalAlign: 'middle' };

/** 分区标题：主色竖条 + 标题，给原始记录"规整章节"感 */
function sectionTitle(label: React.ReactNode) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 3, height: 14, borderRadius: 2, background: BRAND, display: 'inline-block' }} />
      <span style={{ fontWeight: 600, color: '#1f2733' }}>{label}</span>
    </span>
  );
}
import {
  flattenMatrixValuesToFlatData,
  matrixDataKey,
  normalizeMatrixValue,
  matrixSummaryFlatKey,
  matrixSummaryColumnFlatKey,
  matrixSummaryColCellFlatKey,
  matrixSummaryColSpanFlatKey,
  collectMatrixSummaryDataKeys,
  applyMatrixCellFormulas,
  applyMatrixSummaryFormulas,
  uniqueCode,
} from '../../../../shared/matrix-flatten';
import { execute, executeWithFullPrecision, topologicalOrder } from '../../../../shared/formula-engine';

interface FormRendererProps {
  /** Read-only import simulation; keeps the full template for cross-table formula evaluation. */
  previewFieldCode?: string;
  template: RecordTemplate;
  data: Record<string, any>;
  onChange: (data: Record<string, any>) => void;
  /** 点击/聚焦左侧录入字段时通知外层，使右侧 PDF 定位到对应字段。 */
  /** detailCode 是复杂图表的行/图片子锚点；字段仍保持选中状态。 */
  onFocusField?: (field: FieldDefinition, group: FieldGroup, detailCode?: string) => void;
  /** 当前已定位字段，用于给左侧提供轻量选中反馈。 */
  activeFieldCode?: string | null;
  /** 录入记录 id（存在＝已存草稿/已保存）——用于「导入 Excel」留存附件的下载链接。 */
  recordId?: string | number | null;
  /** 已留存的导入 Excel（附件列表，pending=尚未保存到订单、暂不可下载）。 */
  excelAttachments?: Array<{ id: string; filename: string; pending?: boolean; size_bytes?: number }>;
  /** 用户在顶部导入一份 Excel 后回调（把原文件交给上层留存到订单记录）。 */
  onExcelImported?: (file: File) => void;
  /** 图片上传落盘上下文：决定存到 <根>/<订单号>/<原始记录>/<字段名>。recordDir 传「样品名_测试项目名」。 */
  uploadCtx?: { orderNo?: string; recordDir?: string };
}

type FreeGridDisplayAxis = { id: string; idx: number; sample: number | null };

const freeFormulaOverrideKey = (runtimeKey: string) => `__formula_override__::${runtimeKey}`;

function ConfirmableFormulaValue({ value, displayValue, automaticValue, formulaText, override, label, onSave, onClear }: {
  value: any;
  automaticValue?: any;
  formulaText?: string;
  displayValue?: string;
  override?: { value: string | number; calculated_value?: string | number | null };
  label: string;
  onSave: (entry: { value: string; calculated_value?: string | number | null; confirmed_at: string }) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const overridden = !!override;
  const calculated = automaticValue !== undefined ? automaticValue : value;
  const showEditor = () => {
    setDraft(String(override?.value ?? value ?? ''));
    setOpen(true);
  };
  const confirm = () => {
    if (!draft.trim()) { message.warning('修正值不能为空'); return; }
    onSave({
      value: draft,
      calculated_value: calculated ?? null,
      confirmed_at: new Date().toISOString(),
    });
    setOpen(false);
  };
  return <>
    <Button type="text" size="small" onClick={showEditor}
      title={overridden ? '人工修正值；点击修改或恢复公式' : '公式自动计算；点击可在确认后人工修正'}
      style={{
        width: '100%', minWidth: 56, height: 'auto', padding: '3px 6px', borderRadius: 4,
        border: `1px solid ${overridden ? '#ffc069' : '#d3adf7'}`,
        background: overridden ? '#fff7e6' : '#f7f0ff', color: overridden ? '#ad4e00' : '#531dab',
      }}>
      <strong>{value === null || value === undefined || value === '' ? '—' : displayValue ?? String(value)}</strong>
      <span aria-label={overridden ? '公式值已人工修正' : '公式计算值'} style={{ marginLeft: 5, fontSize: 11, fontStyle: 'italic' }}>ƒ{overridden ? '*' : ''}</span>
    </Button>
    <Modal open={open} title="确认修改公式计算结果" okText="确认使用修正值" cancelText="取消"
      onOk={confirm} onCancel={() => setOpen(false)}
      footer={(_, { OkBtn, CancelBtn }) => <Space>
        {overridden && <Button onClick={() => { onClear(); setOpen(false); }}>恢复公式计算</Button>}
        <CancelBtn /><OkBtn />
      </Space>}>
      <div style={{ marginBottom: 8 }}>公式格：{label}</div>
      {formulaText && <div style={{ marginBottom: 8, padding: 8, background: '#fafafa', overflowWrap: 'anywhere', fontFamily: 'monospace' }}>{formulaText}</div>}
      <div style={{ marginBottom: 12, padding: '8px 10px', borderRadius: 6, background: '#f7f0ff', color: '#531dab' }}>
        公式自动计算结果：<strong>{String(calculated ?? '—')}</strong>
      </div>
      <Input autoFocus value={draft} onChange={event => setDraft(event.target.value)} placeholder="请输入人工修正值" />
      <div style={{ marginTop: 10, color: '#ad6800', fontSize: 12 }}>
        确认后将用于后续计算、判定和 PDF；模板公式不会被修改。
      </div>
    </Modal>
  </>;
}

function computeDerivedMerged(template: RecordTemplate, rawData: Record<string, any>): Record<string, any> {
  let flat = flattenMatrixValuesToFlatData(template, rawData);
  flat = applyMatrixCellFormulas(template, flat);
  flat = applyMatrixSummaryFormulas(template, flat);
  const allFields = template.groups.flatMap(g => g.fields);
  const computedFields = allFields.filter(f => f.type === 'computed' && f.formula);
  const ordered = topologicalOrder(computedFields.map(f => ({ code: f.code, formula: f.formula! })));
  const result: Record<string, any> = { ...flat };
  for (const code of ordered) {
    const field = computedFields.find(f => f.code === code);
    if (field?.formula) {
      try {
        result[code] = execute(field.formula, result);
      } catch {
        result[code] = `错误: ${field.formula.type}`;
      }
    }
  }
  const derived: Record<string, any> = {};
  for (const f of computedFields) {
    derived[f.code] = result[f.code];
  }
  for (const k of collectMatrixSummaryDataKeys(template, result)) {
    derived[k] = result[k];
  }
  // 明细公式格也必须回写到受控表单，否则虽然引擎已算出，录入表格仍只能看到“—”。
  for (const field of allFields) {
    if (field.type !== 'data_matrix' || !field.matrix) continue;
    const matrixValue = rawData[field.code] as DataMatrixValue | undefined;
    const sampleIds = Array.isArray(matrixValue?.sample_ids) ? matrixValue.sample_ids : [];
    for (const sid of sampleIds) {
      for (const parameter of field.matrix.parameters || []) {
        if (!parameter.cell_formula?.trim()) continue;
        const key = `${field.code}__${matrixDataKey(sid, parameter.code)}`;
        derived[key] = result[key];
      }
    }
    for (const cellKey of Object.keys(field.matrix.cell_formulas || {})) {
      const key = `${field.code}__${cellKey}`;
      derived[key] = result[key];
    }
  }
  return derived;
}

export default function FormRenderer({
  template, data, onChange, onFocusField, activeFieldCode, previewFieldCode,
  recordId, excelAttachments, onExcelImported, uploadCtx,
}: FormRendererProps) {
  // 自由表格选择格的受控展开状态：焦点/方向键移动到格子时不展开，Enter 或鼠标点击才展开。
  const [openFreeGridChoice, setOpenFreeGridChoice] = useState<string | null>(null);
  const [freeGridStructureField, setFreeGridStructureField] = useState<string | null>(null);
  const [freeGridSelection, setFreeGridSelection] = useState<{ fieldCode: string; r0: number; c0: number; r1: number; c1: number } | null>(null);
  const gridDrag = useRef<{ fieldCode: string; r0: number; c0: number } | null>(null);
  useEffect(() => {
    if (previewFieldCode) return;
    const stop = () => { gridDrag.current = null; };
    const clearSelection = () => {
      gridDrag.current = null;
      setFreeGridSelection(null);
      document.querySelectorAll('.spreadsheet-active-cell').forEach(cell => cell.classList.remove('spreadsheet-active-cell'));
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') clearSelection(); };
    const outside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('.ant-select-dropdown, .ant-dropdown, .ant-modal, .ant-color-picker, .free-grid-number-settings-popup')) return;
      const editor = target.closest('[data-free-grid-editor]');
      if (editor && !target.closest('td, th, button, .ant-select, .ant-input-number')) { clearSelection(); return; }
      setFreeGridSelection(previous => previous && editor?.getAttribute('data-free-grid-editor') !== previous.fieldCode ? null : previous);
      if (!editor) clearSelection();
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('mouseup', stop);
    window.addEventListener('blur', stop);
    return () => { window.removeEventListener('mouseup', stop); window.removeEventListener('blur', stop); document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape); };
  }, []);
  const handleChange = (code: string, value: any) => {
    const newRaw = { ...data, [code]: value };
    const derived = computeDerivedMerged(template, newRaw);
    onChange({ ...newRaw, ...derived });
  };
  // 保存时矩阵虚拟公式键不会落库；重新打开记录后立即重算，不能等用户第一次敲键才显示结果。
  useEffect(() => {
    if (previewFieldCode) return;
    const derived = computeDerivedMerged(template, data);
    const changed = Object.entries(derived).some(([key, value]) => JSON.stringify(data[key]) !== JSON.stringify(value));
    if (changed) onChange({ ...data, ...derived });
  }, [template, data, onChange]);
  const removeValue = (code: string) => {
    const next = { ...data };
    delete next[code];
    const derived = computeDerivedMerged(template, next);
    onChange({ ...next, ...derived });
  };
  const captionEditor = (key: string, templateValue?: string) => {
    const overridden = Object.prototype.hasOwnProperty.call(data, key);
    const value = overridden ? String(data[key] ?? '') : (templateValue || '');
    return (
      <div style={{
        margin: '7px 0 10px', padding: '8px 10px', display: 'flex', alignItems: 'flex-start', gap: 8,
        border: '1px solid #e4e9f1', borderRadius: 6, background: '#fafbfd',
      }}>
        <span style={{ flexShrink: 0, paddingTop: 4, color: '#596579', fontSize: 12, fontWeight: 600 }}>备注：</span>
        <AutoGrowTextArea size="small" autoSize={{ minRows: 1, maxRows: 4 }} value={value}
          placeholder="可选；不填写则不显示"
          onChange={(event) => handleChange(key, event.target.value)} />
        {overridden && (
          <Button size="small" type="link" style={{ flexShrink: 0, paddingInline: 2 }}
            title="删除本次覆盖，恢复模板中的默认备注"
            onClick={() => removeValue(key)}>恢复模板</Button>
        )}
        {!overridden && templateValue && (
          <Tag bordered={false} style={{ flexShrink: 0, margin: '3px 0 0', color: '#667085' }}>模板默认</Tag>
        )}
      </div>
    );
  };
  // Excel 导入面板放在【第一张可导入数据表】之前（数据表区域，不再悬在表单最顶部）
  const firstImportFieldId = template.groups
    .flatMap(g => g.fields)
    .find(f => (f.type === 'data_matrix' && f.matrix?.excel_import?.enabled)
      || (f.type === 'free_grid' && f.free_table?.excel_import?.enabled))?.id;

  const renderField = (field: FieldDefinition, currentGroup?: FieldGroup) => {
    const value = data[field.code];

    // 版式·间隔：纯排版空白，录入端不可交互，仅示意占位（实际高度按模板，PDF 上才精确）
    if (field.type === 'spacer') {
      return (
        <div key={field.id} style={{
          height: 18, margin: '2px 0', borderRadius: 3,
          background: 'repeating-linear-gradient(135deg,#f4f6fa,#f4f6fa 6px,#eef1f6 6px,#eef1f6 12px)',
          color: '#aab', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>间隔 {field.spacer_height || '1cm'}</div>
      );
    }

    if (field.type === 'static_content') {
      return <StaticContentField key={field.id} field={field} template={template} />;
    }

    if (field.type === 'record_conclusion') {
      return <RecordConclusionField key={field.id} field={field} value={value}
        onChange={(next) => handleChange(field.code, next)} />;
    }

    // 测试设备是可录入的设备库引用，使用独立的紫色设备卡片；不要与蓝色“说明/资料”只读卡片混淆。
    if (field.type === 'device_ref') {
      return (
        <div key={field.id} style={{
          margin: '6px 0 10px', padding: '10px 12px 12px',
          border: '1px solid #d3c6ef', borderLeft: '4px solid #722ed1',
          borderRadius: 6, background: '#fcfaff',
        }} data-device-ref="true">
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9, color: '#531dab' }}>
            <ToolOutlined />
            <span style={{ fontSize: 13, fontWeight: 700 }}>
              {field.label}{field.required && <span style={{ color: 'red' }}>*</span>}
            </span>
            <span style={{ fontSize: 11, color: '#8c77ad' }}>设备库选择 · 写入本次原始记录</span>
          </div>
          <DeviceRefField field={field} value={value} onChange={(next) => handleChange(field.code, next)} />
          {field.description && <div style={{ color: '#8c8c8c', fontSize: 11, marginTop: 6 }}>{field.description}</div>}
        </div>
      );
    }

    if (field.semantic_role) {
      const roleLabel: Record<string, string> = {
        inspector: '主检', inspector_date: '检测日期',
        reviewer: '审核', reviewer_date: '审核日期',
      };
      const isReviewerSlot = field.semantic_role === 'reviewer' || field.semantic_role === 'reviewer_date';
      return (
        <div key={field.id} style={fieldRowStyle}>
          <label style={labelStyle}>{field.label}：</label>
          {value ? (
            <Tag color={isReviewerSlot ? 'green' : 'blue'}>{String(value)}</Tag>
          ) : (
            <Tag style={{ color: '#999' }}>{isReviewerSlot ? '待审核' : '—'}</Tag>
          )}
          <span style={{ color: '#aaa', fontSize: 11, marginLeft: 4 }}>
            系统自动填充（{roleLabel[field.semantic_role]}）
          </span>
        </div>
      );
    }

    if (field.type === 'computed') {
      return (
        <div key={field.id} style={fieldRowStyle}>
          <label style={labelStyle}>{field.label}：</label>
          <Tag color="purple">{value !== null && value !== undefined ? String(value) : '—'}</Tag>
          {field.unit && <span style={{ color: '#999', marginLeft: 4 }}>{field.unit}</span>}
        </div>
      );
    }

    if (field.type === 'data_matrix') {
      if (!field.matrix) return null;
      return (
        <div key={field.id}>
          {!previewFieldCode && field.id === firstImportFieldId && (
            <UnifiedExcelImport
              template={template} data={data} onChange={onChange}
              recordId={recordId} attachments={excelAttachments} onExcelImported={onExcelImported} />
          )}
          <DataMatrixField
            field={field}
            formData={data}
            value={value}
            onChange={(v) => handleChange(field.code, v)}
            onFocusRow={(sid) => currentGroup && onFocusField?.(field, currentGroup, `${field.code}::__detail__:row:${sid}`)}
          />
        </div>
      );
    }

    if (field.type === 'free_grid') {
      const gridVal: Record<string, any> = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
      const instanceTable = gridVal[FREE_GRID_STRUCTURE_KEY];
      const ft = instanceTable && typeof instanceTable === 'object'
        && Array.isArray(instanceTable.rows) && Array.isArray(instanceTable.columns)
        ? instanceTable as NonNullable<FieldDefinition['free_table']>
        : field.free_table;
      if (!ft?.columns?.length || !ft?.rows?.length) return null;
      const cols = ft.columns, rows = ft.rows;
      const spans = ft.spans || {}, cells = ft.cells || {}, headerCells = ft.header_cells || {}, inputCells = ft.input_cells || {}, fixedTextCells = ft.fixed_text_cells || {}, cellStyles = ft.cell_styles || {};
      const setCell = (k: string, v: any) => handleChange(field.code, { ...gridVal, [k]: v });
      const setStructuralCell = (k: string, v: any) => handleChange(field.code, {
        ...gridVal, [k]: v, [FREE_GRID_STRUCTURE_CHANGED_KEY]: true,
      });
      const gridText = (v: any): string => v && typeof v === 'object' && 'custom' in v ? String(v.custom ?? '') : String(v ?? '');
      const allFreeFields = template.groups.flatMap(group => group.fields || []).filter(item => item.type === 'free_grid' && item.free_table);
      /** 跨表计算走全模板递归解析；来源字段 code 和内部格 id 都是稳定标识，表名、行列标题可安全修改。 */
      const crossCache = new Map<string, any>();
      const crossVisiting = new Set<string>();
      const crossFormulaValue = (fieldCode: string, cellKey: string, sampleIndex: number | null): any => {
        if (fieldCode === field.code) return formulaValue(cellKey, sampleIndex);
        const runtimeNode = `${fieldCode}::${cellKey}::${sampleIndex ?? 'x'}`;
        if (crossCache.has(runtimeNode)) return crossCache.get(runtimeNode);
        if (crossVisiting.has(runtimeNode)) return null;
        crossVisiting.add(runtimeNode);
        const sourceField = allFreeFields.find(item => item.code === fieldCode);
        const sourceTable = sourceField?.free_table;
        const sourceRawValue = data[fieldCode];
        const sourceRaw: Record<string, any> = sourceRawValue && typeof sourceRawValue === 'object' && !Array.isArray(sourceRawValue) ? sourceRawValue : {};
        const sourceFormula = sourceTable?.cell_formulas?.[cellKey];
        let result: any;
        if (sourceFormula) {
          const runtimeKey = sampleIndex != null ? `${cellKey}::s${sampleIndex}` : cellKey;
          const manual = sourceRaw[freeFormulaOverrideKey(runtimeKey)];
          if (manual && typeof manual === 'object' && manual.value !== undefined) result = manual.value;
          else {
            const sourceData: Record<string, any> = {};
            for (const source of sourceFormula.sources || []) {
              const ref = resolveFreeGridCellReference(source, fieldCode);
              sourceData[source] = crossFormulaValue(ref.fieldCode, ref.cellKey, sampleIndex);
            }
            result = executeWithFullPrecision(sourceFormula, sourceData);
          }
        } else {
          const sampleKey = sampleIndex != null ? `${cellKey}::s${sampleIndex}` : cellKey;
          result = gridText(sourceRaw[sampleKey] ?? sourceRaw[cellKey] ?? sourceTable?.cells?.[cellKey] ?? '');
        }
        const sourceIsData = sourceTable?.cell_types?.[cellKey] === 'number'
          || !!sourceTable?.input_cells?.[cellKey]
          || !!sourceTable?.cell_formulas?.[cellKey];
        result = applyNumericRounding(result, sourceTable?.cell_rounding?.[cellKey] ?? (sourceIsData ? sourceTable?.default_rounding : undefined));
        crossVisiting.delete(runtimeNode);
        crossCache.set(runtimeNode, result);
        return result;
      };
      // 自由表格公式在录入页即时计算（不落库，PDF 端使用同一 execute 引擎重新计算）。
      // 样品带内按当前样品号取来源值；固定格自动回退到模板键。
      const formulaCache = new Map<string, any>();
      const formulaVisiting = new Set<string>();
      const formulaValue = (templateKey: string, sampleIndex: number | null, ignoreManual = false): any => {
        const runtimeKey = sampleIndex != null ? `${templateKey}::s${sampleIndex}` : templateKey;
        const cacheKey = ignoreManual ? `${runtimeKey}::automatic` : runtimeKey;
        if (formulaCache.has(cacheKey)) return formulaCache.get(cacheKey);
        if (formulaVisiting.has(cacheKey)) return null;
        formulaVisiting.add(cacheKey);
        const formula = ft.cell_formulas?.[templateKey];
        let result: any;
        if (formula) {
          const manual = ignoreManual ? undefined : gridVal[freeFormulaOverrideKey(runtimeKey)];
          if (manual && typeof manual === 'object' && manual.value !== undefined) {
            result = manual.value;
          } else {
          const sourceData: Record<string, any> = {};
          // 公式格在样品带外、来源格在样品带内时（典型：平均值/求和汇总行），
          // 将每个来源格展开为全部样品值；带内公式则只取同一样品的来源值。
          // 这与 PDF 生成时的 expandFreeGridSelfBand 口径保持一致。
          const expandedSources = (formula.sources || []).flatMap(source => {
            const reference = resolveFreeGridCellReference(source, field.code);
            if (reference.fieldCode !== field.code) {
              return [{ key: source, value: crossFormulaValue(reference.fieldCode, reference.cellKey, sampleIndex) }];
            }
            if (sampleIndex != null) return [{ key: source, value: formulaValue(source, sampleIndex) }];
            const [sourceRowId, sourceColId] = source.split('::');
            const band = axisIsRow ? bandOfAxis.get(sourceRowId) : bandOfAxis.get(sourceColId);
            const crossId = axisIsRow ? sourceColId : sourceRowId;
            if (!band || (band.cross_refs?.length && !band.cross_refs.includes(crossId))) {
              return [{ key: source, value: formulaValue(source, null) }];
            }
            return (axisIsRow ? displayRows : displayCols).filter(item => item.id === (axisIsRow ? sourceRowId : sourceColId) && item.sample != null && (formula.sample_scope !== 'selected' || item.sample === 0))
              .map(item => ({ key: `${source}::s${item.sample}`, value: formulaValue(source, item.sample) }));
          });
          expandedSources.forEach(({ key, value }) => { sourceData[key] = value; });
          // 自定义表达式的变量与原来源格一一对应，不能安全地自动扩成多个变量；
          // 对其保持原引用，避免 A1/B2 变量被重复值悄悄覆盖。
          const formulaForRun = formula.type === 'custom' ? formula : { ...formula, sources: expandedSources.map(item => item.key) };
          if (formula.type === 'custom') {
            (formula.sources || []).forEach(source => {
              const reference = resolveFreeGridCellReference(source, field.code);
              sourceData[source] = reference.fieldCode === field.code
                ? formulaValue(reference.cellKey, sampleIndex)
                : crossFormulaValue(reference.fieldCode, reference.cellKey, sampleIndex);
            });
          }
          result = executeWithFullPrecision(formulaForRun, sourceData);
          }
        } else {
          result = gridText(gridVal[runtimeKey] ?? gridVal[templateKey] ?? cells[templateKey] ?? '');
        }
        const isDataCell = ft.cell_types?.[templateKey] === 'number' || !!ft.input_cells?.[templateKey] || !!ft.cell_formulas?.[templateKey];
        result = applyNumericRounding(result, ft.cell_rounding?.[templateKey] ?? (isDataCell ? ft.default_rounding : undefined));
        formulaVisiting.delete(cacheKey);
        formulaCache.set(cacheKey, result);
        return result;
      };
      // 记录侧样品带（多带·同轴，无 matrix_code = 自引用）：录入时按各带样品数展开成员行/列
      const layout = buildFreeGridLayout(ft, gridVal);
      const { bands: selfBands, axisIsRow, bandOfAxis, displayRows, displayCols,
        covered: coveredDisp, spans: spanOfDisp } = layout;
      const sampleForCell = (dr: FreeGridDisplayAxis, dc: FreeGridDisplayAxis) =>
        layout.sampleForCell(dr.id, dc.id, dr.sample, dc.sample);
      const structureActive = freeGridStructureField === field.code;
      const selected = freeGridSelection?.fieldCode === field.code ? freeGridSelection : null;
      const selection = resolveEntrySelection(ft, displayRows, displayCols, spanOfDisp, selected ? {
        minR: Math.min(selected.r0, selected.r1), maxR: Math.max(selected.r0, selected.r1),
        minC: Math.min(selected.c0, selected.c1), maxC: Math.max(selected.c0, selected.c1),
      } : null);
      const selectedRange = selection.source;
      const visualRange = selection.visual;
      const persistStructure = (nextTable: NonNullable<FieldDefinition['free_table']>) => {
        handleChange(field.code, {
          ...gridVal,
          [FREE_GRID_STRUCTURE_KEY]: nextTable,
          [FREE_GRID_STRUCTURE_CHANGED_KEY]: true,
        });
      };
      const requestStructureEdit = (afterConfirm?: () => void) => {
        if (!structureActive) { setFreeGridStructureField(field.code); setFreeGridSelection(null); }
        afterConfirm?.();
      };
      const setSelectionStyle = (patch: NonNullable<NonNullable<FieldDefinition['free_table']>['cell_styles']>[string]) => {
        if (!selectedRange) return;
        const nextStyles = { ...cellStyles };
        for (let r = selectedRange.minR; r <= selectedRange.maxR; r++) for (let c = selectedRange.minC; c <= selectedRange.maxC; c++) {
          const key = `${rows[r].id}::${cols[c].id}`;
          nextStyles[key] = { ...nextStyles[key], ...patch };
        }
        // Appearance alone must not trigger the extra-row report warning.
        handleChange(field.code, { ...gridVal, [FREE_GRID_STRUCTURE_KEY]: { ...ft, cell_styles: nextStyles } });
      };
      const selectedStyle = selectedRange ? cellStyles[`${rows[selectedRange.minR]?.id}::${cols[selectedRange.minC]?.id}`] : undefined;
      const entriesOf = (band: typeof selfBands[number]): SampleAxisEntry[] =>
        (band.axis === 'row' ? displayRows : displayCols).filter(item => band.refs.includes(item.id) && item.sample != null)
          .map(item => ({ ref: item.id, sample: item.sample! }));
      const addSample = (band: typeof selfBands[number]) => handleChange(field.code, editSampleAxes(ft, gridVal, band, entriesOf(band)));
      const removeSample = (band: typeof selfBands[number], entry: SampleAxisEntry) => {
        Modal.confirm({
          title: `删除这个试样${band.axis === 'row' ? '行' : '列'}？`,
          content: '仅从本次记录和后续生成的报告中移除此试样，其他试样的数据不变。原有数据保留用于追溯。',
          okText: '删除试样', okButtonProps: { danger: true }, cancelText: '取消',
          onOk: () => handleChange(field.code, editSampleAxes(ft, gridVal, band, entriesOf(band), entry)),
        });
      };
      const insertEntryAxis = (axis: 'row' | 'col') => {
        const token = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        if (axis === 'row') {
          const at = entryInsertionIndex(ft, 'row', selectedRange ? selectedRange.maxR + 1 : rows.length);
          const nextRows = [...rows];
          nextRows.splice(Math.max(0, Math.min(nextRows.length, at)), 0, { id: `entry_r_${token}`, entry_added: true });
          persistStructure({ ...ft, rows: nextRows });
        } else {
          const at = entryInsertionIndex(ft, 'col', selectedRange ? selectedRange.maxC + 1 : cols.length);
          const nextCols = [...cols];
          nextCols.splice(Math.max(0, Math.min(nextCols.length, at)), 0, { id: `entry_c_${token}`, label: '', entry_added: true });
          persistStructure({ ...ft, columns: nextCols });
        }
        // Insertion is after the selection: retain the anchor for the next toolbar action.
      };
      const pruneCellMaps = (
        nextTable: NonNullable<FieldDefinition['free_table']>,
        nextRows: NonNullable<FieldDefinition['free_table']>['rows'],
        nextCols: NonNullable<FieldDefinition['free_table']>['columns'],
      ) => {
        const rowIds = new Set(nextRows.map(item => item.id));
        const colIds = new Set(nextCols.map(item => item.id));
        const keepKey = (key: string) => {
          const [rowId, colId] = key.split('::');
          return rowIds.has(rowId) && colIds.has(colId);
        };
        const mapNames = [
          'cells', 'spans', 'header_cells', 'input_cells', 'sample_index_cells', 'cell_bindings', 'cell_unit_bindings',
          'cell_formulas', 'cell_units', 'cell_types', 'cell_options', 'cell_option_allow_custom', 'fixed_text_cells',
          'cell_unit_options', 'cell_number_fmt', 'cell_rounding', 'cell_styles',
        ] as const;
        const out: any = { ...nextTable, rows: nextRows, columns: nextCols };
        mapNames.forEach(name => {
          const source = (nextTable as any)[name];
          if (!source) return;
          const kept = Object.fromEntries(Object.entries(source).filter(([key]) => keepKey(key)));
          out[name] = Object.keys(kept).length ? kept : undefined;
        });
        if (nextTable.sample_bands?.length) {
          out.sample_bands = nextTable.sample_bands.map(band => ({
            ...band,
            refs: band.refs.filter(id => band.axis === 'row' ? rowIds.has(id) : colIds.has(id)),
            cross_refs: band.cross_refs?.filter(id => band.axis === 'row' ? colIds.has(id) : rowIds.has(id)),
          })).filter(band => band.refs.length);
        }
        return out as NonNullable<FieldDefinition['free_table']>;
      };
      const deleteEntryAxis = (axis: 'row' | 'col') => {
        const sampleAxes = axis === 'row' ? selection.sampleRows : selection.sampleCols;
        if (sampleAxes.length) {
          Modal.confirm({
            title: `删除选中的 ${sampleAxes.length} 个试样${axis === 'row' ? '行' : '列'}？`,
            content: '仅移除选中的试样，其他试样的数据不变。原有数据保留用于追溯。',
            okText: '删除试样', okButtonProps: { danger: true }, cancelText: '取消',
            onOk: () => {
              let next = gridVal;
              for (const band of selfBands.filter(band => band.axis === axis)) {
                let current = entriesOf(band);
                for (const item of sampleAxes.filter(item => band.refs.includes(item.id))) {
                  const entry = { ref: item.id, sample: item.sample! };
                  next = editSampleAxes(ft, next, band, current, entry);
                  current = current.filter(e => e.ref !== entry.ref || e.sample !== entry.sample);
                }
              }
              handleChange(field.code, next);
              setFreeGridSelection(null);
            },
          });
          return;
        }
        if (!selectedRange) { message.info(`请先选择要删除的新增${axis === 'row' ? '行' : '列'}`); return; }
        const indexes = axis === 'row'
          ? Array.from({ length: selectedRange.maxR - selectedRange.minR + 1 }, (_, i) => selectedRange.minR + i)
          : Array.from({ length: selectedRange.maxC - selectedRange.minC + 1 }, (_, i) => selectedRange.minC + i);
        const source = axis === 'row' ? rows : cols;
        if (indexes.some(index => !source[index]?.entry_added)) {
          message.warning(ORIGINAL_STRUCTURE_MESSAGE);
          return;
        }
        const removing = new Set(indexes);
        const nextSpans = { ...spans };
        for (const span of entrySpanRanges(ft)) {
          const hits = indexes.filter(i => i >= (axis === 'row' ? span.minR : span.minC) && i <= (axis === 'row' ? span.maxR : span.maxC));
          if (!hits.length) continue;
          if (!entryRangeOnly(ft, span)) { message.warning(ORIGINAL_STRUCTURE_MESSAGE); return; }
          const remainingRows = rows.slice(span.minR, span.maxR + 1).filter((_, i) => axis !== 'row' || !removing.has(span.minR + i));
          const remainingCols = cols.slice(span.minC, span.maxC + 1).filter((_, i) => axis !== 'col' || !removing.has(span.minC + i));
          delete nextSpans[span.key];
          if (remainingRows.length && remainingCols.length) nextSpans[`${remainingRows[0].id}::${remainingCols[0].id}`] = { rowspan: remainingRows.length, colspan: remainingCols.length };
        }
        const nextRows = axis === 'row' ? rows.filter((_, index) => !removing.has(index)) : rows;
        const nextCols = axis === 'col' ? cols.filter((_, index) => !removing.has(index)) : cols;
        persistStructure(pruneCellMaps({ ...ft, spans: nextSpans }, nextRows, nextCols));
        setFreeGridSelection(null);
      };
      const mergeEntrySelection = () => {
        if (!selectedRange || (selectedRange.minR === selectedRange.maxR && selectedRange.minC === selectedRange.maxC)) {
          message.info('请先按住 Shift 选择一个包含多个格子的矩形区域'); return;
        }
        for (let ri = selectedRange.minR; ri <= selectedRange.maxR; ri++) for (let ci = selectedRange.minC; ci <= selectedRange.maxC; ci++) {
          if (!rows[ri]?.entry_added && !cols[ci]?.entry_added) {
            message.warning(ORIGINAL_STRUCTURE_MESSAGE); return;
          }
        }
        const nextSpans = { ...spans };
        for (const span of entrySpanRanges(ft).filter(span => rangesIntersect(span, selectedRange))) {
          if (!entryRangeOnly(ft, span)) { message.warning(ORIGINAL_STRUCTURE_MESSAGE); return; }
          if (span.minR < selectedRange.minR || span.maxR > selectedRange.maxR || span.minC < selectedRange.minC || span.maxC > selectedRange.maxC) return;
          delete nextSpans[span.key];
        }
        const key = `${rows[selectedRange.minR].id}::${cols[selectedRange.minC].id}`;
        persistStructure({ ...ft, spans: { ...nextSpans, [key]: {
          rowspan: selectedRange.maxR - selectedRange.minR + 1,
          colspan: selectedRange.maxC - selectedRange.minC + 1,
        } } });
      };
      const splitEntrySelection = () => {
        if (!selectedRange) return;
        const targets = entrySpanRanges(ft).filter(span => rangesIntersect(span, selectedRange));
        if (!entryRangeOnly(ft, selectedRange) || targets.some(span => !entryRangeOnly(ft, span))) {
          message.warning(ORIGINAL_STRUCTURE_MESSAGE); return;
        }
        if (!targets.length) return;
        const nextSpans = { ...spans };
        targets.forEach(span => delete nextSpans[span.key]);
        persistStructure({ ...ft, spans: nextSpans });
      };
      const pasteGrid = (e: React.ClipboardEvent<HTMLElement>, startDi: number, startCi: number) => {
        const text = e.clipboardData.getData('text/plain');
        if (!text) return;
        const clipboardGrid = parseSpreadsheetClipboard(text);
        if (!clipboardGrid.length) return;
        e.preventDefault();

        const next = { ...gridVal };
        let written = 0;
        let overwritten = 0;
        let skippedReadonly = 0;
        let skippedFormula = 0;
        let skippedChoice = 0;
        let clipped = 0;

        clipboardGrid.forEach((sourceRow, rOffset) => {
          sourceRow.forEach((sourceValue, cOffset) => {
            const di = startDi + rOffset;
            const ci = startCi + cOffset;
            if (di >= displayRows.length || ci >= displayCols.length) { clipped++; return; }
            if (coveredDisp.has(`${di},${ci}`)) { skippedReadonly++; return; }

            const dr = displayRows[di], dc = displayCols[ci];
            const templateKey = `${dr.id}::${dc.id}`;
            const sampleIdx = sampleForCell(dr, dc);
            const valueKey = sampleIdx != null ? `${templateKey}::s${sampleIdx}` : templateKey;
            const isSampleIndex = !!ft.sample_index_cells?.[templateKey] && sampleIdx != null;
            const choices = ft.cell_options?.[templateKey] || [];
            const implicitFixedText = !headerCells[templateKey] && !inputCells[templateKey] && !ft.cell_formulas?.[templateKey];
            const isEditable = !!headerCells[templateKey] || !!inputCells[templateKey] || !!fixedTextCells[templateKey] || implicitFixedText || choices.length > 0;

            const displaySpan = spanOfDisp.get(`${di},${ci}`);
            const editableAddedHeader = sampleIdx != null && sampleIdx > 0 && ((axisIsRow ? displaySpan?.rs : displaySpan?.cs) || 1) === 1;
            if (!isEditable || isSampleIndex || (headerCells[templateKey] && !structureActive && !editableAddedHeader)) { skippedReadonly++; return; }
            if (ft.cell_formulas?.[templateKey]) { skippedFormula++; return; }
            if (choices.length > 0 && sourceValue !== '' && !choices.includes(sourceValue) && !ft.cell_option_allow_custom?.[templateKey]) {
              skippedChoice++;
              return;
            }

            if ((gridVal[valueKey] ?? '') !== '' && gridVal[valueKey] !== sourceValue) overwritten++;
            next[valueKey] = choices.length > 0 && sourceValue !== '' && !choices.includes(sourceValue)
              ? { custom: sourceValue }
              : sourceValue;
            written++;
          });
        });

        if (written === 0) {
          const reason = skippedChoice
            ? `没有写入数据：${skippedChoice} 个值不在目标格选项中`
            : '没有可写入的录入格，请从可编辑单元格开始粘贴';
          message.warning(reason);
          return;
        }

        const apply = () => {
          handleChange(field.code, next); // 整块只更新一次，避免逐格重算/丢失相邻值
          message.success(`已从当前单元格开始粘贴 ${written} 格`);
          const details: string[] = [];
          if (skippedReadonly) details.push(`跳过 ${skippedReadonly} 个固定、合并覆盖或自动序号格`);
          if (skippedFormula) details.push(`跳过 ${skippedFormula} 个公式格`);
          if (skippedChoice) details.push(`跳过 ${skippedChoice} 个不符合选项的值`);
          if (clipped) details.push(`超出表格范围 ${clipped} 格`);
          if (details.length) message.warning(details.join('；'), 6);
        };

        if (overwritten > 0) {
          Modal.confirm({
            title: '粘贴将覆盖已有数据',
            content: `将写入 ${written} 格，其中 ${overwritten} 格已有内容。是否继续？`,
            okText: '覆盖粘贴',
            cancelText: '取消',
            onOk: apply,
          });
        } else {
          apply();
        }
      };
      return (
        <div key={field.id} data-free-grid-editor={field.code} style={{ margin: '6px 0' }}>
          {!previewFieldCode && field.id === firstImportFieldId && (
            <UnifiedExcelImport
              template={template} data={data} onChange={onChange}
              recordId={recordId} attachments={excelAttachments} onExcelImported={onExcelImported} />
          )}
          {!field.hide_label && <label style={labelStyle}>{field.label}：</label>}
          <div style={{ marginTop: 5, display: previewFieldCode ? 'none' : 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            <Button size="small" icon={<EditOutlined />} type={structureActive ? 'primary' : 'default'}
              onClick={() => { if (structureActive) { setFreeGridStructureField(null); setFreeGridSelection(null); } else requestStructureEdit(); }}>
              {structureActive ? '结束结构调整' : '调整结构'}
            </Button>
            {selfBands.map(band => <Button key={band.id} data-sample-controls="add-sample" size="small" type="primary" ghost icon={<PlusOutlined />} disabled={entriesOf(band).length >= 50} onClick={() => addSample(band)}>{band.axis === 'row' ? '新增试样行' : '新增试样列'}</Button>)}
            <Tooltip title={<div>方向键移动；Enter向下，到底后向右；Shift+Enter换行。支持从Excel粘贴。<br />右键点击试样表头或灰色行号／列号可删除试样，删除需确认。<br />调整结构后可拖拽或按住Shift框选；Esc或点击空白处取消选区。模板原有表头须进入结构调整后编辑，新增试样自身的表头可直接编辑。</div>}>
              <Button type="text" size="small" shape="circle" icon={<QuestionCircleOutlined />} aria-label="表格操作帮助" />
            </Tooltip>
            {structureActive && <>
              <Button size="small" icon={<PlusOutlined />} onClick={() => insertEntryAxis('row')}>新增行</Button>
              <Button size="small" icon={<PlusOutlined />} onClick={() => insertEntryAxis('col')}>新增列</Button>
              <Button size="small" danger disabled={!selection.canDeleteRow} onClick={() => deleteEntryAxis('row')}>删除行</Button>
              <Button size="small" danger disabled={!selection.canDeleteCol} onClick={() => deleteEntryAxis('col')}>删除列</Button>
              <Button size="small" icon={<MergeCellsOutlined />} disabled={!selection.canMerge} onClick={mergeEntrySelection}>合并</Button>
              <Button size="small" icon={<SplitCellsOutlined />} disabled={!selection.canSplit} onClick={splitEntrySelection}>拆分</Button>
              <FreeGridNumberSettings table={ft} cellKeys={selectedRange ? rows.slice(selectedRange.minR, selectedRange.maxR + 1).flatMap(row => cols.slice(selectedRange.minC, selectedRange.maxC + 1).map(col => `${row.id}::${col.id}`)) : []}
                onChange={nextTable => handleChange(field.code, { ...gridVal, [FREE_GRID_STRUCTURE_KEY]: nextTable })} />
              <Select size="small" aria-label="字体" placeholder="字体" disabled={!selectedRange} style={{ width: 116 }} value={selectedStyle?.font}
                options={[{ value: 'Songti SC', label: '宋体' }, { value: 'SimSun', label: '中易宋体' }, { value: 'SimHei', label: '黑体' }, { value: 'KaiTi', label: '楷体' }, { value: 'Arial', label: 'Arial' }, { value: 'Times New Roman', label: 'Times New Roman' }]}
                onChange={font => setSelectionStyle({ font })} />
              <InputNumber size="small" aria-label="字号" placeholder="字号" disabled={!selectedRange} min={6} max={72} style={{ width: 72 }} value={selectedStyle?.size ? parseFloat(selectedStyle.size) : null}
                onChange={size => { if (size != null) setSelectionStyle({ size: `${size}pt` }); }} />
              <Tooltip title="加粗"><Button size="small" aria-label="加粗" icon={<BoldOutlined />} disabled={!selectedRange} type={selectedStyle?.weight === 'bold' ? 'primary' : 'default'} onClick={() => {
                const key = selectedRange ? `${rows[selectedRange.minR].id}::${cols[selectedRange.minC].id}` : '';
                const bold = selectedStyle?.weight ? selectedStyle.weight === 'bold' : headerCells[key] ? field.table_style?.header_bold !== false : field.table_style?.body_bold === true;
                setSelectionStyle({ weight: bold ? 'regular' : 'bold' });
              }} /></Tooltip>
              <Tooltip title="斜体"><Button size="small" aria-label="斜体" icon={<ItalicOutlined />} disabled={!selectedRange} type={selectedStyle?.italic ? 'primary' : 'default'} onClick={() => setSelectionStyle({ italic: !selectedStyle?.italic })} /></Tooltip>
              {(['left', 'center', 'right'] as const).map(align => <Tooltip key={align} title={{ left: '左对齐', center: '居中', right: '右对齐' }[align]}><Button size="small" aria-label={{ left: '左对齐', center: '居中', right: '右对齐' }[align]} disabled={!selectedRange} icon={align === 'left' ? <AlignLeftOutlined /> : align === 'center' ? <AlignCenterOutlined /> : <AlignRightOutlined />} onClick={() => setSelectionStyle({ align })} /></Tooltip>)}
            </>}
          </div>
          <div style={{ overflowX: 'auto', marginTop: 4, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <table style={{ borderCollapse: 'collapse' }} onKeyDown={handleExcelTableKeyDown}
              onFocusCapture={(event) => {
                markSpreadsheetActiveCell(event.target as HTMLElement);
                const row = (event.target as HTMLElement).closest('tr[data-pdf-row]');
                if (row && currentGroup) {
                  const rowId = row.getAttribute('data-pdf-row');
                  const sample = row.getAttribute('data-pdf-sample');
                  // 样品带在 PDF 端会把 r1 展开为 r1#s0、r1#s1…；录入端同步传同一行 id。
                  onFocusField?.(field, currentGroup, `${field.code}::__detail__:row:${rowId}${sample == null ? '' : `#s${sample}`}`);
                }
              }}>
              <tbody>
                <tr data-grid-coordinates="columns">
                  <th aria-label="行列编号" style={{ background: '#f5f7fa', minWidth: 24 }} />
                  {displayCols.map((dc, ci) => {
                    const band = !axisIsRow ? bandOfAxis.get(dc.id) : undefined;
                    const header = <th scope="col" tabIndex={band && dc.sample != null ? 0 : undefined}
                      data-grid-column={columnName(ci)}
                      title={band && dc.sample != null ? '右键管理此试样列' : undefined}
                      style={{ textAlign: 'center', background: '#f5f7fa', color: '#8a94a6', fontSize: 11, padding: '3px 6px', userSelect: 'none', cursor: band && dc.sample != null ? 'context-menu' : 'default' }}>{columnName(ci)}</th>;
                    return band && dc.sample != null
                      ? <Dropdown key={`${dc.id}:${dc.sample}`} trigger={['contextMenu']} menu={{ items: [{ key: 'delete', label: '删除试样列', danger: true }], onClick: () => removeSample(band, { ref: dc.id, sample: dc.sample! }) }}>{header}</Dropdown>
                      : <Fragment key={`${dc.id}:${dc.sample}`}>{header}</Fragment>;
                  })}
                </tr>
                {displayRows.map((dr, di) => (
                  <Fragment key={`${dr.id}#${dr.sample ?? 'x'}`}>
                  <tr key={`${dr.id}#${dr.sample ?? 'x'}`} data-pdf-row={dr.id} data-pdf-sample={dr.sample ?? undefined}>
                    {axisIsRow && dr.sample != null && bandOfAxis.has(dr.id)
                      ? <Dropdown trigger={['contextMenu']} menu={{ items: [{ key: 'delete', label: '删除试样行', danger: true }], onClick: () => removeSample(bandOfAxis.get(dr.id)!, { ref: dr.id, sample: dr.sample! }) }}>
                          <th scope="row" data-grid-row={di + 1} tabIndex={0} data-sample-controls="row-header" title="右键管理此试样行" style={{ background: '#f5f7fa', color: '#8a94a6', fontSize: 11, padding: '0 6px', minWidth: 24, userSelect: 'none', cursor: 'context-menu' }}>{di + 1}</th>
                        </Dropdown>
                      : <th scope="row" data-grid-row={di + 1} style={{ background: '#f5f7fa', color: '#8a94a6', fontSize: 11, padding: '0 6px', minWidth: 24, userSelect: 'none' }}>{di + 1}</th>}
                    {displayCols.map((dc, ci) => {
                      if (coveredDisp.has(`${di},${ci}`)) return null;
                      const k = `${dr.id}::${dc.id}`;                              // 模板键（配置：表头/类型/选项/单位…）
                      const sIdx = sampleForCell(dr, dc);                           // 只在精确试样区内使用样品序号
                      const vk = sIdx != null ? `${k}::s${sIdx}` : k;              // 取值键（带内含样品号）
                      const md = spanOfDisp.get(`${di},${ci}`);                    // 主格显示跨度（与 coveredDisp 同口径）
                      const cspan = md?.cs ?? 1;
                      const rspan = md?.rs ?? 1;
                      const isHeader = !!headerCells[k], isInput = !!inputCells[k], isFormula = !!ft.cell_formulas?.[k];
                      const addedSampleHeader = isHeader && sIdx != null && sIdx > 0 && (axisIsRow ? rspan : cspan) === 1;
                      const isFixedText = !!fixedTextCells[k] || (!isHeader && !isInput && !isFormula);
                      const isSampleIndex = !!ft.sample_index_cells?.[k] && sIdx != null;
                      const isChoice = !!(ft.cell_options?.[k]?.length || ft.cell_types?.[k] === 'choice');
                      const cellBackground = isHeader ? '#f8fafd'
                        : isFormula ? '#fcf8ff'
                          : isChoice ? '#fffdf5'
                            : isFixedText ? '#fffaf5'
                              : isInput && ft.cell_types?.[k] === 'text' ? '#f8fff5'
                                : isInput ? '#f5fbff'
                                  : '#fff';
                      const cellBorder = isHeader ? '#e3e9f2'
                        : isFormula ? '#eadbf8'
                          : isChoice ? '#f6e7b8'
                            : isFixedText ? '#f5dfc3'
                              : isInput && ft.cell_types?.[k] === 'text' ? '#d6f0c8'
                                : isInput ? '#cfeafd'
                                  : '#d9d9d9';
                      const configuredStyle = cellStyles[k];
                      const defaultFont = isHeader ? field.table_style?.header_font : field.table_style?.body_font;
                      const defaultSize = isHeader ? field.table_style?.header_font_size : field.table_style?.body_font_size;
                      const defaultBold = isHeader ? field.table_style?.header_bold !== false : field.table_style?.body_bold === true;
                      const textStyle: React.CSSProperties = {
                        fontWeight: configuredStyle?.weight ? (configuredStyle.weight === 'bold' ? 700 : 400) : (defaultBold ? 700 : 400),
                        fontStyle: configuredStyle?.italic ? 'italic' : 'normal',
                        textAlign: configuredStyle?.align || 'center',
                        ...(configuredStyle?.font || defaultFont ? { fontFamily: configuredStyle?.font || defaultFont } : {}),
                        ...(configuredStyle?.size || defaultSize ? { fontSize: configuredStyle?.size || defaultSize } : {}),
                        ...(configuredStyle?.color ? { color: configuredStyle.color } : {}),
                      };
                      const cell = (
                        <td key={`${dc.id}#${dc.sample ?? 'x'}`} colSpan={cspan > 1 ? cspan : undefined} rowSpan={rspan > 1 ? rspan : undefined}
                          onMouseDown={(event) => {
                            if (!structureActive || event.button !== 0) return;
                            event.preventDefault();
                            if (!event.shiftKey && event.target instanceof HTMLElement && event.target.matches('input, textarea')) event.target.focus({ preventScroll: true });
                            const anchor = event.shiftKey && selected ? { fieldCode: field.code, r0: selected.r0, c0: selected.c0 } : { fieldCode: field.code, r0: di, c0: ci };
                            gridDrag.current = anchor;
                            setFreeGridSelection({ ...anchor, r1: di, c1: ci });
                          }}
                          onMouseEnter={(event) => {
                            const anchor = gridDrag.current;
                            if (!structureActive || event.buttons !== 1 || anchor?.fieldCode !== field.code) return;
                            setFreeGridSelection({ ...anchor, r1: di, c1: ci });
                          }}
                          onPaste={(!isHeader || structureActive || addedSampleHeader) && (isHeader || isInput || isFixedText || ft.cell_options?.[k]?.length) && !isSampleIndex ? (e) => pasteGrid(e, di, ci) : undefined}
                          style={{
                            border: `1px solid ${cellBorder}`,
                            padding: (isHeader || isInput || isFixedText || ft.cell_options?.[k]?.length) ? 0 : '4px 8px',
                            minWidth: 60,
                            background: cellBackground,
                            transition: 'background-color 0.15s, box-shadow 0.15s',
                            boxShadow: structureActive && visualRange
                              && di >= visualRange.minR && di <= visualRange.maxR
                              && ci >= visualRange.minC && ci <= visualRange.maxC
                              ? 'inset 0 0 0 2px #1677ff' : undefined,
                            cursor: structureActive ? 'cell' : undefined,
                            ...textStyle,
                          }}>
                          {isHeader ? (structureActive || addedSampleHeader
                            ? <AutoGrowTextArea size="small" variant="borderless" value={gridVal[vk] ?? cells[k] ?? ''} aria-label={addedSampleHeader ? '新增试样表头' : '表头名称'} onChange={e => addedSampleHeader ? setCell(vk, e.target.value) : setStructuralCell(vk, e.target.value)} style={textStyle} />
                            : <span data-readonly-header="true" style={{ display: 'block', whiteSpace: 'pre-wrap', padding: '4px 8px', ...textStyle }}>{gridVal[vk] ?? cells[k] ?? ''}</span>
                          ) : isSampleIndex ? (
                            <span>{readSampleAxes(gridVal, bandOfAxis.get(axisIsRow ? dr.id : dc.id)!.id)
                              ? entriesOf(bandOfAxis.get(axisIsRow ? dr.id : dc.id)!).findIndex(entry => entry.ref === (axisIsRow ? dr.id : dc.id) && entry.sample === sIdx) + 1
                              : sIdx + 1}</span>
                          ) : isFormula ? (
                            <ConfirmableFormulaValue
                              value={formulaValue(k, sIdx)} displayValue={freeGridNumberText(formulaValue(k, sIdx), ft, k, true)}
                              override={gridVal[freeFormulaOverrideKey(vk)]}
                              automaticValue={formulaValue(k, sIdx, true)}
                              label={freeGridAddress(ft, k)}
                              formulaText={freeGridFormulaLabel(ft.cell_formulas![k], field.code,
                                code => code === field.code ? ft : data[code]?.[FREE_GRID_STRUCTURE_KEY] || allFreeFields.find(f => f.code === code)?.free_table,
                                code => allFreeFields.find(f => f.code === code)?.label || '其他表格')}
                              onSave={(entry) => handleChange(field.code, { ...gridVal, [freeFormulaOverrideKey(vk)]: entry })}
                              onClear={() => {
                                const next = { ...gridVal };
                                delete next[freeFormulaOverrideKey(vk)];
                                handleChange(field.code, next);
                              }} />
                          ) : ft.cell_options?.[k]?.length ? (() => {
                            const choiceControlKey = `${field.code}::${vk}`;
                            const isChoiceOpen = openFreeGridChoice === choiceControlKey;
                            const choiceValue = gridVal[vk];
                            const isCustom = !!choiceValue && typeof choiceValue === 'object' && 'custom' in choiceValue;
                            const options = ft.cell_options![k].map((o: string) => ({ value: o, label: o }));
                            if (ft.cell_option_allow_custom?.[k]) options.push({ value: '__custom__', label: '其他' });
                            return <span style={{ display: 'inline-flex', alignItems: 'center', width: '100%', gap: 4 }}>
                              <Select size="small" variant="borderless" style={{ minWidth: 76, flex: 1, ...textStyle }} value={isCustom ? '__custom__' : choiceValue || undefined}
                                open={isChoiceOpen}
                                placeholder="选择" allowClear options={options}
                                onClick={() => setOpenFreeGridChoice(choiceControlKey)}
                                onOpenChange={(open) => { if (!open) setOpenFreeGridChoice(null); }}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' && !isChoiceOpen) {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    setOpenFreeGridChoice(choiceControlKey);
                                  }
                                }}
                                onChange={(v) => {
                                  setCell(vk, v === '__custom__' ? { custom: '' } : (v as string) || '');
                                  setOpenFreeGridChoice(null);
                                }} />
                              {isCustom && <AutoGrowTextArea size="small" variant="borderless" placeholder="填写其他" style={{ minWidth: 90, flex: 1, ...textStyle }}
                                value={choiceValue.custom || ''} onChange={(e) => setCell(vk, { custom: e.target.value })} />}
                            </span>;
                          })() : isInput ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', width: '100%' }}>
                              <FreeGridNumberInput size="small" variant="borderless" value={gridVal[vk] ?? ''} displayValue={freeGridNumberText(gridVal[vk] ?? '', ft, k)} onChange={(e) => setCell(vk, e.target.value)} style={textStyle} />
                              {ft.cell_unit_options?.[k]?.length
                                ? <Select size="small" variant="borderless" style={{ minWidth: 50 }} value={gridVal[`${vk}::__unit__`] || undefined} placeholder="单位"
                                    options={ft.cell_unit_options[k].map((u: string) => ({ value: u, label: u }))} onChange={(v) => setCell(`${vk}::__unit__`, (v as string) || '')} />
                                : ft.cell_units?.[k] ? <span style={{ color: '#999', fontSize: 11, paddingRight: 4 }}>{ft.cell_units[k]}</span> : null}
                            </span>
                          ) : isFixedText ? (
                            <FreeGridNumberInput size="small" variant="borderless" value={gridVal[vk] ?? cells[k] ?? ''} displayValue={freeGridNumberText(gridVal[vk] ?? cells[k] ?? '', ft, k)}
                              onChange={(e) => setCell(vk, e.target.value)} style={textStyle} />
                          ) : (
                            <span>{cells[k] ?? ''}{ft.cell_units?.[k] ? `（${ft.cell_units[k]}）` : ''}</span>
                          )}
                        </td>
                      );
                      if (!isHeader) return cell;
                      const targets = (axisIsRow ? displayRows.slice(di, di + rspan) : displayCols.slice(ci, ci + cspan))
                        .flatMap(item => { const band = bandOfAxis.get(item.id); return band && item.sample != null ? [{ band, entry: { ref: item.id, sample: item.sample } }] : []; });
                      if (!targets.length) return cell;
                      return <Dropdown key={`${dc.id}#${dc.sample ?? 'x'}`} trigger={['contextMenu']} menu={{
                        items: targets.map(({ band, entry }, index) => ({ key: String(index), danger: true, label: `删除试样${band.axis === 'row' ? '行' : '列'}${targets.length > 1 ? ' ' + (entriesOf(band).findIndex(e => e.ref === entry.ref && e.sample === entry.sample) + 1) : ''}` })),
                        onClick: ({ key }) => { const target = targets[Number(key)]; if (target) removeSample(target.band, target.entry); },
                      }}>{cell}</Dropdown>;

                    })}
                  </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {selfBands.some(band => entriesOf(band).length === 0) && <Alert type="warning" showIcon style={{ marginTop: 6 }} message="当前没有试样，可保存草稿；提交前请新增试样。" />}

        </div>
      );
    }

    if (field.type === 'variant_list') {
      return (
        <VariantListField
          key={field.id}
          field={field}
          value={value}
          onChange={(v) => handleChange(field.code, v)}
        />
      );
    }

    return (
      <div key={field.id} style={fieldRowStyle}>
        <label style={labelStyle}>
          {field.label}
          {field.required && <span style={{ color: 'red' }}>*</span>}
          ：
        </label>
        {renderInput(field, value, (v) => handleChange(field.code, v), uploadCtx)}
        {field.unit && <span style={{ color: '#999', marginLeft: 4 }}>{field.unit}</span>}
        {field.description && <span style={{ color: '#aaa', fontSize: 11, marginLeft: 8 }}>{field.description}</span>}
      </div>
    );
  };

  const setImageCollection = (group: FieldGroup, collection: RecordImageCollection) => {
    const next: Record<string, any> = { ...data, [imageCollectionKey(group.id)]: collection };
    // 同步旧字段数组，保证尚未升级的接口、模板与历史映射仍能读取已有图片。
    const imageFields = group.fields.filter(field => field.type === 'image');
    imageFields.forEach(field => {
      next[field.code] = collection.items
        .filter(item => item.source_field_code === field.code && item.photo)
        .map(item => item.photo);
    });
    const derived = computeDerivedMerged(template, next);
    onChange({ ...next, ...derived });
  };

  const focusWrap = (field: FieldDefinition, group: FieldGroup, content: React.ReactNode, key = field.id) => (
    <div
      key={key}
      // 子控件（尤其表格格子）会在 focus/click 中给出更细的行级锚点；
      // 这里不能在事件冒泡末尾再用字段顶端锚点覆盖它。
      onClick={(event) => { if (event.target === event.currentTarget) onFocusField?.(field, group); }}
      onFocusCapture={() => onFocusField?.(field, group)}
      style={{
        borderRadius: 6,
        padding: '4px 10px', minWidth: 0, boxSizing: 'border-box',
        transition: 'background-color .15s, box-shadow .15s',
        ...(activeFieldCode === field.code
          ? { background: 'rgba(22,119,255,0.055)', boxShadow: 'inset 3px 0 0 #1677ff' }
          : {}),
      }}
    >
      {content}
      {(field.type === 'image' && group.section_role !== 'images')
        && captionEditor(figureCaptionFieldKey(field.code), field.caption)}
    </div>
  );

  const renderGroupFields = (group: FieldGroup) => {
    if (group.section_role !== 'images') {
      return group.fields.map(field => focusWrap(field, group, renderField(field, group)));
    }
    const firstImageIndex = group.fields.findIndex(field => field.type === 'image');
    if (firstImageIndex < 0) return group.fields.map(field => focusWrap(field, group, renderField(field, group)));
    const collection = findImageCollection(data, group) || imageCollectionFromLegacy(group, data);
    return group.fields.map((field, index) => {
      if (field.type !== 'image') return focusWrap(field, group, renderField(field, group));
      if (index !== firstImageIndex) return null;
      return focusWrap(field, group, (
        <>
          <RecordImageCollectionEditor
            group={group}
            collection={collection}
            uploadCtx={uploadCtx}
            onChange={(next) => setImageCollection(group, next)}
            onItemFocus={(_itemIndex, itemId, sourceCode) => {
              const imageFields = group.fields.filter(item => item.type === 'image');
              const sourceIndex = Math.max(0, imageFields.findIndex(item => item.code === sourceCode));
              const field = imageFields[sourceIndex] || imageFields[0];
              if (field) onFocusField?.(field, group, `__image_item__:${itemId}`);
            }}
          />
          {captionEditor(figureCaptionGroupKey(group.id), group.image_layout?.caption)}
        </>
      ), `image-collection-${group.id}`);
    });
  };

  if (previewFieldCode) {
    const field = template.groups.flatMap(group => group.fields).find(field => field.code === previewFieldCode);
    return <div aria-label="导入后表格预览" style={{ overflow: 'auto', maxHeight: 420 }}><div inert>{field ? renderField(field) : null}</div></div>;
  }
  return (
    <div style={{ padding: 16, overflowY: 'auto', height: '100%' }}>
      {/* 嵌套分区：子分区渲染为父 Card 内的 inner Card（存储平铺，按 group-tree 分桶）。Excel 导入面板已下移到第一张数据表之前 */}
      {buildGroupTree(template.groups).map(({ group, children }) => (
        <Card
          key={group.id} size="small" title={sectionTitle(group.label)}
          style={{ marginBottom: 14, borderColor: '#e8ecf3' }}
          styles={{ header: { background: '#fafbfd', borderBottom: '1px solid #eef1f6', minHeight: 40 } }}
        >
          {renderGroupFields(group)}
          {children.map(child => (
            <Card
              key={child.id} type="inner" size="small" title={sectionTitle(child.label)}
              style={{ margin: '10px 0 4px 12px', borderColor: '#e8ecf3' }}
              styles={{ header: { background: '#fafbfd' } }}
            >
              {renderGroupFields(child)}
            </Card>
          ))}
        </Card>
      ))}
    </div>
  );
}

const fieldRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8,
  padding: '7px 2px', borderBottom: '1px dashed #eef1f6',
};
const labelStyle: React.CSSProperties = { fontWeight: 600, color: '#344054', minWidth: 96 };
// 模板/PDF 中使用 pt，而浏览器 CSS 的无单位字号是 px。此前直接把 10pt 当 10px，
// 导致说明文字比同一份文档的录入字体明显偏小。
const ptToPx = (pt: number) => Math.round(pt * (4 / 3) * 10) / 10;

/** 说明字段的固定表格：与自由表格同一份结构/合并/单元格样式，但没有任何可录入格。 */
function StaticTableContent({ table }: { table?: NonNullable<FieldDefinition['free_table']> }) {
  const columns = table?.columns || [];
  const rows = table?.rows || [];
  const covered = new Set<string>();
  const rowIndex = new Map(rows.map((row, index) => [row.id, index]));
  const colIndex = new Map(columns.map((col, index) => [col.id, index]));
  for (const [key, span] of Object.entries(table?.spans || {})) {
    const [rowId, colId] = key.split('::');
    const r = rowIndex.get(rowId), c = colIndex.get(colId);
    if (r == null || c == null) continue;
    const rs = Math.min(Math.max(span.rowspan ?? 1, 1), rows.length - r);
    const cs = Math.min(Math.max(span.colspan ?? 1, 1), columns.length - c);
    for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) if (dr || dc) covered.add(`${r + dr},${c + dc}`);
  }
  if (!rows.length || !columns.length) return <span style={{ color: '#98a2b3' }}>未配置说明表格</span>;
  return <div style={{ overflowX: 'auto' }}><table style={{ borderCollapse: 'collapse', width: '100%', minWidth: columns.length * 92 }}>
    <tbody>{rows.map((row, ri) => <tr key={row.id}>{columns.map((column, ci) => {
      if (covered.has(`${ri},${ci}`)) return null;
      const key = `${row.id}::${column.id}`;
      const span = table?.spans?.[key];
      const style = table?.cell_styles?.[key];
      const isHeader = !!table?.header_cells?.[key];
      return <td key={key} colSpan={span?.colspan} rowSpan={span?.rowspan} style={{
        border: '1px solid #aebdce', padding: '6px 8px', verticalAlign: 'middle',
        textAlign: style?.align || 'center', whiteSpace: 'pre-wrap', background: isHeader ? '#edf4fb' : '#fff',
        fontFamily: style?.font, fontSize: style?.size ? ptToPx(parseFloat(style.size) || 10) : undefined,
        fontWeight: style?.weight === 'bold' || (isHeader && style?.weight !== 'regular') ? 700 : 400,
        fontStyle: style?.italic ? 'italic' : undefined, color: style?.color,
      }}>{table?.cells?.[key] || ''}</td>;
    })}</tr>)}</tbody>
  </table></div>;
}

/** 模板静态说明：只读呈现，绝不写入本次 record_data。 */
function StaticContentField({ field, template }: { field: FieldDefinition; template: RecordTemplate }) {
  if (field.static_kind) {
    if (field.static_display === 'pdf') return null;
    const layout = field.static_layout || {};
    const documentCfg = template.layout_options?.theme_config as Record<string, any> | undefined;
    const font = layout.font || documentCfg?.font || 'Songti SC';
    const fontSizePt = layout.font_size ?? documentCfg?.body_size ?? 10;
    const fontSize = ptToPx(fontSizePt);
    const before = ptToPx(layout.before_pt ?? 0), after = ptToPx(layout.after_pt ?? 4);
    const kindMeta = field.static_kind === 'text'
      ? { label: '模板说明', icon: <InfoCircleOutlined /> }
      : field.static_kind === 'images'
        ? { label: '模板图片资料', icon: <FileImageOutlined /> }
        : { label: '说明', icon: null };
    const wrapStyle: React.CSSProperties = {
      marginTop: before, marginBottom: after, padding: '10px 12px 12px',
      border: '1px solid #b7d7fb', borderLeft: `4px solid ${BRAND}`, borderRadius: 6,
      background: '#f5faff', boxShadow: '0 1px 2px rgba(19,102,217,0.04)',
    };
    const shell = (content: React.ReactNode) => <div style={wrapStyle} data-static-content="true">
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9, color: '#175ca8' }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{kindMeta.icon && <>{kindMeta.icon} </>}{kindMeta.label}</span>
        {field.static_kind !== 'table' && <span style={{ fontSize: 11, color: '#6a7f99' }}>模板固定内容 · 仅查看，不写入本次录入数据</span>}
      </div>
      {content}
    </div>;
    if (field.static_kind === 'text') {
      const paragraphs = (field.static_text || '').split(/\n\s*\n/);
      const textStyle: React.CSSProperties = {
        whiteSpace: 'pre-wrap', fontFamily: font, fontSize,
        lineHeight: `${fontSize + ptToPx(layout.line_gap_pt ?? 4)}px`,
        textIndent: `${layout.first_line_indent_em ?? 0}em`,
      };
      return shell(paragraphs.map((paragraph, index) => <div key={index} style={{ ...textStyle, marginBottom: index === paragraphs.length - 1 ? 0 : ptToPx(layout.paragraph_gap_pt ?? 6) }}>{paragraph}</div>));
    }
    if (field.static_kind === 'images') {
      return shell((field.static_images || []).filter(image => !!image.url).map(image => {
        const width = Number(image.display_width_cm);
        const height = Number(image.display_height_cm);
        return <img key={image.id} src={image.url} alt={image.title || image.name || '说明图片'} style={{
          display: 'block', width: Number.isFinite(width) && width > 0 ? `${Math.min(100, (width / 18) * 100)}%` : '100%',
          maxHeight: Number.isFinite(height) && height > 0 ? `${Math.min(height, 40) * 38}px` : undefined,
          objectFit: Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0 ? 'fill' : 'contain', marginBottom: layout.image_gap_pt ?? 4,
        }} />;
      }));
    }
    if (field.static_kind === 'table') return shell(<StaticTableContent table={field.static_table} />);
    return null;
  }
  const blocks = field.static_content || [];
  const gap = Math.max(0, Math.min(60, field.static_content_gap_pt ?? 4));
  return (
    <div style={{ margin: '8px 0 12px', padding: '10px 12px 12px', border: '1px solid #b7d7fb', borderLeft: `4px solid ${BRAND}`, borderRadius: 6, background: '#f5faff' }} data-static-content="true">
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9, color: '#175ca8' }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}><InfoCircleOutlined /> 模板说明 / 资料</span>
        <span style={{ fontSize: 11, color: '#6a7f99' }}>模板固定内容 · 仅查看</span>
      </div>
      {!field.hide_label && <div style={{ fontWeight: 600, marginBottom: 8 }}>{field.label}</div>}
      {blocks.filter(block => block.display !== 'pdf').map(block => {
        const wrap = (content: React.ReactNode) => <div key={block.id} style={{ marginBottom: gap }}>{content}</div>;
        if (block.kind === 'text') return wrap(<div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{block.text}</div>);
        if (block.kind === 'image') return block.url ? wrap(<img src={block.url} alt={block.name || '说明图片'} style={{ display: 'block', width: `${Math.min(100, ((block.width_cm || 12) / 18) * 100)}%`, maxHeight: `${(block.height_cm || 8) * 38}px`, objectFit: 'contain' }} />) : null;
        return null;
      })}
    </div>
  );
}

function renderInput(field: FieldDefinition, value: any, onChange: (v: any) => void, uploadCtx?: { orderNo?: string; recordDir?: string }) {
  switch (field.type) {
    case 'text':
      return <AutoGrowTextArea size="small" value={typeof value === 'object' ? '' : (value || '')} onChange={(e) => onChange(e.target.value)} style={{ width: 240 }} />;

    case 'number':
      return (
        <Input size="small" value={value ?? ''} onChange={(e) => onChange(e.target.value)} style={{ width: 120 }}
          placeholder={field.default_value ? String(field.default_value) : ''} />
      );

    case 'date':
      return dateInput(field, value, onChange);

    case 'select':
      return <SelectWithCustom field={field} value={value} onChange={onChange} />;

    case 'checkbox':
      return <CheckboxWithCustom field={field} value={value} onChange={onChange} />;

    case 'textarea':
      return <AutoGrowTextArea value={value || ''} onChange={(e) => onChange(e.target.value)}
        autoSize={{ minRows: 2, maxRows: 3 }} style={{ width: 320 }} />;

    case 'device_ref':
      return <DeviceRefField field={field} value={value} onChange={onChange} />;

    case 'image':
      return <ImageField field={field} value={value} onChange={onChange} uploadCtx={uploadCtx} />;

    default:
      return <AutoGrowTextArea size="small" value={value || ''} onChange={(e) => onChange(e.target.value)} style={{ width: 240 }} />;
  }
}

function renderVariantSubfield(sf: FieldDefinition, value: any, onChange: (v: any) => void) {
  switch (sf.type) {
    case 'date':
      return dateInput(sf, value, onChange);
    case 'select':
      return <SelectWithCustom field={sf} value={value} onChange={onChange} style={{ width: 140 }} />;
    case 'textarea':
      return <AutoGrowTextArea size="small" style={{ width: 160 }} value={value || ''} onChange={(e) => onChange(e.target.value)} />;
    case 'number':
      return (
        <Input size="small" style={{ width: 80 }} value={value ?? ''}
          placeholder={sf.default_value ? String(sf.default_value) : ''}
          onChange={(e) => onChange(e.target.value)} />
      );
    default:
      return (
        <Input size="small" style={{ width: 80 }} value={value ?? ''}
          onChange={(e) => onChange(e.target.value)} />
      );
  }
}

function SelectWithCustom({
  field,
  value,
  onChange,
  style,
}: {
  field: FieldDefinition;
  value: any;
  onChange: (v: any) => void;
  style?: React.CSSProperties;
}) {
  const isCustom = value && typeof value === 'object' && 'custom' in value;
  const selectVal = isCustom ? '__custom__' : value;
  const opts = (field.options || []).map(o => ({ value: o, label: o }));
  const allowCustom = field.allow_custom !== false;
  if (allowCustom) opts.push({ value: '__custom__', label: '其他（自定义）' });

  return (
    <Space size={4}>
      <Select size="small" value={selectVal} onChange={(v) => {
        if (v === '__custom__') onChange({ custom: '' });
        else onChange(v);
      }} style={style || { width: 160 }} options={opts} placeholder="请选择" />
      {isCustom && (
        <AutoGrowTextArea size="small" placeholder="填写其他" style={{ width: 180 }}
          value={(value as any).custom || ''}
          onChange={(e) => onChange({ custom: e.target.value })} />
      )}
    </Space>
  );
}

function CheckboxWithCustom({ field, value, onChange }: { field: FieldDefinition; value: any; onChange: (v: any) => void }) {
  const arr: any[] = Array.isArray(value) ? value : [];
  const checked = arr.filter(v => typeof v === 'string');
  const customItem = arr.find(v => v && typeof v === 'object' && 'custom' in v);
  const customChecked = !!customItem;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
      <Checkbox.Group value={checked} onChange={(vals) => {
        const next: any[] = [...vals];
        if (customItem) next.push(customItem);
        onChange(next);
      }}
        options={(field.options || []).map(o => ({ value: o, label: o }))} />
      {field.allow_custom !== false && (
        <>
          <Checkbox checked={customChecked} onChange={(e) => {
            if (e.target.checked) onChange([...checked, { custom: '' }]);
            else onChange(checked);
          }}>其他</Checkbox>
          {customChecked && (
            <AutoGrowTextArea size="small" placeholder="填写其他" style={{ width: 180 }}
              value={(customItem as any).custom || ''}
              onChange={(e) => onChange([...checked, { custom: e.target.value }])} />
          )}
        </>
      )}
    </div>
  );
}

/**
 * DeviceRefField — 测试设备字段（从设备库按管理编号/仪器名称搜索）
 * 存储值：string[]（asset_code 数组）
 *
 * UX：模板常用设备作为快捷候选；“选择其他设备”打开完整设备库搜索。两种入口保存为同一种 asset_code 引用。
 * 已选项以 chip 显示设备名+管理编号；可移除。
 */
function DeviceRefField({ field, value, onChange }: { field: FieldDefinition; value: any; onChange: (v: any) => void }) {
  const codes: string[] = Array.isArray(value) ? value : [];
  const config = field.device_ref_config || {};
  const presetCodes = useMemo(() => config.preset_asset_codes || [], [config.preset_asset_codes]);
  const allowLibrarySearch = config.allow_library_search !== false;
  const single = config.selection_mode === 'single';
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedDetails, setSelectedDetails] = useState<Record<string, any>>({});
  const [showLibrarySearch, setShowLibrarySearch] = useState(presetCodes.length === 0);

  // 已选 + 模板常用 asset_code → 详情（用于快捷候选和已选 chip）
  useEffect(() => {
    const missing = Array.from(new Set([...codes, ...presetCodes])).filter(c => !selectedDetails[c]);
    if (!missing.length) return;
    fetch(`/api/equipment/lookup?codes=${encodeURIComponent(missing.join(','))}`)
      .then(r => r.json())
      .then((rows: any[]) => {
        const next = { ...selectedDetails };
        rows.forEach(r => { next[r.asset_code] = r; });
        setSelectedDetails(next);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codes.join('|'), presetCodes.join('|')]);

  // 远程搜索（debounce 300ms）
  useEffect(() => {
    if (!search.trim()) { setOptions([]); return; }
    setSearchLoading(true);
    const t = setTimeout(() => {
      fetch(`/api/equipment?keyword=${encodeURIComponent(search.trim())}&limit=20`)
        .then(r => r.json())
        .then(d => setOptions(d.items || []))
        .catch(() => setOptions([]))
        .finally(() => setSearchLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const remove = (code: string) => onChange(codes.filter(c => c !== code));
  const add = (code: string, detail?: any) => {
    if (codes.includes(code)) {
      message.warning('该设备已添加');
      return;
    }
    if (detail) setSelectedDetails(prev => ({ ...prev, [code]: detail }));
    onChange(single ? [code] : [...codes, code]);
  };

  const statusColor = (status?: string) => status === '合格' ? 'green'
    : (status && /(超期|停用|报废|不合格)/.test(status)) ? 'red' : 'default';

  return (
    <div style={{ width: '100%' }}>
      {presetCodes.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>常用设备（{single ? '单选' : '可多选'}）</div>
          <Space size={[6, 6]} wrap>
            {presetCodes.map(code => {
              const detail = selectedDetails[code];
              const invalid = detail?.status && /(超期|停用|报废|不合格)/.test(detail.status);
              return (
                <Button key={code} size="small" disabled={codes.includes(code)} danger={invalid}
                  onClick={() => add(code, detail)}>
                  {detail?.name || code}{detail?.model ? `（${detail.model}）` : ''} · {code}
                  {detail?.status ? ` [${detail.status}]` : ''}
                </Button>
              );
            })}
          </Space>
        </div>
      )}
      {allowLibrarySearch && !showLibrarySearch && (
        <Button size="small" type="dashed" icon={<PlusOutlined />} style={{ marginBottom: 8 }}
          onClick={() => setShowLibrarySearch(true)}>从设备库选择其他设备</Button>
      )}
      {allowLibrarySearch && showLibrarySearch && (
        <Select
          size="small"
          showSearch
          autoFocus={presetCodes.length > 0}
          value={null}
          loading={searchLoading}
          searchValue={search}
          onSearch={setSearch}
          filterOption={false}
          placeholder="按管理编号、仪器名称、型号搜索设备库"
          notFoundContent={search ? (searchLoading ? '搜索中…' : '未找到匹配设备') : '输入关键字开始搜索'}
          style={{ minWidth: 320, marginBottom: 8 }}
          onSelect={(v) => {
            const detail = options.find(o => o.asset_code === v);
            add(String(v), detail);
            setSearch('');
          }}
          options={options.map(o => ({
            value: o.asset_code,
            label: (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div>
                  <strong>{o.name}</strong>
                  {o.model && <span style={{ color: '#888', fontSize: 11, marginLeft: 4 }}>{o.model}</span>}
                  <div style={{ fontSize: 11, color: '#666', fontFamily: 'monospace' }}>{o.asset_code}</div>
                </div>
                {o.status && <Tag color={statusColor(o.status)}>{o.status}</Tag>}
              </div>
            ),
          }))}
        />
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {codes.length === 0 && <span style={{ fontSize: 12, color: '#aaa' }}>（暂无设备）</span>}
        {codes.map(c => {
          const d = selectedDetails[c];
          return (
            <Tag key={c} closable onClose={() => remove(c)} style={{ margin: 0 }}>
              {d ? (
                <>
                  <strong>{d.name}</strong>
                  <span style={{ color: '#888', fontFamily: 'monospace', marginLeft: 4 }}>({c})</span>
                </>
              ) : (
                <span style={{ fontFamily: 'monospace' }}>{c}</span>
              )}
            </Tag>
          );
        })}
      </div>
    </div>
  );
}

/**
 * ImageField — 非图片分区内的独立图片字段（兼容旧模板）
 * 值结构：[{ name, url, original_name }]
 */
function ImageField({ field, value, onChange, uploadCtx }: { field: FieldDefinition; value: any; onChange: (v: any) => void; uploadCtx?: { orderNo?: string; recordDir?: string } }) {
  const items: any[] = Array.isArray(value) ? value : [];
  const allowMultiple = field.allow_multiple !== false;

  const handleUpload = async (file: File) => {
    const fd = new FormData();
    const prepared = await prepareImageForUpload(file);
    fd.append('file', prepared);
    // 落盘上下文：订单号 / 原始记录(样品_测试项目) / 字段名 → 按结构分文件夹存
    if (uploadCtx?.orderNo) fd.append('order_no', uploadCtx.orderNo);
    if (uploadCtx?.recordDir) fd.append('record_dir', uploadCtx.recordDir);
    fd.append('field_name', field.label || field.code);
    try {
      const res = await axios.post('/api/images/upload', fd);
      const data = res.data;
      onChange(allowMultiple ? [...items, data] : [data]);
    } catch (e: any) {
      message.error('上传失败：' + (e.message || ''));
    }
    return false; // prevent antd default
  };

  const removeAt = (idx: number) => onChange(items.filter((_, i) => i !== idx));
  const moveAt = (idx: number, dir: -1 | 1) => {
    const t = idx + dir; if (t < 0 || t >= items.length) return;
    const next = [...items]; [next[idx], next[t]] = [next[t], next[idx]]; onChange(next);
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-start' }}>
      {items.map((it, i) => (
        <div key={i} style={{ width: 96, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ position: 'relative', width: 88, height: 88, border: '1px solid #ddd', borderRadius: 4, overflow: 'hidden' }}>
            <img src={it.url || it.server_path} alt={it.original_name || it.name}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <Button size="small" type="text" danger icon={<DeleteOutlined />}
              style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(255,255,255,0.85)', padding: 0, width: 22, height: 22 }}
              onClick={() => removeAt(i)} />
            {items.length > 1 && (
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, display: 'flex', justifyContent: 'space-between', background: 'rgba(255,255,255,0.8)' }}>
                <Button size="small" type="text" disabled={i === 0} onClick={() => moveAt(i, -1)} style={{ padding: 0, height: 18, width: 28, fontSize: 12 }}>‹</Button>
                <Button size="small" type="text" disabled={i === items.length - 1} onClick={() => moveAt(i, 1)} style={{ padding: 0, height: 18, width: 28, fontSize: 12 }}>›</Button>
              </div>
            )}
          </div>
          <ImageProcessButton compact src={it.url || it.server_path}
              name={it.original_name || it.name}
              sizeBytes={it.size_bytes}
              displaySize={{ widthCm: it.display_width_cm ?? field.image_size?.width_cm ?? 7, heightCm: it.display_height_cm ?? field.image_size?.height_cm ?? 6 }}
              displayRotation={it.display_rotation ?? 0}
              onDisplaySizeChange={size => {
                const next = [...items];
                next[i] = { ...it, display_width_cm: size.widthCm, display_height_cm: size.heightCm };
                onChange(next);
              }}
              onPreviewChange={preview => {
                const next = [...items];
                next[i] = { ...it, display_width_cm: preview.widthCm, display_height_cm: preview.heightCm, display_rotation: preview.rotation || undefined };
                onChange(next);
              }}
              onProcessed={async (file) => {
                const fd = new FormData();
                const prepared = await prepareImageForUpload(file);
                fd.append('file', prepared);
                if (uploadCtx?.orderNo) fd.append('order_no', uploadCtx.orderNo);
                if (uploadCtx?.recordDir) fd.append('record_dir', uploadCtx.recordDir);
                fd.append('field_name', field.label || field.code);
                const response = await axios.post('/api/images/upload', fd);
                const next = [...items];
                next[i] = { ...it, ...response.data };
                onChange(next);
              }} />
        </div>
      ))}
      {(allowMultiple || items.length === 0) && (
        <Space direction="vertical" size={6}>
          <Upload accept="image/*" showUploadList={false} beforeUpload={handleUpload}>
            <Button size="small" icon={<PlusOutlined />} style={{ width: 88, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 11 }}>选图</span>
            </Button>
          </Upload>
          <ImageProcessButton compact disabled onProcessed={handleUpload} />
          {IS_TOUCH && (
            <Upload accept="image/*" capture="environment" showUploadList={false} beforeUpload={handleUpload}>
              <Button size="small" icon={<CameraOutlined />} style={{ width: 88, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 11 }}>拍照</span>
              </Button>
            </Upload>
          )}
        </Space>
      )}
    </div>
  );
}

interface VariantEntry {
  variant_id: string;
  values: Record<string, any>;
}

function VariantListField({ field, value, onChange }: { field: FieldDefinition; value: any; onChange: (v: any) => void }) {
  const entries: VariantEntry[] = Array.isArray(value) ? value : [];
  const variants: VariantDef[] = field.variants || [];

  const addEntry = () => {
    const first = variants[0];
    if (!first) return;
    const initVals: Record<string, any> = {};
    for (const sf of first.fields || []) {
      if (sf.default_value !== undefined) initVals[sf.code] = sf.default_value;
    }
    onChange([...entries, { variant_id: first.id, values: initVals }]);
  };

  const removeEntry = (idx: number) => onChange(entries.filter((_, i) => i !== idx));

  const updateEntry = (idx: number, patch: Partial<VariantEntry>) => {
    const next = [...entries];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  const updateSubField = (idx: number, code: string, val: any) => {
    const next = [...entries];
    next[idx] = { ...next[idx], values: { ...next[idx].values, [code]: val } };
    onChange(next);
  };

  const removeSubField = (idx: number, code: string) => {
    const next = [...entries];
    const newVals = { ...next[idx].values };
    delete newVals[code];
    next[idx] = { ...next[idx], values: newVals };
    onChange(next);
  };

  return (
    <div style={{ marginBottom: 6, padding: '4px 0', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
        <label style={labelStyle}>
          {field.label}
          {field.required && <span style={{ color: 'red' }}>*</span>}
          ：
        </label>
        <Button size="small" icon={<PlusOutlined />} onClick={addEntry} type="dashed">添加条目</Button>
        {field.description && <span style={{ color: '#aaa', fontSize: 11, marginLeft: 8 }}>{field.description}</span>}
      </div>

      {entries.length === 0 && (
        <div style={{ marginLeft: 90, color: '#bbb', fontSize: 12 }}>（尚未添加条目）</div>
      )}

      {entries.map((entry, idx) => {
        const variant = variants.find(v => v.id === entry.variant_id);
        return (
          <div key={idx} style={{ marginLeft: 90, marginBottom: 4, padding: 6, background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 4 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <Select size="small" value={entry.variant_id} style={{ width: 200 }}
                options={variants.map(v => ({ value: v.id, label: v.label }))}
                onChange={(vid) => {
                  const newVar = variants.find(v => v.id === vid);
                  const initVals: Record<string, any> = {};
                  for (const sf of newVar?.fields || []) {
                    if (sf.default_value !== undefined) initVals[sf.code] = sf.default_value;
                  }
                  updateEntry(idx, { variant_id: vid, values: initVals });
                }}
              />
              {variant?.render === 'literal' ? (
                <Tag color="blue">{variant.literal_value}</Tag>
              ) : (
                (variant?.fields || []).filter(sf => entry.values[sf.code] !== undefined || !sf.removable).map(sf => (
                  <span key={sf.code} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 12, color: '#666' }}>{sf.label}</span>
                    {renderVariantSubfield(sf, entry.values[sf.code], val => updateSubField(idx, sf.code, val))}
                    {sf.unit && <span style={{ fontSize: 12, color: '#999' }}>{sf.unit}</span>}
                    {sf.removable && (
                      <Button size="small" type="text" icon={<DeleteOutlined />}
                        onClick={() => removeSubField(idx, sf.code)} title="移除该子字段" />
                    )}
                  </span>
                ))
              )}
              <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => removeEntry(idx)} title="删除该条目" />
            </div>

            {variant?.render === 'inline_fields' && (
              <div style={{ marginTop: 4 }}>
                {(variant.fields || []).filter(sf => sf.removable && entry.values[sf.code] === undefined).map(sf => (
                  <Button key={sf.code} size="small" type="link" style={{ padding: '0 4px', fontSize: 11 }}
                    onClick={() => updateSubField(idx, sf.code, sf.default_value ?? '')}>
                    + {sf.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DataMatrixField({
  field,
  value,
  formData,
  onChange,
  onFocusRow,
}: {
  field: FieldDefinition;
  value: any;
  formData: Record<string, any>;
  onChange: (v: any) => void;
  onFocusRow?: (sid: string) => void;
}) {
  const cfg = field.matrix!;
  const v = normalizeMatrixValue(cfg, value) as DataMatrixValue;
  const FORMULA_BG = '#f7f0ff';
  const FORMULA_BORDER = '#d3adf7';
  const INPUT_BG = '#f3f9ff';
  const INPUT_BORDER = '#b7d7fb';
  const OVERRIDE_BG = '#fff7e6';
  const OVERRIDE_BORDER = '#ffc069';
  const [overrideEditor, setOverrideEditor] = useState<null | {
    localKey: string;
    label: string;
    calculatedValue: any;
    draft: string;
  }>(null);

  const localFormulaKey = (flatKey: string) => flatKey.startsWith(`${field.code}__`)
    ? flatKey.slice(field.code.length + 2) : flatKey;
  const openFormulaOverride = (flatKey: string, label: string) => {
    const localKey = localFormulaKey(flatKey);
    const existing = v.formula_overrides?.[localKey];
    const calculatedValue = existing?.calculated_value ?? formData[flatKey] ?? '';
    setOverrideEditor({
      localKey,
      label,
      calculatedValue,
      draft: String(existing?.value ?? formData[flatKey] ?? ''),
    });
  };
  const saveFormulaOverride = () => {
    if (!overrideEditor) return;
    if (overrideEditor.draft.trim() === '') {
      message.warning('修正值不能为空；如需取消修正，请使用“恢复公式计算”');
      return;
    }
    onChange({
      ...v,
      formula_overrides: {
        ...(v.formula_overrides || {}),
        [overrideEditor.localKey]: {
          value: overrideEditor.draft,
          calculated_value: overrideEditor.calculatedValue,
          confirmed_at: new Date().toISOString(),
        },
      },
    });
    setOverrideEditor(null);
    message.success('已确认使用人工修正值；后续公式和 PDF 将采用该值');
  };
  const clearFormulaOverride = () => {
    if (!overrideEditor) return;
    const next = { ...(v.formula_overrides || {}) };
    delete next[overrideEditor.localKey];
    onChange({ ...v, formula_overrides: Object.keys(next).length ? next : undefined });
    setOverrideEditor(null);
    message.success('已恢复公式自动计算');
  };
  const formulaResult = (flatKey: string, label: string) => {
    const localKey = localFormulaKey(flatKey);
    const overridden = !!v.formula_overrides?.[localKey];
    const result = formData[flatKey];
    return (
      <Button
        type="text"
        size="small"
        title={overridden ? '人工修正值；点击查看、修改或恢复公式' : '公式自动计算；点击可在确认后人工修正'}
        onClick={() => openFormulaOverride(flatKey, label)}
        style={{
          width: '100%', minWidth: 72, height: 'auto', padding: '3px 6px', borderRadius: 4,
          border: `1px solid ${overridden ? OVERRIDE_BORDER : FORMULA_BORDER}`,
          background: overridden ? OVERRIDE_BG : FORMULA_BG,
          color: overridden ? '#ad4e00' : '#531dab', whiteSpace: 'normal',
        }}>
        <span style={{ fontWeight: 600 }}>{result === null || result === undefined || result === '' ? '—' : String(result)}</span>
        <span style={{ display: 'block', fontSize: 10, lineHeight: 1.2, opacity: 0.78 }}>
          {overridden ? '人工修正' : 'ƒ 自动计算'}
        </span>
      </Button>
    );
  };

  const updateCell = (sid: string, pcode: string, val: any) => {
    const k = matrixDataKey(sid, pcode);
    onChange({ ...v, cells: { ...v.cells, [k]: val } });
  };

  const addSample = () => {
    // 开放权限（P2）：默认允许增减样品行，除非模板显式锁定（=== false）
    if (cfg.allow_add_remove_samples === false) return;
    const idx = v.sample_ids.length + 1;
    const sid = `s${Date.now()}`;
    const cells = { ...v.cells };
    for (const p of v.parameters) {
      // 新增行也应用参数列默认值
      cells[matrixDataKey(sid, p.code)] = (p.default_value ?? '') !== '' ? p.default_value : '';
    }
    onChange({
      ...v,
      sample_ids: [...v.sample_ids, sid],
      sample_labels: { ...v.sample_labels, [sid]: `${cfg.row_header_prefix || '试样'} ${idx}` },
      cells,
    });
  };

  const removeSample = (sid: string) => {
    if (cfg.allow_add_remove_samples === false) return;
    const cells = { ...v.cells };
    for (const p of v.parameters) {
      delete cells[matrixDataKey(sid, p.code)];
    }
    const sample_labels = { ...v.sample_labels };
    delete sample_labels[sid];
    const formula_overrides = Object.fromEntries(Object.entries(v.formula_overrides || {})
      .filter(([key]) => !key.startsWith(`${sid}__`) && !key.endsWith(`__${sid}`)));
    onChange({
      ...v,
      sample_ids: v.sample_ids.filter(id => id !== sid),
      sample_labels,
      cells,
      formula_overrides: Object.keys(formula_overrides).length ? formula_overrides : undefined,
    });
  };

  const addParameter = () => {
    if (!cfg.allow_add_remove_parameters) return;
    const n = v.parameters.length + 1;
    // 编码系统自动生成，防撞已有列（含被删后再加的场景）
    const code = uniqueCode(`col_${n}`, v.parameters.map(p => p.code));
    const np = { id: `p${Date.now()}`, code, label: `参数${n}` };
    const cells = { ...v.cells };
    for (const sid of v.sample_ids) {
      cells[matrixDataKey(sid, np.code)] = '';
    }
    onChange({ ...v, parameters: [...v.parameters, np], cells });
  };

  const removeParameter = (pcode: string) => {
    if (!cfg.allow_add_remove_parameters) return;
    const cells = { ...v.cells };
    for (const sid of v.sample_ids) {
      delete cells[matrixDataKey(sid, pcode)];
    }
    const formula_overrides = Object.fromEntries(Object.entries(v.formula_overrides || {})
      .filter(([key]) => !key.endsWith(`__${pcode}`)));
    onChange({
      ...v,
      parameters: v.parameters.filter(p => p.code !== pcode),
      cells,
      formula_overrides: Object.keys(formula_overrides).length ? formula_overrides : undefined,
    });
  };

  const setParamLabel = (idx: number, label: string) => {
    const parameters = [...v.parameters];
    parameters[idx] = { ...parameters[idx], label };
    onChange({ ...v, parameters });
  };

  const cellInput = (sid: string, p: { code: string }) => {
    const k = matrixDataKey(sid, p.code);
    const flatKey = `${field.code}__${k}`;
    const paramDef = v.parameters.find(pp => pp.code === p.code);
    const isFormulaCol = !!(paramDef?.cell_formula && paramDef.cell_formula.trim());
    // per-cell formula check
    const hasCellFormula = !!(cfg.cell_formulas && cfg.cell_formulas[k]);
    const cellVal = v.cells[k];
    // 按行公式列 或 per-cell 公式：显示 flat 里算出的值
    if (isFormulaCol || hasCellFormula) {
      return formulaResult(flatKey, `${paramDef?.label || p.code}（${sid}）`);
    }
    if (cfg.cell_type === 'number') {
      return (
        <Input size="small" style={{ width: 72, background: INPUT_BG, borderColor: INPUT_BORDER }} value={cellVal ?? ''}
          onChange={(e) => updateCell(sid, p.code, e.target.value)} />
      );
    }
    return (
      <AutoGrowTextArea size="small" style={{ width: 72, background: INPUT_BG, borderColor: INPUT_BORDER }} value={cellVal ?? ''} onChange={(e) => updateCell(sid, p.code, e.target.value)} />
    );
  };

  const updateSummaryInput = (rowId: string, val: any) => {
    onChange({
      ...v,
      summary_inputs: { ...(v.summary_inputs || {}), [rowId]: val },
    });
  };

  // 逐列录入型汇总行：每个参数列一格，存 v.summary_row_inputs，key = `${rowId}__${paramCode}`
  const updateSummaryRowInput = (rowId: string, paramCode: string, val: any) => {
    onChange({
      ...v,
      summary_row_inputs: { ...(v.summary_row_inputs || {}), [`${rowId}__${paramCode}`]: val },
    });
  };

  // 录入型汇总列：每个样品行一格，存 v.sumcol_inputs，key = `${colId}__${sampleId}`
  const updateSumcolInput = (colId: string, sid: string, val: any) => {
    onChange({
      ...v,
      sumcol_inputs: { ...(v.sumcol_inputs || {}), [`${colId}__${sid}`]: val },
    });
  };

  return (
    <div style={{ marginBottom: 12, overflowX: 'auto' }}>
      <div style={{ fontWeight: 'bold', marginBottom: 6 }}>{field.label}{field.required && <span style={{ color: 'red' }}>*</span>}</div>
      <table style={{ borderCollapse: 'collapse', fontSize: 12 }} onKeyDown={handleExcelTableKeyDown}
        onFocusCapture={(event) => {
          markSpreadsheetActiveCell(event.target as HTMLElement);
          const row = (event.target as HTMLElement).closest('tr[data-pdf-row]');
          if (row?.getAttribute('data-pdf-row')) onFocusRow?.(row.getAttribute('data-pdf-row')!);
        }}>
        <thead>
          <tr>
            {/* undefined=默认"试样"，''=模板显式留空 */}
            <th style={thStyle}>{cfg.axis_header ?? '试样'}</th>
            {v.parameters.map((p, pi) => (
              <th key={p.code} style={thStyle}>
                {cfg.allow_edit_parameter_labels_at_entry ? (
                  <AutoGrowTextArea size="small" style={{ width: 88 }} value={p.label}
                    onChange={(e) => setParamLabel(pi, e.target.value)} />
                ) : (
                  <span>{p.label}</span>
                )}
                <UnitCell
                  param={p}
                  value={v.parameter_unit_overrides?.[p.code] ?? p.unit ?? ''}
                  onChange={(u) => onChange({
                    ...v,
                    parameter_unit_overrides: { ...(v.parameter_unit_overrides || {}), [p.code]: u },
                  })}
                />
                {cfg.allow_add_remove_parameters && (
                  <Button size="small" type="link" danger onClick={() => removeParameter(p.code)}>×</Button>
                )}
              </th>
            ))}
            {(cfg.summary_cols || []).map(sc => (
              <th key={sc.id} style={{ ...thStyle, background: '#fff7e6' }}>
                <div>
                  {sc.label}
                  <HeaderNoteCell
                    note={sc.unit}
                    options={sc.unit_options}
                    allowCustom={sc.unit_allow_custom}
                    stored={v.sumcol_unit_overrides?.[sc.id]}
                    onSet={(u) => onChange({
                      ...v,
                      sumcol_unit_overrides: { ...(v.sumcol_unit_overrides || {}), [sc.id]: u },
                    })}
                  />
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {v.sample_ids.map((sid, ri) => (
            <tr key={sid} data-pdf-row={sid}>
              <td style={tdStyle}>
                {/* 行分组表头（纯展示，PDF 端合并为竖向超级行头；录入期新增行无分组） */}
                {cfg.sample_groups?.[ri] && (
                  <Tag color="blue" style={{ fontSize: 10, marginRight: 4 }}>▭ {cfg.sample_groups[ri]}</Tag>
                )}
                {cfg.allow_edit_sample_labels_at_entry !== false ? (
                  <AutoGrowTextArea size="small" style={{ width: 88 }}
                    value={v.sample_labels?.[sid] ?? cfg.default_sample_labels?.[ri] ?? `${cfg.row_header_prefix || '试样'} ${ri + 1}`}
                    onChange={(e) => onChange({
                      ...v,
                      sample_labels: { ...v.sample_labels, [sid]: e.target.value },
                    })}
                  />
                ) : (
                  <span style={{ fontWeight: 'bold', fontSize: 12 }}>
                    {v.sample_labels?.[sid] ?? cfg.default_sample_labels?.[ri] ?? `${cfg.row_header_prefix || '试样'} ${ri + 1}`}
                  </span>
                )}
                {/* 行表头备注（统一表头模型）：行列倒置使用时行头也能带单位/可选单位 */}
                <HeaderNoteCell
                  note={cfg.sample_notes?.[ri]?.note}
                  options={cfg.sample_notes?.[ri]?.note_options}
                  allowCustom={cfg.sample_notes?.[ri]?.note_allow_custom}
                  stored={v.sample_note_overrides?.[sid]}
                  onSet={(note) => onChange({
                    ...v,
                    sample_note_overrides: { ...(v.sample_note_overrides || {}), [sid]: note },
                  })}
                />
                {cfg.allow_add_remove_samples !== false && (
                  <Button size="small" type="link" danger onClick={() => removeSample(sid)}>删行</Button>
                )}
              </td>
              {v.parameters.map(p => (
                <td key={p.code} style={tdStyle}>{cellInput(sid, p)}</td>
              ))}
              {(cfg.summary_cols || []).map(sc => {
                const tdBase = { ...tdStyle, background: '#fffbe6', textAlign: 'center' as const };
                // 汇总列（跨行单值, per_row===false）：首行 rowspan 一个输入，存 v.sumcol_inputs[colId]（无 sid）
                if (sc.per_row === false) {
                  if (ri !== 0) return null;
                  const spanTd = { ...tdStyle, background: '#fff7e6', textAlign: 'center' as const, verticalAlign: 'middle' as const };
                  const cur = (v.sumcol_inputs?.[sc.id] as any) ?? '';
                  const setSpan = (val: any) => onChange({ ...v, sumcol_inputs: { ...(v.sumcol_inputs || {}), [sc.id]: val } });
                  if (sc.source_type === 'input_text' || sc.source_type === 'input_number') {
                    return (
                      <td key={sc.id} rowSpan={v.sample_ids.length} style={spanTd}>
                        <AutoGrowTextArea size="small" style={{ minWidth: 90 }} value={cur}
                          onChange={(e) => setSpan(e.target.value)}
                          placeholder={sc.source_type === 'input_number' ? '数字' : '文字'} />
                      </td>
                    );
                  }
                  if (sc.source_type === 'input_choice') {
                    const isCustom = cur && typeof cur === 'object' && 'custom' in cur;
                    const selectVal = isCustom ? '__custom__' : (cur as string | undefined);
                    const opts = (sc.choices || []).map(o => ({ value: o, label: o }));
                    if (sc.allow_custom) opts.push({ value: '__custom__', label: '其他（自定义）' });
                    return (
                      <td key={sc.id} rowSpan={v.sample_ids.length} style={spanTd}>
                        <Space size={2} direction="vertical" style={{ width: '100%' }}>
                          <Select size="small" style={{ minWidth: 100 }} value={selectVal} placeholder="选择" options={opts}
                            onChange={(vv) => setSpan(vv === '__custom__' ? { custom: '' } : vv)} />
                          {isCustom && (
                            <AutoGrowTextArea size="small" placeholder="自定义" value={(cur as any).custom || ''}
                              onChange={(e) => setSpan({ custom: e.target.value })} />
                          )}
                        </Space>
                      </td>
                    );
                  }
                  // literal / formula → 只读
                  const sx = sc.source_type === 'literal' ? (sc.literal || '—') : formData[matrixSummaryColSpanFlatKey(field.code, sc.id)];
                  const spanFlatKey = matrixSummaryColSpanFlatKey(field.code, sc.id);
                  return <td key={sc.id} rowSpan={v.sample_ids.length} style={spanTd}>
                    {sc.source_type === 'formula'
                      ? formulaResult(spanFlatKey, sc.label)
                      : (sx === null || sx === undefined || sx === '' ? '—' : String(sx))}
                  </td>;
                }
                const ck = `${sc.id}__${sid}`;
                // 统计列(数字)某格配了公式 → 该格自动算、只读显示（与试样格公式一致）
                if (sc.source_type === 'input_number' && sc.cell_formulas?.[sid]) {
                  const flatKey = matrixSummaryColCellFlatKey(field.code, sc.id, sid);
                  return <td key={sc.id} style={tdBase}>{formulaResult(flatKey, `${sc.label}（${sid}）`)}</td>;
                }
                // 录入型汇总列：每行可编辑（文本 / 数字 / 选择），存 v.sumcol_inputs
                if (sc.source_type === 'input_text' || sc.source_type === 'input_number') {
                  const cur = (v.sumcol_inputs?.[ck] as string) ?? '';
                  return (
                    <td key={sc.id} style={tdBase}>
                      <AutoGrowTextArea size="small" style={{ minWidth: 90 }} value={cur}
                        onChange={(e) => updateSumcolInput(sc.id, sid, e.target.value)}
                        placeholder={sc.source_type === 'input_number' ? '数字' : '文字'} />
                    </td>
                  );
                }
                if (sc.source_type === 'input_choice') {
                  const cur = v.sumcol_inputs?.[ck];
                  const isCustom = cur && typeof cur === 'object' && 'custom' in cur;
                  const selectVal = isCustom ? '__custom__' : (cur as string | undefined);
                  const opts = (sc.choices || []).map(o => ({ value: o, label: o }));
                  if (sc.allow_custom) opts.push({ value: '__custom__', label: '其他（自定义）' });
                  return (
                    <td key={sc.id} style={tdBase}>
                      <Space size={2} direction="vertical" style={{ width: '100%' }}>
                        <Select size="small" style={{ minWidth: 100 }} value={selectVal} placeholder="选择" options={opts}
                          onChange={(vv) => updateSumcolInput(sc.id, sid, vv === '__custom__' ? { custom: '' } : vv)} />
                        {isCustom && (
                          <AutoGrowTextArea size="small" placeholder="自定义" value={(cur as any).custom || ''}
                            onChange={(e) => updateSumcolInput(sc.id, sid, { custom: e.target.value })} />
                        )}
                      </Space>
                    </td>
                  );
                }
                // 固定 / 聚合 / 公式 → 只读显示
                let display: string;
                if (sc.source_type === 'literal') {
                  display = sc.literal || '—';
                } else {
                  const flatKey = matrixSummaryColCellFlatKey(field.code, sc.id, sid);
                  const x = formData[flatKey];
                  if (sc.source_type === 'formula' || sc.source_type === 'per_row_aggregate') {
                    return <td key={sc.id} style={tdBase}>{formulaResult(flatKey, `${sc.label}（${sid}）`)}</td>;
                  }
                  display = x === null || x === undefined || x === '' ? '—' : String(x);
                }
                return <td key={sc.id} style={tdBase}>{display}</td>;
              })}
            </tr>
          ))}
          {(cfg.summary_rows || []).map(sr => {
            const n = v.parameters.length || 1;

            // 逐列手动录入（per_column + input_*）：每个参数列一个输入框
            if (sr.per_column && (sr.source_type === 'input_text' || sr.source_type === 'input_number' || sr.source_type === 'input_choice')) {
              return (
                <tr key={sr.id}>
                  <td style={{ ...tdStyle, fontWeight: 'bold', background: '#e6f4ff' }}>
                    <SummaryLabelCell sr={sr} value={v} onChange={onChange} />
                  </td>
                  {v.parameters.map(p => {
                    const cur = v.summary_row_inputs?.[`${sr.id}__${p.code}`];
                    const hasFormula = !!sr.cell_formulas?.[p.code];
                    if (hasFormula) {
                      const flatKey = matrixSummaryColumnFlatKey(field.code, sr.id, p.code);
                      return (
                        <td key={p.code} style={{ ...tdStyle, background: FORMULA_BG, textAlign: 'center' }}>
                          {formulaResult(flatKey, `${sr.label} / ${p.label}`)}
                        </td>
                      );
                    }
                    return (
                      <td key={p.code} style={{ ...tdStyle, textAlign: 'center', background: '#f0f7ff' }}>
                        {sr.source_type === 'input_choice' ? (
                          <Select size="small" style={{ minWidth: 90 }} value={(cur as any) ?? undefined} placeholder="选择"
                            options={(sr.choices || []).map(o => ({ value: o, label: o }))}
                            onChange={(vv) => updateSummaryRowInput(sr.id, p.code, vv)} />
                        ) : (
                          <AutoGrowTextArea size="small" style={{ width: 80, background: INPUT_BG, borderColor: INPUT_BORDER }} value={(cur as any) ?? ''}
                            onChange={(e) => updateSummaryRowInput(sr.id, p.code, e.target.value)}
                            placeholder={sr.source_type === 'input_number' ? '数字' : ''} />
                        )}
                      </td>
                    );
                  })}
                  {(cfg.summary_cols || []).map(sc => (
                    <td key={sc.id} style={{ ...tdStyle, background: '#fafafa' }} />
                  ))}
                </tr>
              );
            }

            // per_column_aggregate: 每列独立一格
            if (sr.source_type === 'per_column_aggregate') {
              return (
                <tr key={sr.id}>
                  <td style={{ ...tdStyle, fontWeight: 'bold', background: '#fafafa' }}>
                    <SummaryLabelCell sr={sr} value={v} onChange={onChange} />
                  </td>
                  {v.parameters.map(p => {
                    const k = matrixSummaryColumnFlatKey(field.code, sr.id, p.code);
                    return (
                      <td key={p.code} style={{ ...tdStyle, background: FORMULA_BG, textAlign: 'center' }}>
                        {formulaResult(k, `${sr.label} / ${p.label}`)}
                      </td>
                    );
                  })}
                  {(cfg.summary_cols || []).map(sc => (
                    <td key={sc.id} style={{ ...tdStyle, background: '#fafafa' }} />
                  ))}
                </tr>
              );
            }

            const span = Math.min(Math.max(sr.value_colspan ?? n, 1), n);

            const renderValue = (): React.ReactNode => {
              if (sr.source_type === 'literal') {
                return (sr.literal ?? '') === '' ? '—' : String(sr.literal);
              }
              if (sr.source_type === 'input_text') {
                const cur = v.summary_inputs?.[sr.id] ?? '';
                return (
                  <Space size={4} style={{ width: '100%' }}>
                    <AutoGrowTextArea size="small" style={{ minWidth: 240 }} value={cur}
                      onChange={(e) => updateSummaryInput(sr.id, e.target.value)}
                      placeholder={sr.placeholder || '请输入文字'} />
                    {sr.unit && <span style={{ color: '#888' }}>{sr.unit}</span>}
                  </Space>
                );
              }
              if (sr.source_type === 'input_number') {
                const cur = v.summary_inputs?.[sr.id] ?? '';
                return (
                  <Space size={4}>
                    <AutoGrowTextArea size="small" style={{ width: 120 }} value={cur}
                      onChange={(e) => updateSummaryInput(sr.id, e.target.value)}
                      placeholder="输入数字" />
                    {sr.unit && <span style={{ color: '#888' }}>{sr.unit}</span>}
                  </Space>
                );
              }
              if (sr.source_type === 'input_choice') {
                const cur = v.summary_inputs?.[sr.id];
                const isCustom = cur && typeof cur === 'object' && 'custom' in cur;
                const selectVal = isCustom ? '__custom__' : cur;
                const opts = (sr.choices || []).map(o => ({ value: o, label: o }));
                if (sr.allow_custom) opts.push({ value: '__custom__', label: '其他（自定义）' });
                return (
                  <Space size={4}>
                    <Select size="small" style={{ minWidth: 140 }} value={selectVal}
                      placeholder="请选择"
                      options={opts}
                      onChange={(vv) => {
                        if (vv === '__custom__') updateSummaryInput(sr.id, { custom: '' });
                        else updateSummaryInput(sr.id, vv);
                      }} />
                    {isCustom && (
                      <AutoGrowTextArea size="small" style={{ width: 120 }} placeholder="自定义"
                        value={(cur as any).custom || ''}
                        onChange={(e) => updateSummaryInput(sr.id, { custom: e.target.value })} />
                    )}
                  </Space>
                );
              }
              if (sr.source_type === 'formula') {
                const sk = matrixSummaryFlatKey(field.code, sr.id);
                return formulaResult(sk, sr.label);
              }
              // legacy computed_field
              const x = formData[sr.field_code || ''];
              return x === null || x === undefined || x === '' ? '—' : String(x);
            };

            const content = renderValue();
            return (
              <tr key={sr.id}>
                <td style={{ ...tdStyle, fontWeight: 'bold', background: '#fafafa' }}>
                  <SummaryLabelCell sr={sr} value={v} onChange={onChange} />
                </td>
                {span >= n ? (
                  <td colSpan={n} style={{ ...tdStyle, background: '#f6ffed' }}>{content}</td>
                ) : (
                  <>
                    <td colSpan={span} style={{ ...tdStyle, background: '#f6ffed' }}>{content}</td>
                    {v.parameters.slice(span).map(p => (
                      <td key={`pad-${sr.id}-${p.code}`} style={tdStyle} />
                    ))}
                  </>
                )}
                {(cfg.summary_cols || []).map(sc => (
                  <td key={sc.id} style={{ ...tdStyle, background: '#fafafa' }} />
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      <Space style={{ marginTop: 8 }}>
        {cfg.allow_add_remove_samples !== false && (
          <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={addSample}>增加行</Button>
        )}
        {cfg.allow_add_remove_parameters && (
          <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={addParameter}>增加列</Button>
        )}
        {/* Excel 导入已上移到表单顶部「导入 Excel」统一入口（一份 Excel 填充所有表格） */}
      </Space>
      <Modal
        open={!!overrideEditor}
        title="确认修改公式计算结果"
        okText="确认使用修正值"
        cancelText="取消"
        onOk={saveFormulaOverride}
        onCancel={() => setOverrideEditor(null)}
        footer={(_, { OkBtn, CancelBtn }) => (
          <Space>
            {overrideEditor && v.formula_overrides?.[overrideEditor.localKey] && (
              <Button onClick={clearFormulaOverride}>恢复公式计算</Button>
            )}
            <CancelBtn />
            <OkBtn />
          </Space>
        )}>
        <div style={{ padding: '4px 0' }}>
          <div style={{ marginBottom: 8, color: '#475467' }}>公式格：{overrideEditor?.label}</div>
          <div style={{ marginBottom: 12, padding: '8px 10px', borderRadius: 6, background: FORMULA_BG, color: '#531dab' }}>
            修正时的公式值：<strong>{String(overrideEditor?.calculatedValue ?? '—')}</strong>
          </div>
          <Input
            autoFocus
            value={overrideEditor?.draft ?? ''}
            onChange={(event) => setOverrideEditor(current => current ? { ...current, draft: event.target.value } : current)}
            placeholder="请输入人工修正值" />
          <div style={{ marginTop: 10, color: '#ad6800', fontSize: 12, lineHeight: 1.6 }}>
            确认后，该值将替代本条记录的公式结果，并用于后续计算、判定和 PDF；模板中的公式不会被修改。
          </div>
        </div>
      </Modal>
    </div>
  );
}

const thStyle: React.CSSProperties = { border: '1px solid #ddd', padding: 4, background: '#fafafa' };
const tdStyle: React.CSSProperties = { border: '1px solid #ddd', padding: 4 };

/**
 * 顶部统一 Excel 导入：一份 Excel 一次导入，在向导中逐表核对来源和写入结果后一次提交；
 * 导入的原文件交给上层留存到订单记录（可随时下载）。无任何开启 Excel 导入的数据表时不渲染。
 */
function UnifiedExcelImport({
  template, data, onChange, recordId, attachments, onExcelImported,
}: {
  template: RecordTemplate;
  data: Record<string, any>;
  onChange: (data: Record<string, any>) => void;
  recordId?: string | number | null;
  attachments?: Array<{ id: string; filename: string; pending?: boolean; size_bytes?: number }>;
  onExcelImported?: (file: File) => void;
}) {
  const importFields = template.groups.flatMap(g => g.fields).filter(f =>
    (f.type === 'data_matrix' && f.matrix?.excel_import?.enabled) || (f.type === 'free_grid' && f.free_table?.excel_import?.enabled));
  if (!importFields.length) return null;

  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10,
      padding: '8px 12px', marginBottom: 14,
      background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 8,
    }}>
      <ExcelImportWizard fields={importFields} data={data}
        renderPreview={(field, simulated) => <FormRenderer template={template} data={{ ...simulated, ...computeDerivedMerged(template, simulated) }} previewFieldCode={field.code} onChange={() => {}} />}
        onApply={(updates, file) => {
        const next = { ...data, ...updates };
        const derived = computeDerivedMerged(template, next);
        onChange({ ...next, ...derived });
        message.success(`已导入 ${Object.keys(updates).length} 张表格`);
        try { onExcelImported?.(file); } catch { message.warning('数据已导入，但Excel附件留存失败，请重新添加附件'); }
      }} />
      <span style={{ fontSize: 11, color: '#52864e' }}>上传一次Excel，分别核对各表Sheet、数据区域和写入预览后统一导入。</span>
      {attachments && attachments.length > 0 && (
        <span style={{ fontSize: 12, color: '#555', display: 'inline-flex', alignItems: 'center', gap: 8, flexBasis: '100%' }}>
          <span style={{ color: '#888' }}>已留存 Excel：</span>
          {attachments.map(a => (
            (recordId && !a.pending)
              ? <a key={a.id} href={`/api/excel-import/${recordId}/attachments/${a.id}`} target="_blank" rel="noreferrer">
                  {a.filename}{a.size_bytes != null ? ` · ${formatFileBytes(a.size_bytes)}` : ''}
                </a>
              : <span key={a.id} style={{ color: '#999' }} title="保存后可下载">
                  {a.filename}{a.size_bytes != null ? ` · ${formatFileBytes(a.size_bytes)}` : ''}（保存后可下载）
                </span>
          ))}
        </span>
      )}
    </div>
  );
}

/**
 * 表头备注（统一表头模型）：以小括号显示在表头标签后。
 * - 只有固定 note：静态 (note)，如单位；
 * - 配了 options：括号里变下拉（如 客户要求/标准要求），可选"其他"自定义；
 * 所选值由调用方写入 DataMatrixValue 的对应 *_overrides，PDF 端同步显示。
 */
function HeaderNoteCell({
  note, options, allowCustom, stored, onSet,
}: {
  note?: string;
  options?: string[];
  allowCustom?: boolean;
  /** 录入已选值；undefined = 未选 */
  stored?: string;
  onSet: (v: string) => void;
}) {
  const opts = options || [];
  if (!opts.length) {
    return note ? <span style={{ color: '#888', fontSize: 11, marginLeft: 2, fontWeight: 'normal' }}>({note})</span> : null;
  }
  const isCustom = stored !== undefined && !opts.includes(stored);
  const selectVal = isCustom ? '__custom__' : stored;
  return (
    <span style={{ marginLeft: 4, display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 'normal' }}>
      (
      <Select size="small" style={{ minWidth: 88 }} value={selectVal} placeholder="选择"
        options={[
          ...opts.map(o => ({ value: o, label: o })),
          ...(allowCustom ? [{ value: '__custom__', label: '其他' }] : []),
        ]}
        onChange={(v) => { if (v === '__custom__') onSet(''); else onSet(v); }} />
      {isCustom && (
        <AutoGrowTextArea size="small" style={{ width: 80 }} value={stored} placeholder="自定义"
          onChange={(e) => onSet(e.target.value)} />
      )}
      )
    </span>
  );
}

/** 汇总行首列：固定标签 + 表头备注（如「判定要求 (客户要求)」，备注可配可选项） */
function SummaryLabelCell({
  sr,
  value,
  onChange,
}: {
  sr: import('../../../../shared/types').MatrixSummaryRowDef;
  value: import('../../../../shared/types').DataMatrixValue;
  onChange: (v: import('../../../../shared/types').DataMatrixValue) => void;
}) {
  return (
    <>
      {sr.label}
      <HeaderNoteCell
        note={sr.note}
        options={sr.note_options}
        allowCustom={sr.note_allow_custom}
        stored={value.summary_note_overrides?.[sr.id]}
        onSet={(note) => onChange({
          ...value,
          summary_note_overrides: { ...(value.summary_note_overrides || {}), [sr.id]: note },
        })}
      />
    </>
  );
}

function UnitCell({
  param,
  value,
  onChange,
}: {
  param: import('../../../../shared/types').MatrixParameterDef;
  value: string;
  onChange: (v: string) => void;
}) {
  const hasOptions = !!(param.unit_options && param.unit_options.length);
  if (!hasOptions) {
    if (!param.unit) return null;
    return <span style={{ color: '#888', fontSize: 11, marginLeft: 2 }}>({param.unit})</span>;
  }
  const opts = [...(param.unit_options || [])];
  const isCustom = !!value && !opts.includes(value);
  const selectVal = isCustom ? '__custom__' : (value || undefined);
  return (
    <span style={{ marginLeft: 4, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      (
      <Select size="small" style={{ minWidth: 64 }}
        value={selectVal}
        placeholder="单位"
        onChange={(v) => {
          if (v === '__custom__') onChange('');
          else onChange(v);
        }}
        options={[
          ...opts.map(o => ({ value: o, label: o })),
          ...(param.unit_allow_custom ? [{ value: '__custom__', label: '其他' }] : []),
        ]}
      />
      {isCustom || (param.unit_allow_custom && selectVal === '__custom__') ? (
        <AutoGrowTextArea size="small" style={{ width: 72 }} value={isCustom ? value : ''}
          placeholder="自定义"
          onChange={(e) => onChange(e.target.value)} />
      ) : null}
      )
    </span>
  );
}
