import { bindSelectedSampleRange } from '../../../../../shared/free-grid-direct-binding';
import { revealInScrollPanes } from '../../../utils/scrollWithin';
import { selectedSampleBindingKeys, selectedParameterKeys, sampleParameterBindings } from '../../../../../shared/free-grid-parameter-binding';
import { assertReportSampleTargets, createReportSampleRegion, reportSampleRegionIssues } from '../../../../../shared/report-sample-region';
import { rangeCellBindings } from '../../../../../shared/free-grid-range-binding';
/**
 * FreeGridCanvas — F0 自由表格统一网格编辑器（原始记录模板 / 报告项目模板共用）。
 *
 * 所有格子结构相同：自定义行/列、任意矩形合并（含表头）、每格标「表头」或「录入格」。
 *  - 点格子 = 选中 + 可直接输入固定文字；按住 Shift 点另一格 = 框选矩形区（用于合并/批量标记）。
 *  - 合并写 free_table.spans[主格]；被盖格渲染时跳过（与出片端 renderFreeGridTypst 同口径）。
 *  - 两侧共用结构、选区、字体字号、对齐和行列操作；原始记录负责录入角色/公式/数字格式/Excel 导入，项目模板负责映射。
 */
import { useState, useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import FormulaArguments from './FormulaArguments';
import { Button, Input, InputNumber, Select, Radio, Tooltip, Popover, Modal, message, ColorPicker, Switch, Space } from 'antd';
import {
  AlignCenterOutlined, AlignLeftOutlined, AlignRightOutlined, BgColorsOutlined, BoldOutlined,
  ClearOutlined, CloseOutlined, HolderOutlined, ItalicOutlined, MergeCellsOutlined, PlusOutlined,
  LinkOutlined, QuestionCircleOutlined, SettingOutlined, SplitCellsOutlined,
} from '@ant-design/icons';
import type { FieldDefinition, RecordTemplate, CellBinding, ExcelImportMapping } from '../../../../../shared/types';
import { executeWithFullPrecision, type Formula } from '../../../../../shared/formula-engine';
import { encodeFreeGridCellReference, resolveFreeGridCellReference } from '../../../../../shared/free-grid-formula';
import { numericRoundingLabel } from '../../../../../shared/numeric-rounding';
import { roundFreeGridValue, freeGridNumberText } from '../../../../../shared/free-grid-number';
import { freeGridRoundingOptions, setFreeGridTableNumberFormat } from '../../../../../shared/free-grid-number-settings';
import { freeGridTextDefault } from '../../../../../shared/free-grid-defaults';
import BindingPickerModal, { BindingSummary, describeFreeGridCellSource } from '../../ReportEditor/BindingPickerModal';
import { recordSampleBands, sampleBandForCell } from '../../../../../shared/free-grid-binding';
import AutoGrowTextArea from '../../AutoGrowTextArea';
import RoundingIntervalsEditor from '../../RoundingIntervalsEditor';
import { formulaAddressKeys, formulaRangeKeys, formulaRangeLabel } from '../../../../../shared/formula-grid-selection';
import { compileGridFormula, displayGridFormula } from '../../../../../shared/free-grid-excel-formula';
import { formulaCompletion, formulaInsertionRange, formulaParameterHint } from '../../../../../shared/formula-input';
import { maskFormulaStrings, mapFormulaCode, SPREADSHEET_FUNCTIONS } from '../../../../../shared/spreadsheet-expression';
import { FormulaError, invalidGridReference } from '../../../../../shared/formula-error';

type FT = NonNullable<FieldDefinition['free_table']>;
type FreeBandT = {
  id: string;
  axis: 'row' | 'col';
  refs: string[];
  /** row 带限定参与的列，col 带限定参与的行；未设置兼容旧版整行/整列带。 */
  cross_refs?: string[];
  matrix_code?: string;
  source_field?: string;
  source_band_id?: string;
  sample_filter?: { mode: 'all' | 'indices'; indices?: number[] };
};

const DEFAULT_FT: FT = {
  columns: [{ id: 'c1', label: '' }, { id: 'c2', label: '' }, { id: 'c3', label: '' }],
  rows: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }],
  cells: {}, header_cells: {}, input_cells: {},
};

const CELL_FONT_OPTIONS = [
  { value: 'Songti SC', label: '宋体' },
  { value: 'SimHei', label: '黑体' },
  { value: 'KaiTi', label: '楷体' },
  { value: 'FangSong', label: '仿宋' },
  { value: 'FangSong_GB2312', label: '仿宋_GB2312' },
  { value: 'STSong', label: '华文宋体' },
  { value: 'Arial', label: 'Arial' },
  { value: 'Times New Roman', label: 'Times New Roman' },
];

const NUMBER_FORMAT_OPTIONS = [
  { value: 'none', label: '不格式化' },
  { value: 'decimals', label: '小数位' },
  { value: 'scientific', label: '科学计数法' },
  { value: 'significant', label: '有效数字' },
];

const excelColumnName = (index: number): string => {
  let n = index + 1;
  let out = '';
  while (n > 0) { n--; out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26); }
  return out;
};

export default function FreeGridCanvas({ field, template, onChange, linkedRecord, editorMode = 'record', documentFont = 'Songti SC', documentSize = 10, staticContentMode = false, onCellFocus, toolbarHost }: {
  field: FieldDefinition;
  /** 当前整张模板：公式编辑器用它选择其它自由表格，并以字段 code 保存稳定跨表引用。 */
  template?: RecordTemplate;
  onChange: (patch: Partial<FieldDefinition>) => void;
  /** 报告侧编辑时传入关联的原始记录模板 → 每格可「绑定原始记录」自动取值。记录侧不传＝无绑定入口。 */
  linkedRecord?: RecordTemplate | null;
  editorMode?: 'record' | 'report-cover' | 'report-project';
  documentFont?: string;
  documentSize?: number;
  /** 说明字段中的固定表格：所有单元格直接编辑模板文字，不暴露录入格/公式/Excel/绑定设置。 */
  staticContentMode?: boolean;
  /** 点击单元格时同步 PDF 到该视觉行。 */
  onCellFocus?: (rowId: string) => void;
  /** undefined keeps embedded controls; null hides controls for inactive cover tables. */
  toolbarHost?: HTMLElement | null;
}) {
  const ft: FT = field.free_table || DEFAULT_FT;
  const cols = ft.columns || [];
  const rows = ft.rows || [];
  const cells = ft.cells || {};
  const spans = ft.spans || {};
  const headerCells = ft.header_cells || {};
  // 说明表格不读取或写入记录数据。即便是从旧自由表格复制而来，编辑时也一律按固定文字格处理。
  const inputCells = staticContentMode ? {} : (ft.input_cells || {});
  const sampleIndexCells = staticContentMode ? {} : (ft.sample_index_cells || {});
  const cellBindings = staticContentMode ? {} : (ft.cell_bindings || {});
  const cellUnitBindings = staticContentMode ? {} : (ft.cell_unit_bindings || {});
  const cellStyles = ft.cell_styles || {};
  const isReportProject = editorMode === 'report-project';
  const isRecordEditor = editorMode === 'record' && !staticContentMode;
  // AntD 下拉/数字输入可能在父组件完成下一次渲染前连续触发多个 onChange。
  // 用同步引用保存刚提交的最新 free_table，避免后一个补丁以旧 props 为基准覆盖前一个补丁。
  const latestFtRef = useRef(ft);
  latestFtRef.current = ft;
  const update = (patch: Partial<FT>) => {
    const next = { ...latestFtRef.current, ...patch };
    latestFtRef.current = next;
    onChange({ free_table: next });
  };

  const keyAt = (ri: number, ci: number) => `${rows[ri].id}::${cols[ci].id}`;
  /** 内部稳定 id（r3::c_...）只用于存储；界面统一显示 Excel 风格坐标（A1、B3、AA12）。 */
  const cellAddress = (key: string): string => {
    const [rowId, colId] = key.split('::');
    const rowIndex = rows.findIndex(row => row.id === rowId);
    const colIndex = cols.findIndex(col => col.id === colId);
    if (rowIndex < 0 || colIndex < 0) return '未知格';
    return `${excelColumnName(colIndex)}${rowIndex + 1}`;
  };
  const freeGridFields = (template?.groups || []).flatMap(group => group.fields || [])
    .filter(candidate => candidate.type === 'free_grid' && candidate.free_table);
  const sourceFieldOf = (fieldCode: string) => freeGridFields.find(candidate => candidate.code === fieldCode)
    || (field.code === fieldCode ? field : undefined);
  const addressInField = (sourceField: FieldDefinition | undefined, cellKey: string): string => {
    const sourceTable = sourceField?.free_table;
    if (!sourceTable) return '未知格';
    const [rowId, colId] = cellKey.split('::');
    const rowIndex = sourceTable.rows.findIndex(row => row.id === rowId);
    const colIndex = sourceTable.columns.findIndex(col => col.id === colId);
    return rowIndex < 0 || colIndex < 0 ? '未知格' : `${excelColumnName(colIndex)}${rowIndex + 1}`;
  };
  const sourceInfoFor = (source: string, ownerFieldCode = field.code) => {
    const reference = resolveFreeGridCellReference(source, ownerFieldCode);
    const sourceField = sourceFieldOf(reference.fieldCode);
    const address = addressInField(sourceField, reference.cellKey);
    const crossTable = reference.fieldCode !== field.code;
    const stableTableAlias = reference.fieldCode.replace(/[^A-Za-z0-9_]/g, '_') || 'TABLE';
    return {
      ...reference,
      sourceField,
      address,
      alias: crossTable ? `T_${stableTableAlias}_${address}` : address,
      label: crossTable ? `'${sourceField?.label || reference.fieldCode}'!${address}` : address,
    };
  };
  const sourceInfo = (source: string) => sourceInfoFor(source, field.code);
  const canonicalSource = (source: string, ownerFieldCode: string): string => {
    const reference = resolveFreeGridCellReference(source, ownerFieldCode);
    return reference.fieldCode === field.code
      ? reference.cellKey
      : encodeFreeGridCellReference(reference.fieldCode, reference.cellKey);
  };
  const normBands: FreeBandT[] = ft.sample_bands?.length
    ? ft.sample_bands.filter(b => b?.refs?.length)
    : (ft.sample_band?.ref ? [{ id: 'legacy', axis: ft.sample_band.axis, refs: [ft.sample_band.ref], matrix_code: ft.sample_band.matrix_code }] : []);
  // 记录侧自引用带＝无 matrix_code 且无 source_field；报告侧带＝matrix_code(data_matrix驱动) 或 source_field(记录原始记录表格驱动，从原始记录拉取时生成)
  const selfBands = normBands.filter(b => !b.matrix_code && !b.source_field);
  const matrixBand = normBands.find(b => b.matrix_code);
  const sourceFieldBand = normBands.find(b => b.source_field);   // 拉取生成的报告样品带（记录 free_grid 驱动）
  const bandContainsCell = (band: FreeBandT, rowId: string, colId: string): boolean => {
    const cross = band.cross_refs;
    return band.axis === 'row'
      ? band.refs.includes(rowId) && (!cross?.length || cross.includes(colId))
      : band.refs.includes(colId) && (!cross?.length || cross.includes(rowId));
  };
  const inferredSourceBinding = Object.values(cellBindings).find(b =>
    b.source === 'record_free_cell' || b.source === 'record_free_cell_sample' || b.source === 'record_free_formula_cell' || b.source === 'record_free_formula_cell_sample' || b.source === 'record_free_template_cell');
  const inheritedSourceFieldCode = ft.source_field_code || sourceFieldBand?.source_field
    || (inferredSourceBinding && 'field_code' in inferredSourceBinding ? inferredSourceBinding.field_code : undefined);
  const findRecordField = (code: string) => (linkedRecord?.groups || []).flatMap(group => group.fields || []).find(item => item.code === code);
  const matrixParameterLabel = (matrixCode: string, paramCode: string) =>
    findRecordField(matrixCode)?.matrix?.parameters.find(param => param.code === paramCode)?.label || '参数';
  const bindingShortText = (binding: CellBinding): string => {
    if (binding.source === 'literal') return binding.text || '空白';
    if (binding.source === 'record_sample_index') return '自动序号';
    if (binding.source === 'record_sample_label') return '试样名称';
    if (binding.source === 'record_field') return findRecordField(binding.field_code)?.label || '原始记录字段';
    if (binding.source === 'record_header') return matrixParameterLabel(binding.matrix_code, binding.param_code);
    if (binding.source === 'record_cell' || binding.source === 'record_cell_sample') return matrixParameterLabel(binding.matrix_code, binding.param_code);
    if (binding.source === 'record_summary') {
      const matrix = findRecordField(binding.matrix_code)?.matrix;
      return matrix?.summary_rows?.find(row => row.id === binding.row_id)?.label || '汇总结果';
    }
    if (binding.source === 'record_free_template_cell') {
      return findRecordField(binding.field_code)?.free_table?.cells?.[binding.cell_key]?.trim() || '表头文字';
    }
    if (binding.source === 'record_free_cell' || binding.source === 'record_free_cell_sample' || binding.source === 'record_free_formula_cell' || binding.source === 'record_free_formula_cell_sample') {
      const sample = binding.source === 'record_free_cell_sample' || binding.source === 'record_free_formula_cell_sample';
      const description = describeFreeGridCellSource(binding.field_code, binding.cell_key, linkedRecord, sample ? 'sample' : 'cell');
      const parts = description.split(' · ');
      return parts[parts.length - 1]?.replace(/[「」]/g, '') || '原始记录数据';
    }
    if (binding.source === 'order') return '委托单字段';
    if (binding.source === 'sample') return '样品字段';
    if (binding.source === 'test') return '检测项目字段';
    if (binding.source === 'report_meta') return '报告字段';
    if (binding.source === 'report_sample') return '样品信息';
    if (binding.source === 'system') return '系统字段';
    return '已映射';
  };

  // ─── 矩形选区（Shift 框选）──────────────────────────────────────
  const [sel, setSel] = useState<{ r0: number; c0: number; r1: number; c1: number } | null>(null);
  type GridRange = { minR: number; maxR: number; minC: number; maxC: number };
  type MergeBindingCandidate = { signature: string; key: string; binding: CellBinding; unitBinding?: CellBinding };
  const [pendingMerge, setPendingMerge] = useState<{
    range: GridRange;
    candidates: MergeBindingCandidate[];
    selectedSignature: string;
  } | null>(null);
  const range = sel && {
    minR: Math.min(sel.r0, sel.r1), maxR: Math.max(sel.r0, sel.r1),
    minC: Math.min(sel.c0, sel.c1), maxC: Math.max(sel.c0, sel.c1),
  };
  const selCount = range ? (range.maxR - range.minR + 1) * (range.maxC - range.minC + 1) : 0;
  const spanRectAt = (ri: number, ci: number): { minR: number; maxR: number; minC: number; maxC: number } => {
    const rowIdx = new Map(rows.map((r, i) => [r.id, i]));
    const colIdx = new Map(cols.map((c, i) => [c.id, i]));
    for (const [k, sp] of Object.entries(spans)) {
      const [rid, cid] = k.split('::');
      const sr = rowIdx.get(rid), sc = colIdx.get(cid);
      if (sr == null || sc == null) continue;
      const rs = Math.min(Math.max(sp?.rowspan ?? 1, 1), rows.length - sr);
      const cs = Math.min(Math.max(sp?.colspan ?? 1, 1), cols.length - sc);
      if (ri >= sr && ri < sr + rs && ci >= sc && ci < sc + cs) return { minR: sr, maxR: sr + rs - 1, minC: sc, maxC: sc + cs - 1 };
    }
    return { minR: ri, maxR: ri, minC: ci, maxC: ci };
  };
  /** 任何选区只要碰到合并格，就必须包含该合并格完整区域（行/列头选区、拖选均适用）。 */
  const expandSelectionToSpans = (selection: { r0: number; c0: number; r1: number; c1: number }) => {
    let minR = Math.min(selection.r0, selection.r1), maxR = Math.max(selection.r0, selection.r1);
    let minC = Math.min(selection.c0, selection.c1), maxC = Math.max(selection.c0, selection.c1);
    const rowIdx = new Map(rows.map((row, index) => [row.id, index]));
    const colIdx = new Map(cols.map((col, index) => [col.id, index]));
    let changed = true;
    while (changed) {
      changed = false;
      for (const [key, span] of Object.entries(spans)) {
        const [rowId, colId] = key.split('::');
        const row = rowIdx.get(rowId), col = colIdx.get(colId);
        if (row == null || col == null) continue;
        const endR = Math.min(rows.length - 1, row + Math.max(span.rowspan ?? 1, 1) - 1);
        const endC = Math.min(cols.length - 1, col + Math.max(span.colspan ?? 1, 1) - 1);
        if (endR < minR || row > maxR || endC < minC || col > maxC) continue;
        const nextMinR = Math.min(minR, row), nextMaxR = Math.max(maxR, endR);
        const nextMinC = Math.min(minC, col), nextMaxC = Math.max(maxC, endC);
        if (nextMinR !== minR || nextMaxR !== maxR || nextMinC !== minC || nextMaxC !== maxC) {
          minR = nextMinR; maxR = nextMaxR; minC = nextMinC; maxC = nextMaxC; changed = true;
        }
      }
    }
    return { r0: minR, c0: minC, r1: maxR, c1: maxC };
  };
  const selectionBetween = (anchor: GridRange, target: GridRange) => expandSelectionToSpans({
    r0: Math.min(anchor.minR, target.minR),
    c0: Math.min(anchor.minC, target.minC),
    r1: Math.max(anchor.maxR, target.maxR),
    c1: Math.max(anchor.maxC, target.maxC),
  });
  // Excel 式框选：始终按按下时的锚点与当前格重算矩形，可向任意方向扩展或回拖收缩。
  const dragAnchorRef = useRef<GridRange | null>(null);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const up = () => {
      excelDragRef.current = null;
      dragAnchorRef.current = null;
      setDragging(false);
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);
  const onCellDown = (ri: number, ci: number, e: React.MouseEvent) => {
    // 右键由 onContextMenu 处理；这里若按左键逻辑先重置选区，会让多格批量配置退化成单格。
    if (e.button !== 0) return;
    if (excelDraft) {
      e.preventDefault();
      if (keyAt(ri, ci) === excelDraft.target) return;
      const selection = formulaInsertionRange(excelDraft.text, excelCaret.start, excelCaret.end);
      excelDragRef.current = { r: ri, c: ci, text: excelDraft.text, ...selection };
      insertExcelReference(ri, ci);
      return;
    }
    if (fx) {
      e.preventDefault();
      formulaDragRef.current = { r: ri, c: ci, sources: [...fx.sources], moved: false, target: fx.target };
      selectFormulaRange(ri, ci);
      return;
    }
    if (e.shiftKey && sel) {
      const current = {
        minR: Math.min(sel.r0, sel.r1), maxR: Math.max(sel.r0, sel.r1),
        minC: Math.min(sel.c0, sel.c1), maxC: Math.max(sel.c0, sel.c1),
      };
      setSel(selectionBetween(current, spanRectAt(ri, ci)));
    }
    else {
      const sr = spanRectAt(ri, ci);
      dragAnchorRef.current = sr;
      setSel({ r0: sr.minR, c0: sr.minC, r1: sr.maxR, c1: sr.maxC });
      setDragging(true);
    }
  };
  const onCellEnter = (ri: number, ci: number, e: React.MouseEvent) => {
    if (excelDraft) { if (e.buttons === 1 && excelDragRef.current) insertExcelReference(ri, ci); return; }
    if (e.buttons === 1 && formulaDragRef.current) { selectFormulaRange(ri, ci); return; }
    // 只有按住左键且存在本次拖动锚点时才框选；从锚点重算，避免选区只能扩大不能收缩。
    const anchor = dragAnchorRef.current;
    if (e.buttons === 1 && anchor) setSel(selectionBetween(anchor, spanRectAt(ri, ci)));
  };

  // 被合并主格 span 覆盖的格（行列序号），与 renderFreeGridTypst 同口径
  const covered = (() => {
    const colIdx = new Map(cols.map((c, i) => [c.id, i]));
    const rowIdx = new Map(rows.map((r, i) => [r.id, i]));
    const s = new Set<string>();
    for (const [k, sp] of Object.entries(spans)) {
      const [rid, cid] = k.split('::');
      const ri = rowIdx.get(rid), ci = colIdx.get(cid);
      if (ri == null || ci == null) continue;
      const cs = Math.min(Math.max(sp?.colspan ?? 1, 1), cols.length - ci);
      const rs = Math.min(Math.max(sp?.rowspan ?? 1, 1), rows.length - ri);
      for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) { if (dr || dc) s.add(`${ri + dr},${ci + dc}`); }
    }
    return s;
  })();

  const repeatHeaderRows = Math.max(0, Math.min(rows.length, Math.floor(ft.repeat_header_rows || 0)));
  const setRepeatHeaderRows = (value: number) => {
    const count = Math.max(1, Math.min(rows.length, Math.floor(value || 1)));
    const rowIndex = new Map(rows.map((row, index) => [row.id, index]));
    const crossesBoundary = Object.entries(spans).some(([key, span]) => {
      const [rowId] = key.split('::');
      const start = rowIndex.get(rowId);
      if (start == null) return false;
      const end = start + Math.max(span.rowspan ?? 1, 1);
      return start < count && end > count;
    });
    if (crossesBoundary) {
      message.warning('有合并格跨越重复表头与正文的边界。请调整重复行数，或先拆分该合并格。');
      return;
    }
    update({ repeat_header_rows: count });
  };

  // ─── 行列增删 ───────────────────────────────────────────────────
  // 新增行/列时默认标记：首列的格＝表头，其余＝数字录入格（与默认表/边缘表头一致，须显式标 number 类型，否则显示「录入」而非「录入·数字」）
  const marksNewRow = (id: string) => { const hc: Record<string, true> = {}, ic: Record<string, true> = {}, ct: Record<string, 'text' | 'number' | 'choice'> = {}; cols.forEach((c, ci) => { if (ci === 0) hc[`${id}::${c.id}`] = true; else { ic[`${id}::${c.id}`] = true; ct[`${id}::${c.id}`] = 'number'; } }); return { hc, ic, ct }; };
  const marksNewCol = (id: string) => { const hc: Record<string, true> = {}, ic: Record<string, true> = {}, ct: Record<string, 'text' | 'number' | 'choice'> = {}; rows.forEach((r, ri) => { if (ri === 0) hc[`${r.id}::${id}`] = true; else { ic[`${r.id}::${id}`] = true; ct[`${r.id}::${id}`] = 'number'; } }); return { hc, ic, ct }; };
  const spansAfterInsert = (axis: 'row' | 'col', insertAt: number): FT['spans'] => {
    const rowIndex = new Map(rows.map((r, i) => [r.id, i]));
    const colIndex = new Map(cols.map((c, i) => [c.id, i]));
    const next: NonNullable<FT['spans']> = {};
    for (const [key, span] of Object.entries(spans)) {
      const [rowId, colId] = key.split('::');
      const start = axis === 'row' ? rowIndex.get(rowId) : colIndex.get(colId);
      if (start == null) continue;
      const length = axis === 'row' ? Math.max(span.rowspan ?? 1, 1) : Math.max(span.colspan ?? 1, 1);
      const inside = insertAt > start && insertAt < start + length;
      next[key] = inside
        ? axis === 'row' ? { ...span, rowspan: length + 1 } : { ...span, colspan: length + 1 }
        : span;
    }
    return next;
  };
  const bandsAfterInsert = (axis: 'row' | 'col', id: string, insertAt: number, orderedIds: string[]): FreeBandT[] =>
    normBands.map(band => {
      const isExpansionAxis = band.axis === axis;
      const members = isExpansionAxis ? band.refs : band.cross_refs;
      if (!members?.length) return band;
      const positions = members.map(ref => orderedIds.indexOf(ref)).filter(i => i >= 0);
      if (!positions.length) return band;
      const min = Math.min(...positions), max = Math.max(...positions);
      // 插在样品带成员之间时，新轴属于同一个样品单元；插在带前/后则保持普通轴。
      if (!(insertAt > min && insertAt <= max)) return band;
      const nextMembers = orderedIds.filter(ref => members.includes(ref) || ref === id);
      return isExpansionAxis ? { ...band, refs: nextMembers } : { ...band, cross_refs: nextMembers };
    });
  const coveredKeysForLayout = (
    layoutRows: FT['rows'],
    layoutCols: FT['columns'],
    layoutSpans: FT['spans'],
  ): Set<string> => {
    const rowIndex = new Map(layoutRows.map((r, i) => [r.id, i]));
    const colIndex = new Map(layoutCols.map((c, i) => [c.id, i]));
    const keys = new Set<string>();
    for (const [key, span] of Object.entries(layoutSpans || {})) {
      const [rowId, colId] = key.split('::');
      const ri = rowIndex.get(rowId), ci = colIndex.get(colId);
      if (ri == null || ci == null) continue;
      const rowspan = Math.min(Math.max(span.rowspan ?? 1, 1), layoutRows.length - ri);
      const colspan = Math.min(Math.max(span.colspan ?? 1, 1), layoutCols.length - ci);
      for (let dr = 0; dr < rowspan; dr++) for (let dc = 0; dc < colspan; dc++) {
        if (dr || dc) keys.add(`${layoutRows[ri + dr].id}::${layoutCols[ci + dc].id}`);
      }
    }
    return keys;
  };
  const insertRowAt = (insertAt: number) => {
    if (rows.length >= 50) { message.warning('已达到最大行数'); return; }
    const at = Math.max(0, Math.min(rows.length, insertAt));
    const id = `r_${Date.now()}`;
    const nextRows = [...rows.slice(0, at), { id }, ...rows.slice(at)];
    const nextSpans = spansAfterInsert('row', at);
    const patch: Partial<FT> = {
      rows: nextRows,
      spans: nextSpans,
      sample_bands: bandsAfterInsert('row', id, at, nextRows.map(r => r.id)),
      sample_band: undefined,
    };
    if (staticContentMode) {
      // 说明表格中的新增格永远是模板固定文字，不能遗留自由表格的录入/数字类型配置。
      patch.input_cells = {};
      patch.cell_types = {};
      patch.cell_options = {};
    } else if (isReportProject || !linkedRecord) {
      const marks = marksNewRow(id);
      const coveredKeys = coveredKeysForLayout(nextRows, cols, nextSpans);
      for (const key of coveredKeys) { delete marks.hc[key]; delete marks.ic[key]; delete marks.ct[key]; }
      patch.header_cells = { ...headerCells, ...marks.hc };
      if (!isReportProject) {
        patch.input_cells = { ...inputCells, ...marks.ic };
        patch.cell_types = { ...cellTypes, ...marks.ct };
      }
    }
    update(patch);
    setSel({ r0: at, c0: 0, r1: at, c1: 0 });
  };
  const insertColAt = (insertAt: number) => {
    if (cols.length >= 30) { message.warning('已达到最大列数'); return; }
    const at = Math.max(0, Math.min(cols.length, insertAt));
    const id = `c_${Date.now()}`;
    const nextCols = [...cols.slice(0, at), { id, label: '' }, ...cols.slice(at)];
    const nextSpans = spansAfterInsert('col', at);
    const patch: Partial<FT> = {
      columns: nextCols,
      spans: nextSpans,
      sample_bands: bandsAfterInsert('col', id, at, nextCols.map(c => c.id)),
      sample_band: undefined,
    };
    if (staticContentMode) {
      // 说明表格中的新增格永远是模板固定文字，不能遗留自由表格的录入/数字类型配置。
      patch.input_cells = {};
      patch.cell_types = {};
      patch.cell_options = {};
    } else if (isReportProject || !linkedRecord) {
      const marks = marksNewCol(id);
      const coveredKeys = coveredKeysForLayout(rows, nextCols, nextSpans);
      for (const key of coveredKeys) { delete marks.hc[key]; delete marks.ic[key]; delete marks.ct[key]; }
      patch.header_cells = { ...headerCells, ...marks.hc };
      if (!isReportProject) {
        patch.input_cells = { ...inputCells, ...marks.ic };
        patch.cell_types = { ...cellTypes, ...marks.ct };
      }
    }
    update(patch);
    setSel({ r0: 0, c0: at, r1: 0, c1: at });
  };

  const [dragAxis, setDragAxis] = useState<{ axis: 'row' | 'col'; index: number; start: number; end: number } | null>(null);
  const mergedAxisBlock = (axis: 'row' | 'col', index: number): { start: number; end: number } => {
    const rowIndex = new Map(rows.map((r, i) => [r.id, i]));
    const colIndex = new Map(cols.map((c, i) => [c.id, i]));
    let start = index, end = index, changed = true;
    while (changed) {
      changed = false;
      for (const [key, span] of Object.entries(spans)) {
        const [rowId, colId] = key.split('::');
        const spanStart = axis === 'row' ? rowIndex.get(rowId) : colIndex.get(colId);
        if (spanStart == null) continue;
        const length = axis === 'row' ? Math.max(span.rowspan ?? 1, 1) : Math.max(span.colspan ?? 1, 1);
        if (length <= 1) continue;
        const axisLength = axis === 'row' ? rows.length : cols.length;
        // 覆盖整条轴的合并格在排序前后仍覆盖同一批行/列，不应把整个表锁成一个不可移动块。
        if (spanStart === 0 && length >= axisLength) continue;
        const spanEnd = spanStart + length - 1;
        if (spanEnd < start || spanStart > end) continue;
        const nextStart = Math.min(start, spanStart), nextEnd = Math.max(end, spanEnd);
        if (nextStart !== start || nextEnd !== end) { start = nextStart; end = nextEnd; changed = true; }
      }
      // 样品带成员必须保持连续；拖动其中一行/列时整体移动该带，不能拆散 refs。
      const ids = axis === 'row' ? rows.map(r => r.id) : cols.map(c => c.id);
      for (const band of normBands) {
        if (band.axis !== axis) continue;
        const positions = band.refs.map(id => ids.indexOf(id)).filter(i => i >= 0);
        if (!positions.length) continue;
        const bandStart = Math.min(...positions), bandEnd = Math.max(...positions);
        if (bandEnd < start || bandStart > end) continue;
        const nextStart = Math.min(start, bandStart), nextEnd = Math.max(end, bandEnd);
        if (nextStart !== start || nextEnd !== end) { start = nextStart; end = nextEnd; changed = true; }
      }
    }
    return { start, end };
  };
  const startAxisDrag = (axis: 'row' | 'col', index: number, e: React.DragEvent) => {
    const block = mergedAxisBlock(axis, index);
    setDragAxis({ axis, index, ...block });
    e.dataTransfer.effectAllowed = 'move';
    const payload = `${axis}:${index}:${block.start}:${block.end}`;
    // dataTransfer 是跨 dragstart/drop 的稳定来源；不能只依赖可能尚未刷新的 React state。
    e.dataTransfer.setData('application/x-free-grid-axis', payload);
    e.dataTransfer.setData('text/plain', payload);
  };
  const dropAxisAt = (axis: 'row' | 'col', targetIndex: number, e: React.DragEvent) => {
    e.preventDefault();
    const payload = e.dataTransfer.getData('application/x-free-grid-axis') || e.dataTransfer.getData('text/plain');
    const match = /^(row|col):(\d+):(\d+):(\d+)$/.exec(payload);
    const transferred = match ? { axis: match[1] as 'row' | 'col', index: Number(match[2]), start: Number(match[3]), end: Number(match[4]) } : null;
    const source = dragAxis?.axis === axis ? dragAxis : transferred?.axis === axis ? transferred : null;
    if (!source) { setDragAxis(null); return; }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const after = axis === 'row' ? e.clientY >= rect.top + rect.height / 2 : e.clientX >= rect.left + rect.width / 2;
    const rawInsertAt = after ? targetIndex + 1 : targetIndex;
    const list = axis === 'row' ? rows : cols;
    const orderedBands = (orderedIds: string[]) => normBands.map(band => band.axis === axis
      ? { ...band, refs: orderedIds.filter(id => band.refs.includes(id)) }
      : band);

    // 同一个合并/试样结构块内部允许移动单行/单列。旧实现把这种放置一律当作原位，
    // 行方向常有纵向合并格，因此表现为“行完全拖不动”。
    if (rawInsertAt >= source.start && rawInsertAt <= source.end + 1) {
      if (rawInsertAt === source.index || rawInsertAt === source.index + 1) { setDragAxis(null); return; }
      const item = list[source.index];
      const rest = [...list.slice(0, source.index), ...list.slice(source.index + 1)];
      const insertAt = rawInsertAt > source.index ? rawInsertAt - 1 : rawInsertAt;
      const reordered = [...rest.slice(0, insertAt), item, ...rest.slice(insertAt)];
      const orderedIds = reordered.map(entry => entry.id);
      const positions = new Map(orderedIds.map((id, index) => [id, index]));
      const oldIds = list.map(entry => entry.id);
      const keepsStructure = Object.entries(spans).every(([key, span]) => {
        const [rowId, colId] = key.split('::');
        const masterId = axis === 'row' ? rowId : colId;
        const start = oldIds.indexOf(masterId);
        if (start < 0) return true;
        const length = axis === 'row' ? Math.max(span.rowspan ?? 1, 1) : Math.max(span.colspan ?? 1, 1);
        if (length <= 1) return true;
        const coveredIds = oldIds.slice(start, Math.min(oldIds.length, start + length));
        const nextPositions = coveredIds.map(id => positions.get(id)).filter((value): value is number => value != null).sort((a, b) => a - b);
        return nextPositions.length === coveredIds.length
          && nextPositions.every((value, index) => value === nextPositions[0] + index)
          && positions.get(masterId) === nextPositions[0];
      }) && normBands.every(band => {
        if (band.axis !== axis) return true;
        const bandPositions = band.refs.map(id => positions.get(id)).filter((value): value is number => value != null).sort((a, b) => a - b);
        return bandPositions.every((value, index) => value === bandPositions[0] + index);
      });
      if (!keepsStructure) {
        message.warning('该位置会拆开合并格或试样展开区，请拖到这一组的前面或后面，或先拆分相关合并格');
        setDragAxis(null);
        return;
      }
      update(axis === 'row'
        ? { rows: reordered as FT['rows'], sample_bands: orderedBands(orderedIds), sample_band: undefined }
        : { columns: reordered as FT['columns'], sample_bands: orderedBands(orderedIds), sample_band: undefined });
      setDragAxis(null);
      setSel(axis === 'row'
        ? { r0: insertAt, c0: 0, r1: insertAt, c1: cols.length - 1 }
        : { r0: 0, c0: insertAt, r1: rows.length - 1, c1: insertAt });
      return;
    }

    const targetBlock = mergedAxisBlock(axis, targetIndex);
    let insertAt = after ? targetBlock.end + 1 : targetBlock.start;
    const { start, end } = source;
    if (insertAt >= start && insertAt <= end + 1) { setDragAxis(null); return; }
    const block = list.slice(start, end + 1);
    const rest = [...list.slice(0, start), ...list.slice(end + 1)];
    if (insertAt > end) insertAt -= block.length;
    const reordered = [...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)];
    const orderedIds = reordered.map(item => item.id);
    const reorderedBands = orderedBands(orderedIds);
    update(axis === 'row'
      ? { rows: reordered as FT['rows'], sample_bands: reorderedBands, sample_band: undefined }
      : { columns: reordered as FT['columns'], sample_bands: reorderedBands, sample_band: undefined });
    setDragAxis(null);
    const movedStart = insertAt;
    const movedEnd = insertAt + block.length - 1;
    setSel(axis === 'row'
      ? { r0: movedStart, c0: 0, r1: movedEnd, c1: cols.length - 1 }
      : { r0: 0, c0: movedStart, r1: rows.length - 1, c1: movedEnd });
  };
  // 删除选区所在的行/列，并清掉引用被删行/列的 cells/spans/标记
  const cleanMaps = (removedKeysPredicate: (rowId: string, colId: string) => boolean) => {
    const filterMap = <T,>(m: Record<string, T>): Record<string, T> => {
      const out: Record<string, T> = {};
      for (const [k, v] of Object.entries(m)) { const [rid, cid] = k.split('::'); if (!removedKeysPredicate(rid, cid)) out[k] = v; }
      return out;
    };
    return {
      cells: filterMap(cells),
      spans: filterMap(spans),
      header_cells: filterMap(headerCells),
      input_cells: filterMap(inputCells),
      fixed_text_cells: filterMap(fixedTextCells),
      cell_rounding: filterMap(cellRounding),
      cell_styles: filterMap(cellStyles),
      cell_unit_bindings: filterMap(cellUnitBindings),
      sample_index_cells: filterMap(sampleIndexCells),
    };
  };
  // 删行/列时同步剔除样品带里引用被删行/列的 refs，空带则删除（refs 用 id，行删只命中行带、列删只命中列带）
  const pruneBands = (removed: Set<string>) => {
    const bands = ft.sample_bands?.length
      ? ft.sample_bands
      : (ft.sample_band?.ref ? [{ id: 'legacy', axis: ft.sample_band.axis, refs: [ft.sample_band.ref], matrix_code: ft.sample_band.matrix_code }] : []);
    const pruned = bands.map(b => ({ ...b, refs: b.refs.filter(r => !removed.has(r)) })).filter(b => b.refs.length);
    return { sample_bands: pruned.length ? pruned : undefined, sample_band: undefined };
  };
  const delRows = () => {
    if (!range || rows.length <= 1) { message.info('至少保留一行'); return; }
    const removed = new Set(rows.slice(range.minR, range.maxR + 1).map(r => r.id));
    if (sourceFieldBand?.axis === 'row' && [...removed].some(id => sourceFieldBand.refs.includes(id))) {
      message.info('试样结果区按行自动展开，不能删除试样样板行；如只想少显示某些结果，请删除参数列。');
      return;
    }
    update({ rows: rows.filter(r => !removed.has(r.id)), ...cleanMaps((rid) => removed.has(rid)), ...pruneBands(removed) });
    setSel(null);
  };
  const delCols = () => {
    if (!range || cols.length <= 1) { message.info('至少保留一列'); return; }
    const removed = new Set(cols.slice(range.minC, range.maxC + 1).map(c => c.id));
    if (sourceFieldBand?.axis === 'col' && [...removed].some(id => sourceFieldBand.refs.includes(id))) {
      message.info('试样结果区按列自动展开，不能删除试样样板列；如只想少显示某些结果，请删除参数行。');
      return;
    }
    update({ columns: cols.filter(c => !removed.has(c.id)), ...cleanMaps((_rid, cid) => removed.has(cid)), ...pruneBands(removed) });
    setSel(null);
  };
  // 尺寸直填：把网格调整到 N 行 / N 列（末尾增减，保留已有内容/合并/标记）
  const setRowCount = (n: number | null) => {
    const t = Math.max(1, Math.min(50, Math.round(n || 1)));
    if (t === rows.length) return;
    if (t > rows.length) {
      const add = Array.from({ length: t - rows.length }, (_, i) => ({ id: `r_${Date.now()}_${i}` }));
      const hc = { ...headerCells }, ic = { ...inputCells }, ct = { ...cellTypes };
      add.forEach(r => {
        const m = marksNewRow(r.id);
        Object.assign(hc, m.hc);
        if (!isReportProject) { Object.assign(ic, m.ic); Object.assign(ct, m.ct); }
      });
      update(staticContentMode
        ? { rows: [...rows, ...add], input_cells: {}, cell_types: {}, cell_options: {} }
        : isReportProject
          ? { rows: [...rows, ...add], header_cells: hc }
          : linkedRecord
            ? { rows: [...rows, ...add] }
            : { rows: [...rows, ...add], header_cells: hc, input_cells: ic, cell_types: ct });
    } else { const rm = new Set(rows.slice(t).map(r => r.id)); update({ rows: rows.slice(0, t), ...cleanMaps((rid) => rm.has(rid)) }); setSel(null); }
  };
  const setColCount = (n: number | null) => {
    const t = Math.max(1, Math.min(30, Math.round(n || 1)));
    if (t === cols.length) return;
    if (t > cols.length) {
      const add = Array.from({ length: t - cols.length }, (_, i) => ({ id: `c_${Date.now()}_${i}`, label: '' }));
      const hc = { ...headerCells }, ic = { ...inputCells }, ct = { ...cellTypes };
      add.forEach(c => {
        const m = marksNewCol(c.id);
        Object.assign(hc, m.hc);
        if (!isReportProject) { Object.assign(ic, m.ic); Object.assign(ct, m.ct); }
      });
      update(staticContentMode
        ? { columns: [...cols, ...add], input_cells: {}, cell_types: {}, cell_options: {} }
        : isReportProject
          ? { columns: [...cols, ...add], header_cells: hc }
          : linkedRecord
            ? { columns: [...cols, ...add] }
            : { columns: [...cols, ...add], header_cells: hc, input_cells: ic, cell_types: ct });
    } else { const rm = new Set(cols.slice(t).map(c => c.id)); update({ columns: cols.slice(0, t), ...cleanMaps((_rid, cid) => rm.has(cid)) }); setSel(null); }
  };

  // ─── 合并 / 拆分 ─────────────────────────────────────────────────
  const mergeRange = (mergeRange: GridRange, bindingToKeep?: CellBinding, unitBindingToKeep?: CellBinding) => {
    const { minR, maxR, minC, maxC } = mergeRange;
    const mainKey = keyAt(minR, minC);
    const selectedKeys: string[] = [];
    for (let ri = minR; ri <= maxR; ri++) for (let ci = minC; ci <= maxC; ci++) selectedKeys.push(keyAt(ri, ci));
    const selectedKeySet = new Set(selectedKeys);
    // 被覆盖格的所有逐格数据都必须删除，否则拆分后旧映射/公式/格式会重新出现。
    const inRange = (rid: string, cid: string) => {
      const ri = rows.findIndex(r => r.id === rid), ci = cols.findIndex(c => c.id === cid);
      return ri >= minR && ri <= maxR && ci >= minC && ci <= maxC && !(ri === minR && ci === minC);
    };
    const cleaned = cleanMaps(inRange);
    const keepMainOnly = <T,>(map: Record<string, T> | undefined): Record<string, T> => {
      const next = { ...(map || {}) };
      for (const key of selectedKeySet) if (key !== mainKey) delete next[key];
      return next;
    };
    const nextBindings = keepMainOnly(cellBindings);
    const nextUnitBindings = keepMainOnly(cellUnitBindings);
    const nextFormulas = keepMainOnly(ft.cell_formulas);
    if (bindingToKeep) {
      nextBindings[mainKey] = bindingToKeep;
      // 映射与表头/录入/公式角色互斥；来源被保留时以映射为主角色。
      delete cleaned.header_cells[mainKey];
      delete cleaned.input_cells[mainKey];
      delete cleaned.fixed_text_cells[mainKey];
      delete nextFormulas[mainKey];
    } else {
      delete nextBindings[mainKey];
    }
    if (unitBindingToKeep) nextUnitBindings[mainKey] = unitBindingToKeep;
    update({
      ...cleaned,
      spans: { ...cleaned.spans, [mainKey]: { colspan: maxC - minC + 1, rowspan: maxR - minR + 1 } },
      cell_bindings: nextBindings,
      cell_formulas: nextFormulas,
      cell_units: keepMainOnly(ft.cell_units),
      cell_types: keepMainOnly(ft.cell_types),
      cell_options: keepMainOnly(ft.cell_options),
      cell_option_allow_custom: keepMainOnly(ft.cell_option_allow_custom),
      fixed_text_cells: keepMainOnly(ft.fixed_text_cells),
      cell_unit_options: keepMainOnly(ft.cell_unit_options),
      cell_number_fmt: keepMainOnly(ft.cell_number_fmt),
      cell_rounding: keepMainOnly(ft.cell_rounding),
      cell_styles: keepMainOnly(ft.cell_styles),
      cell_unit_bindings: nextUnitBindings,
      sample_index_cells: keepMainOnly(ft.sample_index_cells),
    });
    // 保留完整合并范围。随后直接点“拆分”时，拆分后仍能一键重新合并，
    // 不需要用户重新拖选原区域。
    setSel({ r0: minR, c0: minC, r1: maxR, c1: maxC });
  };
  const mergeSel = () => {
    if (!range || selCount <= 1) { message.info('按住 Shift 点另一格，选中至少两个相邻格'); return; }
    const candidatesBySignature = new Map<string, MergeBindingCandidate>();
    for (let ri = range.minR; ri <= range.maxR; ri++) for (let ci = range.minC; ci <= range.maxC; ci++) {
      const key = keyAt(ri, ci);
      const binding = cellBindings[key];
      if (!binding) continue;
      const signature = JSON.stringify(binding);
      if (!candidatesBySignature.has(signature)) candidatesBySignature.set(signature, { signature, key, binding, unitBinding: cellUnitBindings[key] });
    }
    const candidates = [...candidatesBySignature.values()];
    if (candidates.length > 1) {
      const mainSignature = cellBindings[keyAt(range.minR, range.minC)]
        ? JSON.stringify(cellBindings[keyAt(range.minR, range.minC)])
        : candidates[0].signature;
      setPendingMerge({ range: { ...range }, candidates, selectedSignature: mainSignature });
      return;
    }
    mergeRange(range, candidates[0]?.binding, candidates[0]?.unitBinding);
  };
  const splitSel = () => {
    if (!range) return;
    const next = { ...spans };
    let changed = false;
    const nextMinR = range.minR, nextMinC = range.minC;
    let nextMaxR = range.maxR, nextMaxC = range.maxC;
    for (let ri = range.minR; ri <= range.maxR; ri++) for (let ci = range.minC; ci <= range.maxC; ci++) {
      const k = keyAt(ri, ci);
      const span = next[k];
      if (span) {
        nextMaxR = Math.max(nextMaxR, Math.min(rows.length - 1, ri + Math.max(span.rowspan ?? 1, 1) - 1));
        nextMaxC = Math.max(nextMaxC, Math.min(cols.length - 1, ci + Math.max(span.colspan ?? 1, 1) - 1));
        delete next[k];
        changed = true;
      }
    }
    if (!changed) { message.info('选区里没有合并格'); return; }
    update({ spans: next });
    setSel({ r0: nextMinR, c0: nextMinC, r1: nextMaxR, c1: nextMaxC });
  };
  const selHasMerge = !!range && (() => {
    for (let ri = range.minR; ri <= range.maxR; ri++) for (let ci = range.minC; ci <= range.maxC; ci++) {
      if (spans[keyAt(ri, ci)]) return true;
    }
    return false;
  })();

  // ─── 标记：表头 / 固定文字 / 录入格 ──────────────────────────────
  // 表头/固定文字/录入/绑定/公式 五种为【互斥角色】：设其一即清掉这些格上的其它角色
  // （修「标了录入/公式后切不到表头」——原来各标记独立，渲染时录入/公式盖过表头）
  const stripFrom = (keys: string[], keep: string): Partial<FT> => {
    const strip = <T,>(m: Record<string, T> | undefined): Record<string, T> => { const n = { ...(m || {}) }; for (const k of keys) delete n[k]; return n; };
    const current = latestFtRef.current;
    const p: any = {};
    if (keep !== 'header_cells') p.header_cells = strip(current.header_cells);
    if (keep !== 'input_cells') p.input_cells = strip(current.input_cells);
    if (keep !== 'fixed_text_cells') p.fixed_text_cells = strip(current.fixed_text_cells);
    if (keep !== 'cell_bindings') p.cell_bindings = strip(current.cell_bindings);
    if (keep !== 'cell_formulas') p.cell_formulas = strip(current.cell_formulas);
    if (keep !== 'input_cells') p.sample_index_cells = strip(current.sample_index_cells);
    return p;
  };
  const setCellText = (ri: number, ci: number, text: string) =>
    update({ cells: { ...cells, [keyAt(ri, ci)]: text } });

  // F4 键盘导航：Enter=下移，↑↓←→ 跳格（←→仅在光标到端时跳，保留文本编辑）
  const tableRef = useRef<HTMLTableElement>(null);
  const focusCell = (tr: number, tc: number) => {
    const r = Math.max(0, Math.min(rows.length - 1, tr)), c = Math.max(0, Math.min(cols.length - 1, tc));
    // 合并格任意位置都统一跳到主格；否则视觉选区已移动，但 DOM 焦点仍停在旧格。
    const rect = spanRectAt(r, c);
    setSel({ r0: rect.minR, c0: rect.minC, r1: rect.maxR, c1: rect.maxC });
    const cell = tableRef.current?.querySelector<HTMLElement>(`[data-grid-cell="${rect.minR}-${rect.minC}"]`);
    // 即使目标是录入格/公式格（没有输入控件），也要跟随选中格把画布滚到可见位置。
    revealInScrollPanes(cell);
    const el = tableRef.current?.querySelector<HTMLElement>(
      `textarea[data-gp="${rect.minR}-${rect.minC}"], input[data-gp="${rect.minR}-${rect.minC}"]`,
    );
    if (el) {
      el.focus();
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.select();
    } else {
      // 录入格/公式格在模板期没有可编辑控件：把焦点交给画布本身，继续接收方向键。
      tableRef.current?.focus();
    }
  };
  const onCellKey = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>, ri: number, ci: number) => {
    const k = e.key;
    if (k === 'F2' && !staticContentMode && !isReportProject && !fx) { e.preventDefault(); beginExcelFormula(); return; }
    if (k === '=' && !staticContentMode && !isReportProject && !fx) { e.preventDefault(); beginExcelFormula('='); return; }
    // Enter 确认并下移；上下左右四向均可跳格（编辑短值场景下不保留光标左右移动）
    if (k === 'Enter' || k === 'ArrowDown') { e.preventDefault(); focusCell(ri + 1, ci); }
    else if (k === 'ArrowUp') { e.preventDefault(); focusCell(ri - 1, ci); }
    else if (k === 'ArrowLeft') { e.preventDefault(); focusCell(ri, ci - 1); }
    else if (k === 'ArrowRight') { e.preventDefault(); focusCell(ri, ci + 1); }
  };
  const onCanvasKey = (e: React.KeyboardEvent<HTMLTableElement>) => {
    if (e.target === e.currentTarget && e.key === 'F2' && !staticContentMode && !isReportProject && !fx) {
      e.preventDefault(); beginExcelFormula(); return;
    }
    if (e.target === e.currentTarget && e.key === '=' && !staticContentMode && !isReportProject && !fx) {
      e.preventDefault(); beginExcelFormula('='); return;
    }
    if (fx) {
      if (e.key === 'Escape') { e.stopPropagation(); requestCloseFormula(); }
      e.preventDefault();
      return;
    }
    // 文字输入框已有 onCellKey；这里只处理焦点落在“录入/公式”等无输入控件的格子时。
    if (e.target !== e.currentTarget) return;
    if (!['Enter', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    // 画布焦点下彻底拦截方向键默认页面滚动；滚动只交给鼠标滚轮与上述定位逻辑。
    e.preventDefault();
    if (!range) return;
    const r = range.minR, c = range.minC;
    if (e.key === 'Enter' || e.key === 'ArrowDown') focusCell(r + 1, c);
    else if (e.key === 'ArrowUp') focusCell(r - 1, c);
    else if (e.key === 'ArrowLeft') focusCell(r, c - 1);
    else if (e.key === 'ArrowRight') focusCell(r, c + 1);
  };

  // 画布拖拽调列宽/行高（首行右缘拖=列宽，首列下缘拖=行高；存 `${pt}pt`）
  const resizeRef = useRef<null | { type: 'col' | 'row'; id: string; start: number; startSize: number; scale: number }>(null);
  const gridRef = useRef({ cols, rows, update });
  gridRef.current = { cols, rows, update };
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const rz = resizeRef.current; if (!rz) return;
      const { cols, rows, update } = gridRef.current;
      const delta = ((rz.type === 'col' ? e.clientX : e.clientY) - rz.start) / rz.scale;
      const pt = Math.max(16, Math.round((rz.startSize + delta) * 0.75));
      if (rz.type === 'col') update({ columns: cols.map(c => c.id === rz.id ? { ...c, width: `${pt}pt` } : c) });
      else update({ rows: rows.map(r => r.id === rz.id ? { ...r, height: `${pt}pt` } : r) });
    };
    const up = () => { resizeRef.current = null; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);
  const startResize = (type: 'col' | 'row', id: string, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const td = (e.currentTarget as HTMLElement).parentElement as HTMLElement;
    resizeRef.current = { type, id, start: type === 'col' ? e.clientX : e.clientY, startSize: type === 'col' ? td.offsetWidth : td.offsetHeight, scale: gridZoom / 100 };
  };

  // ─── F1 报告侧：每格绑定原始记录 ────────────────────────────────
  const [bindDirectSamples, setBindDirectSamples] = useState(false);
  const [bindWholeParameter, setBindWholeParameter] = useState(false);
  const [bindOpen, setBindOpen] = useState(false);
  const [bindKey, setBindKey] = useState<string | null>(null);
  const [bindKeys, setBindKeys] = useState<string[]>([]);
  const [bindMode, setBindMode] = useState<'normal' | 'sample-parameter'>('normal');
  const [bindInitialTarget, setBindInitialTarget] = useState<'content' | 'unit'>('content');
  const stripForBinding = (keys: string[]): Partial<FT> => {
    const patch = stripFrom(keys, 'cell_bindings');
    // 报告表头只是展示属性（灰底/表头文字格式），可以与映射共存。
    if (isReportProject) delete patch.header_cells;
    return patch;
  };
  const setCellBinding = (k: string, b: CellBinding) => {
    update({ ...stripForBinding([k]), cell_bindings: { ...cellBindings, [k]: b } });
  };
  const setCellUnitBinding = (k: string, b: CellBinding | undefined) => {
    const next = { ...cellUnitBindings };
    if (b) next[k] = b;
    else delete next[k];
    update({ cell_unit_bindings: next });
  };
  const setCellBindingAndUnit = (k: string, b: CellBinding | undefined, unit: CellBinding | undefined) => {
    const keys = bindKeys.length ? bindKeys : [k];
    if (bindDirectSamples) {
      try {
        const source = b && 'field_code' in b ? findRecordField(b.field_code) : undefined;
        if (!source || !b) throw new Error('请点击来源表的试样列号／行号');
        const patch = bindSelectedSampleRange(ft, keys, source, b);
        update({ ...stripForBinding(keys), ...patch });
        return;
      } catch (error) { message.warning((error as Error).message); return false; }
    }
    if (bindWholeParameter && sourceFieldBand && b && ['record_free_cell_sample', 'record_free_formula_cell_sample', 'record_sample_index'].includes(b.source)) {
      try {
        const source = findRecordField(sourceFieldBand.source_field || '');
        if (!source || !b) throw new Error('请选择试样参数来源');
        const mapped = sampleParameterBindings(sourceFieldBand, keys, source, b);
        const nextBindings = { ...cellBindings }, nextUnits = { ...cellUnitBindings };
        keys.forEach(key => {
          nextBindings[key] = mapped.bindings[key];
          if (mapped.units[key]) nextUnits[key] = mapped.units[key];
          else delete nextUnits[key];
        });
        update({ ...stripForBinding(keys), cell_bindings: nextBindings, cell_unit_bindings: nextUnits });
        return;
      } catch (error) { message.warning((error as Error).message); return false; }
    }
    const nextBindings = { ...cellBindings };
    const nextUnits = { ...cellUnitBindings };
    let mapped: Record<string, CellBinding>, mappedUnits: Record<string, CellBinding>;
    try {
      assertReportSampleTargets(ft, keys, b);
      assertReportSampleTargets(ft, keys, unit);
      mapped = rangeCellBindings(keys, ft, b, code => findRecordField(code)?.free_table);
      mappedUnits = rangeCellBindings(keys, ft, unit, code => findRecordField(code)?.free_table);
    } catch (error) { message.warning((error as Error).message); return false; }
    keys.forEach(key => {
      if (b) nextBindings[key] = mapped[key];
      else if (keys.length === 1) delete nextBindings[key];
      if (unit) nextUnits[key] = mappedUnits[key];
      else delete nextUnits[key];
    });
    update({ ...stripForBinding(keys), cell_bindings: nextBindings, cell_unit_bindings: nextUnits });
  };
  // 合并格/逐试样视觉合并格虽然覆盖多个物理格，用户看到并选中的是一个逻辑格，
  // 公式和报告映射都应允许把它当作单格操作。
  const selCellKey = range ? (() => {
    if (selCount === 1) return keyAt(range.minR, range.minC);
    const visual = spanRectAt(range.minR, range.minC);
    return visual.minR === range.minR && visual.maxR === range.maxR
      && visual.minC === range.minC && visual.maxC === range.maxC
      ? keyAt(range.minR, range.minC)
      : null;
  })() : null;
  const mappingCellKey = selCellKey;
  const selectedBindingKeys: string[] = [];
  if (range) for (let ri = range.minR; ri <= range.maxR; ri++) for (let ci = range.minC; ci <= range.maxC; ci++) {
    const key = keyAt(ri, ci);
    if (cellBindings[key] || cellUnitBindings[key]) selectedBindingKeys.push(key);
  }
  const activeBindKey = bindKey || mappingCellKey;

  // ─── 样品带（F2 报告侧 matrix_code / 记录侧自引用；多带·同轴，区域选择）───────────
  const recordMatrices = (linkedRecord?.groups || []).flatMap(g => g.fields || [])
    .filter((f: any) => f.type === 'data_matrix').map((f: any) => ({ code: f.code, label: f.label || f.code }));
  const reportSampleSources = (linkedRecord?.groups || []).flatMap(group => group.fields || [])
    .filter(item => item.free_table && recordSampleBands(item.free_table).length === 1);
  const [reportSampleSourceCode, setReportSampleSourceCode] = useState<string>();
  const reportSampleSource = reportSampleSources.find(item => item.code === (reportSampleSourceCode || sourceFieldBand?.source_field || inheritedSourceFieldCode)) || reportSampleSources[0];
  const sampleRegionIssues = isReportProject ? reportSampleRegionIssues(ft) : [];
  const [bandMatrixSel, setBandMatrixSel] = useState<string | undefined>(undefined);
  const bandMatrix = bandMatrixSel || matrixBand?.matrix_code || recordMatrices[0]?.code;
  const selRowId = range ? rows[range.minR]?.id : null;
  const selColId = range ? cols[range.minC]?.id : null;
  // 报告侧：单矩阵带（选中格所在行/列，报告按矩阵样品数展开）
  const setBand = (axis: 'row' | 'col') => {
    const ref = axis === 'row' ? selRowId : selColId;
    if (!ref || !bandMatrix) { message.info('先选中带内一个格，并选择「样品来源矩阵」'); return; }
    update({ sample_bands: [{ id: 'matrix', axis, refs: [ref], matrix_code: bandMatrix }], sample_band: undefined });
  };
  // 记录侧：框选试样区（数据格 + 共享表头一起选）→ 自动检测轴 + 可确认 → 多区域同轴
  const [pendingBand, setPendingBand] = useState<{ minR: number; maxR: number; minC: number; maxC: number; axis: 'row' | 'col' } | null>(null);
  const rowAllHeader = (ri: number, c0: number, c1: number) => { for (let ci = c0; ci <= c1; ci++) if (!headerCells[keyAt(ri, ci)]) return false; return true; };
  const colAllHeader = (ci: number, r0: number, r1: number) => { for (let ri = r0; ri <= r1; ri++) if (!headerCells[keyAt(ri, ci)]) return false; return true; };
  // 自动检测：选区顶行全表头→按行展开；左列全表头→按列展开（默认行）
  const guessAxis = (rg: { minR: number; maxR: number; minC: number; maxC: number }): 'row' | 'col' =>
    (colAllHeader(rg.minC, rg.minR, rg.maxR) && !rowAllHeader(rg.minR, rg.minC, rg.maxC)) ? 'col' : 'row';
  // 试样单元成员 = 选区内“非表头”的行/列（表头是共享固定部分，排除）；全表头则取整选区
  const bandRefsOf = (rg: { minR: number; maxR: number; minC: number; maxC: number }, axis: 'row' | 'col'): string[] => {
    if (axis === 'row') {
      const rr: string[] = [];
      for (let ri = rg.minR; ri <= rg.maxR; ri++) if (!rowAllHeader(ri, rg.minC, rg.maxC)) rr.push(rows[ri].id);
      return rr.length ? rr : rows.slice(rg.minR, rg.maxR + 1).map(r => r.id);
    }
    const cc: string[] = [];
    for (let ci = rg.minC; ci <= rg.maxC; ci++) if (!colAllHeader(ci, rg.minR, rg.maxR)) cc.push(cols[ci].id);
    return cc.length ? cc : cols.slice(rg.minC, rg.maxC + 1).map(c => c.id);
  };
  const startSampleBand = () => {
    if (!range) { message.info('先框选需要随试样重复的数据格；表头无需选择，会保持共享固定'); return; }
    if (!isReportProject && selfBands.length) {
      Modal.warning({
        title: '本表只能设置一个试样区域',
        content: `当前已有试样区域 ${describeSelfBandRange(selfBands[0])}。如需改为刚才选择的区域，请先点击已有试样区域右侧的“移除”，再重新框选设置；移除区域不会删除表格内容。`,
        okText: '知道了',
      });
      return;
    }
    const axis = isReportProject && reportSampleSource?.free_table ? recordSampleBands(reportSampleSource.free_table)[0].axis : guessAxis(range);
    setPendingBand({ minR: range.minR, maxR: range.maxR, minC: range.minC, maxC: range.maxC, axis });
  };
  const describeSelfBandRange = (band: FreeBandT) => {
    const bandRows = band.axis === 'row' ? band.refs : (band.cross_refs || rows.map(row => row.id));
    const bandCols = band.axis === 'row' ? (band.cross_refs || cols.map(col => col.id)) : band.refs;
    const rowIndexes = bandRows.map(id => rows.findIndex(row => row.id === id)).filter(index => index >= 0);
    const colIndexes = bandCols.map(id => cols.findIndex(col => col.id === id)).filter(index => index >= 0);
    if (!rowIndexes.length || !colIndexes.length) return '已选区域';
    const minRow = Math.min(...rowIndexes), maxRow = Math.max(...rowIndexes);
    const minCol = Math.min(...colIndexes), maxCol = Math.max(...colIndexes);
    return `${excelColumnName(minCol)}${minRow + 1}:${excelColumnName(maxCol)}${maxRow + 1}`;
  };
  const confirmSampleBand = () => {
    if (!pendingBand) return;
    if (!isReportProject && selfBands.length) {
      Modal.warning({
        title: '无法添加第二个试样区域',
        content: `本表已有试样区域 ${describeSelfBandRange(selfBands[0])}。请先移除原区域，再设置新区域。`,
        okText: '知道了',
      });
      setPendingBand(null);
      return;
    }
    const refs = bandRefsOf(pendingBand, pendingBand.axis);
    const crossRefs = pendingBand.axis === 'row'
      ? cols.slice(pendingBand.minC, pendingBand.maxC + 1).map(col => col.id)
      : rows.slice(pendingBand.minR, pendingBand.maxR + 1).map(row => row.id);
    const overlaps = selfBands.some(b => b.axis === pendingBand.axis
      && refs.some(ref => b.refs.includes(ref))
      && crossRefs.some(ref => !b.cross_refs?.length || b.cross_refs.includes(ref)));
    if (!isReportProject && overlaps) { message.warning('该区与已有试样区重叠，请重新框选'); return; }
    if (isReportProject) {
      try {
        if (!reportSampleSource) throw new Error('关联原始记录中尚无试样区域，请先在原始记录模板设置');
        const band = createReportSampleRegion(ft, reportSampleSource, refs, crossRefs);
        update({ sample_bands: [band], sample_band: undefined });
      } catch (error) { message.warning((error as Error).message); return; }
    } else update({ sample_bands: [{ id: `sb_${Date.now()}`, axis: pendingBand.axis, refs, cross_refs: crossRefs }], sample_band: undefined });
    setPendingBand(null); setSel(null);
    message.success(isReportProject ? '已关联试样区域，可以按参数绑定试样列／行' : '已设置试样区域，试录时可在表格上方新增试样');
  };
  const removeSelfBand = (id: string) => {
    // 从完整带配置中移除，避免工具栏过滤后的 selfBands 覆盖报告/来源带，
    // 同时将旧版 sample_band 迁移为新的 sample_bands 结构。
    const next = normBands.filter(b => b.id !== id);
    update({ sample_bands: next.length ? next : undefined, sample_band: undefined });
    message.success('已移除试样区');
  };
  const cellInBand = (k: string | null): boolean => {
    if (!k) return false;
    const [rid, cid] = k.split('::');
    return normBands.some(b => bandContainsCell(b, rid, cid));
  };
  const canUseSampleSeries = (k: string | null): boolean => !!k && !!sourceFieldBand
    && !!sampleBandForCell({ ...ft, sample_band: undefined,
      sample_bands: [{ id: sourceFieldBand.id, axis: sourceFieldBand.axis, refs: sourceFieldBand.refs, cross_refs: sourceFieldBand.cross_refs }] }, k);
  const isSampleBinding = (binding: CellBinding | undefined) =>
    binding?.source === 'record_free_cell_sample' || binding?.source === 'record_free_formula_cell_sample' || binding?.source === 'record_sample_index';
  const parameterRowIds = new Set<string>();
  const parameterColIds = new Set<string>();
  if (sourceFieldBand) {
    for (const [key, binding] of Object.entries(cellBindings)) {
      if (!isSampleBinding(binding) || !canUseSampleSeries(key)) continue;
      const [rowId, colId] = key.split('::');
      if (sourceFieldBand.axis === 'col') parameterRowIds.add(rowId);
      else parameterColIds.add(colId);
    }
  }
  const isLockedSampleResultCell = (k: string | null): boolean => {
    if (!k || !canUseSampleSeries(k)) return false;
    const binding = cellBindings[k];
    // 报告表头可与逐试样映射共存；灰色表头属性不能拆散其视觉合并。
    return isSampleBinding(binding);
  };
  const selectedHasLockedSampleResult = !!range && (() => {
    for (let ri = range.minR; ri <= range.maxR; ri++) {
      for (let ci = range.minC; ci <= range.maxC; ci++) {
        if (isLockedSampleResultCell(keyAt(ri, ci))) return true;
      }
    }
    return false;
  })();
  const openDirectSampleBinding = () => {
    const keys = editSelKeys.filter(key => !headerCells[key]);
    if (!keys.length) { message.info('请框选试样数据格，不包含固定表头'); return; }
    setBindDirectSamples(true);
    setBindWholeParameter(false);
    setBindKeys(keys);
    setBindKey(keys[0]);
    setBindInitialTarget('content');
    setBindOpen(true);
  };
  const openParameterBinding = () => {
    setBindDirectSamples(false);
    if (!parameterKeys.length) return;
    setBindWholeParameter(true);
    setBindKeys(parameterKeys);
    setBindKey(parameterKeys[0]);
    setBindMode('sample-parameter');
    setBindInitialTarget('content');
    setBindOpen(true);
  };
  const openBindingForSelectedCell = (target: 'content' | 'unit' = 'content') => {
    setBindDirectSamples(false);
    setBindWholeParameter(false);
    const key = bindingSelectionKeys[0];
    if (!key) return;
    setBindKeys([...bindingSelectionKeys]);
    setBindMode(canUseSampleSeries(key) ? 'sample-parameter' : 'normal');
    setBindInitialTarget(target);
    setBindKey(key);
    setBindOpen(true);
  };
  const clearSelectedBindings = () => {
    if (!selectedBindingKeys.length) return;
    const clear = () => {
      const next = { ...cellBindings };
      const nextUnits = { ...cellUnitBindings };
      selectedBindingKeys.forEach(key => delete next[key]);
      selectedBindingKeys.forEach(key => delete nextUnits[key]);
      update({ cell_bindings: next, cell_unit_bindings: nextUnits });
      // Clearing a source leaves the actual merge geometry and selection intact.
    };
    if (selectedBindingKeys.length === 1) { clear(); return; }
    Modal.confirm({
      title: `清除所选区域中的 ${selectedBindingKeys.length} 个映射？`,
      content: '清除后这些格子将恢复为未映射状态。',
      okText: '清除映射',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: clear,
    });
  };
  const clearSingleBindingPart = (k: string, part: 'content' | 'unit') => {
    const visual = spanRectAt(rows.findIndex(row => row.id === k.split('::')[0]), cols.findIndex(col => col.id === k.split('::')[1]));
    const keys: string[] = [];
    for (let ri = visual.minR; ri <= visual.maxR; ri++) for (let ci = visual.minC; ci <= visual.maxC; ci++) keys.push(keyAt(ri, ci));
    if (part === 'content') {
      const next = { ...cellBindings };
      keys.forEach(key => delete next[key]);
      update({ cell_bindings: next });
      } else {
      const next = { ...cellUnitBindings };
      keys.forEach(key => delete next[key]);
      update({ cell_unit_bindings: next });
    }
  };
  const openBindingAtCell = (ri: number, ci: number) => {
    setBindDirectSamples(false);
    setBindWholeParameter(false);
    const k = keyAt(ri, ci);
    setBindKeys([k]);
    setSel({ r0: ri, c0: ci, r1: ri, c1: ci });
    setBindMode(canUseSampleSeries(k) ? 'sample-parameter' : 'normal');
    setBindInitialTarget('content');
    setBindKey(k);
    setBindOpen(true);
  };
  // ─── F3 每格公式（预设公式 + 点格插入的自定义公式）────────────────────
  const cellFx = staticContentMode ? {} : (ft.cell_formulas || {});
  const FX_LABELS: Record<string, string> = {
    average: '平均',
    sum: '求和',
    max: '最大',
    min: '最小',
    custom: '自定义',
  };
  type VisualCondition = { operator: '>=' | '>' | '<=' | '<' | '==' | '!='; value: number };
  type FxDraft = {
    target: string;
    type: string;
    sources: string[];
    followSamples: boolean;
    op?: string;
    threshold?: number;
    visualMode: 'calculation' | 'condition';
    operators: string[];
    factor: number;
    offset: number;
    conditions: VisualCondition[];
    logic: 'all' | 'any';
    pass: string;
    fail: string;
    expression: string;
    testValues: Record<string, number | null>;
  };
  const [fx, setFx] = useState<FxDraft | null>(null);
  const formulaDragRef = useRef<{ r: number; c: number; sources: string[]; moved: boolean; target: string; blocked?: boolean } | null>(null);
  const [formulaPanelBounds, setFormulaPanelBounds] = useState({ left: 16, width: 600, bottom: 12 });
  const [formulaHost, setFormulaHost] = useState<HTMLElement | null>(null);
  const formulaPanelRef = useRef<HTMLElement | null>(null);
  const [formulaPanelHeight, setFormulaPanelHeight] = useState(0);
  const formulaInitialDraft = useRef('');
  const [formulaDetails, setFormulaDetails] = useState(false);
  function requestCloseFormula() {
    const close = () => { formulaDragRef.current = null; setFx(null); setFormulaLibraryOpen(false); };
    if (fx && JSON.stringify(fx) !== formulaInitialDraft.current) {
      Modal.confirm({ title: '放弃未应用的公式修改？', content: '原有公式不会改变。', okText: '放弃修改', cancelText: '继续编辑', zIndex: 1200, onOk: close });
    } else close();
  }
  function selectFormulaRange(r: number, c: number) {
    const drag = formulaDragRef.current;
    if (!drag) return;
    drag.moved ||= r !== drag.r || c !== drag.c;
    const keys = formulaRangeKeys(ft, drag, { r, c });
    drag.blocked = keys.includes(drag.target);
    // Always derive from the mouse-down snapshot: repeated mousemove/auto-scroll
    // events must not toggle the same cell repeatedly. Dragging adds a rectangle;
    // a single-cell click toggles only that cell and preserves disjoint sources.
    const sources = drag.blocked ? drag.sources
      : !drag.moved && keys.length === 1 && drag.sources.includes(keys[0])
        ? drag.sources.filter(source => source !== keys[0])
        : [...new Set([...drag.sources, ...keys])];
    setFx(current => current && !(sources.length === current.sources.length && sources.every((s, i) => current.sources[i] === s)) ? { ...current, sources,
      conditions: sources.map(s => current.conditions[current.sources.indexOf(s)] || { operator: '>=', value: 0 }),
      operators: sources.slice(1).map((_, i) => current.operators[i] || '+'),
    } : current);
  }
  const rangePickerRef = useRef(selectFormulaRange);
  rangePickerRef.current = selectFormulaRange;
  useEffect(() => {
    if (!fx) return;
    const position = () => {
      const host = tableRef.current?.closest<HTMLElement>('.ant-drawer-section, .ant-drawer-content') || null;
      setFormulaHost(host);
      const rect = tableRef.current?.parentElement?.getBoundingClientRect();
      const hostRect = host?.getBoundingClientRect();
      const left = Math.max(8, (rect?.left || 16) - (hostRect?.left || 0));
      const width = Math.max(0, Math.min(rect?.width || 600, (host?.clientWidth || window.innerWidth) - left - 8));
      const footer = host?.querySelector('.ant-drawer-footer')?.getBoundingClientRect().height || 0;
      const bottom = footer + 8;
      setFormulaPanelBounds(previous => previous.left === left && previous.width === width && previous.bottom === bottom ? previous : { left, width, bottom });
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    const observer = new ResizeObserver(position);
    if (tableRef.current?.parentElement) observer.observe(tableRef.current.parentElement);
    return () => { observer.disconnect(); window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); };
  }, [!!fx]);
  useEffect(() => {
    if (!fx || !formulaHost) return;
    formulaHost.classList.add('free-grid-formula-host');
    return () => formulaHost.classList.remove('free-grid-formula-host');
  }, [!!fx, formulaHost]);
  useEffect(() => {
    if (!fx || !formulaPanelRef.current) { setFormulaPanelHeight(0); return; }
    const panel = formulaPanelRef.current;
    const measure = () => setFormulaPanelHeight(panel.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure); observer.observe(panel);
    return () => observer.disconnect();
  }, [!!fx, formulaHost]);
  useEffect(() => {
    let frame = 0;
    let pointer = { x: 0, y: 0 };
    const tick = () => {
      if (!formulaDragRef.current) return;
      let node = tableRef.current?.parentElement;
      while (node) {
        const rect = node.getBoundingClientRect();
        const overflow = getComputedStyle(node);
        if (/(auto|scroll)/.test(overflow.overflowY) && node.scrollHeight > node.clientHeight) {
          const panelTop = document.querySelector('[aria-label="公式编辑面板"]')?.getBoundingClientRect().top ?? window.innerHeight;
          const bottom = Math.min(rect.bottom, panelTop);
          node.scrollTop += pointer.y > bottom - 28 ? 16 : pointer.y < rect.top + 28 ? -16 : 0;
        }
        if (/(auto|scroll)/.test(overflow.overflowX) && node.scrollWidth > node.clientWidth) node.scrollLeft += pointer.x > rect.right - 28 ? 16 : pointer.x < rect.left + 28 ? -16 : 0;
        node = node.parentElement;
      }
      const hit = document.elementFromPoint(pointer.x, pointer.y)?.closest('[data-grid-cell]');
      if (hit && tableRef.current?.contains(hit)) {
        const [r, c] = (hit.getAttribute('data-grid-cell') || '').split('-').map(Number);
        if (Number.isFinite(r) && Number.isFinite(c)) rangePickerRef.current(r, c);
      }
      frame = requestAnimationFrame(tick);
    };
    const move = (event: MouseEvent) => { pointer = { x: event.clientX, y: event.clientY }; if (formulaDragRef.current && !frame) frame = requestAnimationFrame(tick); };
    const up = () => { if (formulaDragRef.current?.blocked) message.warning('引用区域不能包含公式目标格，请重新选择'); formulaDragRef.current = null; cancelAnimationFrame(frame); frame = 0; };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up); window.addEventListener('blur', up);
    return () => { up(); window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); window.removeEventListener('blur', up); };
  }, []);
  const [fxSourceTableCode, setFxSourceTableCode] = useState(field.code);
  const [sourceAddress, setSourceAddress] = useState('');
  const addAddressSources = () => {
    const sourceTable = sourceFieldOf(fxSourceTableCode)?.free_table;
    if (!fx || !sourceTable) return;
    try {
      const keys = formulaAddressKeys(sourceTable, sourceAddress);
      if (!keys.length) { message.info('该区域没有可用来源，请选择非表头格'); return; }
      if (fxSourceTableCode === field.code && keys.includes(fx.target)) { message.warning('来源区域不能包含结果格'); return; }
      const added = keys.map(key => fxSourceTableCode === field.code ? key : encodeFreeGridCellReference(fxSourceTableCode, key));
      setFx(current => {
        if (!current) return current;
        const sources = [...new Set([...current.sources, ...added])];
        return { ...current, sources, operators: sources.slice(1).map((_, i) => current.operators[i] || '+'), conditions: sources.map((_, i) => current.conditions[i] || { operator: '>=', value: 0 }) };
      });
      setSourceAddress('');
    } catch (error) { message.warning((error as Error).message); }
  };
  const [formulaLibraryOpen, setFormulaLibraryOpen] = useState(false);
  const [libraryItemName, setLibraryItemName] = useState<string | null>(null);
  const [formulaLibrarySearch, setFormulaLibrarySearch] = useState('');
  const [formulaJoinOperator, setFormulaJoinOperator] = useState<'+' | '-' | '*' | '/'>('+');
  const formulaSelectionRef = useRef({ start: 0, end: 0 });
  /** 公式显示格式：单格 > 整表；均未配置时保持原精度。 */
  const formulaFormatForTarget = (target: string) => ft.cell_number_fmt?.[target] || ft.default_number_fmt;
  const formulaPrecisionText = (target: string) => {
    const fmt = formulaFormatForTarget(target);
    const rounding = ft.cell_rounding?.[target] || ft.default_rounding;
    const roundingText = rounding ? `先${numericRoundingLabel(rounding)}，` : '不修约，';
    if (fmt?.mode === 'none') return `${roundingText}不额外格式化显示`;
    if (!fmt) return `${roundingText}不额外格式化显示`;
    if (fmt.mode === 'decimals') return `${roundingText}再显示 ${fmt.digits} 位小数`;
    if (fmt.mode === 'scientific') return `${roundingText}再用科学计数法显示（${fmt.digits} 位）`;
    return `${roundingText}再显示 ${fmt.digits} 位有效数字`;
  };
  function toggleFxSource(key: string, sourceFieldCode = field.code) {
    const sourceField = sourceFieldOf(sourceFieldCode);
    const sourceTable = sourceField?.free_table;
    if (sourceTable?.header_cells?.[key]) {
      message.info('表头是固定标签，不能作为公式来源；请选择录入格、公式格或固定数值格');
      return;
    }
    const source = sourceFieldCode === field.code ? key : encodeFreeGridCellReference(sourceFieldCode, key);
    setFx(current => {
      if (!current || (sourceFieldCode === field.code && key === current.target)) return current;
      const index = current.sources.indexOf(source);
      if (index >= 0) {
        const sources = current.sources.filter((_, i) => i !== index);
        const conditions = current.conditions.filter((_, i) => i !== index);
        const operators = current.operators.filter((_, i) => i !== Math.max(0, index - 1)).slice(0, Math.max(0, sources.length - 1));
        return { ...current, sources, conditions, operators };
      }
      return {
        ...current,
        sources: [...current.sources, source],
        conditions: [...current.conditions, { operator: '>=', value: 0 }],
        operators: current.sources.length ? [...current.operators, '+'] : current.operators,
      };
    });
  }
  const [excelDraft, setExcelDraft] = useState<{ target: string; text: string } | null>(null);
  const [gridZoom, setGridZoom] = useState(100);
  const [functionBrowserOpen, setFunctionBrowserOpen] = useState(false);
  const [functionSearch, setFunctionSearch] = useState('');
  const [excelFocused, setExcelFocused] = useState(false);
  const completionListRef = useRef<HTMLDivElement>(null);
  const originalExcelText = useRef('');
  const excelInputRef = useRef<import('antd').InputRef>(null);
  const [excelCaret, setExcelCaret] = useState({ start: 0, end: 0 });
  const [completionIndex, setCompletionIndex] = useState(0);
  const excelDragRef = useRef<{ r: number; c: number; text: string; start: number; end: number } | null>(null);
  const moveExcelCaret = (position: number) => {
    setExcelCaret({ start: position, end: position });
    requestAnimationFrame(() => {
      excelInputRef.current?.focus();
      excelInputRef.current?.input?.setSelectionRange(position, position);
    });
  };
  const insertExcelReference = (r: number, c: number) => {
    const drag = excelDragRef.current;
    if (!drag || !excelDraft) return;
    const a = cellAddress(keyAt(Math.min(r, drag.r), Math.min(c, drag.c)));
    const b = cellAddress(keyAt(Math.max(r, drag.r), Math.max(c, drag.c)));
    const address = a === b ? a : `${a}:${b}`;
    setExcelDraft({ ...excelDraft, text: drag.text.slice(0, drag.start) + address + drag.text.slice(drag.end) });
    moveExcelCaret(drag.start + address.length);
  };
  const completion = excelDraft && excelCaret.start === excelCaret.end ? formulaCompletion(excelDraft.text, excelCaret.start) : null;
  useEffect(() => {
    revealInScrollPanes(completionListRef.current?.querySelector<HTMLElement>('[aria-selected="true"]'));
  }, [completionIndex, completion?.options.join('|')]);
  const completeFunction = (name: string) => {
    if (!excelDraft || !completion) return;
    const suffix = excelDraft.text.slice(completion.end);
    const insert = name + (/^\s*\(/.test(suffix) ? '' : '(');
    setExcelDraft({ ...excelDraft, text: excelDraft.text.slice(0, completion.start) + insert + suffix });
    setCompletionIndex(0);
    moveExcelCaret(completion.start + insert.length);
  };
  const beginExcelFormula = (text?: string) => {
    if (isReportProject) return;
    if (!selCellKey || fx) return;
    const existing = displayGridFormula(ft, cellFx[selCellKey]);
    const original = existing ?? formulaText(cellFx[selCellKey]);
    const draft = text ?? (original || '=');
    originalExcelText.current = original;
    setExcelDraft({ target: selCellKey, text: draft });
    setExcelFocused(true);
    moveExcelCaret(draft.length);
  };
  let excelSources: string[] = [];
  if (excelDraft) {
    try { excelSources = compileGridFormula(ft, excelDraft.text).sources; }
    catch {
      // Highlight references while parentheses/arguments are still being typed.
      for (const match of maskFormulaStrings(excelDraft.text).matchAll(/\b[A-Za-z]+[1-9]\d*(?:\s*:\s*[A-Za-z]+[1-9]\d*)?\b(?!\s*\()/g)) {
        try { excelSources.push(...compileGridFormula(ft, `SUM(${match[0]})`).sources); } catch { /* invalid/out-of-bounds address */ }
      }
    }
  }
  const applyExcelFormula = () => {
    if (!excelDraft) return;
    try {
      if (cellFx[excelDraft.target] && excelDraft.text === originalExcelText.current) {
        setExcelDraft(null); excelDragRef.current = null; tableRef.current?.focus(); return;
      }
      const [targetRow, targetCol] = excelDraft.target.split('::');
      if (!ft.rows.some(row => row.id === targetRow) || !ft.columns.some(col => col.id === targetCol)) {
        throw new Error('目标格已被删除，请按 Esc 取消并重新选择');
      }
      const formula = compileGridFormula(ft, excelDraft.text);
      const previous = cellFx[excelDraft.target];
      // Retain dynamic sample semantics when editing a legacy simple aggregate.
      const aggregateNames: Record<string, string> = { sum: 'SUM', average: 'AVERAGE', min: 'MIN', max: 'MAX' };
      const previousName = previous && aggregateNames[previous.type];
      let formulaToSave: Formula = formula;
      if (previousName) {
        if (new RegExp(`^${previousName}\\(v\\d+(?:\\s*,\\s*v\\d+)*\\)$`, 'i').test(formula.expression!.replace(/\s/g, ''))) {
          formulaToSave = { ...previous, sources: formula.sources };
        } else if (previous.sample_scope !== 'selected') {
          throw new Error('此公式随试样数量变化。请保留原聚合函数修改来源，避免丢失动态试样关系');
        }
      }
      const target = `${field.code}::${excelDraft.target}`;
      const visitsTarget = (source: string, owner: string, seen = new Set<string>()): boolean => {
        const ref = resolveFreeGridCellReference(source, owner);
        const node = `${ref.fieldCode}::${ref.cellKey}`;
        if (node === target) return true;
        if (seen.has(node)) return false;
        seen.add(node);
        return (sourceFieldOf(ref.fieldCode)?.free_table?.cell_formulas?.[ref.cellKey]?.sources || [])
          .some(child => visitsTarget(child, ref.fieldCode, seen));
      };
      if (formula.sources.some(source => visitsTarget(source, field.code))) throw new Error('公式不能直接或间接引用自身');
      update({ cell_formulas: { ...cellFx, [excelDraft.target]: formulaToSave }, ...stripFrom([excelDraft.target], 'cell_formulas') });
      setExcelDraft(null);
      excelDragRef.current = null;
      tableRef.current?.focus();
    } catch (error) { message.warning(error instanceof Error ? error.message : '公式无效'); }
  };
  const openFx = () => {
    if (!selCellKey) return;
    const cur: any = cellFx[selCellKey];
    const sourceCount = cur?.sources?.length || 0;
    const savedConditions = Array.isArray(cur?.params?.conditions) ? cur.params.conditions : [];
    const draft: FxDraft = cur
      ? {
          target: selCellKey,
          // 旧版“可视化计算”只保留运行兼容；再次编辑时统一迁移到自定义公式。
          type: cur.type === 'visual' ? 'custom' : cur.type,
          sources: cur.sources || [],
          followSamples: cur.sample_scope !== 'selected',
          op: cur.params?.operator,
          threshold: cur.params?.threshold,
          visualMode: cur.params?.visual_mode === 'condition' ? 'condition' : 'calculation',
          operators: Array.from({ length: Math.max(0, sourceCount - 1) }, (_, index) => cur.params?.operators?.[index] || '+'),
          factor: Number(cur.params?.factor ?? 1),
          offset: Number(cur.params?.offset ?? 0),
          conditions: Array.from({ length: sourceCount }, (_, index) => ({
            operator: savedConditions[index]?.operator || '>=',
            value: Number(savedConditions[index]?.value ?? 0),
          })),
          logic: cur.params?.logic === 'any' ? 'any' : 'all',
          pass: String(cur.params?.pass ?? '合格'),
          fail: String(cur.params?.fail ?? '不合格'),
          expression: String(cur.expression ?? ''),
          testValues: {},
        }
      : {
          target: selCellKey, type: 'sum', sources: [], followSamples: true,
          visualMode: 'calculation', operators: [], factor: 1, offset: 0,
          conditions: [], logic: 'all', pass: '合格', fail: '不合格',
          expression: '', testValues: {},
        };
    formulaInitialDraft.current = JSON.stringify(draft);
    // All entry points now edit in the formula bar, never open the old card.
    beginExcelFormula();
    setCtxCard(null);
    setFormulaDetails(draft.type === 'custom');
    setFxSourceTableCode(field.code);
    setSourceAddress('');
    setLibraryItemName(null);
  };
  const saveFx = () => {
    if (!fx) return;
    if (!ft.rows.some(row => row.id === fx.target.split('::')[0]) || !ft.columns.some(col => col.id === fx.target.split('::')[1])) {
      message.warning('目标格已被删除，请取消并重新选择公式格'); return;
    }
    if (['average', 'sum', 'max', 'min'].includes(fx.type) && !fx.followSamples && fx.sources.some(source => resolveFreeGridCellReference(source, field.code).fieldCode !== field.code)) {
      message.warning('固定试样范围暂仅支持当前表格，请移除跨表来源或开启随试样增减'); return;
    }
    if (!fx.sources.length && fx.type !== 'custom') { message.info('请在表格中选择来源格'); return; }
    const targetNode = `${field.code}::${fx.target}`;
    const reachesTarget = (source: string, ownerFieldCode: string, seen = new Set<string>()): boolean => {
      const reference = resolveFreeGridCellReference(source, ownerFieldCode);
      const node = `${reference.fieldCode}::${reference.cellKey}`;
      if (node === targetNode) return true;
      if (seen.has(node)) return false;
      seen.add(node);
      const sourceFormula = sourceFieldOf(reference.fieldCode)?.free_table?.cell_formulas?.[reference.cellKey];
      return (sourceFormula?.sources || []).some(next => reachesTarget(next, reference.fieldCode, seen));
    };
    if (fx.sources.some(source => reachesTarget(source, field.code))) {
      message.error(`检测到循环引用：${cellAddress(fx.target)} 间接引用了自身，请调整来源格`);
      return;
    }
    const f: any = { type: fx.type, sources: fx.sources };
    if (['average', 'sum', 'max', 'min'].includes(fx.type)) f.sample_scope = fx.followSamples ? 'all' : 'selected';
    if (fx.type === 'visual') {
      if (fx.visualMode === 'calculation') {
        if (fx.operators.some(operator => !['+', '-', '*', '/'].includes(operator))) {
          message.warning('自定义计算中存在无效运算符');
          return;
        }
        f.params = {
          visual_mode: 'calculation',
          operators: fx.operators.slice(0, Math.max(0, fx.sources.length - 1)),
          factor: Number.isFinite(fx.factor) ? fx.factor : 1,
          offset: Number.isFinite(fx.offset) ? fx.offset : 0,
        };
      } else {
        if (fx.conditions.length < fx.sources.length || fx.conditions.some(condition => !Number.isFinite(condition.value))) {
          message.warning('请为每个来源格填写完整的判定条件');
          return;
        }
        f.params = {
          visual_mode: 'condition',
          conditions: fx.conditions.slice(0, fx.sources.length),
          logic: fx.logic,
          pass: fx.pass || '合格',
          fail: fx.fail || '不合格',
        };
      }
    }
    if (fx.type === 'custom') {
      const normalizedExpression = fx.expression.trim().replace(/^=\s*/, '');
      if (!normalizedExpression) { message.info('请输入公式；可点击下方来源格变量插入'); return; }
      f.expression = normalizedExpression;
      f.params = {
        ...(cellFx[fx.target]?.params?.expression_dialect === 'excel_v1' ? { expression_dialect: 'excel_v1' } : {}),
        source_aliases: Object.fromEntries(fx.sources.map(source => [source, sourceInfo(source).alias])),
        source_labels: Object.fromEntries(fx.sources.map(source => [source, sourceInfo(source).label])),
      };
    }
    update({ cell_formulas: { ...cellFx, [fx.target]: f }, ...stripFrom([fx.target], 'cell_formulas') });
    setFx(null);
  };
  /** 试算只要求填写最底层数据格；直接来源若也是公式格，就按其公式继续展开并以全精度重算。 */
  const trialLeafSources = (() => {
    if (!fx) return [] as string[];
    const leaves: string[] = [];
    const seen = new Set<string>();
    const walk = (source: string, ownerFieldCode: string) => {
      const info = sourceInfoFor(source, ownerFieldCode);
      const node = `${info.fieldCode}::${info.cellKey}`;
      if (seen.has(node)) return;
      seen.add(node);
      const nested = info.sourceField?.free_table?.cell_formulas?.[info.cellKey];
      if (nested) (nested.sources || []).forEach(child => walk(child, info.fieldCode));
      else leaves.push(canonicalSource(source, ownerFieldCode));
    };
    fx.sources.forEach(source => walk(source, field.code));
    return leaves;
  })();
  const visualFormulaPreview = (() => {
    if (!fx || (!fx.sources.length && fx.type !== 'custom')) return null;
    const params = fx.visualMode === 'calculation'
      ? { visual_mode: 'calculation', operators: fx.operators, factor: fx.factor, offset: fx.offset }
      : { visual_mode: 'condition', conditions: fx.conditions, logic: fx.logic, pass: fx.pass, fail: fx.fail };
    const formula: Formula = fx.type === 'custom'
      ? { type: 'custom', sources: fx.sources, expression: fx.expression.trim().replace(/^=\s*/, ''), params: { expression_dialect: cellFx[fx.target]?.params?.expression_dialect, source_aliases: Object.fromEntries(fx.sources.map(source => [source, sourceInfo(source).alias])) } }
      : { type: fx.type as Formula['type'], sources: fx.sources, params };
    const cache = new Map<string, any>();
    const visiting = new Set<string>();
    const valueOf = (source: string, ownerFieldCode: string): any => {
      const info = sourceInfoFor(source, ownerFieldCode);
      const node = `${info.fieldCode}::${info.cellKey}`;
      if (cache.has(node)) return cache.get(node);
      if (visiting.has(node)) return new FormulaError('#CYCLE!', '公式存在循环引用');
      const missing = invalidGridReference(info.sourceField?.free_table, info.cellKey);
      if (missing) return missing;
      visiting.add(node);
      const nested = info.sourceField?.free_table?.cell_formulas?.[info.cellKey];
      let value: any;
      if (nested) {
        const nestedData: Record<string, any> = {};
        (nested.sources || []).forEach(child => { nestedData[child] = valueOf(child, info.fieldCode); });
        value = executeWithFullPrecision(nested, nestedData);
      } else {
        const canonical = canonicalSource(source, ownerFieldCode);
        const trial = fx.testValues[canonical];
        value = trial === null || trial === undefined
          ? info.sourceField?.free_table?.cells?.[info.cellKey]
          : trial;
      }
      const sourceTable = info.sourceField?.free_table;
      value = roundFreeGridValue(value, sourceTable, info.cellKey);
      visiting.delete(node);
      cache.set(node, value);
      return value;
    };
    const sourceValues: Record<string, any> = {};
    fx.sources.forEach(source => { sourceValues[source] = valueOf(source, field.code); });
    const hasValues = fx.sources.every(source => sourceValues[source] !== undefined && sourceValues[source] !== '' && sourceValues[source] !== null);
    return hasValues || formula.params?.expression_dialect === 'excel_v1' ? executeWithFullPrecision(formula, sourceValues) : null;
  })();
  const visualFormulaPreviewText = (() => {
    if (visualFormulaPreview === null || visualFormulaPreview === undefined) return '';
    return freeGridNumberText(visualFormulaPreview, ft, fx?.target || '');
  })();
  const visualExplanation = (() => {
    if (!fx || fx.type !== 'visual' || !fx.sources.length) return '';
    if (fx.visualMode === 'condition') {
      const joiner = fx.logic === 'any' ? ' 或者 ' : ' 并且 ';
      return fx.sources.map((source, index) => {
        const condition = fx.conditions[index] || { operator: '>=', value: 0 };
        return `${sourceInfo(source).label} ${condition.operator} ${condition.value}`;
      }).join(joiner) + `，满足时输出“${fx.pass || '合格'}”，否则输出“${fx.fail || '不合格'}”`;
    }
    let text = fx.sources.map((source, index) =>
      `${index ? ` ${fx.operators[index - 1] || '+'} ` : ''}${sourceInfo(source).label}`).join('');
    if (fx.factor !== 1) text = `(${text}) × ${fx.factor}`;
    if (fx.offset) text = `(${text}) ${fx.offset >= 0 ? '+' : '-'} ${Math.abs(fx.offset)}`;
    return `${text}（按从左到右顺序计算）`;
  })();
  const formulaText = (formula: Formula | null | undefined, ownerFieldCode = field.code): string => {
    if (!formula) return '';
    const compact = ownerFieldCode === field.code && formula.type !== 'custom' ? formulaRangeLabel(ft, formula.sources || []) : undefined;
    const refs = compact ? [compact] : (formula.sources || []).map(source => sourceInfoFor(source, ownerFieldCode).label);
    if (formula.type === 'custom') {
      const replacements: Record<string, string> = {};
      (formula.sources || []).forEach((source, index) => {
        const info = sourceInfoFor(source, ownerFieldCode);
        const savedAlias = formula.params?.source_aliases?.[source];
        const alias = typeof savedAlias === 'string' && savedAlias ? savedAlias : info.alias;
        replacements[alias] = info.label;
        replacements[`v${index + 1}`] = info.label;
      });
      const readable = mapFormulaCode(String(formula.expression || '').replace(/^=\s*/, ''), code => code.replace(/\b[A-Za-z_][A-Za-z0-9_]*\b/g, id => replacements[id] ?? id));
      return `=${readable}`;
    }
    if (formula.type === 'average') return `=AVERAGE(${refs.join(', ')})`;
    if (formula.type === 'sum') return `=SUM(${refs.join(', ')})`;
    if (formula.type === 'max') return `=MAX(${refs.join(', ')})`;
    if (formula.type === 'min') return `=MIN(${refs.join(', ')})`;
    if (formula.type === 'visual') return `=${visualExplanation || refs.join(' + ')}`;
    return `=${String(formula.type).toUpperCase()}(${refs.join(', ')})`;
  };
  const draftFormulaText = fx ? formulaText({
    type: fx.type as Formula['type'],
    sources: fx.sources,
    expression: fx.expression,
  }) : '';
  const selectedFormulaText = selCellKey ? formulaText(cellFx[selCellKey]) : '';
  type FormulaLibraryItem = {
    category: string;
    name: string;
    signature: string;
    description: string;
    minSources: number;
    example: (aliases: string[]) => string;
  };
  const formulaLibrary: FormulaLibraryItem[] = [
    { category: '统计', name: '求和', signature: 'SUM(数值1, 数值2, …)', description: '把所有来源值相加。', minSources: 1, example: a => `SUM(${a.join(', ') || 'A1, A2, A3'})` },
    { category: '统计', name: '平均值', signature: 'AVERAGE(数值1, 数值2, …)', description: '计算所有来源值的算术平均值。', minSources: 1, example: a => `AVERAGE(${a.join(', ') || 'A1, A2, A3'})` },
    { category: '统计', name: '最小值', signature: 'MIN(数值1, 数值2, …)', description: '返回来源值中的最小值。', minSources: 1, example: a => `MIN(${a.join(', ') || 'A1, A2, A3'})` },
    { category: '统计', name: '最大值', signature: 'MAX(数值1, 数值2, …)', description: '返回来源值中的最大值。', minSources: 1, example: a => `MAX(${a.join(', ') || 'A1, A2, A3'})` },
    { category: '统计', name: '计数', signature: 'COUNT(数值1, 数值2, …)', description: '返回参与计算的数值个数。', minSources: 1, example: a => `COUNT(${a.join(', ') || 'A1, A2, A3'})` },
    { category: '统计', name: '乘积', signature: 'PRODUCT(数值1, 数值2, …)', description: '把所有来源值依次相乘。', minSources: 1, example: a => `PRODUCT(${a.join(', ') || 'A1, A2, A3'})` },
    { category: '统计', name: '中位数', signature: 'MEDIAN(数值1, 数值2, …)', description: '排序后取中间值；偶数个数据取中间两个的平均。', minSources: 1, example: a => `MEDIAN(${a.join(', ') || 'A1, A2, A3'})` },
    { category: '统计', name: '样本标准差', signature: 'STDEV.S(数值1, 数值2, …)', description: '按样本口径计算标准差，分母为 n−1，至少需要两个值。', minSources: 2, example: a => `STDEV.S(${a.join(', ') || 'A1, A2, A3'})` },
    { category: '统计', name: '总体标准差', signature: 'STDEV.P(数值1, 数值2, …)', description: '按总体口径计算标准差，分母为 n。', minSources: 1, example: a => `STDEV.P(${a.join(', ') || 'A1, A2, A3'})` },
    { category: '统计', name: '样本方差', signature: 'VAR.S(数值1, 数值2, …)', description: '按样本口径计算方差，分母为 n−1。', minSources: 2, example: a => `VAR.S(${a.join(', ') || 'A1, A2, A3'})` },
    { category: '统计', name: '总体方差', signature: 'VAR.P(数值1, 数值2, …)', description: '按总体口径计算方差，分母为 n。', minSources: 1, example: a => `VAR.P(${a.join(', ') || 'A1, A2, A3'})` },
    { category: '幂与根', name: '平方', signature: '数值 ^ 2', description: '计算一个数的平方。', minSources: 1, example: a => `${a[0] || 'A1'}^2` },
    { category: '幂与根', name: 'n 次方', signature: 'POWER(数值, 次数)', description: '计算任意 n 次方；第二个参数可以改成来源格。', minSources: 1, example: a => `POWER(${a[0] || 'A1'}, ${a[1] || '3'})` },
    { category: '幂与根', name: '平方根', signature: 'SQRT(数值)', description: '计算非负数的平方根。', minSources: 1, example: a => `SQRT(${a[0] || 'A1'})` },
    { category: '幂与根', name: 'n 次方根', signature: 'ROOT(数值, 根次数)', description: '计算任意 n 次方根，例如三次方根；支持负数的奇数次方根。', minSources: 1, example: a => `ROOT(${a[0] || 'A1'}, ${a[1] || '3'})` },
    { category: '幂与根', name: '绝对值', signature: 'ABS(数值)', description: '去掉数值的正负号。', minSources: 1, example: a => `ABS(${a[0] || 'A1'})` },
    { category: '幂与根', name: '余数', signature: 'MOD(被除数, 除数)', description: '返回除法运算的余数，除数不能为 0。', minSources: 2, example: a => `MOD(${a[0] || 'A1'}, ${a[1] || 'A2'})` },
    { category: '指数与对数', name: '自然指数', signature: 'EXP(数值)', description: '计算 e 的指定次方。', minSources: 1, example: a => `EXP(${a[0] || 'A1'})` },
    { category: '指数与对数', name: '自然对数', signature: 'LN(数值)', description: '计算以 e 为底的自然对数，数值必须大于 0。', minSources: 1, example: a => `LN(${a[0] || 'A1'})` },
    { category: '指数与对数', name: '指定底数对数', signature: 'LOG(数值, 底数)', description: '计算指定底数的对数；省略底数时按 10 为底。', minSources: 1, example: a => `LOG(${a[0] || 'A1'}, ${a[1] || '10'})` },
    { category: '指数与对数', name: '常用对数', signature: 'LOG10(数值)', description: '计算以 10 为底的对数。', minSources: 1, example: a => `LOG10(${a[0] || 'A1'})` },
    { category: '取整', name: '四舍五入', signature: 'ROUND(数值, 小数位)', description: '按指定小数位四舍五入；这是实际计算取整，会影响下游公式。', minSources: 1, example: a => `ROUND(${a[0] || 'A1'}, ${a[1] || '2'})` },
    { category: '取整', name: '向外取整', signature: 'ROUNDUP(数值, 小数位)', description: '按指定小数位向远离 0 的方向取整。', minSources: 1, example: a => `ROUNDUP(${a[0] || 'A1'}, ${a[1] || '2'})` },
    { category: '取整', name: '向内取整', signature: 'ROUNDDOWN(数值, 小数位)', description: '按指定小数位向 0 的方向截取。', minSources: 1, example: a => `ROUNDDOWN(${a[0] || 'A1'}, ${a[1] || '2'})` },
    { category: '取整', name: '向上倍数', signature: 'CEILING(数值, 倍数)', description: '向上取到指定倍数，例如 CEILING(A1, 0.5)。', minSources: 1, example: a => `CEILING(${a[0] || 'A1'}, ${a[1] || '1'})` },
    { category: '取整', name: '向下倍数', signature: 'FLOOR(数值, 倍数)', description: '向下取到指定倍数，例如 FLOOR(A1, 0.5)。', minSources: 1, example: a => `FLOOR(${a[0] || 'A1'}, ${a[1] || '1'})` },
    { category: '三角函数', name: '正弦', signature: 'SIN(弧度)', description: '计算弧度值的正弦。', minSources: 1, example: a => `SIN(${a[0] || 'A1'})` },
    { category: '三角函数', name: '余弦', signature: 'COS(弧度)', description: '计算弧度值的余弦。', minSources: 1, example: a => `COS(${a[0] || 'A1'})` },
    { category: '三角函数', name: '正切', signature: 'TAN(弧度)', description: '计算弧度值的正切。', minSources: 1, example: a => `TAN(${a[0] || 'A1'})` },
    { category: '三角函数', name: '反正弦', signature: 'ASIN(数值)', description: '返回反正弦的弧度值，输入范围为 −1 到 1。', minSources: 1, example: a => `ASIN(${a[0] || 'A1'})` },
    { category: '三角函数', name: '反余弦', signature: 'ACOS(数值)', description: '返回反余弦的弧度值，输入范围为 −1 到 1。', minSources: 1, example: a => `ACOS(${a[0] || 'A1'})` },
    { category: '三角函数', name: '反正切', signature: 'ATAN(数值)', description: '返回反正切的弧度值。', minSources: 1, example: a => `ATAN(${a[0] || 'A1'})` },
    { category: '比例与常量', name: '百分比', signature: '分子 / 分母 * 100', description: '计算百分比数值；例如结果 12.5 表示 12.5%。', minSources: 2, example: a => `${a[0] || 'A1'} / ${a[1] || 'A2'} * 100` },
    { category: '比例与常量', name: '百分号常量', signature: '数值%', description: '百分号把字面数除以 100，例如 5% 等于 0.05。', minSources: 0, example: a => `${a[0] || '5'}%` },
    { category: '比例与常量', name: '圆周率', signature: 'PI()', description: '返回圆周率 π，可用于圆周、面积及角度换算。', minSources: 0, example: () => 'PI()' },
  ];
  // ─── 单元格编辑卡：类型 / 选项 / 单位(固定或录入选) / 数字格式（应用到所选全部格）──
  const cellUnits = staticContentMode ? {} : (ft.cell_units || {});
  const cellOptions = staticContentMode ? {} : (ft.cell_options || {});
  const cellOptionAllowCustom = staticContentMode ? {} : (ft.cell_option_allow_custom || {});
  const fixedTextCells = staticContentMode ? {} : (ft.fixed_text_cells || {});
  const cellNumFmt = staticContentMode ? {} : (ft.cell_number_fmt || {});
  const cellRounding = staticContentMode ? {} : (ft.cell_rounding || {});
  const cellTypes = staticContentMode ? {} : (ft.cell_types || {});
  const cellUnitOptions = staticContentMode ? {} : (ft.cell_unit_options || {});
  const [ctxCard, setCtxCard] = useState<{ x: number; y: number } | null>(null);   // 浮动编辑卡位置（双击/右键格子触发）
  // 右键卡：点卡外关闭（antd 下拉/选择弹层在 portal，不算「卡外」）
  useEffect(() => {
    if (!ctxCard) return;
    const h = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('[data-ctxcard]') || t?.closest?.('.ant-select-dropdown, .ant-picker-dropdown, .ant-dropdown, .ant-popover')) return;
      setCtxCard(null);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [ctxCard]);
  const [unitModeSel, setUnitModeSel] = useState<'fixed' | 'options'>('fixed');
  const editSelKeys: string[] = (() => {
    if (!range) return [];
    const ks: string[] = [];
    for (let ri = range.minR; ri <= range.maxR; ri++) for (let ci = range.minC; ci <= range.maxC; ci++) if (!covered.has(`${ri},${ci}`)) ks.push(keyAt(ri, ci));
    return ks;
  })();
  const selectedSampleKeys = sourceFieldBand ? selectedSampleBindingKeys(ft, sourceFieldBand, editSelKeys) : [];
  const parameterKeys = sourceFieldBand ? selectedParameterKeys(ft, sourceFieldBand, editSelKeys) : [];
  const selectedWholeAxis = !!range && ((range.minR === 0 && range.maxR === rows.length - 1)
    || (range.minC === 0 && range.maxC === cols.length - 1));
  const bindingSelectionKeys = selectedWholeAxis && selectedSampleKeys.length ? selectedSampleKeys : editSelKeys;

  type CellStyle = NonNullable<FT['cell_styles']>[string];
  const commonCellStyleValue = <K extends keyof CellStyle>(prop: K): CellStyle[K] | undefined | '__mixed__' => {
    if (!editSelKeys.length) return undefined;
    const first = cellStyles[editSelKeys[0]]?.[prop];
    return editSelKeys.every(key => cellStyles[key]?.[prop] === first) ? first : '__mixed__';
  };
  const setSelectedCellStyle = (patch: Partial<CellStyle>) => {
    if (!editSelKeys.length) return;
    const next = { ...cellStyles };
    editSelKeys.forEach(key => {
      const style = { ...(next[key] || {}), ...patch };
      Object.keys(style).forEach(prop => style[prop as keyof CellStyle] == null && delete style[prop as keyof CellStyle]);
      if (Object.keys(style).length) next[key] = style;
      else delete next[key];
    });
    update({ cell_styles: next });
  };
  const clearSelectedCellStyle = () => {
    const next = { ...cellStyles };
    editSelKeys.forEach(key => delete next[key]);
    update({ cell_styles: next });
  };
  const selectedWeight = commonCellStyleValue('weight');
  const selectedItalic = commonCellStyleValue('italic');
  const selectedColor = commonCellStyleValue('color');
  const selectedAlign = commonCellStyleValue('align');
  const selectedHasCellStyle = editSelKeys.some(key => !!cellStyles[key] && Object.keys(cellStyles[key]).length > 0);
  const effectiveFontFor = (key: string) => {
    const isHeader = !!headerCells[key];
    return cellStyles[key]?.font
      || (isHeader ? field.table_style?.header_font : field.table_style?.body_font)
      || field.table_style?.font
      || documentFont;
  };
  const effectiveSizeFor = (key: string) => {
    const isHeader = !!headerCells[key];
    return cellStyles[key]?.size
      || (isHeader ? field.table_style?.header_font_size : field.table_style?.body_font_size)
      || field.table_style?.font_size
      || `${documentSize}pt`;
  };
  const selectedEffectiveFont = editSelKeys.length && editSelKeys.every(key => effectiveFontFor(key) === effectiveFontFor(editSelKeys[0]))
    ? effectiveFontFor(editSelKeys[0])
    : '__mixed__';
  const selectedEffectiveSize = editSelKeys.length && editSelKeys.every(key => effectiveSizeFor(key) === effectiveSizeFor(editSelKeys[0]))
    ? effectiveSizeFor(editSelKeys[0])
    : '__mixed__';
  const setMapFor = (mapName: keyof FT, keys: string[], val: any) => {
    const src = ((latestFtRef.current as any)[mapName] || {}) as Record<string, any>;
    const n = { ...src };
    for (const k of keys) { if (val == null || val === '' || (Array.isArray(val) && !val.length)) delete n[k]; else n[k] = val; }
    update({ [mapName]: n } as Partial<FT>);
  };
  /** 单元格数据类型互斥切换：选择项只属于“选择”，数字格式和修约只属于“数字”。 */
  const setCellDataType = (keys: string[], type: 'text' | 'number' | 'choice') => {
    const current = latestFtRef.current;
    const nextTypes = { ...(current.cell_types || {}) };
    const nextOptions = { ...(current.cell_options || {}) };
    const nextAllowCustom = { ...(current.cell_option_allow_custom || {}) };
    const nextNumFmt = { ...(current.cell_number_fmt || {}) };
    const nextRounding = { ...(current.cell_rounding || {}) };
    const nextCells = { ...current.cells };
    keys.forEach(key => {
      if (type !== 'text' && current.cell_types?.[key] === 'text' && current.input_cells?.[key]) delete nextCells[key];
      nextTypes[key] = type;
      if (type !== 'choice') { delete nextOptions[key]; delete nextAllowCustom[key]; }
      if (type !== 'number') { delete nextNumFmt[key]; delete nextRounding[key]; }
    });
    update({ cells: nextCells, cell_types: nextTypes, cell_options: nextOptions, cell_option_allow_custom: nextAllowCustom, cell_number_fmt: nextNumFmt, cell_rounding: nextRounding });
  };
  const initUnitMode = (k: string | undefined) => setUnitModeSel(k && cellUnitOptions[k]?.length ? 'options' : 'fixed');
  const setColWidthFor = (keys: string[], w: string) => { const ids = new Set(keys.map(k => k.split('::')[1])); update({ columns: cols.map(c => ids.has(c.id) ? { ...c, width: w || undefined } : c) }); };
  const setRowHeightFor = (keys: string[], h: string) => { const ids = new Set(keys.map(k => k.split('::')[0])); update({ rows: rows.map(r => ids.has(r.id) ? { ...r, height: h || undefined } : r) }); };
  // 角色（表头 / 固定文字 / 录入格 / 公式）互斥切换——供编辑卡「角色」下拉调用（应用到所选全部格）
  const setRole = (role: 'header' | 'input' | 'fixed' | 'formula') => {
    const keys = editSelKeys;
    if (!keys.length) return;
    if (role === 'formula') {
      if (keys.length === 1) { setCtxCard(null); openFx(); }   // 关卡片、打开公式面板（仅单格可配公式）
      else message.info('公式只能给单个格设置');
      return;
    }
    const current = latestFtRef.current;
    const withKeys = (m: Record<string, true>) => { const n = { ...m }; keys.forEach(k => (n[k] = true)); return n; };
    if (role === 'header') update({ header_cells: withKeys(current.header_cells || {}), ...stripFrom(keys, 'header_cells') });
    else if (role === 'input') update({ input_cells: withKeys(current.input_cells || {}), ...stripFrom(keys, 'input_cells') });
    else {
      const nextTypes = { ...(current.cell_types || {}) };
      const nextOptions = { ...(current.cell_options || {}) };
      const nextAllowCustom = { ...(current.cell_option_allow_custom || {}) };
      const nextNumberFmt = { ...(current.cell_number_fmt || {}) };
      const nextRounding = { ...(current.cell_rounding || {}) };
      keys.forEach(key => {
        nextTypes[key] = 'text';
        delete nextOptions[key];
        delete nextAllowCustom[key];
        delete nextNumberFmt[key];
        delete nextRounding[key];
      });
      update({
        fixed_text_cells: withKeys(current.fixed_text_cells || {}),
        ...stripFrom(keys, 'fixed_text_cells'),
        cell_types: nextTypes,
        cell_options: nextOptions,
        cell_option_allow_custom: nextAllowCustom,
        cell_number_fmt: nextNumberFmt,
        cell_rounding: nextRounding,
      });
    }
  };
  // 项目模板保留继承的数字格式用于最终渲染，但不在这里编辑；格式唯一来源是原始记录模板。
  const hasCellSettings = (k: string) => !!(cellUnits[k] || cellUnitBindings[k] || cellOptions[k]?.length || (isRecordEditor && (cellNumFmt[k] || cellRounding[k])) || cellTypes[k] || cellUnitOptions[k]?.length);
  const lab: React.CSSProperties = { fontSize: 12, color: '#555', marginBottom: 3 };
  // getPopupContainer：右键浮动卡里把下拉渲染进卡片自身，避免跨 portal 被卡片盖住（z-index 竞争）
  const editCard = (getPopupContainer?: (t: HTMLElement) => HTMLElement) => {
    const keys = editSelKeys;
    const first = keys[0];
    if (!first) return <div style={{ padding: 4, color: '#999' }}>先在网格里选中格子</div>;
    const single = keys.length === 1;
    // 混合选区不能套用第一个格子的值冒充“共同配置”；显示“多种”，选择新值后再统一应用。
    type EditableRole = 'header' | 'input' | 'fixed' | 'formula' | 'binding';
    const roleOf = (key: string): EditableRole =>
      cellFx[key] ? 'formula' : cellBindings[key] ? 'binding' : inputCells[key] ? 'input' : headerCells[key] ? 'header' : 'fixed';
    const firstRole = roleOf(first);
    const curRole: EditableRole | '__mixed__' = keys.every(key => roleOf(key) === firstRole) ? firstRole : '__mixed__';
    const typeOf = (key: string): 'text' | 'number' | 'choice' => cellTypes[key] || (headerCells[key] ? 'text' : 'number');
    const firstType = typeOf(first);
    const curType: 'text' | 'number' | 'choice' | '__mixed__' = keys.every(key => typeOf(key) === firstType) ? firstType : '__mixed__';
    const firstCol = cols.find(c => c.id === first.split('::')[1]);
    const firstRow = rows.find(r => r.id === first.split('::')[0]);
    const curW = firstCol?.width && /pt$/.test(String(firstCol.width)) ? parseFloat(String(firstCol.width)) : undefined;
    const curH = firstRow?.height && /pt$/.test(String(firstRow.height)) ? parseFloat(String(firstRow.height)) : undefined;
    const firstContent = cells[first] ?? '';
    const commonContent = keys.every(key => (cells[key] ?? '') === firstContent) ? firstContent : undefined;
    const effectiveRoundingFor = (key: string) => cellRounding[key] ?? ft.default_rounding ?? { mode: 'none' as const };
    const firstRounding = effectiveRoundingFor(first);
    const commonRounding = keys.every(key => JSON.stringify(effectiveRoundingFor(key)) === JSON.stringify(firstRounding)) ? firstRounding : undefined;
    const effectiveNumberFormatFor = (key: string) => cellNumFmt[key] ?? ft.default_number_fmt ?? { mode: 'none' as const, digits: 2 };
    const firstNumberFormat = effectiveNumberFormatFor(first);
    const commonNumberFormat = keys.every(key => JSON.stringify(effectiveNumberFormatFor(key)) === JSON.stringify(firstNumberFormat)) ? firstNumberFormat : undefined;
    const numberPreview = freeGridNumberText(10.125, ft, first);
    return (
      <div style={{ width: 268, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 11, color: '#8c8c8c' }}>已选 {keys.length} 格 · 设置应用到全部所选</div>
        {!isReportProject && !staticContentMode && <div>
          <div style={lab}>
            角色
            <Tooltip zIndex={2100} title="固定文字＝在模板中预填，数据录入时仍可修改，并可被项目模板映射；录入＝数据录入时填写；公式＝引用其它格计算。">
              <QuestionCircleOutlined style={{ marginLeft: 3, color: '#bbb' }} />
            </Tooltip>
          </div>
          <Select size="small" style={{ width: '100%' }} value={curRole === '__mixed__' ? undefined : curRole}
            placeholder={curRole === '__mixed__' ? '多种角色（请选择统一角色）' : undefined} getPopupContainer={getPopupContainer}
            onChange={(r) => { if (r !== 'binding') setRole(r as 'header' | 'input' | 'fixed' | 'formula'); }}
            options={[
              { value: 'header', label: '表头' },
              { value: 'input', label: '录入' },
              { value: 'fixed', label: '固定文字' },
              { value: 'formula', label: '公式' },
              ...(curRole === 'binding' ? [{ value: 'binding', label: '绑定原始记录', disabled: true }] : []),
            ]} />
        </div>}
        {curType !== 'choice' && (curRole === 'fixed' || (single && curRole === 'header')) && (
          <div><div style={lab}>{single ? '内容 / 名称' : '统一文字内容'}</div>
            <AutoGrowTextArea size="small"
              placeholder={commonContent === undefined ? '所选格内容不同；输入后统一覆盖' : '在此输入文字'}
              value={commonContent ?? ''} onChange={(e) => setMapFor('cells', keys, e.target.value)} />
            {!single && <div style={{ marginTop: 4, fontSize: 11, color: '#8c8c8c' }}>输入内容会写入全部所选固定文字格。</div>}
          </div>
        )}
        {!staticContentMode && (curRole === '__mixed__' || curRole === 'input' || curRole === 'header' || curRole === 'fixed') && (<div>
          <div style={lab}>
            数据类型
            <Tooltip zIndex={2100} title="文字/数字＝该格内容的类型；选择＝录入时从下方「选项」里下拉选。表头一般用文字。">
              <QuestionCircleOutlined style={{ marginLeft: 3, color: '#bbb' }} />
            </Tooltip>
          </div>
          <Select aria-label="单元格数据类型" size="small" style={{ width: '100%' }} value={curType === '__mixed__' ? undefined : curType}
            placeholder={curType === '__mixed__' ? '多种类型（请选择统一类型）' : undefined}
            onChange={(t) => setCellDataType(keys, t as 'text' | 'number' | 'choice')} getPopupContainer={getPopupContainer}
            options={[
              { value: 'text', label: '文字' }, { value: 'number', label: '数字' }, { value: 'choice', label: '选择' },
            ]} />
        </div>)}
        {isRecordEditor && curRole === 'input' && curType === 'text' && keys.every(key => !sampleIndexCells[key]) && (
          <div><div style={lab}>默认填写内容</div>
            <AutoGrowTextArea aria-label="默认填写内容" size="small"
              placeholder={commonContent === undefined ? '所选格内容不同；输入后统一覆盖' : '默认填写内容'}
              value={commonContent ?? ''} onChange={event => setMapFor('cells', keys, event.target.value)} />
          </div>
        )}
        {!linkedRecord && curRole === 'input' && keys.every(cellInBand) && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={lab}>试样自动序号</span>
            <Switch size="small" checked={keys.every(key => !!sampleIndexCells[key])}
              onChange={(checked) => setMapFor('sample_index_cells', keys, checked ? true : undefined)} />
          </div>
        )}
        {curType === 'choice' && (
          <div><div style={lab}>选项
            <Tooltip zIndex={2100} title="录入时下拉可选的值；也可把表头做成可选项。输入后回车添加。">
              <QuestionCircleOutlined style={{ marginLeft: 3, color: '#bbb' }} />
            </Tooltip></div>
            <Select size="small" mode="tags" style={{ width: '100%' }} placeholder="输入选项回车添加" value={cellOptions[first] || []} onChange={(v) => setMapFor('cell_options', keys, v as string[])} open={false} suffixIcon={null} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 7 }}>
              <span style={{ fontSize: 12, color: '#555' }}>允许填写其他内容</span>
              <Switch size="small" checked={keys.every(key => !!cellOptionAllowCustom[key])}
                onChange={(checked) => setMapFor('cell_option_allow_custom', keys, checked ? true : undefined)} />
            </div>
          </div>
        )}
        {isRecordEditor && curType === 'number' && (
          <div><div style={lab}>数字格式 <span style={{ color: '#999' }}>（同时决定修约位数）</span></div>
            <div style={{ display: 'flex', gap: 6 }}>
              <Select size="small" style={{ flex: 1 }}
                value={commonNumberFormat?.mode}
                placeholder={commonNumberFormat ? undefined : '多种数字格式'} getPopupContainer={getPopupContainer}
                onChange={(m) => {
                  const existing = latestFtRef.current.cell_number_fmt?.[first] ?? latestFtRef.current.default_number_fmt;
                  setMapFor('cell_number_fmt', keys, { mode: m, digits: existing?.digits ?? 2 });
                }}
                options={NUMBER_FORMAT_OPTIONS} />
              {commonNumberFormat && commonNumberFormat.mode !== 'none' && <InputNumber size="small" style={{ width: 66 }} min={0} max={10} value={commonNumberFormat.digits ?? 2}
                onChange={(v) => {
                  const existing = latestFtRef.current.cell_number_fmt?.[first] ?? latestFtRef.current.default_number_fmt ?? commonNumberFormat;
                  setMapFor('cell_number_fmt', keys, { mode: existing.mode, digits: (v as number) ?? 2 });
                }} addonAfter="位" />}
            </div></div>
        )}
        {isRecordEditor && curType === 'number' && (
          <div><div style={lab}>数值修约 <span style={{ color: '#999' }}>（先修约，再格式化）</span></div>
            <div style={{ display: 'flex', gap: 6 }}>
              <Select aria-label="单元格修约方式" size="small" style={{ flex: 1 }}
                value={commonRounding?.mode}
                placeholder={commonRounding ? undefined : '多种修约方式'} getPopupContainer={getPopupContainer}
                onChange={(mode) => {
                  setMapFor('cell_rounding', keys, { mode });
                }}
                options={freeGridRoundingOptions(commonRounding?.mode)} />
            </div>
            {commonRounding?.mode === 'piecewise' && <RoundingIntervalsEditor value={commonRounding} onChange={rule => setMapFor('cell_rounding', keys, rule)} />}
            <div style={{ marginTop: 4, fontSize: 11, color: '#8c8c8c' }}>普通修约位数随数字格式，如小数 1 位对应间隔 0.2/0.5；分段规则按所填间隔。下游公式引用修约后的值，原始输入保留。</div>
          </div>
        )}
        {isRecordEditor && curType === 'number' && (
          <div style={{ padding: '7px 8px', borderRadius: 4, background: '#f6ffed', color: '#3f7d20', fontSize: 12 }}>
            实时示例：原始值 10.125 → {numberPreview}
          </div>
        )}
        {!isRecordEditor && (cellNumFmt[first] || cellRounding[first]) && (
          <div style={{ padding: '6px 8px', borderRadius: 4, background: '#f6f8fb', color: '#697386', fontSize: 12 }}>
            数值规则继承自原始记录：{cellRounding[first] ? numericRoundingLabel(cellRounding[first]) : '不修约'}；{cellNumFmt[first] ? (cellNumFmt[first].mode === 'none' ? '不格式化' : cellNumFmt[first].mode === 'decimals' ? `保留 ${cellNumFmt[first].digits} 位小数` : cellNumFmt[first].mode === 'scientific' ? `科学计数法 · ${cellNumFmt[first].digits} 位` : `有效数字 ${cellNumFmt[first].digits} 位`) : '不格式化'}。请在原始记录模板中修改。
          </div>
        )}
        <div>
          <div style={lab}>单位</div>
          <Radio.Group size="small" optionType="button" value={unitModeSel}
            onChange={(e) => { const m = e.target.value; setUnitModeSel(m); if (m === 'fixed') setMapFor('cell_unit_options', keys, undefined); else setMapFor('cell_units', keys, undefined); }}
            options={[{ value: 'fixed', label: '固定' }, { value: 'options', label: '可选' }]} />
          <div style={{ marginTop: 6 }}>
            {unitModeSel === 'fixed'
              ? <Input size="small" placeholder="如 MPa（留空=无）" value={cellUnits[first]} onChange={(e) => setMapFor('cell_units', keys, e.target.value)} />
              : <Select size="small" mode="tags" style={{ width: '100%' }} placeholder="单位选项，回车添加（如 mm / cm）" value={cellUnitOptions[first] || []} onChange={(v) => setMapFor('cell_unit_options', keys, v as string[])} open={false} suffixIcon={null} />}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}><div style={lab}>列宽</div>
            <InputNumber size="small" style={{ width: '100%' }} min={0} step={2} placeholder="自动" value={curW} addonAfter="pt" onChange={(v) => setColWidthFor(keys, v ? `${v}pt` : '')} /></div>
          <div style={{ flex: 1 }}><div style={lab}>行高</div>
            <InputNumber size="small" style={{ width: '100%' }} min={0} step={2} placeholder="自动" value={curH} addonAfter="pt" onChange={(v) => setRowHeightFor(keys, v ? `${v}pt` : '')} /></div>
        </div>
        <div style={{ textAlign: 'right', marginTop: 2 }}>
          <Button size="small" type="primary" onClick={() => setCtxCard(null)}>完成</Button>
        </div>
      </div>
    );
  };

  // ─── 渲染 ────────────────────────────────────────────────────────
  const excelImport: ExcelImportMapping = ft.excel_import || { enabled: false, sheet_name: '', mode: 'auto' };
  const updateExcelImport = (patch: Partial<ExcelImportMapping>) => update({ excel_import: { ...excelImport, ...patch, mode: 'auto' } });

  const gridBorder = staticContentMode ? '1px solid #eaecef' : `${Math.max(1, 100 / gridZoom)}px solid #a8b2c0`;
  const td: React.CSSProperties = {
    border: gridBorder,
    padding: 0,
    // 原始记录 / 项目模板共用紧凑尺寸；长文字仍由输入框按最多三行展开。
    minWidth: 96,
    height: 48,
    verticalAlign: 'middle',
    position: 'relative',
  };
  const gLabel: React.CSSProperties = { fontSize: 12, color: '#8c8c8c' };
  const sep: React.CSSProperties = { width: 1, height: 16, background: '#e8e8e8', margin: '0 3px' };
  const hasSel = !!range;
  const colWidthValues = cols.map(col => col.width || '');
  const rowHeightValues = rows.map(row => row.height || '');
  const sharedColWidth = colWidthValues.length && colWidthValues.every(value => value === colWidthValues[0])
    && /pt$/.test(colWidthValues[0]) ? parseFloat(colWidthValues[0]) : undefined;
  const sharedRowHeight = rowHeightValues.length && rowHeightValues.every(value => value === rowHeightValues[0])
    && /pt$/.test(rowHeightValues[0]) ? parseFloat(rowHeightValues[0]) : undefined;
  const mixedColWidths = new Set(colWidthValues).size > 1;
  const mixedRowHeights = new Set(rowHeightValues).size > 1;
  const setWholeTableColWidth = (value: number | null) => update({
    columns: cols.map(col => ({ ...col, width: value == null ? undefined : `${value}pt` })),
  });
  const setWholeTableRowHeight = (value: number | null) => update({
    rows: rows.map(row => ({ ...row, height: value == null ? undefined : `${value}pt` })),
  });
  const renderToolbar = (content: ReactNode) => toolbarHost === undefined ? content : toolbarHost ? createPortal(content, toolbarHost) : null;
  return (
    <div style={{ border: '1px solid #eef0f3', borderRadius: 8, padding: 10, paddingBottom: fx ? formulaPanelHeight + 24 : 10, background: '#fff' }}>
      {/* 主工具栏：尺寸 + 结构（常显、精简） */}
      {renderToolbar(<div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={gLabel}>尺寸</span>
        <InputNumber size="small" min={1} max={50} style={{ width: 52 }} value={rows.length} onChange={setRowCount} />
        <span style={{ color: '#bbb' }}>×</span>
        <InputNumber size="small" min={1} max={30} style={{ width: 52 }} value={cols.length} onChange={setColCount} />
        <span style={sep} />
        <Tooltip title="一次设置全部列；之后仍可在单个格子的配置卡中覆盖某一列。清空则全部恢复自动列宽。">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={gLabel}>整表列宽</span>
            <InputNumber size="small" min={16} max={600} step={2} style={{ width: 92 }}
              value={sharedColWidth} placeholder={mixedColWidths ? '不一致' : '自动'} addonAfter="pt"
              onChange={setWholeTableColWidth} />
          </span>
        </Tooltip>
        <Tooltip title="一次设置全部行；之后仍可在单个格子的配置卡中覆盖某一行。清空则全部恢复自适应行高。">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={gLabel}>整表行高</span>
            <InputNumber size="small" min={16} max={600} step={2} style={{ width: 92 }}
              value={sharedRowHeight} placeholder={mixedRowHeights ? '不一致' : '自适应'} addonAfter="pt"
              onChange={setWholeTableRowHeight} />
          </span>
        </Tooltip>
        <span style={sep} />
        <Tooltip title={range ? '在当前选区下方插入一行' : '在表格末尾增加一行'}>
          <Button size="small" icon={<PlusOutlined />} onClick={() => insertRowAt(range ? range.maxR + 1 : rows.length)}>行</Button>
        </Tooltip>
        <Tooltip title={range ? '在当前选区右侧插入一列' : '在表格末尾增加一列'}>
          <Button size="small" icon={<PlusOutlined />} onClick={() => insertColAt(range ? range.maxC + 1 : cols.length)}>列</Button>
        </Tooltip>
        {(isRecordEditor || staticContentMode) && <>
          <span style={sep} />
          <Tooltip title="开启后，PDF 跨页时重复顶部表头。支持多级表头：将顶部连续的多行一起设为重复；表格中间的分组标题不重复。合并格必须完整位于表头或正文内，不能跨越两者边界。">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Switch size="small" checked={repeatHeaderRows > 0}
                onChange={(enabled) => enabled ? setRepeatHeaderRows(repeatHeaderRows || 1) : update({ repeat_header_rows: undefined })} />
              <span style={gLabel}>跨页表头</span>
            </span>
          </Tooltip>
          {repeatHeaderRows > 0 && <InputNumber size="small" min={1} max={rows.length} value={repeatHeaderRows}
            style={{ width: 68 }} addonAfter="行" onChange={(value) => setRepeatHeaderRows(Number(value || 1))} />}
        </>}
        {isRecordEditor && <>
          {(Object.values(cellNumFmt).some(rule => rule.mode !== 'none') || Object.values(cellRounding).some(rule => rule.mode !== 'none')) && <Popover trigger="click" content={<Space direction="vertical">
            <span>修改整表数字格式会统一数字格；之后仍可单独设置个别格子。</span>
            {ft.default_number_fmt && <Button size="small" onClick={() => update(setFreeGridTableNumberFormat(latestFtRef.current, latestFtRef.current.default_number_fmt))}>将当前数字格式统一到整表</Button>}
            <Button size="small" onClick={() => update({ default_number_fmt: undefined, default_rounding: undefined, cell_number_fmt: {}, cell_rounding: {} })}>清除整表数字格式与修约</Button>
          </Space>}><Button size="small">单格规则：格式 {Object.values(cellNumFmt).filter(rule => rule.mode !== 'none').length} 格 / 修约 {Object.values(cellRounding).filter(rule => rule.mode !== 'none').length} 格</Button></Popover>}
          <span style={sep} />
          <Tooltip title="统一整表数字格的格式和位数，覆盖已有单格数字格式；不修改原始值、修约方式或表头。之后可单独设置个别格子。">
            <span style={gLabel}>整表数字</span>
          </Tooltip>
          <Select size="small" style={{ width: 104 }} value={ft.default_number_fmt?.mode || 'none'}
            onChange={(m) => {
              const existing = latestFtRef.current.default_number_fmt;
              update(setFreeGridTableNumberFormat(latestFtRef.current, m === 'none' ? undefined : { mode: m as NonNullable<FT['default_number_fmt']>['mode'], digits: existing?.digits ?? 2 }));
            }}
            options={NUMBER_FORMAT_OPTIONS} />
          {ft.default_number_fmt?.mode && <InputNumber aria-label="整表数字格式位数" size="small" style={{ width: 62 }} min={ft.default_number_fmt.mode === 'significant' ? 1 : 0} max={10} value={ft.default_number_fmt?.digits ?? 2}
            onChange={(v) => {
              const existing = latestFtRef.current.default_number_fmt;
              if (existing && v != null) update(setFreeGridTableNumberFormat(latestFtRef.current, { mode: existing.mode, digits: v as number }));
            }} addonAfter="位" />}
          <Tooltip title="修约改变实际数值，之后再应用数字显示格式；单元格配置可覆盖整表规则。">
            <span style={{ ...gLabel, marginLeft: 4 }}>整表修约</span>
          </Tooltip>
          <Select aria-label="整表修约方式" size="small" style={{ width: 148 }} value={ft.default_rounding?.mode || 'none'}
            onChange={(mode) => {
              update({ default_rounding: mode === 'none' ? undefined : { mode: mode as NonNullable<FT['default_rounding']>['mode'] } });
            }}
            options={freeGridRoundingOptions(ft.default_rounding?.mode)} />
          {ft.default_rounding?.mode === 'piecewise' && <RoundingIntervalsEditor value={ft.default_rounding} onChange={rule => update({ default_rounding: rule })} />}
        </>}
        {!isRecordEditor && !staticContentMode && (ft.default_number_fmt || ft.default_rounding || Object.keys(cellNumFmt).length > 0 || Object.keys(cellRounding).length > 0) && (
          <Tooltip title="项目模板只继承并显示原始记录的数值格式和修约规则；请在原始记录模板中设置。">
            <span style={{ marginLeft: 4, fontSize: 12, color: '#8c8c8c' }}>数字格式与修约由原始记录控制</span>
          </Tooltip>
        )}
        <Tooltip title={isReportProject
          ? '右键或双击格子＝打开格式编辑卡；在格上按住拖动＝框选多格批量设置。'
          : staticContentMode ? '每个格子直接输入说明文字；拖动框选多格后可合并、拆分和批量设置文字格式。'
            : '右键或双击格子＝打开编辑卡（设角色/类型/单位等）；在格上按住拖动＝框选多格批量设置。'}>
          <QuestionCircleOutlined style={{ color: '#bbb', marginLeft: 4 }} />
        </Tooltip>
      </div>)}

      {isRecordEditor && <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '8px 10px', marginBottom: 10, background: '#f6ffed', borderRadius: 6 }}>
        <Switch size="small" checked={excelImport.enabled} onChange={enabled => updateExcelImport({ enabled })} />
        <span>允许Excel导入</span>
        {excelImport.enabled && <Input size="small" style={{ width: 250 }} aria-label="Sheet名称（选填）" placeholder="Sheet名称（选填）" value={excelImport.sheet_name} onChange={e => updateExcelImport({ sheet_name: e.target.value })} />}
        <Tooltip title="不填写：单Sheet自动选择，多Sheet在录入时选择。上传一次可为多张表分配来源，预览确认后导入。"><QuestionCircleOutlined /></Tooltip>
      </div>}

          {!linkedRecord && !staticContentMode && <div data-sample-region-toolbar="true" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            {selfBands.length === 0 ? <Tooltip title="框选试样数据格后设置方向；支持局部矩形，表头无需选择。">
              <Button size="small" type="primary" ghost disabled={!range} onClick={startSampleBand}>设为试样区</Button>
            </Tooltip> : <>
              <span style={{ color: '#08979c', fontSize: 12 }}>试样区域 {describeSelfBandRange(selfBands[0])} · {selfBands[0].axis === 'row' ? '每行一个试样' : '每列一个试样'}</span>
              <Tooltip title="只清除试样区域设置，不删除表格内容；清除后可重新框选。">
                <Button size="small" danger onClick={() => { removeSelfBand(selfBands[0].id); setPendingBand(null); }}>清除试样区域</Button>
              </Tooltip>
            </>}
          </div>}
      {isReportProject && linkedRecord && <div data-report-sample-region-toolbar="true" style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <details><summary style={{ cursor: 'pointer', fontSize: 12 }}>区域设置（可选）</summary><Button size="small" disabled={!range || !reportSampleSources.length} onClick={startSampleBand}>
          {sourceFieldBand ? '重设试样区' : '设为试样区'}
        </Button></details>
        <span style={{ fontSize: 12, color: '#8c8c8c' }}>{sourceFieldBand
          ? `试样区域 ${describeSelfBandRange(sourceFieldBand)}；按参数绑定试样${sourceFieldBand.axis === 'row' ? '列' : '行'}`
          : reportSampleSources.length ? '框选数据格后点击“选择试样行／列来源”，无需先设置区域。' : '请先在关联原始记录中设置试样区域。'}</span>
      </div>}
      {isReportProject && sourceFieldBand && sampleRegionIssues.length > 0 && <div data-sample-region-issues="true"
        style={{ padding: '8px 10px', marginBottom: 10, background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 4 }}>
        <div>试样区已设置；{sampleRegionIssues.length} 项旧映射需要调整，原映射已保留。</div>
        <div style={{ maxHeight: 150, overflowY: 'auto' }}>{sampleRegionIssues.map(issue => {
          const [row, col] = issue.key.split('::');
          const ri = rows.findIndex(item => item.id === row), ci = cols.findIndex(item => item.id === col);
          return <div key={`${issue.part}:${issue.key}`} style={{ fontSize: 12 }}>
            <Button size="small" type="link" disabled={ri < 0 || ci < 0} onClick={() => {
              openBindingAtCell(ri, ci);
              setBindInitialTarget(issue.part === 'unit' ? 'unit' : 'content');
            }}>{cellAddress(issue.key)} · {issue.part === 'unit' ? '单位' : '内容'}</Button>
            {issue.reason}
          </div>;
        })}</div>
      </div>}
      {/* 选中操作栏：有选区才出现，按功能分组 */}
      {hasSel && renderToolbar(
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 10, padding: '8px 10px', background: '#f7f9fc', border: '1px solid #eef0f3', borderRadius: 6 }}>
          <span style={{ ...gLabel, color: '#1677ff', fontWeight: 500 }}>已选 {selCount} 格</span>
          <span style={sep} />
          <Tooltip title={selectedHasLockedSampleResult ? '合并后保留唯一的试样来源；若存在多个不同来源，将由你选择' : undefined}>
            <Button size="small" type="primary" ghost icon={<MergeCellsOutlined />} disabled={selCount <= 1} onClick={mergeSel}>合并</Button>
          </Tooltip>
          <Tooltip title={selHasMerge ? '拆分从原始记录复制或手动创建的真实合并格' : '选区中没有可拆分的真实合并格'}>
            <Button size="small" icon={<SplitCellsOutlined />} disabled={!selHasMerge} onClick={splitSel}>拆分</Button>
          </Tooltip>
          <Button size="small" danger onClick={delRows}>删行</Button>
          <Button size="small" danger onClick={delCols}>删列</Button>
          {isRecordEditor && (
            <Tooltip title={selCount > 1
              ? '对当前选区内所有格子统一设置角色、数据类型、选项、单位、数字格式和行列尺寸；不会改变各格已有文字内容。'
              : '配置当前格子的角色、数据类型、选项、单位、数字格式和行列尺寸。'}>
              <Button
                size="small"
                type="primary"
                ghost
                icon={<SettingOutlined />}
                onClick={() => {
                  // 不经单元格事件，保留拖拽得到的整块选区；编辑卡中的所有设置会应用到 editSelKeys。
                  initUnitMode(editSelKeys[0]);
                  setCtxCard({ x: Math.max(16, Math.round(window.innerWidth / 2 - 134)), y: 88 });
                }}
              >
                {selCount > 1 ? '批量配置' : '配置'}
              </Button>
            </Tooltip>
          )}
          <span style={sep} />
          <Select
            size="small"
            allowClear
            style={{ width: 118 }}
            value={selectedEffectiveFont === '__mixed__' ? undefined : selectedEffectiveFont}
            placeholder="多种字体"
            onChange={(font) => setSelectedCellStyle({ font: font || undefined })}
            options={CELL_FONT_OPTIONS}
          />
          <InputNumber
            size="small"
            min={6}
            max={72}
            step={0.5}
            style={{ width: 74 }}
            value={selectedEffectiveSize !== '__mixed__' ? parseFloat(selectedEffectiveSize) : null}
            placeholder="多种"
            addonAfter="pt"
            onChange={(size) => setSelectedCellStyle({ size: size != null ? `${size}pt` : undefined })}
          />
          <Tooltip title="加粗（再次点击设为正常字重）">
            <Button size="small" icon={<BoldOutlined />} type={selectedWeight === 'bold' ? 'primary' : 'default'}
              onClick={() => setSelectedCellStyle({ weight: selectedWeight === 'bold' ? 'regular' : 'bold' })} />
          </Tooltip>
          <Tooltip title="斜体">
            <Button size="small" icon={<ItalicOutlined />} type={selectedItalic === true ? 'primary' : 'default'}
              onClick={() => setSelectedCellStyle({ italic: selectedItalic === true ? false : true })} />
          </Tooltip>
          <Tooltip title="文字颜色">
            <ColorPicker
              size="small"
              allowClear
              value={selectedColor && selectedColor !== '__mixed__' ? selectedColor : '#000000'}
              presets={[{ label: '常用', colors: ['#000000', '#595959', '#cf1322', '#d48806', '#389e0d', '#1677ff', '#722ed1'] }]}
              onChangeComplete={(color) => setSelectedCellStyle({ color: color.toHexString() })}
              onClear={() => setSelectedCellStyle({ color: undefined })}
            >
              <Button size="small" icon={<BgColorsOutlined />} />
            </ColorPicker>
          </Tooltip>
          <Tooltip title="左对齐"><Button size="small" icon={<AlignLeftOutlined />} type={selectedAlign === 'left' ? 'primary' : 'default'} onClick={() => setSelectedCellStyle({ align: 'left' })} /></Tooltip>
          <Tooltip title="居中"><Button size="small" icon={<AlignCenterOutlined />} type={selectedAlign === 'center' ? 'primary' : 'default'} onClick={() => setSelectedCellStyle({ align: 'center' })} /></Tooltip>
          <Tooltip title="右对齐"><Button size="small" icon={<AlignRightOutlined />} type={selectedAlign === 'right' ? 'primary' : 'default'} onClick={() => setSelectedCellStyle({ align: 'right' })} /></Tooltip>
          <Tooltip title="清除所选格的单元格格式，恢复表头/内容默认设置">
            <Button size="small" icon={<ClearOutlined />} disabled={!selectedHasCellStyle} onClick={clearSelectedCellStyle} />
          </Tooltip>
          {isReportProject && linkedRecord && <>
            {sourceFieldBand && <span style={{ fontSize: 12, color: '#08979c' }}>
              已关联“{findRecordField(sourceFieldBand.source_field || '')?.label || '原始记录表格'}” · 试样自动{sourceFieldBand.axis === 'row' ? '向下' : '向右'}展开
            </span>}
            <Tooltip title="可选中单格、整行或整列配置来源；逐试样来源按每个试样取值">
              <Button size="small" type="primary" ghost disabled={!editSelKeys.length} onClick={() => openBindingForSelectedCell('content')}>
                选择来源
              </Button>
            </Tooltip>
            <Tooltip title="框选数据格后直接选择来源试样行／列，确认时自动建立试样映射，无需预先设置区域。">
              <Button size="small" disabled={!editSelKeys.some(key => !headerCells[key]) || !reportSampleSources.length} onClick={openDirectSampleBinding}>选择试样行／列来源</Button>
            </Tooltip>
            {sourceFieldBand && <Tooltip title="选中参数表头或试样数据格，一次修改试样区域内该参数的全部来源；表头文字不变，单位自动跟随。合并参数请单格设置。">
              <Button size="small" disabled={!parameterKeys.length} onClick={openParameterBinding}>
                绑定试样{sourceFieldBand.axis === 'row' ? '列' : '行'}
              </Button>
            </Tooltip>}
            <Tooltip title={selectedBindingKeys.length ? '清除选区内的映射；多个映射会先确认' : '选区内没有映射'}>
              <Button size="small" disabled={!selectedBindingKeys.length} onClick={clearSelectedBindings}>清除来源</Button>
            </Tooltip>
          </>}
          {linkedRecord && !sourceFieldBand && recordMatrices.length > 0 && <>
            <span style={sep} />
            <span style={gLabel}>试样来源</span>
            <Select size="small" style={{ width: 116 }} placeholder="选择来源表格" value={bandMatrix}
              onChange={setBandMatrixSel} options={recordMatrices.map(m => ({ value: m.code, label: m.label }))} />
            <Tooltip title="所选格所在【行】设为样品带（报告按该矩阵样品数自动展开成多行）"><Button size="small" disabled={!selRowId} onClick={() => setBand('row')}>向下排列</Button></Tooltip>
            <Tooltip title="所选格所在【列】设为样品带（每列一个样品）"><Button size="small" disabled={!selColId} onClick={() => setBand('col')}>向右排列</Button></Tooltip>
            {matrixBand && <Button size="small" danger onClick={() => update({ sample_bands: undefined, sample_band: undefined })}>取消</Button>}
          </>}
        </div>
      )}
      {isReportProject && linkedRecord && mappingCellKey && (
        <div style={{ display: 'grid', gridTemplateColumns: '68px minmax(0, 1fr) auto auto', alignItems: 'center', gap: '5px 10px', margin: '-2px 0 10px', padding: '7px 10px', background: '#fafbfc', borderTop: '1px solid #eef0f3', borderBottom: '1px solid #eef0f3', fontSize: 12 }}>
          <span style={{ color: '#8c8c8c' }}>内容来源</span>
          <span style={{ minWidth: 0 }}>{cellBindings[mappingCellKey]
            ? <BindingSummary value={cellBindings[mappingCellKey]} linkedRecord={linkedRecord} />
            : <span style={{ color: '#bfbfbf' }}>未设置</span>}</span>
          <Button type="link" size="small" style={{ padding: 0 }} onClick={() => openBindingForSelectedCell('content')}>修改</Button>
          <Button type="link" danger size="small" style={{ padding: 0 }} disabled={!cellBindings[mappingCellKey]} onClick={() => clearSingleBindingPart(mappingCellKey, 'content')}>清除</Button>
          <span style={{ color: '#8c8c8c' }}>单位来源</span>
          <span style={{ minWidth: 0 }}>{cellUnitBindings[mappingCellKey]
            ? <BindingSummary value={cellUnitBindings[mappingCellKey]} linkedRecord={linkedRecord} />
            : <span style={{ color: '#bfbfbf' }}>未设置</span>}</span>
          <Button type="link" size="small" style={{ padding: 0 }} onClick={() => openBindingForSelectedCell('unit')}>修改</Button>
          <Button type="link" danger size="small" style={{ padding: 0 }} disabled={!cellUnitBindings[mappingCellKey]} onClick={() => clearSingleBindingPart(mappingCellKey, 'unit')}>清除</Button>
        </div>
      )}
      <Modal title="设置试样区域" open={!!pendingBand} onOk={confirmSampleBand} onCancel={() => setPendingBand(null)} okText="确认设置" cancelText="取消" destroyOnHidden>
        {pendingBand && <Space orientation="vertical" style={{ width: '100%' }}>
          <div>已选区域：{excelColumnName(pendingBand.minC)}{pendingBand.minR + 1}:{excelColumnName(pendingBand.maxC)}{pendingBand.maxR + 1}（支持局部表格）</div>
          {isReportProject && <Select style={{ width: '100%' }} aria-label="试样来源表格"
            value={reportSampleSource?.code} options={reportSampleSources.map(item => ({ value: item.code, label: item.label || item.code }))}
            onChange={code => {
              setReportSampleSourceCode(code);
              const source = reportSampleSources.find(item => item.code === code)!;
              setPendingBand({ ...pendingBand, axis: recordSampleBands(source.free_table!)[0].axis });
            }} />}
          <Radio.Group disabled={isReportProject} value={pendingBand.axis} onChange={e => setPendingBand({ ...pendingBand, axis: e.target.value })}
            options={[{ value: 'row', label: '每行一个试样' }, { value: 'col', label: '每列一个试样' }]} optionType="button" />
          {isReportProject ? <div style={{ color: '#8c8c8c' }}>方向跟随来源。一个试样区可以包含多个参数列／行。例如每行一个试样时，可框选 B2:E2，同时纳入四个参数列；生成报告时按实际试样数展开。参数表头不选入区域。设置不会删除旧映射；不匹配的旧映射会在设置后列出，便于逐项调整。</div> : <div style={{ color: '#8c8c8c' }}>初始 {bandRefsOf(pendingBand, pendingBand.axis).length} 个试样；录入时每次新增一{pendingBand.axis === 'row' ? '行' : '列'}。点击“确认设置”后生效。</div>}
        </Space>}
      </Modal>
      {!staticContentMode && !isReportProject && (
        <div style={{ display: 'grid', gridTemplateColumns: '72px 30px minmax(0, 1fr) auto', alignItems: 'stretch', marginBottom: 8, border: '1px solid #d9d9d9', borderRadius: 5, background: '#fff' }}>
          <div title="名称框：当前选中的单元格" style={{ padding: '5px 8px', borderRight: '1px solid #e8e8e8', textAlign: 'center', fontFamily: 'monospace', fontWeight: 650 }}>
            {selCellKey ? cellAddress(selCellKey) : '—'}
          </div>
          <div title="公式栏" style={{ padding: '5px 6px', color: '#722ed1', fontFamily: 'serif', fontStyle: 'italic', fontWeight: 700 }}>fx</div>
          <div style={{ position: 'relative', minWidth: 0 }}>
          <Input ref={excelInputRef} aria-label="单元格公式" role="combobox" aria-autocomplete="list" aria-expanded={!!completion && excelFocused} variant="borderless" disabled={!selCellKey || !!fx}
            placeholder="输入 =SUM(B2:B6)，Enter 应用，Esc 取消"
            value={excelDraft?.text ?? (selCellKey ? displayGridFormula(ft, cellFx[selCellKey]) ?? selectedFormulaText : '')}
            onFocus={() => { setExcelFocused(true); if (!excelDraft && selCellKey) beginExcelFormula(); }}
            onBlur={() => setExcelFocused(false)}
            onKeyUp={e => { const input = e.currentTarget; setExcelCaret({ start: input.selectionStart ?? 0, end: input.selectionEnd ?? 0 }); }}
            onSelect={e => { const input = e.currentTarget; setExcelCaret({ start: input.selectionStart ?? 0, end: input.selectionEnd ?? 0 }); }}
            onChange={e => {
              if (selCellKey) setExcelDraft({ target: excelDraft?.target ?? selCellKey, text: e.target.value });
              const position = e.target.selectionStart ?? e.target.value.length;
              setExcelCaret({ start: position, end: e.target.selectionEnd ?? position });
              setCompletionIndex(0);
            }}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.nativeEvent?.isComposing) return;
              if (completion && ['ArrowDown', 'ArrowUp', 'Tab', 'Enter'].includes(e.key)) {
                e.preventDefault();
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') setCompletionIndex((completionIndex + (e.key === 'ArrowDown' ? 1 : -1) + completion.options.length) % completion.options.length);
                else completeFunction(completion.options[completionIndex % completion.options.length]);
                return;
              }
              if (e.key === 'Enter') { e.preventDefault(); applyExcelFormula(); }
              if (e.key === 'Escape') { e.preventDefault(); setExcelDraft(null); excelDragRef.current = null; tableRef.current?.focus(); }
            }} />
          {completion && excelFocused && <div ref={completionListRef} role="listbox" aria-label="函数补全" style={{ position: 'absolute', left: 0, top: 'calc(100% + 4px)', zIndex: 30, width: 'min(360px, 100%)', minWidth: 160, maxHeight: 240, overflowY: 'auto', padding: 4, background: '#fff', border: '1px solid #cbd5e1', borderRadius: 6, boxShadow: '0 6px 20px #0002' }}>
            {completion.options.map((name, index) => <div key={name} role="option" aria-selected={index === completionIndex % completion.options.length}
              onMouseDown={e => e.preventDefault()} onMouseEnter={() => setCompletionIndex(index)} onClick={() => completeFunction(name)}
              style={{ padding: '7px 10px', borderRadius: 4, cursor: 'pointer', fontFamily: 'monospace', fontSize: 13, color: '#1f2937', background: index === completionIndex % completion.options.length ? '#e6f4ff' : '#fff' }}>
              <span style={{ marginRight: 10, color: '#7c3aed', fontStyle: 'italic' }}>ƒ</span>{name}
            </div>)}
          </div>}
          </div>
          <Space size={4} style={{ padding: '2px 4px' }}>
            <Button size="small" onMouseDown={e => e.preventDefault()} onClick={() => { setFunctionSearch(''); setFunctionBrowserOpen(true); }}>公式库</Button>
            <Button type="primary" size="small" disabled={!excelDraft} onMouseDown={e => e.preventDefault()} onClick={applyExcelFormula}>完成</Button>
          </Space>
          {excelDraft && formulaParameterHint(excelDraft.text, excelCaret.start) && <div style={{ gridColumn: '1 / -1', padding: '4px 8px', fontSize: 12, color: '#595959', background: '#fafafa' }}>
            {formulaParameterHint(excelDraft.text, excelCaret.start)}
          </div>}
        </div>
      )}
      <Modal title="公式库" open={functionBrowserOpen} onCancel={() => setFunctionBrowserOpen(false)} footer={null} width={600} styles={{ body: { maxHeight: '65vh', overflow: 'auto' } }}>
        <Input aria-label="搜索公式函数" placeholder="搜索函数名或中文说明，例如 average、平均值" value={functionSearch} onChange={e => setFunctionSearch(e.target.value)} allowClear />
        {SPREADSHEET_FUNCTIONS.map(name => {
          const alias = ({ POW: 'POWER', VAR_S: 'VAR.S', VAR_P: 'VAR.P', STDEV_S: 'STDEV.S', STDEV_P: 'STDEV.P' } as Record<string, string>)[name] || name;
          const item = formulaLibrary.find(item => item.signature.startsWith(alias + '('));
          const extra: Record<string, [string, string]> = {
            IF: ['条件判断', 'IF(条件, 成立时返回值, 不成立时返回值)'], IFERROR: ['错误兜底', 'IFERROR(表达式, 出错时返回值)'],
            AND: ['同时满足所有条件', 'AND(条件1, 条件2, …)'], OR: ['满足任一条件', 'OR(条件1, 条件2, …)'], NOT: ['条件取反', 'NOT(条件)'], TRUNC: ['直接截断', 'TRUNC(数值, 小数位数)'],
          };
          const label = item?.name || extra[name]?.[0] || name;
          const signature = item?.signature || extra[name]?.[1] || `${name}(数值参数)`;
          if (!`${name} ${label} ${item?.description || ''}`.toLowerCase().includes(functionSearch.trim().toLowerCase())) return null;
          return <div key={name} style={{ padding: '12px 0', borderBottom: '1px solid #f0f0f0' }}>
            <strong>{name} · {label}</strong><div style={{ marginTop: 4, fontFamily: 'monospace' }}>{signature}</div>
            {item?.description && <div style={{ marginTop: 4, color: '#595959' }}>{item.description}</div>}
          </div>;
        })}
      </Modal>
      {fx && typeof document !== 'undefined' && createPortal(
        <section ref={formulaPanelRef} aria-label="公式编辑面板" data-formula-dirty={JSON.stringify(fx) !== formulaInitialDraft.current ? 'true' : undefined} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); requestCloseFormula(); } }} style={{ position: formulaHost ? 'absolute' : 'fixed', ...formulaPanelBounds, zIndex: formulaHost ? 20 : 1050, maxHeight: 'min(45dvh, 440px)', overflow: 'auto', boxSizing: 'border-box', padding: '0 10px 10px', background: '#fff', border: '1px solid #91caff', borderRadius: 8, boxShadow: '0 -4px 24px #0002' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 2, padding: '10px 0', background: '#fff', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <Button size="small" style={{ color: '#d46b08' }} onClick={() => {
            const [r, c] = fx.target.split('::');
            revealInScrollPanes(tableRef.current?.querySelector(`[data-grid-cell="${rows.findIndex(x => x.id === r)}-${cols.findIndex(x => x.id === c)}"]`), { block: 'center' });
          }}>结果填入 {cellAddress(fx.target)} ↗</Button>
          <Select aria-label="公式计算方式" size="small" style={{ width: 150 }} value={fx.type} onChange={(t) => { setFx({ ...fx, type: t }); if (t === 'custom') setFormulaDetails(true); }}
            options={Object.entries(FX_LABELS).map(([v, l]) => ({ value: v, label: l }))} />
          <Button size="small" onClick={() => setFormulaDetails(!formulaDetails)}>{formulaDetails ? '收起设置' : '更多设置'}</Button>
          {['average', 'sum', 'max', 'min'].includes(fx.type) && !sampleBandForCell(ft, fx.target) && fx.sources.some(source => {
            const ref = resolveFreeGridCellReference(source, field.code);
            const table = sourceFieldOf(ref.fieldCode)?.free_table;
            return ref.fieldCode === field.code && table && sampleBandForCell(table, ref.cellKey);
          }) && <Tooltip title="开启：选中试样格会包含由其新增的试样；关闭：仅计算选中的原试样，删除的试样不参与。">
            <span style={{ fontSize: 12 }}><Switch size="small" checked={fx.followSamples} onChange={followSamples => setFx({ ...fx, followSamples })} /> 随试样增减</span>
          </Tooltip>}
          <Button size="small" type="primary" disabled={fx.type === 'custom' ? !fx.expression.trim() : !fx.sources.length} onClick={saveFx}>应用公式</Button>
          <Button size="small" onClick={requestCloseFormula}>取消</Button>
          <div style={{ flexBasis: '100%', fontFamily: 'monospace', overflowWrap: 'anywhere', maxHeight: 48, overflow: 'auto' }}>{draftFormulaText || '拖动表格选择来源区域'}{visualFormulaPreviewText && <span style={{ color: '#389e0d' }}>　试算：{visualFormulaPreviewText}</span>}</div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, maxHeight: 68, overflow: 'auto', marginBottom: 8 }}>
          <span style={{ fontSize: 12, alignSelf: 'center', color: '#595959' }}>{fx.type === 'custom' ? '来源（点击插入公式）：' : '已选来源：'}</span>
          {!fx.sources.length && <span style={{ color: '#8c8c8c', fontSize: 12 }}>在表格中单击或拖动选择</span>}
          {fx.sources.map(source => <span key={source} style={{ display: 'inline-flex', alignItems: 'center', border: '1px solid #91caff', borderRadius: 4 }}>
            <Button size="small" type="text" title={fx.type === 'custom' ? '插入到公式中' : '定位来源'} onClick={() => {
              if (fx.type === 'custom') { setFx({ ...fx, expression: `${fx.expression}${sourceInfo(source).alias}` }); return; }
              const ref = resolveFreeGridCellReference(source, field.code);
              if (ref.fieldCode !== field.code) { setFxSourceTableCode(ref.fieldCode); setFormulaDetails(true); return; }
              const [r, c] = ref.cellKey.split('::');
              revealInScrollPanes(tableRef.current?.querySelector(`[data-grid-cell="${rows.findIndex(x => x.id === r)}-${cols.findIndex(x => x.id === c)}"]`), { block: 'center' });
            }}>{sourceInfo(source).label}</Button>
            <Button size="small" type="text" aria-label={`移除来源 ${sourceInfo(source).label}`} icon={<CloseOutlined />} onClick={() => {
              const ref = resolveFreeGridCellReference(source, field.code); toggleFxSource(ref.cellKey, ref.fieldCode);
            }} />
          </span>)}
          {fx.sources.length > 0 && (
            <Button size="small" onClick={() => setFx({ ...fx, sources: [], operators: [], conditions: [] })}>清空来源</Button>
          )}
        </div>
        <div style={{ display: formulaDetails ? 'flex' : 'none', flexWrap: 'wrap', gap: 8 }}>
          {freeGridFields.length > 1 && (
            <div style={{ flex: '1 0 100%', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#fff', border: '1px solid #e6d4ff', borderRadius: 6 }}>
              <span style={{ fontSize: 12, color: '#595959' }}>手动添加来源（可跨表）</span>
              <Select aria-label="公式来源表格" size="small" style={{ minWidth: 180 }} value={fxSourceTableCode} onChange={code => { setFxSourceTableCode(code); setSourceAddress(''); }}
                options={freeGridFields.map(candidate => ({ value: candidate.code, label: `${candidate.label || candidate.code}${candidate.code === field.code ? '（当前表）' : ''}` }))} />
              <Input size="small" aria-label="公式来源区域" style={{ width: 180 }} value={sourceAddress} placeholder="例如 B2 或 B2:B8" onChange={event => setSourceAddress(event.target.value)} onPressEnter={addAddressSources} />
              <Button size="small" disabled={!sourceAddress.trim()} onClick={addAddressSources}>添加来源</Button>
            </div>
          )}
          {fx.type === 'custom' && (
            <div style={{ flex: '1 0 100%', minWidth: 0, padding: '10px 12px', background: '#fff', border: '1px solid #e6d4ff', borderRadius: 6 }}>
              <div style={{ fontSize: 12, color: '#595959', marginBottom: 7 }}>
                点击上方来源插入公式，再填写运算符；也可从公式库选择常用函数。
              </div>
              <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} value={fx.expression} placeholder="例如：(B2 + C2) / 2"
                onChange={(event) => setFx({ ...fx, expression: event.target.value })}
                onSelect={(event) => { formulaSelectionRef.current = { start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd }; }}
                onClick={(event) => { formulaSelectionRef.current = { start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd }; }}
                onKeyUp={(event) => { formulaSelectionRef.current = { start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd }; }}
                onBlur={(event) => { formulaSelectionRef.current = { start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd }; }} />
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 9, padding: '8px 10px', background: '#fafafa', borderRadius: 5 }}>
                <Button size="small" type="primary" ghost onClick={() => { setFormulaLibrarySearch(''); setLibraryItemName(null); setFormulaLibraryOpen(true); }}>fx 公式库</Button>
                <span style={{ fontSize: 12, color: '#595959' }}>按类别查看全部函数、参数说明和当前来源格示例，再选择替换或追加到公式。</span>
              </div>
              <details style={{ marginTop: 10 }}><summary style={{ cursor: 'pointer', fontSize: 12 }}>填写示例值试算（可选，不写入记录）</summary>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 10 }}>
                <span style={{ fontSize: 12, color: '#595959' }}>试算输入：</span>
                {trialLeafSources.map(source => (
                  <span key={source} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 13, color: '#262626', fontWeight: 650 }}>{sourceInfo(source).label}</span>
                    <InputNumber size="small" style={{ width: 82 }} placeholder={sourceInfo(source).address} value={fx.testValues[source] ?? undefined}
                      onChange={(value) => setFx({ ...fx, testValues: { ...fx.testValues, [source]: value == null ? null : Number(value) } })} />
                  </span>
                ))}
                <span style={{ marginLeft: 8, fontSize: 12, color: '#595959' }}>结果精度：{formulaPrecisionText(fx.target)}</span>
              </div>
              {fx.sources.length > 0 && <div style={{ marginTop: 10, padding: '6px 8px', borderRadius: 4, background: visualFormulaPreview === null ? '#fff2f0' : '#f6ffed', color: visualFormulaPreview === null ? '#cf1322' : '#389e0d', fontSize: 12 }}>
                {visualFormulaPreview === null ? '暂无试算结果，可填写示例值并检查表达式。' : `试算结果：${visualFormulaPreviewText}`}
              </div>}
              </details>
            </div>
          )}
          {/* 旧版 visual 公式仅保留引擎运行兼容，不再提供可视化计算编辑入口。 */}
          {fx.type === 'visual' && fx && (
            <div style={{
              flex: '1 0 100%', minWidth: 0, padding: '10px 12px', background: '#fff',
              border: '1px solid #e6d4ff', borderRadius: 6,
            }}>
              <Radio.Group
                size="small"
                optionType="button"
                buttonStyle="solid"
                value={fx.visualMode}
                onChange={(event) => setFx({ ...fx, visualMode: event.target.value })}
                options={[{ value: 'calculation', label: '自定义计算' }]}
                style={{ marginBottom: 10 }}
              />

              {fx.visualMode === 'calculation' ? (
                <>
                  <div style={{ fontSize: 12, color: '#595959', marginBottom: 6 }}>
                    计算链（来源格按照点选顺序排列）
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                    {fx.sources.length === 0 && <span style={{ color: '#bfbfbf', fontSize: 12 }}>点击“选来源”，再依次点击表格格子</span>}
                    {fx.sources.map((source, index) => (
                      <span key={source} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {index > 0 && (
                          <Select
                            size="small"
                            style={{ width: 58 }}
                            value={fx.operators[index - 1] || '+'}
                            onChange={(operator) => {
                              const operators = [...fx.operators];
                              operators[index - 1] = operator;
                              setFx({ ...fx, operators });
                            }}
                            options={[
                              { value: '+', label: '＋' },
                              { value: '-', label: '－' },
                              { value: '*', label: '×' },
                              { value: '/', label: '÷' },
                            ]}
                          />
                        )}
                        <span style={{ padding: '3px 9px', borderRadius: 4, background: '#e6f4ff', color: '#0958d9', fontWeight: 600 }}>
                          {sourceInfo(source).label}
                        </span>
                      </span>
                    ))}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, color: '#595959' }}>最终结果</span>
                    <span>×</span>
                    <InputNumber size="small" style={{ width: 90 }} value={fx.factor}
                      onChange={(value) => setFx({ ...fx, factor: Number(value ?? 1) })} />
                    <span>＋</span>
                    <InputNumber size="small" style={{ width: 90 }} value={fx.offset}
                      onChange={(value) => setFx({ ...fx, offset: Number(value ?? 0) })} />
                    <span style={{ marginLeft: 8, fontSize: 12, color: '#595959' }}>结果精度：{formulaPrecisionText(fx.target)}</span>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 12, color: '#595959' }}>多个条件</span>
                    <Select
                      size="small"
                      style={{ width: 120 }}
                      value={fx.logic}
                      onChange={(logic) => setFx({ ...fx, logic })}
                      options={[
                        { value: 'all', label: '全部满足' },
                        { value: 'any', label: '任一满足' },
                      ]}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {fx.sources.length === 0 && <span style={{ color: '#bfbfbf', fontSize: 12 }}>点击“选来源”，选择需要判定的格子</span>}
                    {fx.sources.map((source, index) => {
                      const condition = fx.conditions[index] || { operator: '>=', value: 0 };
                      return (
                        <div key={source} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                          <span style={{ minWidth: 42, padding: '3px 9px', borderRadius: 4, background: '#e6f4ff', color: '#0958d9', fontWeight: 600 }}>
                            {sourceInfo(source).label}
                          </span>
                          <Select
                            size="small"
                            style={{ width: 86 }}
                            value={condition.operator}
                            onChange={(operator) => {
                              const conditions = [...fx.conditions];
                              conditions[index] = { ...condition, operator };
                              setFx({ ...fx, conditions });
                            }}
                            options={[
                              { value: '>=', label: '≥' },
                              { value: '>', label: '>' },
                              { value: '<=', label: '≤' },
                              { value: '<', label: '<' },
                              { value: '==', label: '=' },
                              { value: '!=', label: '≠' },
                            ]}
                          />
                          <InputNumber
                            size="small"
                            style={{ width: 120 }}
                            value={condition.value}
                            placeholder="比较值"
                            onChange={(value) => {
                              const conditions = [...fx.conditions];
                              conditions[index] = { ...condition, value: Number(value ?? 0) };
                              setFx({ ...fx, conditions });
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 10 }}>
                    <span style={{ fontSize: 12, color: '#595959' }}>满足时输出</span>
                    <Input size="small" style={{ width: 120 }} value={fx.pass}
                      onChange={(event) => setFx({ ...fx, pass: event.target.value })} />
                    <span style={{ fontSize: 12, color: '#595959' }}>否则输出</span>
                    <Input size="small" style={{ width: 120 }} value={fx.fail}
                      onChange={(event) => setFx({ ...fx, fail: event.target.value })} />
                  </div>
                </>
              )}

              {visualExplanation && (
                <div style={{ marginTop: 10, padding: '6px 8px', borderRadius: 4, background: '#f6ffed', color: '#389e0d', fontSize: 12 }}>
                  公式说明：{visualExplanation}
                  {visualFormulaPreview !== null && visualFormulaPreview !== undefined && (
                    <b style={{ marginLeft: 8 }}>当前模板值试算：{visualFormulaPreviewText}</b>
                  )}
                </div>
              )}
            </div>
          )}
          {!['custom', 'visual'].includes(fx.type) && fx.sources.length > 0 && (
            <div style={{ flex: '1 0 100%', padding: '9px 12px', background: '#fff', border: '1px solid #e6d4ff', borderRadius: 6 }}>
              <div style={{ marginBottom: 8, fontFamily: 'monospace', color: '#722ed1' }}>公式：{draftFormulaText}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: '#595959' }}>试算输入</span>
                {trialLeafSources.map(source => (
                  <span key={source} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 650 }}>{sourceInfo(source).label}</span>
                    <InputNumber size="small" style={{ width: 82 }} value={fx.testValues[source] ?? undefined}
                      placeholder={sourceInfo(source).address}
                      onChange={(value) => setFx({ ...fx, testValues: { ...fx.testValues, [source]: value == null ? null : Number(value) } })} />
                  </span>
                ))}
                <span style={{ marginLeft: 6, padding: '4px 8px', borderRadius: 4, background: visualFormulaPreview === null ? '#fff2f0' : '#f6ffed', color: visualFormulaPreview === null ? '#cf1322' : '#389e0d', fontSize: 12, fontWeight: 650 }}>
                  {visualFormulaPreview === null ? '等待有效试算值' : `✓ 试算通过：${visualFormulaPreviewText}`}
                </span>
              </div>
            </div>
          )}
        </div>
        </section>, formulaHost || document.body
      )}
      <Modal
        title="fx 公式库"
        zIndex={1150}
        open={formulaLibraryOpen && !!fx}
        onCancel={() => setFormulaLibraryOpen(false)}
        footer={null}
        width={920}
        styles={{ body: { maxHeight: '72vh', overflowY: 'auto', paddingRight: 8 } }}
      >
        {fx && (() => {
          const keyword = formulaLibrarySearch.trim().toLowerCase();
          const filtered = formulaLibrary.filter(item => !keyword || `${item.category} ${item.name} ${item.signature} ${item.description}`.toLowerCase().includes(keyword));
          const categories = Array.from(new Set(filtered.map(item => item.category)));
          const insertFormula = (example: string) => {
            const current = fx.expression.trim();
            const selection = formulaSelectionRef.current;
            const hasSelection = selection.start >= 0 && selection.end > selection.start && selection.end <= fx.expression.length;
            let expression: string;
            if (hasSelection) {
              expression = `${fx.expression.slice(0, selection.start)}${example}${fx.expression.slice(selection.end)}`;
            } else if (!current) {
              expression = example;
            } else if (/[+\-*/^(,]\s*$/.test(current)) {
              expression = `${current}${example}`;
            } else {
              // 两边加括号，保证连续组合多个公式时不被乘除优先级悄然改变含义。
              expression = `(${current}) ${formulaJoinOperator} (${example})`;
            }
            setFx({ ...fx, expression });
            formulaSelectionRef.current = { start: expression.length, end: expression.length };
            setFormulaLibraryOpen(false);
          };
          return <>
            <div style={{ padding: '9px 12px', marginBottom: 12, background: '#f6faff', border: '1px solid #d6e4ff', borderRadius: 6, color: '#475467', fontSize: 12, lineHeight: 1.7 }}>
              <div>选择函数后，指定它使用哪些来源，核对预览再插入。多来源时，单值函数不会默认使用第一个格子。</div>
            </div>
            {!libraryItemName && <Input allowClear value={formulaLibrarySearch} onChange={event => setFormulaLibrarySearch(event.target.value)}
              placeholder="搜索：标准差、取整、LOG、三角函数……" style={{ marginBottom: 14 }} />}
            {!!fx.expression.trim() && <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '-3px 0 14px', padding: '7px 10px', background: '#fafafa', borderRadius: 5 }}>
              <span style={{ fontSize: 12, color: '#595959' }}>已有公式时组合方式</span>
              <Select size="small" value={formulaJoinOperator} onChange={setFormulaJoinOperator} style={{ width: 130 }} options={[
                { value: '+', label: '＋ 相加' },
                { value: '-', label: '－ 相减' },
                { value: '*', label: '× 相乘' },
                { value: '/', label: '÷ 相除' },
              ]} />
              <span style={{ color: '#8c8c8c', fontSize: 11 }}>系统会为旧公式和新公式分别加括号，确保运算顺序明确。</span>
            </div>}
            {libraryItemName ? <FormulaArguments key={libraryItemName} item={formulaLibrary.find(item => item.name === libraryItemName)!}
              sources={fx.sources.map(source => ({ value: sourceInfo(source).alias, label: sourceInfo(source).label }))}
              onInsert={insertFormula} onBack={() => setLibraryItemName(null)} /> : <>
            {categories.length === 0 && <div style={{ padding: 28, textAlign: 'center', color: '#8c8c8c' }}>没有找到匹配的公式</div>}
            {categories.map(category => (
              <div key={category} style={{ marginBottom: 18 }}>
                <div style={{ marginBottom: 8, paddingBottom: 5, borderBottom: '1px solid #f0f0f0', color: '#262626', fontWeight: 700 }}>{category}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))', gap: 9 }}>
                  {filtered.filter(item => item.category === category).map(item => {
                    return <div key={`${category}:${item.name}`} style={{ display: 'flex', flexDirection: 'column', minHeight: 150, padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 7, background: '#fff' }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                        <b>{item.name}</b>
                        {item.category === '统计' && <span style={{ color: '#8c8c8c', fontSize: 11 }}>至少 {item.minSources} 个来源</span>}
                      </div>
                      <code style={{ display: 'block', marginTop: 5, color: '#722ed1', whiteSpace: 'normal' }}>{item.signature}</code>
                      <div style={{ flex: 1, marginTop: 6, color: '#667085', fontSize: 12, lineHeight: 1.55 }}>{item.description}</div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                        <Button size="small" type="primary" onClick={() => setLibraryItemName(item.name)}>
                          选择此函数
                        </Button>
                      </div>
                    </div>;
                  })}
                </div>
              </div>
            ))}</>}
          </>;
        })()}
      </Modal>
      {!staticContentMode && <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4, marginBottom: 6 }}>
        <span style={{ color: '#8c8c8c', fontSize: 12 }}>视图缩放</span>
        <Button size="small" aria-label="缩小表格" disabled={gridZoom <= 50} onClick={() => setGridZoom(Math.max(50, gridZoom - 10))}>−</Button>
        <Select size="small" aria-label="表格缩放比例" style={{ width: 90 }} value={gridZoom} onChange={setGridZoom}
          options={[...new Set([50, 60, 75, 80, 90, 100, 110, 125, 150, gridZoom])].sort((a, b) => a - b).map(value => ({ value, label: `${value}%` }))} />
        <Button size="small" aria-label="放大表格" disabled={gridZoom >= 150} onClick={() => setGridZoom(Math.min(150, gridZoom + 10))}>＋</Button>
      </div>}
      <div style={{ overflow: 'auto', maxHeight: staticContentMode ? undefined : '65vh', border: '1px solid #a8b2c0', borderRadius: 6, display: 'block', width: '100%', maxWidth: '100%' }}>
        <table ref={tableRef} tabIndex={-1} onKeyDown={onCanvasKey}
          style={{ zoom: gridZoom / 100, borderCollapse: 'collapse', width: '100%', minWidth: 38 + cols.length * 96, tableLayout: 'fixed', userSelect: dragging || fx || excelDraft ? 'none' : undefined, outline: 'none' }}>
          <thead>
            <tr>
              <th style={{ position: 'sticky', left: 0, top: 0, zIndex: 9, width: 38, minWidth: 38, height: 22, background: '#f1f5f9', border: gridBorder }} />
              {cols.map((c, ci) => {
                const active = dragAxis?.axis === 'col' && ci >= dragAxis.start && ci <= dragAxis.end;
                return (
                  <th key={c.id} draggable
                    onClick={() => setSel(expandSelectionToSpans({ r0: 0, c0: ci, r1: rows.length - 1, c1: ci }))}
                    onDragStart={(e) => startAxisDrag('col', ci, e)}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                    onDrop={(e) => dropAxisAt('col', ci, e)}
                    onDragEnd={() => setDragAxis(null)}
                    title={`${excelColumnName(ci)} 列：拖动中间图标调整位置；拖动右边缘调整列宽；点击选中整列`}
                    style={{ position: 'sticky', top: 0, zIndex: 8, minWidth: 96, width: c.width, height: 24, padding: 0, textAlign: 'center', color: active ? '#1677ff' : '#475569', background: active ? '#e6f4ff' : '#f1f5f9', border: gridBorder, cursor: 'grab' }}>
                    <span style={{ display: 'inline-flex', height: '100%', width: '100%', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 12, fontWeight: 650 }}>
                      {excelColumnName(ci)}
                      <HolderOutlined style={{ pointerEvents: 'none', fontSize: 12, opacity: 0.55 }} />
                    </span>
                    <div
                      onMouseDown={(e) => startResize('col', c.id, e)}
                      onDragStart={(e) => e.preventDefault()}
                      title="拖动调整列宽"
                      style={{ position: 'absolute', top: 0, right: -4, width: 8, height: '100%', cursor: 'col-resize', zIndex: 6 }}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={r.id}>
                <th draggable
                  onClick={() => setSel(expandSelectionToSpans({ r0: ri, c0: 0, r1: ri, c1: cols.length - 1 }))}
                  onDragStart={(e) => startAxisDrag('row', ri, e)}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                  onDrop={(e) => dropAxisAt('row', ri, e)}
                  onDragEnd={() => setDragAxis(null)}
                  title={`第 ${ri + 1} 行：拖动中间图标调整位置；拖动下边缘调整行高；点击选中整行`}
                  style={{ position: 'sticky', left: 0, zIndex: 7, width: 38, minWidth: 38, padding: 0, textAlign: 'center', color: dragAxis?.axis === 'row' && ri >= dragAxis.start && ri <= dragAxis.end ? '#1677ff' : '#475569', background: dragAxis?.axis === 'row' && ri >= dragAxis.start && ri <= dragAxis.end ? '#e6f4ff' : '#f1f5f9', border: gridBorder, cursor: 'grab' }}>
                  <span style={{ display: 'inline-flex', height: '100%', width: '100%', alignItems: 'center', justifyContent: 'center', gap: 2, fontSize: 11, fontWeight: 650 }}>
                    {ri + 1}
                    <HolderOutlined style={{ pointerEvents: 'none', fontSize: 10, opacity: 0.5 }} />
                  </span>
                  <div
                    onMouseDown={(e) => startResize('row', r.id, e)}
                    onDragStart={(e) => e.preventDefault()}
                    title="拖动调整行高"
                    style={{ position: 'absolute', left: 0, bottom: -4, width: '100%', height: 8, cursor: 'row-resize', zIndex: 6 }}
                  />
                </th>
                {cols.map((c, ci) => {
                  const k = keyAt(ri, ci);
                  if (covered.has(`${ri},${ci}`)) return null;
                  const sp = spans[k];
                  const cspan = Math.min(Math.max(sp?.colspan ?? 1, 1), cols.length - ci);
                  const rspan = Math.min(Math.max(sp?.rowspan ?? 1, 1), rows.length - ri);
                  const isHeader = !!headerCells[k];
                  const isInput = !!inputCells[k];
                  const binding = cellBindings[k];
                  const unitBinding = cellUnitBindings[k];
                  const inBand = cellInBand(k);
                  const lockedSampleCell = isLockedSampleResultCell(k);
                  // 绑定类型决定展示；是否仍位于当前样品带内只决定整条合并/参数轴行为。
                  // 来源绑定独立于当前表格位置，展示按已保存的绑定类型处理。
                  const sampleResultCell = !isHeader && isSampleBinding(binding) && canUseSampleSeries(k);
                  const parameterLine = sourceFieldBand?.axis === 'col'
                    ? parameterRowIds.has(r.id)
                    : sourceFieldBand?.axis === 'row'
                      ? parameterColIds.has(c.id)
                      : false;
                  const bindableReportCell = isReportProject && !!linkedRecord && !lockedSampleCell;
                  const hasFx = cellFx[k];
                  // 公式编辑尚未保存时，也应立即把目标格显示为公式格，避免误以为仍是普通录入格。
                  const isSrc = !!(fx && fx.sources.includes(k)) || excelSources.includes(k);
                  const isFxTarget = (!!fx && fx.target === k) || excelDraft?.target === k;
                  const displayedFxType = isReportProject && binding ? undefined : isFxTarget ? (excelDraft ? 'custom' : fx?.type) : (hasFx as any)?.type;
                  const inSel = !!range && ri >= range.minR && ri <= range.maxR && ci >= range.minC && ci <= range.maxC;
                  const isChoice = !!(cellOptions[k]?.length || cellTypes[k] === 'choice');
                  const configuredStyle = cellStyles[k];
                  const defaultFont = (isHeader ? field.table_style?.header_font : field.table_style?.body_font) || field.table_style?.font || documentFont;
                  const defaultSize = (isHeader ? field.table_style?.header_font_size : field.table_style?.body_font_size) || field.table_style?.font_size || `${documentSize}pt`;
                  const defaultBold = isHeader ? field.table_style?.header_bold !== false : field.table_style?.body_bold === true;
                  const cellTextStyle: React.CSSProperties = {
                    fontWeight: configuredStyle?.weight ? (configuredStyle.weight === 'bold' ? 700 : 400) : (defaultBold ? 700 : 400),
                    fontStyle: configuredStyle?.italic ? 'italic' : 'normal',
                    textAlign: configuredStyle?.align || 'center',
                    ...(configuredStyle?.font || defaultFont ? { fontFamily: configuredStyle?.font || defaultFont } : {}),
                    ...(configuredStyle?.size || defaultSize ? { fontSize: configuredStyle?.size || defaultSize } : {}),
                    ...(configuredStyle?.color ? { color: configuredStyle.color } : {}),
                  };
                  // 状态文案有自己的默认视觉层级，但用户显式设置的单元格格式必须覆盖这些默认值。
                  const explicitCellTextStyle: React.CSSProperties = {
                    ...(configuredStyle?.weight ? { fontWeight: configuredStyle.weight === 'bold' ? 700 : 400 } : {}),
                    ...(configuredStyle?.italic != null ? { fontStyle: configuredStyle.italic ? 'italic' : 'normal' } : {}),
                    ...(configuredStyle?.align ? { textAlign: configuredStyle.align } : {}),
                    ...(configuredStyle?.font ? { fontFamily: configuredStyle.font } : {}),
                    ...(configuredStyle?.size ? { fontSize: configuredStyle.size } : {}),
                    ...(configuredStyle?.color ? { color: configuredStyle.color } : {}),
                  };
                  const cellJustify = configuredStyle?.align === 'left' ? 'flex-start' : configuredStyle?.align === 'right' ? 'flex-end' : 'center';
                  // 录入格按类型区分底色：选择框=黄、文字=绿、数字(含未设)=蓝
                  const inputBg = isChoice ? '#fffbe6' : cellTypes[k] === 'text' ? '#f6ffed' : '#e6f7ff';
                  // 报告侧严格按映射状态着色：未映射白、单格映射黄、逐试样映射青。
                  // 参数轴/试样展开区仅保留边线，不再给未映射格铺青色，避免与已映射格混淆。
                  const bg = isHeader
                    ? '#f4f6fa'
                    : sampleResultCell
                      ? '#e8f8f5'
                      : displayedFxType
                        ? '#f9f0ff'
                        : binding
                          ? '#fff7e6'
                          : isReportProject
                            ? '#fff'
                            : parameterLine
                              ? '#f0fffb'
                              : isChoice
                                ? '#fffbe6'
                                : isInput
                                  ? inputBg
                                  : inBand
                                    ? '#effcfb'
                                    : '#fff';
                  const parameterEdge: React.CSSProperties = sourceFieldBand?.axis === 'col' && parameterRowIds.has(r.id)
                    ? { borderTop: '2px solid #5cdbd3', borderBottom: '2px solid #5cdbd3' }
                    : sourceFieldBand?.axis === 'row' && parameterColIds.has(c.id)
                      ? { borderLeft: '2px solid #5cdbd3', borderRight: '2px solid #5cdbd3' }
                      : {};
                  const colWpx = c.width && /pt$/.test(String(c.width)) ? Math.round(parseFloat(String(c.width)) / 0.75) : undefined;
                  const rowHpx = r.height && /pt$/.test(String(r.height)) ? Math.round(parseFloat(String(r.height)) / 0.75) : undefined;
                  return (
                    <td key={c.id}
                      data-grid-cell={`${ri}-${ci}`}
                      colSpan={(cspan > 1 ? cspan : undefined)}
                      rowSpan={(rspan > 1 ? rspan : undefined)}
                      style={{ ...td, position: 'relative', background: isFxTarget ? '#fff7e6' : isSrc ? '#e6f4ff' : bg, ...cellTextStyle, ...parameterEdge, boxShadow: isFxTarget ? 'inset 0 0 0 3px #fa8c16' : isSrc ? 'inset 0 0 0 2px #1677ff' : inSel && !fx ? 'inset 0 0 0 2px #1677ff' : undefined, cursor: 'cell', ...(sampleResultCell ? { borderLeft: '3px solid #13a8a8' } : inBand ? { borderLeft: '3px solid #13c2c2' } : {}), ...(colWpx ? { width: colWpx, minWidth: colWpx } : {}), ...(rowHpx ? { height: rowHpx } : {}) }}
                      onMouseDown={(e) => { onCellFocus?.(r.id); onCellDown(ri, ci, e); }}
                      onMouseEnter={(e) => onCellEnter(ri, ci, e)}
                      onDoubleClick={(e) => {
                        if (fx || excelDraft) { e.preventDefault(); return; }
                        if (isReportProject && linkedRecord) { e.preventDefault(); openBindingAtCell(ri, ci); return; }
                        setSel({ r0: ri, c0: ci, r1: ri, c1: ci }); initUnitMode(keyAt(ri, ci)); setCtxCard({ x: e.clientX, y: e.clientY });
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        if (excelDraft) return;
                        const insideCurrentSelection = !!range
                          && ri >= range.minR && ri <= range.maxR
                          && ci >= range.minC && ci <= range.maxC;
                        if (!insideCurrentSelection) {
                          const rect = spanRectAt(ri, ci);
                          setSel({ r0: rect.minR, c0: rect.minC, r1: rect.maxR, c1: rect.maxC });
                        }
                        initUnitMode(insideCurrentSelection ? editSelKeys[0] : keyAt(ri, ci));
                        setCtxCard({ x: e.clientX, y: e.clientY });
                      }}>
                      {isFxTarget && (
                        <span
                          title={`当前正在编辑的公式目标格：${cellAddress(k)}`}
                          style={{ position: 'absolute', top: 3, left: 4, zIndex: 2, padding: '1px 5px', borderRadius: 9, background: '#fa8c16', color: '#fff', fontSize: 10, lineHeight: 1.4, fontWeight: 700, pointerEvents: 'none' }}
                        >
                          当前编辑
                        </span>
                      )}
                      {isSrc && (
                        <span
                          title={`公式来源格：${cellAddress(k)}`}
                          style={{ position: 'absolute', top: 3, right: 4, zIndex: 2, padding: '1px 5px', borderRadius: 9, background: '#722ed1', color: '#fff', fontSize: 10, lineHeight: 1.4, fontWeight: 700, pointerEvents: 'none' }}
                        >
                          {cellAddress(k)}
                        </span>
                      )}
                      {sampleResultCell ? (
                        <div style={{ minHeight: 42, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, padding: '4px 6px', ...cellTextStyle }}>
                          <Tooltip title={<div><div>内容：<BindingSummary value={binding!} linkedRecord={linkedRecord || null} /></div>{unitBinding && <div style={{ marginTop: 5 }}>单位：<BindingSummary value={unitBinding} linkedRecord={linkedRecord || null} /></div>}</div>}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#08979c', fontSize: 12, fontWeight: 600, ...explicitCellTextStyle }}>
                              <LinkOutlined aria-label="已关联试样数据" />
                            </span>
                          </Tooltip>
                          <span style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#1677ff', fontSize: 12, ...explicitCellTextStyle }}>
                            {bindingShortText(binding!)}
                          </span>
                        </div>
                      ) : displayedFxType ? (
                        <div style={{ padding: isFxTarget ? '22px 6px 4px' : '4px 6px', color: '#722ed1', fontWeight: 650, ...cellTextStyle, fontSize: 10, lineHeight: 1.35 }}
                          title={isFxTarget ? excelDraft?.text ?? draftFormulaText : formulaText(hasFx)}>
                          <div>fx · {FX_LABELS[displayedFxType] || '自定义'}</div>
                          <div style={{ marginTop: 2, fontFamily: 'monospace', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {isFxTarget ? excelDraft?.text ?? draftFormulaText : formulaText(hasFx)}
                          </div>
                        </div>
                      ) : bindableReportCell ? (
                        <div
                          style={{
                            minHeight: 42,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: cellJustify,
                            justifyContent: 'center',
                            gap: 3,
                            padding: '4px 6px',
                            textAlign: 'center',
                            cursor: 'cell',
                            color: binding ? undefined : '#8c8c8c',
                            fontSize: 12,
                            border: 'none',
                            borderRadius: 4,
                            margin: 4,
                            ...cellTextStyle,
                          }}
                          title={binding ? '单击选中；双击可修改映射或自定义文字' : undefined}
                        >
                          {!binding && (cells[k]?.trim() || inSel) && <AutoGrowTextArea size="small" variant="borderless" value={cells[k] ?? ''}
                            placeholder="" data-gp={`${ri}-${ci}`}
                            onDoubleClick={e => e.stopPropagation()}
                            onChange={e => setCellText(ri, ci, e.target.value)} style={cellTextStyle} />}
                          {binding ? <>
                            <span style={{ maxWidth: '100%', whiteSpace: 'pre-wrap', color: '#262626', fontSize: 14, lineHeight: 1.25, ...explicitCellTextStyle }}>
                              {bindingShortText(binding)}
                            </span>
                            <Tooltip title={<div><div>内容：<BindingSummary value={binding} linkedRecord={linkedRecord || null} /></div>{unitBinding && <div style={{ marginTop: 5 }}>单位：<BindingSummary value={unitBinding} linkedRecord={linkedRecord || null} /></div>}</div>}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: unitBinding ? '#08979c' : '#1677ff', fontSize: 10, lineHeight: 1.2, fontWeight: 500, ...explicitCellTextStyle }}>
                                <LinkOutlined aria-label="已关联映射" />
                              </span>
                            </Tooltip>
                          </> : !cells[k]?.trim() && !unitBinding ? (
                            <button type="button" aria-label="添加映射" title="选择来源"
                              onClick={(e) => { e.stopPropagation(); openBindingAtCell(ri, ci); }}
                              style={{ padding: '5px 8px', border: 0, background: 'transparent', color: '#1677ff', cursor: 'pointer' }}>
                              <PlusOutlined />
                            </button>
                          ) : null}
                        </div>
                      ) : binding ? (
                        <div style={{ fontSize: 11, padding: '4px 6px', ...cellTextStyle }} title="绑定原始记录">
                          {bindingShortText(binding)}
                        </div>
                      ) : (cellOptions[k]?.length || cellTypes[k] === 'choice') ? (
                        <div style={{ padding: '2px 6px', color: '#d48806', ...cellTextStyle, fontSize: 10, lineHeight: 1.35 }} title={`录入·选择（录入时从选项里选）：${(cellOptions[k] || []).join(' / ') || '未设选项'}`}>▾ 录入·选择</div>
                      ) : isInput ? (
                        <div style={{ padding: '2px 6px', color: cellTypes[k] === 'text' ? '#7cb305' : '#69a9ff', ...cellTextStyle, fontSize: 10, lineHeight: 1.35, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                          title={freeGridTextDefault(ft, k) ? '默认填写内容' : '录入格'}>
                          {sampleIndexCells[k] ? '自动序号' : freeGridTextDefault(ft, k) || `录入${cellTypes[k] === 'number' ? '·数字' : cellTypes[k] === 'text' ? '·文字' : ''}${cellUnits[k] ? `（${cellUnits[k]}）` : ''}`}
                        </div>
                      ) : (
                        // 固定文字/表头：模板里直接输入内容
                        <AutoGrowTextArea
                          size="small" variant="borderless"
                          data-gp={`${ri}-${ci}`}
                          onKeyDown={(e) => onCellKey(e, ri, ci)}
                          value={cells[k] ?? ''}
                          placeholder="输入文字"
                          onChange={(e) => setCellText(ri, ci, e.target.value)}
                          style={cellTextStyle} />
                      )}
                      {!isReportProject && (binding || unitBinding) ? (
                        <Tooltip title={<div style={{ maxWidth: 420 }}>
                          <div><span style={{ color: '#bfbfbf' }}>内容：</span>{binding ? <BindingSummary value={binding} linkedRecord={linkedRecord || null} /> : '未设置'}</div>
                          <div style={{ marginTop: 5 }}><span style={{ color: '#bfbfbf' }}>单位：</span>{unitBinding ? <BindingSummary value={unitBinding} linkedRecord={linkedRecord || null} /> : '未设置'}</div>
                        </div>}>
                          <LinkOutlined style={{ position: 'absolute', top: 3, right: 4, zIndex: 4, fontSize: 12, color: binding && unitBinding ? '#08979c' : binding ? '#1677ff' : '#d48806' }} />
                        </Tooltip>
                      ) : hasCellSettings(k) && <span style={{ position: 'absolute', top: 0, right: 2, fontSize: 9, color: '#722ed1', lineHeight: 1 }} title="有单元格设置（单位/选项/数字格式）">⚙</span>}
                      {ri === 0 && <div onMouseDown={(e) => startResize('col', c.id, e)} title="拖动调列宽" style={{ position: 'absolute', top: 0, right: 0, width: 8, height: '100%', cursor: 'col-resize', zIndex: 5 }} />}
                      {ci === 0 && <div onMouseDown={(e) => startResize('row', r.id, e)} title="拖动调行高" style={{ position: 'absolute', left: 0, bottom: 0, height: 8, width: '100%', cursor: 'row-resize', zIndex: 5 }} />}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ctxCard && createPortal(
        // 门户到 body：避开祖先 transform（antd 面板/抽屉常带），否则 position:fixed 会相对被变换的祖先而错位到工具栏下方。
        <div data-ctxcard style={{
          position: 'fixed', zIndex: 2000,
          left: Math.min(ctxCard.x, window.innerWidth - 300),
          top: Math.max(16, Math.min(ctxCard.y, window.innerHeight - Math.min(620, window.innerHeight - 32))),
          background: '#fff', border: '1px solid #d9d9d9', borderRadius: 8,
          boxShadow: '0 6px 24px rgba(0,0,0,0.16)', padding: 12,
          boxSizing: 'border-box', maxHeight: 'min(620px, calc(100vh - 32px))', overflowY: 'auto', overscrollBehavior: 'contain',
        }}>
          <div style={{ position: 'sticky', top: -12, zIndex: 3, display: 'flex', alignItems: 'center', margin: '-12px -12px 10px', padding: '8px 8px 6px 12px', background: '#fff', borderBottom: '1px solid #f0f0f0' }}>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{editSelKeys.length > 1 ? `批量配置 · ${editSelKeys.length} 格` : '单元格设置'}</span>
            <Button type="text" size="small" icon={<CloseOutlined />} aria-label="关闭单元格设置" title="关闭"
              onClick={() => setCtxCard(null)} style={{ color: '#8a94a6' }} />
          </div>
          {/* 下拉渲染进卡片自身(getPopupContainer→卡片元素)：同一堆叠上下文、浮在卡片之上，且属于 [data-ctxcard] 不会触发点外关闭 */}
          {editCard((t) => (t.closest('[data-ctxcard]') as HTMLElement) || document.body)}
        </div>,
        document.body,
      )}
      {toolbarHost === undefined && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 10, fontSize: 11, color: '#8c8c8c', alignItems: 'center' }}>
        {(staticContentMode ? [
          { c: '#fff', t: '固定说明文字（直接输入）' },
          { c: '#f4f6fa', t: '表头（可选）' },
        ] : linkedRecord ? [
          { c: '#f4f6fa', t: '表头/固定说明' },
          { c: '#fff', t: '待选择来源' },
          { c: '#fff7e6', t: '已绑定来源' },
          { c: '#e8f8f5', t: '逐试样参数' },
          { c: '#f9f0ff', t: '公式' },
        ] : [
          { c: '#f4f6fa', t: '表头' },
          { c: '#e6f7ff', t: '录入·数字' },
          { c: '#f6ffed', t: '录入·文字' },
          { c: '#fffbe6', t: '录入·选择' },
          { c: '#f9f0ff', t: '公式' },
        ]).map(x => (
          <span key={x.t} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 12, height: 12, background: x.c, border: '1px solid #e0e0e0', borderRadius: 3 }} />{x.t}
          </span>
        ))}
          {linkedRecord && sourceFieldBand && <>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 12, height: 12, background: '#effcfb', border: '1px solid #e0e0e0', borderLeft: '3px solid #13c2c2', borderRadius: 2 }} />试样展开区
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 12, height: 12, background: '#f0fffb', border: '2px solid #5cdbd3', borderRadius: 2 }} />
              逐试样区域
            </span>
          </>}
        <Tooltip title={linkedRecord
            ? '点击格子选择来源；试样区域自动逐试样取值，标题和共享内容保持固定。'
          : staticContentMode
            ? '每格都是模板固定文字；拖动框选后可合并、拆分、调整字体、字号、加粗和对齐'
            : selfBands.length ? '拖动框选多格进行批量配置。已有试样区域；如需重设，请先清除试样区域。'
              : '拖动框选多格，选中后在上方操作栏合并、标记、配置公式或设置试样区域'}>
          <Button size="small" type="text" shape="circle" icon={<QuestionCircleOutlined />} aria-label="表格编辑帮助" />
        </Tooltip>
      </div>}
      {linkedRecord && bindOpen && activeBindKey && (
        <BindingPickerModal
          open={bindOpen}
          value={bindDirectSamples ? { source: 'record_free_cell_sample', field_code: inheritedSourceFieldCode || reportSampleSource?.code || '', cell_key: '' } : cellBindings[activeBindKey] || (bindMode === 'sample-parameter' && sourceFieldBand?.source_field
            ? { source: 'record_free_cell_sample', field_code: sourceFieldBand.source_field, cell_key: '' }
            : headerCells[activeBindKey] && inheritedSourceFieldCode
              ? { source: 'record_free_template_cell', field_code: inheritedSourceFieldCode, cell_key: activeBindKey }
            : { source: 'literal', text: cells[activeBindKey] || '' })}
          linkedRecord={linkedRecord}
          compactFreeGrid={bindDirectSamples}
          allowedSources={bindDirectSamples ? ['record_free_cell_sample', 'record_free_formula_cell_sample'] : undefined}
          sampleSelectionShape={bindDirectSamples ? { rows: new Set(bindKeys.map(key => key.split('::')[0])).size, columns: new Set(bindKeys.map(key => key.split('::')[1])).size } : undefined}
          parameterAxisBinding={bindWholeParameter || bindDirectSamples}
          freeGridAllowSample={bindDirectSamples || (bindKeys.length ? bindKeys : [activeBindKey]).every(key => canUseSampleSeries(key))}
          initialCompactTarget={bindInitialTarget}
          sampleUnitMode={bindMode === 'sample-parameter' && canUseSampleSeries(activeBindKey)}
          unitValue={cellUnitBindings[activeBindKey]}
          contentValuePresent={bindDirectSamples || !!cellBindings[activeBindKey]}
          bandMatrixCode={!sourceFieldBand && cellInBand(activeBindKey) ? matrixBand?.matrix_code : undefined}
          title={bindDirectSamples ? `选择试样行／列来源（目标 ${bindKeys.length} 格）` : bindWholeParameter ? `绑定试样${sourceFieldBand?.axis === 'row' ? '列' : '行'}（${bindKeys.length} 格，单位自动跟随）` : bindKeys.length > 1 ? `为所选 ${bindKeys.length} 格设置来源（整行／列选择仅绑定试样区内的数据格）` : '设置内容来源与单位'}
          onChange={(b) => setCellBinding(activeBindKey, b)}
          onUnitChange={(b) => setCellUnitBinding(activeBindKey, b)}
          onCombinedChange={(b, unit) => setCellBindingAndUnit(activeBindKey, b, unit)}
          onClose={() => { setBindOpen(false); setBindKey(null); setBindMode('normal'); setBindInitialTarget('content'); }}
        />
      )}
      <Modal
        open={!!pendingMerge}
        title="选择合并后保留的来源"
        okText="合并"
        cancelText="取消"
        onCancel={() => setPendingMerge(null)}
        onOk={() => {
          if (!pendingMerge) return;
          const selected = pendingMerge.candidates.find(item => item.signature === pendingMerge.selectedSignature);
          if (!selected) return;
          mergeRange(pendingMerge.range, selected.binding, selected.unitBinding);
          setPendingMerge(null);
        }}
      >
        <div style={{ color: '#595959', marginBottom: 12 }}>
          选区中存在多个不同的数据来源。合并格只能保留一个来源，其他来源会从被覆盖格中移除。
        </div>
        <Radio.Group
          value={pendingMerge?.selectedSignature}
          onChange={(e) => setPendingMerge(current => current ? { ...current, selectedSignature: e.target.value } : current)}
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          {pendingMerge?.candidates.map(item => {
            const [rowId, colId] = item.key.split('::');
            const rowNo = rows.findIndex(row => row.id === rowId) + 1;
            const colNo = cols.findIndex(col => col.id === colId) + 1;
            return (
              <Radio key={item.signature} value={item.signature} style={{ alignItems: 'flex-start' }}>
                <span style={{ color: '#8c8c8c', marginRight: 6 }}>第 {rowNo} 行第 {colNo} 列</span>
                <BindingSummary value={item.binding} linkedRecord={linkedRecord || null} />
              </Radio>
            );
          })}
        </Radio.Group>
      </Modal>
    </div>
  );
}
