/**
 * MatrixCanvas — 交互式表格画布
 * 双击编辑行列表头；右键菜单增删；数据格单击选公式目标；
 * 参数列 / 汇总列表头单击选中 → 表格上方出现「公共操作栏」（左右移 / 删除，与报告结果表画布同款）。
 */
import { useState, useRef, type CSSProperties } from 'react';
import { Button, Dropdown, Tag, Tooltip, Select as AntSelect, Switch, Space, Modal, Segmented, InputNumber } from 'antd';
import type { MenuProps } from 'antd';
import { PlusOutlined, DeleteOutlined, ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';
import type { DataMatrixConfig, MatrixParameterDef, MatrixSummaryRowDef, MatrixSummaryColDef } from '../../../../../shared/types';
import { matrixDataKey, uniqueCode } from '../../../../../shared/matrix-flatten';
import { FORMULA_TYPES } from '../../../../../shared/formula-engine';
import InlineEditor from './InlineEditor';
import HeaderConfigCard, { type HeaderCfgValue } from './HeaderConfigCard';
import AutoGrowTextArea from '../../AutoGrowTextArea';

// ── P-Map-13 配色：三类区域一眼可分（可变试样数据 / 参数·其他 / 汇总）──
const C_SAMPLE = '#eef6ff';        // 试样数据格（可变、会算进平均、被报告试样带展开）
const C_SAMPLE_HDR = '#dbeafe';    // 试样轴表头（行/列）
const C_SUMMARY = '#fff7e6';       // 汇总行 / 汇总列
const C_AGG = '#f6ffed';           // 自动统计（每列统计）
const C_FORMULA = '#fffbe6';       // 跨列公式
const C_OTHER = '#f9f0ff';         // 统计行（非试样：限值/理论值/判定等，不计入试样）
const C_FX_CELL = '#e6fffb';       // 设了单元格公式的格
const C_ACTIVE = '#e6f4ff';        // 当前选中的公式目标
const ACTIVE_BORDER = '2px solid #1677ff';

export type FormulaTarget =
  | { kind: 'cell_col'; paramIdx: number }
  | { kind: 'cell'; sampleIdx: number; paramIdx: number }
  | { kind: 'other_cell'; rowIdx: number; paramIdx: number }  // "统计行"(per_column)的某一格公式（按参数列，与试样格同款）
  | { kind: 'other_col_cell'; colId: string; sampleIdx: number }  // "统计列"(per_row)的某一格公式（按样品，与试样格同款）
  | { kind: 'sumcol_span_formula'; colId: string }  // "汇总列"(per_row===false 跨行单值)的公式
  | { kind: 'per_column'; rowIdx: number }
  | { kind: 'summary_formula'; rowIdx: number };

type EditingCell =
  | null
  | { kind: 'corner' }
  | { kind: 'row_header'; rowIdx: number }
  | { kind: 'col_header'; paramIdx: number }
  | { kind: 'summary_label'; rowIdx: number }
  | { kind: 'summary_col_label'; colId: string };

type ContextMenuState = {
  x: number;
  y: number;
  items: MenuProps['items'];
} | null;

interface Props {
  config: DataMatrixConfig;
  onChange: (c: DataMatrixConfig) => void;
  formulaTarget: FormulaTarget | null;
  onSelectFormulaTarget: (t: FormulaTarget | null) => void;
}

export default function MatrixCanvas({ config, onChange, formulaTarget, onSelectFormulaTarget }: Props) {
  const [editing, setEditing] = useState<EditingCell>(null);
  // 统一表头配置卡片（右键任意表头打开）
  const [cfgCard, setCfgCard] = useState<null | { kind: 'param' | 'row' | 'sumrow' | 'sumcol'; key: number | string }>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState>(null);
  /** 单元格默认值编辑弹窗（数据格右键「配置默认值」） */
  const [defaultEdit, setDefaultEdit] = useState<{ si: number; pi: number; value: string } | null>(null);
  // 列宽 / 行高拖拽（写回结构化属性，右侧 PDF 实时重编译所见即所得）
  const [resize, setResize] = useState<
    | { kind: 'col'; idx: number; startX: number; startFr: number }
    | { kind: 'axis'; startX: number; startFr: number }
    | { kind: 'row'; idx: number; startY: number; startCm: number }
    | null
  >(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const params = config.parameters || [];
  const summaries = config.summary_rows || [];
  const summaryCols = config.summary_cols || [];
  const n = config.default_sample_count || 1;
  const isTextMatrix = config.cell_type === 'text';
  const prefix = config.row_header_prefix || '试样';
  // 试样轴方向：缺省行（试样为行）。按钮文案随之；试样为列时画布与 PDF 转置。
  const sampleUnit = config.sample_axis === 'col' ? '列' : '行';
  const paramUnit = config.sample_axis === 'col' ? '行' : '列';
  // 转置画布仅在「无多级参数分组 / 无行分组」时启用（与 PDF embedDataMatrix gate 一致），否则回退行模式渲染。
  const colMode = config.sample_axis === 'col'
    && !(config.parameters || []).some(p => (p.group || '').trim())
    && !(config.sample_groups || []).some(g => (g || '').trim());

  // 行名兜底必须与渲染端一致（createEmptyMatrixValue / embedDataMatrixTypst 都是 `${prefix} ${i+1}`），
  // 否则画布显示 "1/2/3" 而 PDF 显示 "试样 1/试样 2"，配置与渲染对不上
  const rowLabel = (idx: number) => config.default_sample_labels?.[idx] ?? `${prefix} ${idx + 1}`;
  const matrixColumnWidths = [config.axis_col_width || '', ...params.map(param => param.width || '')];
  const sharedMatrixColumnWidth = matrixColumnWidths.length
    && matrixColumnWidths.every(width => width === matrixColumnWidths[0]) && /fr$/.test(matrixColumnWidths[0])
    ? parseFloat(matrixColumnWidths[0]) : undefined;
  const matrixRowHeights = Array.from({ length: n }, (_, index) => config.sample_row_heights?.[index] || '');
  const sharedMatrixRowHeight = matrixRowHeights.length
    && matrixRowHeights.every(height => height === matrixRowHeights[0]) && /cm$/.test(matrixRowHeights[0])
    ? parseFloat(matrixRowHeights[0]) : undefined;

  // ─── 结构操作 ──────────────────────────────────────────────────────
  const addColumn = (afterIdx?: number) => {
    const nn = params.length + 1;
    // 编码系统自动生成，扫描已用 code 防撞（用户不可见、不可改）
    const code = uniqueCode(`col_${nn}`, params.map(p => p.code));
    const newParam: MatrixParameterDef = { id: `p${Date.now()}`, code, label: `参数${nn}` };
    const next = [...params];
    if (afterIdx !== undefined) next.splice(afterIdx + 1, 0, newParam);
    else next.push(newParam);
    onChange({ ...config, parameters: next });
  };

  const removeColumn = (idx: number) => {
    onChange({ ...config, parameters: params.filter((_, i) => i !== idx) });
  };

  // ─── 选中表头 → 顶部「公共操作栏」（左右移 / 删除），参考报告项目模板的结果表画布 ────
  // 参数列 / 汇总列的表头本身没有内联操作按钮（汇总行已有），单击表头选中即可在表格上方操作。
  type HeaderSel = { kind: 'param'; idx: number } | { kind: 'sumcol'; id: string };
  const [selHeader, setSelHeader] = useState<HeaderSel | null>(null);
  const toggleHeaderSel = (s: HeaderSel) => setSelHeader(cur => (cur && JSON.stringify(cur) === JSON.stringify(s)) ? null : s);
  const moveColumn = (idx: number, dir: -1 | 1) => {
    const t = idx + dir;
    if (t < 0 || t >= params.length) return;
    const next = [...params];
    [next[idx], next[t]] = [next[t], next[idx]];
    onChange({ ...config, parameters: next });
  };
  const moveSummaryCol = (id: string, dir: -1 | 1) => {
    const idx = summaryCols.findIndex(c => c.id === id);
    const t = idx + dir;
    if (idx < 0 || t < 0 || t >= summaryCols.length) return;
    const next = [...summaryCols];
    [next[idx], next[t]] = [next[t], next[idx]];
    onChange({ ...config, summary_cols: next });
  };

  /** sample_notes 与默认行按索引对齐——增删行时同步 splice */
  const alignedNotes = () => {
    const notes = [...(config.sample_notes || [])];
    while (notes.length < n) notes.push(null);
    return notes;
  };

  /** sample_row_heights 同样按索引对齐 */
  const alignedHeights = () => {
    const hs = [...(config.sample_row_heights || [])];
    while (hs.length < n) hs.push(null);
    return hs;
  };

  /** sample_groups（行分组表头）同样按索引对齐 */
  const alignedGroups = () => {
    const gs = [...(config.sample_groups || [])];
    while (gs.length < n) gs.push(null);
    return gs;
  };

  const frOf = (w?: string) => {
    const m = /^([\d.]+)fr$/.exec((w || '').trim());
    return m ? parseFloat(m[1]) : 1;
  };
  const cmOf = (h?: string | null) => {
    const m = /^([\d.]+)cm$/.exec((h || '').trim());
    return m ? parseFloat(m[1]) : 0.9;
  };
  const setRowHeight = (idx: number, hCm: number | null) => {
    const hs = alignedHeights();
    hs[idx] = hCm === null ? null : `${hCm}cm`;
    onChange({ ...config, sample_row_heights: hs.some(Boolean) ? hs : undefined });
  };

  const addRow = (afterIdx?: number) => {
    const newCount = n + 1;
    const labels = [...(config.default_sample_labels || Array.from({ length: n }, (_, i) => rowLabel(i)))];
    const notes = alignedNotes();
    const heights = alignedHeights();
    const groups = alignedGroups();
    if (afterIdx !== undefined) { labels.splice(afterIdx + 1, 0, `${prefix} ${newCount}`); notes.splice(afterIdx + 1, 0, null); heights.splice(afterIdx + 1, 0, null); groups.splice(afterIdx + 1, 0, null); }
    else { labels.push(`${prefix} ${newCount}`); notes.push(null); heights.push(null); groups.push(null); }
    onChange({
      ...config, default_sample_count: newCount, default_sample_labels: labels,
      sample_notes: notes.some(Boolean) ? notes : undefined,
      sample_row_heights: heights.some(Boolean) ? heights : undefined,
      sample_groups: groups.some(g => (g || '').trim()) ? groups : undefined,
    });
  };

  const removeRow = (idx: number) => {
    if (n <= 1) return;
    const labels = [...(config.default_sample_labels || Array.from({ length: n }, (_, i) => rowLabel(i)))];
    const notes = alignedNotes();
    const heights = alignedHeights();
    const groups = alignedGroups();
    labels.splice(idx, 1);
    notes.splice(idx, 1);
    heights.splice(idx, 1);
    groups.splice(idx, 1);
    onChange({
      ...config, default_sample_count: n - 1, default_sample_labels: labels,
      sample_notes: notes.some(Boolean) ? notes : undefined,
      sample_row_heights: heights.some(Boolean) ? heights : undefined,
      sample_groups: groups.some(g => (g || '').trim()) ? groups : undefined,
    });
  };

  /** 行表头配置卡保存：标题 + 备注 + 行分组合并成一次 onChange（避免多次更新覆盖） */
  const saveRowCfg = (idx: number, patch: HeaderCfgValue) => {
    const labels = [...(config.default_sample_labels || Array.from({ length: n }, (_, i) => rowLabel(i)))];
    labels[idx] = patch.label;
    const notes = alignedNotes();
    const noteCfg = {
      note: patch.note,
      note_options: patch.note_options,
      note_allow_custom: patch.note_allow_custom,
    };
    notes[idx] = (noteCfg.note || noteCfg.note_options?.length) ? noteCfg : null;
    const groups = alignedGroups();
    groups[idx] = (patch.group || '').trim() || null;
    onChange({
      ...config, default_sample_labels: labels,
      sample_notes: notes.some(Boolean) ? notes : undefined,
      sample_groups: groups.some(g => (g || '').trim()) ? groups : undefined,
    });
  };

  const updateRowLabel = (idx: number, label: string) => {
    const labels = [...(config.default_sample_labels || Array.from({ length: n }, (_, i) => rowLabel(i)))];
    labels[idx] = label;
    onChange({ ...config, default_sample_labels: labels });
  };

  const updateParam = (idx: number, patch: Partial<MatrixParameterDef>) => {
    const next = [...params];
    next[idx] = { ...next[idx], ...patch };
    onChange({ ...config, parameters: next });
  };

  const updateAxisHeader = (v: string) => onChange({ ...config, axis_header: v });

  // 加汇总行：先选跨列(perColumn=false)/逐列(true)，再选数据类型（文本/数字/选择框，均手动录入）。
  // 公式/统计不在菜单里——加完点行上「ƒ 配置公式/统计」自行配置（数字行→跨列公式 / 逐列自动统计）。
  const addSummaryRow = (sourceType: 'input_text' | 'input_number' | 'input_choice', perColumn: boolean, label?: string) => {
    const id = `sum_${Date.now()}`;
    const defaultLabel = label ?? `${perColumn ? '统计行' : '汇总行'}${summaries.length + 1}`;
    const base = perColumn ? { per_column: true as const } : {};
    let newRow: MatrixSummaryRowDef;
    if (sourceType === 'input_number') newRow = { id, label: defaultLabel, source_type: 'input_number', placeholder: '请输入', ...base };
    else if (sourceType === 'input_choice') newRow = { id, label: defaultLabel, source_type: 'input_choice', choices: [], allow_custom: false, ...base };
    else newRow = { id, label: defaultLabel, source_type: 'input_text', placeholder: '请输入', ...base };
    const rows = [...summaries, newRow];
    onChange({ ...config, summary_rows: rows });
    // 添加后立即进入行名编辑状态，方便修改
    setEditing({ kind: 'summary_label', rowIdx: rows.length - 1 });
  };

  // P-Map-13a：移除「每列统计（自动聚合）」创建入口——所有计算改为手动配置公式。
  // per_column_aggregate / per_row_aggregate 仅保留【渲染兜底】，编辑器不再新建。

  // 把"数字"汇总行（跨列）点击转成"整行公式"（手动配置），并打开配置面板
  const configureSummaryFormula = (idx: number) => {
    const sr = summaries[idx];
    if (!sr) return;
    updateSummaryRow(idx, { source_type: 'formula', formula: sr.formula || { type: 'average', sources: [], decimals: 2 } });
    onSelectFormulaTarget({ kind: 'summary_formula', rowIdx: idx });
  };

  const removeSummaryRow = (idx: number) => {
    onChange({ ...config, summary_rows: summaries.filter((_, i) => i !== idx) });
    if (formulaTarget && ('rowIdx' in formulaTarget) && (formulaTarget as any).rowIdx === idx) onSelectFormulaTarget(null);
  };

  // ─── 汇总列 / 统计列 CRUD ─────────────────────────────────────────
  // 统计列(perRow=true，缺省)＝逐行每格手填；汇总列(perRow=false)＝跨行一个值。
  const addSummaryCol = (kind: 'input_text' | 'input_number' | 'input_choice', perRow: boolean = true, label?: string) => {
    const id = `sc_${Date.now()}`;
    const defaultLabel = label ?? (perRow ? `统计列${summaryCols.length + 1}` : `汇总列${summaryCols.length + 1}`);
    const base = perRow ? {} : { per_row: false as const };
    let newCol: MatrixSummaryColDef;
    if (kind === 'input_number') newCol = { id, label: defaultLabel, source_type: 'input_number', ...base };
    else if (kind === 'input_choice') newCol = { id, label: defaultLabel, source_type: 'input_choice', choices: [], allow_custom: false, ...base };
    else newCol = { id, label: defaultLabel, source_type: 'input_text', ...base };
    onChange({ ...config, summary_cols: [...summaryCols, newCol] });
    setEditing({ kind: 'summary_col_label', colId: id });
  };

  const updateSummaryCol = (id: string, patch: Partial<MatrixSummaryColDef>) => {
    onChange({ ...config, summary_cols: summaryCols.map(c => {
      if (c.id !== id) return c;
      const next = { ...c, ...patch } as MatrixSummaryColDef;
      if (patch.source_type && patch.source_type !== 'input_choice') { delete (next as any).choices; delete (next as any).allow_custom; }
      if (patch.source_type && patch.source_type !== 'formula') delete (next as any).formula;
      return next;
    }) });
  };

  const removeSummaryCol = (id: string) => {
    onChange({ ...config, summary_cols: summaryCols.filter(c => c.id !== id) });
  };

  // 工具栏「行/列」＝【视觉方向】（行=水平条/底部、列=垂直条/右侧），与试样轴无关——
  // 内部 summary_row / summary_col 由当前轴决定，让"加统计行就出一条横行、加统计列就出一竖列"在两种布局都直观一致。
  // 渲染口径：试样为行→summary_row 在底部(横)、summary_col 在右侧(竖)；试样为列(转置)→正好相反，故此处按轴互换内部类型。
  // stat=true ⇒ 逐格(统计，per_column/per_row=true)；stat=false ⇒ 整条单值(汇总)。
  const addSummaryVisual = (orient: 'row' | 'col', stat: boolean, type: 'input_text' | 'input_number' | 'input_choice') => {
    const isCol = config.sample_axis === 'col';
    const label = `${stat ? '统计' : '汇总'}${orient === 'row' ? '行' : '列'}${summaries.length + summaryCols.length + 1}`;
    const useRow = (orient === 'row') !== isCol;   // 视觉行 in 默认 / 视觉列 in 转置 → 内部 summary_row
    if (useRow) addSummaryRow(type, stat, label);
    else addSummaryCol(type, stat, label);
  };

  const updateSummaryColLabel = (id: string, label: string) => {
    onChange({ ...config, summary_cols: summaryCols.map(c => c.id === id ? { ...c, label } : c) });
  };

  const updateSummaryLabel = (idx: number, label: string) => {
    const rows = [...summaries];
    rows[idx] = { ...rows[idx], label };
    onChange({ ...config, summary_rows: rows });
  };

  const updateSummaryRow = (idx: number, patch: Partial<MatrixSummaryRowDef>) => {
    const rows = [...summaries];
    const next = { ...rows[idx], ...patch } as MatrixSummaryRowDef;
    if (patch.source_type && patch.source_type !== 'input_choice') { delete (next as any).choices; delete (next as any).allow_custom; }
    if (patch.source_type && patch.source_type !== 'formula') delete (next as any).formula;
    rows[idx] = next;
    onChange({ ...config, summary_rows: rows });
  };

  const moveSummaryRow = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= summaries.length) return;
    const rows = [...summaries];
    [rows[idx], rows[target]] = [rows[target], rows[idx]];
    onChange({ ...config, summary_rows: rows });
    // 同步移动 formulaTarget
    if (formulaTarget && 'rowIdx' in formulaTarget) {
      if (formulaTarget.rowIdx === idx) onSelectFormulaTarget({ ...formulaTarget, rowIdx: target });
      else if (formulaTarget.rowIdx === target) onSelectFormulaTarget({ ...formulaTarget, rowIdx: idx });
    }
  };

  const isActive = (t: FormulaTarget) => formulaTarget && JSON.stringify(formulaTarget) === JSON.stringify(t);

  // ─── 右键菜单 ─────────────────────────────────────────────────────
  const showCtx = (e: React.MouseEvent, items: MenuProps['items']) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = wrapRef.current?.getBoundingClientRect();
    setCtxMenu({ x: e.clientX - (rect?.left || 0), y: e.clientY - (rect?.top || 0), items });
  };

  // 表头右键 → 统一配置卡片（HeaderConfigCard）；单元格右键仍走菜单（公式）
  const openCfg = (e: React.MouseEvent, kind: 'param' | 'row' | 'sumrow' | 'sumcol', key: number | string) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu(null);
    setCfgCard({ kind, key });
  };

  /** 数据格右键：默认值（所有矩阵）+ 公式（仅数字矩阵、非列公式格）二选一配置 */
  const cellCtx = (e: React.MouseEvent, si: number, pi: number) => {
    const cellKey = matrixDataKey(`s${si}`, params[pi].code);
    const hasF = !!(config.cell_formulas?.[cellKey]);
    const hasDefault = (config.cell_defaults?.[cellKey] ?? '') !== '';
    const canFormula = !isTextMatrix && !(params[pi].cell_formula?.trim());
    showCtx(e, [
      { key: 'dv', label: hasDefault ? `编辑默认值（当前：${config.cell_defaults![cellKey]}）` : '配置默认值',
        onClick: () => setDefaultEdit({ si, pi, value: config.cell_defaults?.[cellKey] ?? '' }) },
      ...(hasDefault ? [{ key: 'dvclr', label: '清除默认值', onClick: () => {
        const cd = { ...(config.cell_defaults || {}) };
        delete cd[cellKey];
        onChange({ ...config, cell_defaults: Object.keys(cd).length ? cd : undefined });
      }}] : []),
      ...(canFormula ? [{ key: 'f', label: hasF ? '编辑公式' : '配置公式', onClick: () => onSelectFormulaTarget({ kind: 'cell', sampleIdx: si, paramIdx: pi }) }] : []),
      ...(canFormula && hasF ? [{ key: 'clr', label: '清除公式', danger: true, onClick: () => {
        const cf = { ...(config.cell_formulas || {}) };
        delete cf[cellKey];
        onChange({ ...config, cell_formulas: Object.keys(cf).length ? cf : undefined });
      }}] : []),
    ]);
  };

  const saveCellDefault = () => {
    if (!defaultEdit) return;
    const cellKey = matrixDataKey(`s${defaultEdit.si}`, params[defaultEdit.pi].code);
    const cd = { ...(config.cell_defaults || {}) };
    if (defaultEdit.value.trim() === '') delete cd[cellKey];
    else cd[cellKey] = defaultEdit.value;
    onChange({ ...config, cell_defaults: Object.keys(cd).length ? cd : undefined });
    setDefaultEdit(null);
  };

  const noteSuffix = (note?: string, opts?: string[]) => note ? ` (${note})` : opts?.length ? ` (${opts.join('/')})` : '';

  // ─── 数据格（试样×参数）渲染：行/列两种版式共用 ──────────────────────
  const renderDataCell = (ri: number, pi: number) => {
    const p = params[pi];
    const hasColF = !!(p.cell_formula?.trim());
    const cellKey = matrixDataKey(`s${ri}`, p.code);
    const hasCellF = !!(config.cell_formulas?.[cellKey]);
    const cellDefault = config.cell_defaults?.[cellKey];
    const tgt: FormulaTarget = { kind: 'cell', sampleIdx: ri, paramIdx: pi };
    const active = isActive(tgt);
    const clickable = !isTextMatrix && !hasColF;
    return (
      <td key={p.code} title="右键：配置默认值 / 公式"
        style={{ ...TD, cursor: 'pointer', background: active ? C_ACTIVE : hasCellF ? C_FX_CELL : hasColF ? C_FORMULA : C_SAMPLE, textAlign: 'center', border: active ? ACTIVE_BORDER : TD.border }}
        onClick={() => clickable && onSelectFormulaTarget(tgt)}
        onContextMenu={(e) => cellCtx(e, ri, pi)}>
        {hasColF ? <Tag color="orange" style={{ fontSize: 10, margin: 0 }}>ƒ 列</Tag>
          : hasCellF ? <Tag color="cyan" style={{ fontSize: 10, margin: 0 }}>ƒ</Tag>
          : (cellDefault ?? '') !== '' ? <span style={{ color: '#8c8c8c', fontSize: 10 }}>默:{cellDefault}</span>
          : isTextMatrix ? <span style={{ color: '#bbb', fontSize: 10 }}>文本</span>
          : <span style={{ color: '#ccc', fontSize: 10 }}>录入</span>}
      </td>
    );
  };

  // ─── P-Map-13b-2：试样为列（转置）画布。行模式 JSX 原样保留；此处独立渲染，零回退风险。──
  // 多级参数分组 / 行分组场景不在此转置（与 PDF 一致，回退提示走行模式由调用方控制）。
  const renderColTable = () => {
    const sampleIdx = Array.from({ length: n }, (_, i) => i);
    const isInputSr = (sr: MatrixSummaryRowDef) => ['input_text', 'input_number', 'input_choice'].includes(sr.source_type);
    return (
      <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
        <thead>
          <tr>
            {/* 左上角 */}
            <th style={{ ...TH, cursor: 'pointer', minWidth: 80 }} onDoubleClick={() => setEditing({ kind: 'corner' })}>
              {editing?.kind === 'corner'
                ? <InlineEditor value={config.axis_header ?? '试样'} allowEmpty placeholder="留空 = PDF 上不显示"
                    onCommit={(v) => { updateAxisHeader(v); setEditing(null); }} onCancel={() => setEditing(null)} />
                : <span style={{ color: '#666' }}>{config.axis_header === '' ? <span style={{ color: '#bbb', fontStyle: 'italic' }}>(空白)</span> : (config.axis_header ?? '试样')}</span>}
            </th>
            {/* 试样列头（每个试样一列） */}
            {sampleIdx.map(ri => (
              <th key={ri} title="双击配置（试样名/分组/备注/插入/删除）；右键同"
                style={{ ...TH, background: C_SAMPLE_HDR, cursor: 'pointer', minWidth: 76 }}
                onDoubleClick={(e) => openCfg(e, 'row', ri)} onContextMenu={(e) => openCfg(e, 'row', ri)}>
                <HeaderConfigCard title="试样设置" open={cfgCard?.kind === 'row' && cfgCard.key === ri} closeOnOutsideClick onClose={() => setCfgCard(null)} showGroup
                  value={{ label: rowLabel(ri), group: config.sample_groups?.[ri] || undefined, note: config.sample_notes?.[ri]?.note, note_options: config.sample_notes?.[ri]?.note_options, note_allow_custom: config.sample_notes?.[ri]?.note_allow_custom }}
                  onSave={(patch) => saveRowCfg(ri, patch)}
                  actions={[
                    { key: 'ia', label: '← 左插试样', onClick: () => addRow(ri > 0 ? ri - 1 : undefined) },
                    { key: 'ib', label: '右插试样 →', onClick: () => addRow(ri) },
                    ...(n > 1 ? [{ key: 'del', label: '删除此试样', danger: true, onClick: () => removeRow(ri) }] : []),
                  ]}>
                  {editing?.kind === 'row_header' && editing.rowIdx === ri
                    ? <InlineEditor value={rowLabel(ri)} onCommit={(v) => { updateRowLabel(ri, v); setEditing(null); }} onCancel={() => setEditing(null)} />
                    : <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                        {config.sample_groups?.[ri] && <Tag color="blue" style={{ fontSize: 10, margin: 0 }}>▭ {config.sample_groups[ri]}</Tag>}
                        <span>{rowLabel(ri)}{noteSuffix(config.sample_notes?.[ri]?.note, config.sample_notes?.[ri]?.note_options)}</span>
                      </span>}
                </HeaderConfigCard>
              </th>
            ))}
            {/* 汇总行 / 统计行 → 右侧列头（转置：按参数维度真正转到右侧） */}
            {summaries.map((sr, si) => {
              const isOther = sr.per_column || sr.source_type === 'per_column_aggregate';
              const isInput = isInputSr(sr);
              return (
                <th key={sr.id} title="双击配置（名称/备注/公式/删除）；右键同"
                  style={{ ...TH, background: isOther ? C_OTHER : C_SUMMARY, cursor: 'pointer', minWidth: 72 }}
                  onDoubleClick={(e) => openCfg(e, 'sumrow', si)} onContextMenu={(e) => openCfg(e, 'sumrow', si)}>
                  {/* 转置：summary_row 显示为右侧竖列 → 配置卡按【视觉】称「列」 */}
                  <HeaderConfigCard title={isOther ? '统计列设置' : '汇总列设置'} open={cfgCard?.kind === 'sumrow' && cfgCard.key === si} closeOnOutsideClick onClose={() => setCfgCard(null)}
                    showDefault={sr.source_type === 'input_choice' ? 'choice' : isInput} defaultChoices={sr.choices}
                    value={{ label: sr.label, note: sr.note, note_options: sr.note_options, note_allow_custom: sr.note_allow_custom, default_value: sr.default_value }}
                    onSave={(patch) => updateSummaryRow(si, { label: patch.label, note: patch.note, note_options: patch.note_options, note_allow_custom: patch.note_allow_custom, default_value: patch.default_value })}
                    actions={[
                      ...(sr.source_type === 'per_column_aggregate' ? [{ key: 'f', label: 'ƒ 编辑统计', onClick: () => onSelectFormulaTarget({ kind: 'per_column' as const, rowIdx: si }) }] : []),
                      ...(sr.source_type === 'formula' ? [{ key: 'f', label: 'ƒ 编辑公式', onClick: () => onSelectFormulaTarget({ kind: 'summary_formula' as const, rowIdx: si }) }] : []),
                      ...(sr.source_type === 'input_number' && !sr.per_column ? [{ key: 'f', label: 'ƒ 配置公式（整行算一个值）', onClick: () => configureSummaryFormula(si) }] : []),
                      { key: 'del', label: '删除', danger: true, onClick: () => removeSummaryRow(si) },
                    ]}>
                    <span style={{ color: '#d48806' }}>{sr.label || '(双击编辑)'}{noteSuffix(sr.note, sr.note_options)}</span>
                  </HeaderConfigCard>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {/* 参数行（每参数一行） */}
          {params.map((p, pi) => {
            const isEditingCol = editing?.kind === 'col_header' && editing.paramIdx === pi;
            const hasF = !!(p.cell_formula?.trim());
            return (
              <tr key={p.code}>
                <td title="单击选中（上方出现上下移/删除操作栏）；双击配置（标题/分组/备注/插入/删除）；右键同"
                  style={{ ...TH, cursor: 'pointer', fontWeight: 'bold', textAlign: 'center', ...(selHeader?.kind === 'param' && selHeader.idx === pi ? { outline: '2px solid #1677ff', outlineOffset: -2 } : {}) }}
                  onClick={() => toggleHeaderSel({ kind: 'param', idx: pi })}
                  onDoubleClick={(e) => openCfg(e, 'param', pi)} onContextMenu={(e) => openCfg(e, 'param', pi)}>
                  <HeaderConfigCard title="参数设置" open={cfgCard?.kind === 'param' && cfgCard.key === pi} closeOnOutsideClick onClose={() => setCfgCard(null)} showGroup
                    value={{ label: p.label, group: p.group, note: p.unit, note_options: p.unit_options, note_allow_custom: p.unit_allow_custom }}
                    onSave={(patch) => updateParam(pi, { label: patch.label, group: patch.group, unit: patch.note, unit_options: patch.note_options, unit_allow_custom: patch.note_allow_custom })}
                    actions={[
                      { key: 'ia', label: '↑ 上插参数', onClick: () => addColumn(pi > 0 ? pi - 1 : undefined) },
                      { key: 'ib', label: '下插参数 ↓', onClick: () => addColumn(pi) },
                      ...(!isTextMatrix ? [{ key: 'f', label: 'ƒ 按行公式', onClick: () => onSelectFormulaTarget({ kind: 'cell_col' as const, paramIdx: pi }) }] : []),
                      { key: 'del', label: '删除此参数', danger: true, onClick: () => removeColumn(pi) },
                    ]}>
                    {isEditingCol
                      ? <InlineEditor value={p.label} onCommit={(v) => { updateParam(pi, { label: v }); setEditing(null); }} onCancel={() => setEditing(null)} />
                      : <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                          {p.group && <Tag color="blue" style={{ fontSize: 10, margin: 0 }}>▭ {p.group}</Tag>}
                          <span>{p.label || `参数${pi + 1}`}{p.unit ? ` (${p.unit})` : (p.unit_options?.length ? ` (${p.unit_options.join('/')})` : '')}</span>
                          {hasF && <Tag color="orange" style={{ fontSize: 10, margin: 0 }}>ƒ ={p.cell_formula}</Tag>}
                        </span>}
                  </HeaderConfigCard>
                </td>
                {/* 每个试样一格 */}
                {sampleIdx.map(ri => renderDataCell(ri, pi))}
                {/* 汇总行 / 统计行 单元格（右侧列，转置：每参数行一格） */}
                {summaries.map((sr, si) => {
                  const isOther = sr.per_column || sr.source_type === 'per_column_aggregate';
                  if (!isOther) {
                    // 汇总行（跨参数单值）：首参数行 rowspan
                    if (pi !== 0) return null;
                    const canFx = sr.source_type === 'formula' || sr.source_type === 'input_number';
                    const tgt: FormulaTarget = { kind: 'summary_formula', rowIdx: si };
                    const cellActive = isActive(tgt);
                    const fx = sr.source_type === 'formula' && !!sr.formula;
                    return (
                      <td key={sr.id} rowSpan={params.length}
                        style={{ ...TD, background: cellActive ? C_ACTIVE : fx ? C_FX_CELL : C_SUMMARY, textAlign: 'center', verticalAlign: 'middle', cursor: canFx ? 'pointer' : 'default', border: cellActive ? ACTIVE_BORDER : TD.border }}
                        title={canFx ? '汇总行公式（整列一个值）：点击配置' : '录入'}
                        onClick={() => { if (sr.source_type === 'formula') onSelectFormulaTarget(tgt); else if (sr.source_type === 'input_number') configureSummaryFormula(si); }}>
                        {fx ? <Tag color="gold" style={{ fontSize: 10, margin: 0 }}>ƒ</Tag>
                          : sr.source_type === 'input_number' ? <span style={{ color: '#ccc', fontSize: 10 }}>数字·点设公式</span>
                          : sr.source_type === 'literal' ? <span style={{ color: '#888', fontSize: 11 }}>{sr.literal || '固定'}</span>
                          : <span style={{ color: '#ccc', fontSize: 10 }}>录入</span>}
                      </td>
                    );
                  }
                  if (sr.source_type === 'per_column_aggregate') {
                    return (
                      <td key={sr.id} style={{ ...TD, background: C_AGG, textAlign: 'center', cursor: 'pointer' }}
                        onClick={() => onSelectFormulaTarget({ kind: 'per_column', rowIdx: si })}>
                        <Tag color="green" style={{ fontSize: 10, margin: 0 }}>{sr.aggregate === 'sum' ? '求和' : sr.aggregate === 'max' ? '最大' : sr.aggregate === 'min' ? '最小' : '均值'}</Tag>
                      </td>
                    );
                  }
                  if (sr.source_type === 'input_number') {
                    // 统计行某格（按参数）：可点配公式，与试样格同款，只选该格
                    const tgt: FormulaTarget = { kind: 'other_cell', rowIdx: si, paramIdx: pi };
                    const cellActive = isActive(tgt);
                    const fx = !!sr.cell_formulas?.[p.code];
                    return (
                      <td key={sr.id}
                        style={{ ...TD, background: cellActive ? C_ACTIVE : fx ? C_FX_CELL : C_OTHER, textAlign: 'center', cursor: 'pointer', border: cellActive ? ACTIVE_BORDER : TD.border }}
                        title={fx ? '本格公式：点击编辑' : '点击：配置本格公式（与试样格同款）'}
                        onClick={() => onSelectFormulaTarget(tgt)}>
                        {fx ? <Tag color="cyan" style={{ fontSize: 10, margin: 0 }}>ƒ</Tag> : <span style={{ color: '#ccc', fontSize: 10 }}>录入</span>}
                      </td>
                    );
                  }
                  return (
                    <td key={sr.id} style={{ ...TD, background: C_OTHER, textAlign: 'center' }}>
                      <span style={{ color: '#ccc', fontSize: 10 }}>{sr.source_type === 'input_choice' ? '选择' : '文本'}</span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {/* 汇总列 / 统计列 → 底部行（转置：按试样维度真正转到底部，每试样一格） */}
          {summaryCols.map(sc => (
            <tr key={sc.id}>
              <td title="双击配置（标题/备注/删除）；右键同"
                style={{ ...TH, background: sc.per_row === false ? C_SUMMARY : C_OTHER, cursor: 'pointer', fontWeight: 'bold', textAlign: 'center' }}
                onDoubleClick={(e) => openCfg(e, 'sumcol', sc.id)} onContextMenu={(e) => openCfg(e, 'sumcol', sc.id)}>
                {/* 转置：summary_col 显示为底部横行 → 配置卡按【视觉】称「行」 */}
                <HeaderConfigCard title={sc.per_row === false ? '汇总行设置' : '统计行设置'} open={cfgCard?.kind === 'sumcol' && cfgCard.key === sc.id} closeOnOutsideClick onClose={() => setCfgCard(null)}
                  value={{ label: sc.label, note: sc.unit, note_options: sc.unit_options, note_allow_custom: sc.unit_allow_custom }}
                  onSave={(patch) => onChange({ ...config, summary_cols: summaryCols.map(c => c.id === sc.id ? { ...c, label: patch.label, unit: patch.note, unit_options: patch.note_options, unit_allow_custom: patch.note_allow_custom } : c) })}
                  actions={[{ key: 'del', label: '删除', danger: true, onClick: () => removeSummaryCol(sc.id) }]}>
                  <span style={{ color: '#d48806' }}>{sc.label}{noteSuffix(sc.unit, sc.unit_options)}</span>
                </HeaderConfigCard>
              </td>
              {sc.per_row === false ? (
                (sc.source_type === 'input_number' || sc.source_type === 'formula') ? (() => {
                  const tgt: FormulaTarget = { kind: 'sumcol_span_formula', colId: sc.id };
                  const cellActive = isActive(tgt);
                  const fx = sc.source_type === 'formula' && !!sc.formula;
                  return (
                    <td colSpan={n} style={{ ...TD, background: cellActive ? C_ACTIVE : fx ? C_FX_CELL : C_SUMMARY, textAlign: 'center', cursor: 'pointer', border: cellActive ? ACTIVE_BORDER : TD.border }}
                      title={fx ? '汇总列公式（整行一个值）：点击编辑' : '点击：配置本汇总列公式（整行一个值）'}
                      onClick={() => onSelectFormulaTarget(tgt)}>
                      {fx ? <Tag color="gold" style={{ fontSize: 10, margin: 0 }}>ƒ</Tag> : <span style={{ color: '#ccc', fontSize: 10 }}>数字·点设公式</span>}
                    </td>
                  );
                })() : (
                  <td colSpan={n} style={{ ...TD, background: C_SUMMARY, textAlign: 'center' }}>
                    {sc.source_type === 'literal' ? <span style={{ color: '#888', fontSize: 11 }}>{sc.literal || '固定'}</span>
                      : <span style={{ color: '#ccc', fontSize: 10 }}>{sc.source_type === 'input_choice' ? '选择' : '文本'}录入</span>}
                  </td>
                )
              ) : sc.source_type === 'per_row_aggregate' ? (
                sampleIdx.map(ri => (
                  <td key={ri} style={{ ...TD, background: C_AGG, textAlign: 'center' }}>
                    <Tag color="gold" style={{ fontSize: 10, margin: 0 }}>{sc.aggregate === 'sum' ? '∑' : sc.aggregate === 'max' ? 'max' : sc.aggregate === 'min' ? 'min' : 'avg'}</Tag>
                  </td>
                ))
              ) : sc.source_type === 'input_number' ? (
                // 统计列某格（按试样）：可点配公式，与试样格同款，只选该格
                sampleIdx.map(ri => {
                  const sid = `s${ri}`;
                  const tgt: FormulaTarget = { kind: 'other_col_cell', colId: sc.id, sampleIdx: ri };
                  const cellActive = isActive(tgt);
                  const fx = !!sc.cell_formulas?.[sid];
                  return (
                    <td key={ri} style={{ ...TD, background: cellActive ? C_ACTIVE : fx ? C_FX_CELL : C_OTHER, textAlign: 'center', cursor: 'pointer', border: cellActive ? ACTIVE_BORDER : TD.border }}
                      title={fx ? '本格公式：点击编辑' : '点击：配置本格公式（与试样格同款）'}
                      onClick={() => onSelectFormulaTarget(tgt)}>
                      {fx ? <Tag color="cyan" style={{ fontSize: 10, margin: 0 }}>ƒ</Tag> : <span style={{ color: '#ccc', fontSize: 10 }}>录入</span>}
                    </td>
                  );
                })
              ) : (
                sampleIdx.map(ri => (
                  <td key={ri} style={{ ...TD, background: C_OTHER, textAlign: 'center' }}>
                    <span style={{ color: '#ccc', fontSize: 10 }}>{sc.source_type === 'input_choice' ? '选择' : '文本'}</span>
                  </td>
                ))
              )}
              {/* 右侧汇总行列留空 */}
              {summaries.map(sr => <td key={sr.id} style={{ ...TD, background: '#fafafa' }} />)}
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  return (
    <>
    {/* 试样排布：表格正上方醒目开关——决定试样横排还是竖排，也决定报告「试样带」按行还是按列。统计数据表无试样轴，改显提示。 */}
    {config.kind === 'stats' ? (
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10, padding: '8px 12px', background: '#f9f0ff', border: '1px solid #d3adf7', borderRadius: 8 }}>
        <span style={{ fontWeight: 600, color: '#722ed1' }}>统计数据表</span>
        <span style={{ fontSize: 12, color: '#722ed1' }}>行为固定统计项（平均值/最大值/限值…）、无试样轴；报告里逐格绑定（不按试样自动展开）。在「表格用途」可切回试样数据。</span>
      </div>
    ) : (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 10, padding: '8px 12px', background: '#f0f7ff', border: '1px solid #91caff', borderRadius: 8 }}>
      <span style={{ fontWeight: 600, color: '#0958d9' }}>试样排布</span>
      <Segmented
        value={config.sample_axis === 'col' ? 'col' : 'row'}
        onChange={(v) => onChange({ ...config, sample_axis: v as 'row' | 'col' })}
        options={[{ label: '试样为行 ↓', value: 'row' }, { label: '试样为列 →', value: 'col' }]} />
      <Tooltip title="试样为行：每个试样一行、参数为列。试样为列：每个试样一列、参数为行。右侧预览和 PDF 使用相同排布，项目模板据此自动展开试样。">
        <span style={{ color: '#1677ff', cursor: 'help' }}>ⓘ</span>
      </Tooltip>
      {config.sample_axis === 'col' && (
        <span style={{ fontSize: 12, color: '#0958d9' }}>
          试样横向排布：每个试样一列、参数为行（出片同此版式）。汇总列显示在底部、汇总行/统计行显示在右侧。
        </span>
      )}
    </div>
    )}
    {/* 结构工具栏：所有「新增」集中在表格上方，表内不再散落 + 按钮 */}
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <span style={{ fontSize: 12, color: '#8c8c8c' }}>新增：</span>
      <Tooltip title={`试样${sampleUnit}：一条试样的原始测试数据；会算进平均值、在报告里「按试样自动展开」`}>
        <Button size="small" type="primary" ghost icon={<PlusOutlined />} onClick={() => addRow()}>试样{sampleUnit}</Button>
      </Tooltip>
      <Tooltip title={`参数${paramUnit}：一个检测参数/测量项`}>
        <Button size="small" icon={<PlusOutlined />} onClick={() => addColumn()}>参数{paramUnit}</Button>
      </Tooltip>
      <Dropdown trigger={['click']} menu={{ items: [
        { key: 'text', label: '文本', onClick: () => addSummaryVisual('row', false, 'input_text') },
        { key: 'number', label: '数字', onClick: () => addSummaryVisual('row', false, 'input_number') },
        { key: 'choice', label: '选择', onClick: () => addSummaryVisual('row', false, 'input_choice') },
      ] }}>
        <Tooltip title="汇总行：底部一条横行、整行一个值（跨所有列，如「结论：合格」）。需要计算时建数字行再「配置公式」手动配"><Button size="small" icon={<PlusOutlined />}>汇总行</Button></Tooltip>
      </Dropdown>
      <Dropdown trigger={['click']} menu={{ items: [
        { key: 'text', label: '文本', onClick: () => addSummaryVisual('col', false, 'input_text') },
        { key: 'number', label: '数字', onClick: () => addSummaryVisual('col', false, 'input_number') },
        { key: 'choice', label: '选择', onClick: () => addSummaryVisual('col', false, 'input_choice') },
      ] }}>
        <Tooltip title="汇总列：右侧一竖列、整列一个值（跨所有行）"><Button size="small" icon={<PlusOutlined />}>汇总列</Button></Tooltip>
      </Dropdown>
      <Dropdown trigger={['click']} menu={{ items: [
        { key: 'text', label: '文本', onClick: () => addSummaryVisual('row', true, 'input_text') },
        { key: 'number', label: '数字', onClick: () => addSummaryVisual('row', true, 'input_number') },
        { key: 'choice', label: '选择', onClick: () => addSummaryVisual('row', true, 'input_choice') },
      ] }}>
        <Tooltip title="统计行：底部一条横行、逐列每格手填或配公式，但【不算试样】、报告「按试样自动展开」不拉它（用于限值/理论值/判定）"><Button size="small" icon={<PlusOutlined />}>统计行</Button></Tooltip>
      </Dropdown>
      <Dropdown trigger={['click']} menu={{ items: [
        { key: 'text', label: '文本', onClick: () => addSummaryVisual('col', true, 'input_text') },
        { key: 'number', label: '数字', onClick: () => addSummaryVisual('col', true, 'input_number') },
        { key: 'choice', label: '选择', onClick: () => addSummaryVisual('col', true, 'input_choice') },
      ] }}>
        <Tooltip title="统计列：右侧一竖列、逐行每格手填，但【不算试样】（如各试样平均值/判定）"><Button size="small" icon={<PlusOutlined />}>统计列</Button></Tooltip>
      </Dropdown>
      <span style={{ width: 1, height: 18, background: '#e8e8e8' }} />
      <Tooltip title="一次设置试样列和全部参数列；之后仍可单独调整某列。清空恢复自动。">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>整表列宽
          <InputNumber size="small" min={0.3} max={12} step={0.1} style={{ width: 82 }}
            value={sharedMatrixColumnWidth} placeholder={new Set(matrixColumnWidths).size > 1 ? '不一致' : '自动'}
            onChange={(value) => onChange({
              ...config,
              axis_col_width: value == null ? undefined : `${value}fr`,
              parameters: params.map(param => ({ ...param, width: value == null ? undefined : `${value}fr` })),
            })} /> fr
        </span>
      </Tooltip>
      <Tooltip title="一次设置全部试样行的最小行高；之后仍可单独调整某行。清空恢复自适应。">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>整表行高
          <InputNumber size="small" min={0.3} max={12} step={0.1} style={{ width: 82 }}
            value={sharedMatrixRowHeight} placeholder={new Set(matrixRowHeights).size > 1 ? '不一致' : '自适应'}
            onChange={(value) => onChange({
              ...config,
              sample_row_heights: value == null ? undefined : Array.from({ length: n }, () => `${value}cm`),
            })} /> cm
        </span>
      </Tooltip>
      <span style={{ fontSize: 11, color: '#bbb' }}>· 在某行/列表头上双击或右键 → 可在它前后精确插入</span>
    </div>
    {/* ─── 选中表头时的公共操作栏（参数列 / 汇总列：左右移 / 删除） ─── */}
    {selHeader && (() => {
      const barStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8, padding: '6px 10px', background: '#e6f4ff', border: '1px solid #91caff', borderRadius: 6, fontSize: 12, color: '#0958d9' };
      if (selHeader.kind === 'param') {
        const idx = selHeader.idx;
        const p = params[idx];
        if (!p) return null;
        // 试样为列（转置）时参数是「行」→ 上/下移；否则参数是「列」→ 左/右移。移动的都是 parameters 数组。
        const [prevLbl, nextLbl] = colMode ? ['↑ 上移', '下移 ↓'] : ['← 左移', '右移 →'];
        return (
          <div style={barStyle}>
            <span>已选中参数{paramUnit}：<b>{p.label || `参数${idx + 1}`}</b></span>
            <Button size="small" disabled={idx <= 0} onClick={() => { moveColumn(idx, -1); setSelHeader({ kind: 'param', idx: idx - 1 }); }}>{prevLbl}</Button>
            <Button size="small" disabled={idx >= params.length - 1} onClick={() => { moveColumn(idx, 1); setSelHeader({ kind: 'param', idx: idx + 1 }); }}>{nextLbl}</Button>
            <Button size="small" danger icon={<DeleteOutlined />} onClick={() => { removeColumn(idx); setSelHeader(null); }}>删除</Button>
            <Button size="small" type="text" onClick={() => setSelHeader(null)}>取消选中</Button>
          </div>
        );
      }
      const idx = summaryCols.findIndex(c => c.id === selHeader.id);
      const sc = summaryCols[idx];
      if (!sc) return null;
      return (
        <div style={barStyle}>
          <span>已选中汇总列：<b>{sc.label || '汇总列'}</b></span>
          <Button size="small" disabled={idx <= 0} onClick={() => moveSummaryCol(sc.id, -1)}>← 左移</Button>
          <Button size="small" disabled={idx >= summaryCols.length - 1} onClick={() => moveSummaryCol(sc.id, 1)}>右移 →</Button>
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => { removeSummaryCol(sc.id); setSelHeader(null); }}>删除</Button>
          <Button size="small" type="text" onClick={() => setSelHeader(null)}>取消选中</Button>
        </div>
      );
    })()}
    <div ref={wrapRef} style={{ overflowX: 'auto', position: 'relative', border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', boxShadow: '0 1px 3px rgba(16,40,80,0.05)' }} onClick={() => setCtxMenu(null)}>
      {colMode ? renderColTable() : (
      <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
        <thead>
          <tr>
            {/* 左上角 */}
            <th style={{ ...TH, cursor: 'pointer', minWidth: 80, position: 'relative' }} onDoubleClick={() => setEditing({ kind: 'corner' })}>
              {/* 角头默认显示与渲染端一致（PDF 默认"试样"），不再用画布私有的"试样 \ 参数" */}
              {editing?.kind === 'corner' ? (
                <InlineEditor value={config.axis_header ?? '试样'}
                  allowEmpty
                  placeholder="留空 = PDF 上不显示"
                  onCommit={(v) => { updateAxisHeader(v); setEditing(null); }}
                  onCancel={() => setEditing(null)} />
              ) : (
                <span style={{ color: '#666' }}>
                  {config.axis_header === ''
                    ? <span style={{ color: '#bbb', fontStyle: 'italic' }}>(空白)</span>
                    : (config.axis_header ?? '试样')}
                  {config.axis_col_width && <span style={{ fontSize: 9, color: '#999', marginLeft: 3 }}>{config.axis_col_width}</span>}
                </span>
              )}
              <div
                title="拖拽调整 PDF 试样列宽，双击恢复自动"
                onPointerDown={(e) => {
                  e.preventDefault(); e.stopPropagation();
                  (e.target as HTMLElement).setPointerCapture(e.pointerId);
                  setResize({ kind: 'axis', startX: e.clientX, startFr: frOf(config.axis_col_width) });
                }}
                onPointerMove={(e) => {
                  if (resize?.kind !== 'axis') return;
                  const fr = Math.max(0.3, Math.round((resize.startFr + (e.clientX - resize.startX) / 60) * 10) / 10);
                  onChange({ ...config, axis_col_width: `${fr}fr` });
                }}
                onPointerUp={(e) => { (e.target as HTMLElement).releasePointerCapture(e.pointerId); setResize(null); }}
                onDoubleClick={(e) => { e.stopPropagation(); onChange({ ...config, axis_col_width: undefined }); }}
                style={{ position: 'absolute', top: 0, right: -3, width: 7, height: '100%', cursor: 'col-resize', zIndex: 2 }}
              />
            </th>
            {/* 列头 */}
            {params.map((p, pi) => {
              const hasF = !!(p.cell_formula?.trim());
              const active = isActive({ kind: 'cell_col', paramIdx: pi });
              const noteText = p.unit ? ` (${p.unit})` : (p.unit_options?.length ? ` (${p.unit_options.join('/')})` : '');
              const isEditingCol = editing?.kind === 'col_header' && editing.paramIdx === pi;
              return (
                <th key={p.code}
                  title="单击选中（上方出现左右移/删除操作栏）；双击配置（标题/分组/备注）；右键同；拖右缘调 PDF 列宽"
                  style={{ ...TH, cursor: 'pointer', background: active ? '#e6f4ff' : hasF ? '#fff7e6' : '#fafafa', border: active ? '2px solid #1677ff' : TH.border, minWidth: 90, position: 'relative', ...(selHeader?.kind === 'param' && selHeader.idx === pi ? { outline: '2px solid #1677ff', outlineOffset: -2 } : {}) }}
                  onClick={() => toggleHeaderSel({ kind: 'param', idx: pi })}
                  onContextMenu={(e) => openCfg(e, 'param', pi)}
                  onDoubleClick={(e) => openCfg(e, 'param', pi)}
                >
                  {/* 默认值/小数位已迁出列头卡：默认值=数据格右键、小数位=矩阵工具栏整表配置 */}
                  <HeaderConfigCard
                    title="列设置"
                    open={cfgCard?.kind === 'param' && cfgCard.key === pi}
                    closeOnOutsideClick onClose={() => setCfgCard(null)}
                    showGroup
                    value={{
                      label: p.label,
                      group: p.group,
                      note: p.unit,
                      note_options: p.unit_options,
                      note_allow_custom: p.unit_allow_custom,
                    }}
                    onSave={(patch) => updateParam(pi, {
                      label: patch.label,
                      group: patch.group,
                      unit: patch.note,
                      unit_options: patch.note_options,
                      unit_allow_custom: patch.note_allow_custom,
                    })}
                    extra={
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontSize: 12, color: '#555' }}>列宽</span>
                        <InputNumber size="small" style={{ width: 90 }} min={0.3} max={8} step={0.1} placeholder="自动"
                          value={(p.width && /fr$/.test(p.width)) ? parseFloat(p.width) : undefined}
                          onChange={(v) => updateParam(pi, { width: v ? `${v}fr` : undefined })} />
                        <span style={{ fontSize: 11, color: '#999' }}>fr（留空=自动）</span>
                      </div>
                    }
                    actions={[
                      { key: 'il', label: '← 左插列', onClick: () => addColumn(pi > 0 ? pi - 1 : undefined) },
                      { key: 'ir', label: '右插列 →', onClick: () => addColumn(pi) },
                      ...(!isTextMatrix ? [{ key: 'f', label: 'ƒ 按行公式', onClick: () => onSelectFormulaTarget({ kind: 'cell_col' as const, paramIdx: pi }) }] : []),
                      { key: 'del', label: '删除此列', danger: true, onClick: () => removeColumn(pi) },
                    ]}
                  >
                    {isEditingCol ? (
                      <InlineEditor value={p.label} onCommit={(v) => { updateParam(pi, { label: v }); setEditing(null); }} onCancel={() => setEditing(null)} />
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                        {p.group && <Tag color="blue" style={{ fontSize: 10, margin: 0 }}>▭ {p.group}</Tag>}
                        <span>
                          {p.label || `参数${pi + 1}`}{noteText}
                          {p.width && <span style={{ fontSize: 9, color: '#999', marginLeft: 3 }}>{p.width}</span>}
                        </span>
                        {hasF && <Tag color="orange" style={{ fontSize: 10, margin: 0 }}>ƒ ={p.cell_formula}</Tag>}
                      </div>
                    )}
                  </HeaderConfigCard>
                  <div
                    title="拖拽调整 PDF 列宽，双击恢复自动"
                    onPointerDown={(e) => {
                      e.preventDefault(); e.stopPropagation();
                      (e.target as HTMLElement).setPointerCapture(e.pointerId);
                      setResize({ kind: 'col', idx: pi, startX: e.clientX, startFr: frOf(p.width) });
                    }}
                    onPointerMove={(e) => {
                      if (resize?.kind !== 'col' || resize.idx !== pi) return;
                      const fr = Math.max(0.3, Math.round((resize.startFr + (e.clientX - resize.startX) / 60) * 10) / 10);
                      updateParam(pi, { width: `${fr}fr` });
                    }}
                    onPointerUp={(e) => { (e.target as HTMLElement).releasePointerCapture(e.pointerId); setResize(null); }}
                    onDoubleClick={(e) => { e.stopPropagation(); updateParam(pi, { width: undefined }); }}
                    style={{ position: 'absolute', top: 0, right: -3, width: 7, height: '100%', cursor: 'col-resize', zIndex: 2 }}
                  />
                </th>
              );
            })}
            {/* 汇总列头 */}
            {summaryCols.map(sc => {
              const isSc = editing?.kind === 'summary_col_label' && editing.colId === sc.id;
              const scNote = sc.unit ? ` (${sc.unit})` : (sc.unit_options?.length ? ` (${sc.unit_options.join('/')})` : '');
              return (
                <th key={sc.id} style={{ ...TH, background: '#fff7e6', minWidth: 80, cursor: 'pointer', ...(selHeader?.kind === 'sumcol' && selHeader.id === sc.id ? { outline: '2px solid #1677ff', outlineOffset: -2 } : {}) }}
                  title="单击选中（上方出现左右移/删除操作栏）；双击配置（标题/备注/删除）；右键同"
                  onClick={() => toggleHeaderSel({ kind: 'sumcol', id: sc.id })}
                  onDoubleClick={(e) => openCfg(e, 'sumcol', sc.id)}
                  onContextMenu={(e) => openCfg(e, 'sumcol', sc.id)}>
                  <HeaderConfigCard
                    title="汇总列设置"
                    open={cfgCard?.kind === 'sumcol' && cfgCard.key === sc.id}
                    closeOnOutsideClick onClose={() => setCfgCard(null)}
                    value={{
                      label: sc.label,
                      note: sc.unit,
                      note_options: sc.unit_options,
                      note_allow_custom: sc.unit_allow_custom,
                    }}
                    onSave={(patch) => onChange({
                      ...config,
                      summary_cols: summaryCols.map(c => c.id === sc.id ? {
                        ...c, label: patch.label, unit: patch.note,
                        unit_options: patch.note_options, unit_allow_custom: patch.note_allow_custom,
                      } : c),
                    })}
                    actions={[{ key: 'del', label: '删除此汇总列', danger: true, onClick: () => removeSummaryCol(sc.id) }]}
                  >
                    {isSc ? (
                      <InlineEditor
                        value={sc.label}
                        onCommit={(v) => { updateSummaryColLabel(sc.id, v); setEditing(null); }}
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
                      <span style={{ color: '#d48806' }}
                        onDoubleClick={(e) => openCfg(e, 'sumcol', sc.id)}>
                        {sc.label}{scNote}{' '}
                        {sc.source_type === 'per_row_aggregate'
                          ? <Tag color="gold" style={{ fontSize: 10, margin: 0 }}>{sc.aggregate || 'avg'}</Tag>
                          : sc.source_type === 'literal'
                            ? <Tag color="default" style={{ fontSize: 10, margin: 0 }}>固定</Tag>
                            : <Tag color="blue" style={{ fontSize: 10, margin: 0 }}>{sc.source_type === 'input_number' ? '数字' : sc.source_type === 'input_choice' ? '选择' : '文本'}录入</Tag>}
                      </span>
                    )}
                    {/* 录入型选择列：在列头配置选项（一次配置，所有试样行该列共用） */}
                    {sc.source_type === 'input_choice' && (
                      <div style={{ marginTop: 4 }} onDoubleClick={(e) => e.stopPropagation()}>
                        <ChoicesInlineEditor
                          choices={sc.choices || []}
                          allowCustom={!!sc.allow_custom}
                          onChange={(choices, allow_custom) => updateSummaryCol(sc.id, { choices, allow_custom })}
                        />
                      </div>
                    )}
                  </HeaderConfigCard>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {/* 试样行（可变试样数据） */}
          {Array.from({ length: n }, (_, ri) => (
            <tr key={ri}>
              <td style={{ ...TH, background: C_SAMPLE_HDR, cursor: 'pointer', fontWeight: 'bold', textAlign: 'center', position: 'relative' }}
                title="双击配置（试样名/分组/备注/插入/删除）；右键同；拖下缘调 PDF 最小行高"
                onDoubleClick={(e) => openCfg(e, 'row', ri)}
                onContextMenu={(e) => openCfg(e, 'row', ri)}>
                <HeaderConfigCard
                  title="行设置"
                  open={cfgCard?.kind === 'row' && cfgCard.key === ri}
                  closeOnOutsideClick onClose={() => setCfgCard(null)}
                  showGroup
                  value={{
                    label: rowLabel(ri),
                    group: config.sample_groups?.[ri] || undefined,
                    note: config.sample_notes?.[ri]?.note,
                    note_options: config.sample_notes?.[ri]?.note_options,
                    note_allow_custom: config.sample_notes?.[ri]?.note_allow_custom,
                  }}
                  onSave={(patch) => saveRowCfg(ri, patch)}
                  extra={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontSize: 12, color: '#555' }}>行高</span>
                      <InputNumber size="small" style={{ width: 90 }} min={0} max={20} step={0.1} placeholder="自动"
                        value={cmOf(config.sample_row_heights?.[ri]) || undefined}
                        onChange={(v) => setRowHeight(ri, v != null ? v : null)} />
                      <span style={{ fontSize: 11, color: '#999' }}>cm（留空=自动）</span>
                    </div>
                  }
                  actions={[
                    { key: 'ia', label: '↑ 上插行', onClick: () => addRow(ri > 0 ? ri - 1 : undefined) },
                    { key: 'ib', label: '下插行 ↓', onClick: () => addRow(ri) },
                    ...(n > 1 ? [{ key: 'del', label: '删除此行', danger: true, onClick: () => removeRow(ri) }] : []),
                  ]}
                >
                  {editing?.kind === 'row_header' && editing.rowIdx === ri ? (
                    <InlineEditor value={rowLabel(ri)} onCommit={(v) => { updateRowLabel(ri, v); setEditing(null); }} onCancel={() => setEditing(null)} />
                  ) : (
                    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                      {config.sample_groups?.[ri] && <Tag color="blue" style={{ fontSize: 10, margin: 0 }}>▭ {config.sample_groups[ri]}</Tag>}
                      <span>
                        {rowLabel(ri)}
                        {config.sample_notes?.[ri]?.note ? ` (${config.sample_notes[ri]!.note})`
                          : config.sample_notes?.[ri]?.note_options?.length ? ` (${config.sample_notes[ri]!.note_options!.join('/')})` : ''}
                        {config.sample_row_heights?.[ri] && (
                          <span style={{ fontSize: 9, color: '#999', marginLeft: 3 }}>↕{config.sample_row_heights[ri]}</span>
                        )}
                      </span>
                    </span>
                  )}
                </HeaderConfigCard>
                <div
                  title="拖拽调整 PDF 最小行高（内容多时仍自动撑开），双击恢复自适应"
                  onPointerDown={(e) => {
                    e.preventDefault(); e.stopPropagation();
                    (e.target as HTMLElement).setPointerCapture(e.pointerId);
                    setResize({ kind: 'row', idx: ri, startY: e.clientY, startCm: cmOf(config.sample_row_heights?.[ri]) });
                  }}
                  onPointerMove={(e) => {
                    if (resize?.kind !== 'row' || resize.idx !== ri) return;
                    const cm = Math.max(0.4, Math.round((resize.startCm + (e.clientY - resize.startY) / 37.8) * 20) / 20);
                    setRowHeight(ri, cm);
                  }}
                  onPointerUp={(e) => { (e.target as HTMLElement).releasePointerCapture(e.pointerId); setResize(null); }}
                  onDoubleClick={(e) => { e.stopPropagation(); setRowHeight(ri, null); }}
                  style={{ position: 'absolute', left: 0, bottom: -3, width: '100%', height: 7, cursor: 'row-resize', zIndex: 2 }}
                />
              </td>
              {params.map((p, pi) => {
                const hasColF = !!(p.cell_formula?.trim());
                const cellKey = matrixDataKey(`s${ri}`, p.code);
                const hasCellF = !!(config.cell_formulas?.[cellKey]);
                const cellDefault = config.cell_defaults?.[cellKey];
                const tgt: FormulaTarget = { kind: 'cell', sampleIdx: ri, paramIdx: pi };
                const active = isActive(tgt);
                const clickable = !isTextMatrix && !hasColF;
                return (
                  <td key={p.code}
                    title="右键：配置默认值 / 公式"
                    style={{ ...TD, cursor: 'pointer', background: active ? C_ACTIVE : hasCellF ? C_FX_CELL : hasColF ? C_FORMULA : C_SAMPLE, textAlign: 'center', border: active ? ACTIVE_BORDER : TD.border }}
                    onClick={() => clickable && onSelectFormulaTarget(tgt)}
                    onContextMenu={(e) => cellCtx(e, ri, pi)}>
                    {hasColF ? <Tag color="orange" style={{ fontSize: 10, margin: 0 }}>ƒ 列</Tag>
                      : hasCellF ? <Tag color="cyan" style={{ fontSize: 10, margin: 0 }}>ƒ</Tag>
                      : (cellDefault ?? '') !== '' ? <span style={{ color: '#8c8c8c', fontSize: 10 }}>默:{cellDefault}</span>
                      : isTextMatrix ? <span style={{ color: '#bbb', fontSize: 10 }}>文本</span>
                      : <span style={{ color: '#ccc', fontSize: 10 }}>录入</span>}
                  </td>
                );
              })}
              {/* 汇总列(跨行 per_row=false)＝首行 rowspan 单值；统计列(逐行)＝每行一格 */}
              {summaryCols.map(sc => {
                if (sc.per_row === false) {
                  if (ri !== 0) return null;
                  // 汇总列(跨行单值)·数字：点击→配「跨行公式」（整列算一个值）
                  if (sc.source_type === 'input_number' || (sc.source_type === 'formula')) {
                    const tgt: FormulaTarget = { kind: 'sumcol_span_formula', colId: sc.id };
                    const cellActive = isActive(tgt);
                    const fx = sc.source_type === 'formula' && !!sc.formula;
                    return (
                      <td key={sc.id} rowSpan={n}
                        style={{ ...TD, background: cellActive ? C_ACTIVE : fx ? C_FX_CELL : C_SUMMARY, textAlign: 'center', verticalAlign: 'middle', cursor: 'pointer', border: cellActive ? ACTIVE_BORDER : TD.border }}
                        title={fx ? '跨行公式（整列一个值）：点击编辑' : '点击：配置本汇总列的公式（整列算一个值）；不配＝录入时手填'}
                        onClick={() => onSelectFormulaTarget(tgt)}>
                        {fx ? <Tag color="gold" style={{ fontSize: 10, margin: 0 }}>ƒ</Tag>
                          : <span style={{ color: '#ccc', fontSize: 10 }}>数字录入 · 点击设公式</span>}
                      </td>
                    );
                  }
                  return (
                    <td key={sc.id} rowSpan={n} style={{ ...TD, background: C_SUMMARY, textAlign: 'center', verticalAlign: 'middle' }}>
                      {sc.source_type === 'literal' ? <span style={{ color: '#888', fontSize: 11 }}>{sc.literal || '固定'}</span>
                        : <span style={{ color: '#ccc', fontSize: 10 }}>{sc.source_type === 'input_choice' ? '选择' : '文本'}录入</span>}
                    </td>
                  );
                }
                // 统计列(per_row)·数字：每格可点→配逐格公式（与试样格/统计行同款），只选该格
                if (sc.source_type === 'input_number') {
                  const sid = `s${ri}`;
                  const tgt: FormulaTarget = { kind: 'other_col_cell', colId: sc.id, sampleIdx: ri };
                  const cellActive = isActive(tgt);
                  const fx = !!sc.cell_formulas?.[sid];
                  return (
                    <td key={sc.id}
                      style={{ ...TD, background: cellActive ? C_ACTIVE : fx ? C_FX_CELL : C_OTHER, textAlign: 'center', cursor: 'pointer', border: cellActive ? ACTIVE_BORDER : TD.border }}
                      title={fx ? '本格公式：点击编辑（与试样格同款）' : '点击：配置本格公式（与试样格同款）；不配＝录入时手填'}
                      onClick={() => onSelectFormulaTarget(tgt)}>
                      {fx ? <Tag color="cyan" style={{ fontSize: 10, margin: 0 }}>ƒ</Tag>
                        : <span style={{ color: '#ccc', fontSize: 10 }}>录入</span>}
                    </td>
                  );
                }
                return (
                  <td key={sc.id} style={{ ...TD, background: sc.source_type === 'per_row_aggregate' ? C_AGG : C_OTHER, textAlign: 'center' }}>
                    {sc.source_type === 'per_row_aggregate'
                      ? <Tag color="gold" style={{ fontSize: 10, margin: 0 }}>{sc.aggregate === 'sum' ? '∑' : sc.aggregate === 'max' ? 'max' : sc.aggregate === 'min' ? 'min' : 'avg'}</Tag>
                      : sc.source_type === 'literal'
                        ? <span style={{ color: '#888', fontSize: 11 }}>{sc.literal || '固定'}</span>
                        : <span style={{ color: '#ccc', fontSize: 10 }}>录入</span>}
                  </td>
                );
              })}
            </tr>
          ))}
          {/* 汇总行 */}
          {summaries.map((sr, si) => {
            const editable = sr.source_type === 'per_column_aggregate' || sr.source_type === 'formula' || sr.source_type === 'input_number';
            const kind: FormulaTarget['kind'] = sr.source_type === 'per_column_aggregate' ? 'per_column' : 'summary_formula';
            const tgt: FormulaTarget = { kind, rowIdx: si };
            const active = editable && isActive(tgt);
            const isInput = ['input_text', 'input_number', 'input_choice'].includes(sr.source_type);
            // 统计行（per_column 录入，非试样）＝紫；每列统计＝绿；跨列公式＝黄；跨列录入＝灰
            const rowBg = active ? C_ACTIVE : (sr.per_column && isInput) ? C_OTHER : sr.source_type === 'per_column_aggregate' ? C_AGG : sr.source_type === 'formula' ? C_FORMULA : '#fafafa';

            return (
              <tr key={sr.id}>
                <td style={{ ...TH, fontWeight: 'bold', background: rowBg, cursor: 'pointer', position: 'relative' }}
                  onDoubleClick={(e) => openCfg(e, 'sumrow', si)}
                  onContextMenu={(e) => openCfg(e, 'sumrow', si)}
                  title="双击配置（行名/备注/默认值/删除）；右键同">
                  <HeaderConfigCard
                    title="汇总行设置"
                    open={cfgCard?.kind === 'sumrow' && cfgCard.key === si}
                    closeOnOutsideClick onClose={() => setCfgCard(null)}
                    showDefault={sr.source_type === 'input_choice' ? 'choice' : isInput}
                    defaultChoices={sr.choices}
                    value={{
                      label: sr.label,
                      note: sr.note,
                      note_options: sr.note_options,
                      note_allow_custom: sr.note_allow_custom,
                      default_value: sr.default_value,
                    }}
                    onSave={(patch) => updateSummaryRow(si, {
                      label: patch.label,
                      note: patch.note,
                      note_options: patch.note_options,
                      note_allow_custom: patch.note_allow_custom,
                      default_value: patch.default_value,
                    })}
                    actions={[
                      ...(sr.source_type === 'per_column_aggregate' ? [{ key: 'f', label: 'ƒ 编辑统计', onClick: () => onSelectFormulaTarget({ kind: 'per_column' as const, rowIdx: si }) }] : []),
                      ...(sr.source_type === 'formula' ? [{ key: 'f', label: 'ƒ 编辑公式', onClick: () => onSelectFormulaTarget({ kind: 'summary_formula' as const, rowIdx: si }) }] : []),
                      // 跨列数字行 → 点此转成「整行公式」（统计行的逐列公式改为点格配置，不走这里）
                      ...(sr.source_type === 'input_number' && !sr.per_column ? [{ key: 'f', label: 'ƒ 配置公式（整行算一个值）', onClick: () => configureSummaryFormula(si) }] : []),
                      { key: 'del', label: '删除此汇总行', danger: true, onClick: () => removeSummaryRow(si) },
                    ]}
                  >
                  {editing?.kind === 'summary_label' && editing.rowIdx === si ? (
                    <InlineEditor value={sr.label} onCommit={(v) => { updateSummaryLabel(si, v); setEditing(null); }} onCancel={() => setEditing(null)} />
                  ) : (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                      <span style={{ flex: 1 }}>
                        {sr.label || '(双击编辑)'}
                        {sr.note ? ` (${sr.note})` : sr.note_options?.length ? ` (${sr.note_options.join('/')})` : ''}
                      </span>
                      <Tooltip title="上移">
                        <Button size="small" type="text" icon={<ArrowUpOutlined style={{ fontSize: 10 }} />}
                          disabled={si === 0}
                          style={{ padding: 0, height: 16, width: 16 }}
                          onClick={(e) => { e.stopPropagation(); moveSummaryRow(si, -1); }} />
                      </Tooltip>
                      <Tooltip title="下移">
                        <Button size="small" type="text" icon={<ArrowDownOutlined style={{ fontSize: 10 }} />}
                          disabled={si === summaries.length - 1}
                          style={{ padding: 0, height: 16, width: 16 }}
                          onClick={(e) => { e.stopPropagation(); moveSummaryRow(si, 1); }} />
                      </Tooltip>
                      <Button size="small" type="text" danger icon={<DeleteOutlined />}
                        style={{ padding: 0, height: 16, width: 16 }}
                        onClick={(e) => { e.stopPropagation(); removeSummaryRow(si); }} />
                    </span>
                  )}
                  </HeaderConfigCard>
                </td>
                {sr.source_type === 'per_column_aggregate' ? (
                  params.map(p => (
                    <td key={p.code} style={{ ...TD, background: rowBg, textAlign: 'center', cursor: 'pointer' }}
                      onClick={() => onSelectFormulaTarget(tgt)}>
                      <Tag color="green" style={{ fontSize: 10, margin: 0 }}>{sr.aggregate === 'sum' ? '求和' : sr.aggregate === 'max' ? '最大' : sr.aggregate === 'min' ? '最小' : '均值'}</Tag>
                    </td>
                  ))
                ) : (sr.per_column && isInput) ? (
                  sr.source_type === 'input_choice' ? (
                    <td colSpan={params.length} style={{ ...TD, background: C_OTHER }}>
                      <span style={{ fontSize: 10, color: '#722ed1', marginRight: 6 }}>统计行·每列从这些选项选：</span>
                      <ChoicesInlineEditor choices={sr.choices || []} allowCustom={!!sr.allow_custom}
                        onChange={(choices, allow_custom) => updateSummaryRow(si, { choices, allow_custom })} />
                    </td>
                  ) : (
                    // 统计行的格子＝和试样格完全一样：点格→复用试样格公式面板（不另做组件）
                    params.map((p, pi) => {
                      const canFx = sr.source_type === 'input_number';
                      const fx = !!sr.cell_formulas?.[p.code];
                      const tgt: FormulaTarget = { kind: 'other_cell', rowIdx: si, paramIdx: pi };
                      const cellActive = canFx && isActive(tgt);
                      return (
                        <td key={p.code}
                          style={{ ...TD, background: cellActive ? C_ACTIVE : fx ? C_FX_CELL : canFx ? C_OTHER : '#f5f5f5', textAlign: 'center', cursor: canFx ? 'pointer' : 'default', border: cellActive ? ACTIVE_BORDER : TD.border }}
                          title={canFx ? '点击：配置本格公式（与试样格相同）；不配＝录入时手填' : '录入时手填'}
                          onClick={() => { if (canFx) onSelectFormulaTarget(tgt); }}>
                          {fx ? <Tag color="cyan" style={{ fontSize: 10, margin: 0 }}>ƒ</Tag>
                            : <span style={{ color: '#ccc', fontSize: 10 }}>{canFx ? '录入' : '文本'}</span>}
                        </td>
                      );
                    })
                  )
                ) : (
                  <td colSpan={params.length} style={{ ...TD, background: rowBg, textAlign: 'center', cursor: editable ? 'pointer' : 'default' }}
                    onClick={() => editable && onSelectFormulaTarget(tgt)}>
                    {sr.source_type === 'formula' && sr.formula && <Tag color="gold" style={{ fontSize: 10 }}>{FORMULA_TYPES.find(t => t.type === sr.formula?.type)?.label || sr.formula.type} ({sr.formula.sources?.length || 0}项)</Tag>}
                    {sr.source_type === 'formula' && !sr.formula && <span style={{ color: '#faad14', fontSize: 11 }}>点击配置...</span>}
                    {sr.source_type === 'input_number' && <Tag color="blue" style={{ fontSize: 10 }}>数字录入 · 点击设公式</Tag>}
                    {sr.source_type === 'input_text' && <Tag color="blue" style={{ fontSize: 10 }}>文本录入</Tag>}
                    {sr.source_type === 'input_choice' && (
                      <ChoicesInlineEditor
                        choices={sr.choices || []}
                        allowCustom={!!sr.allow_custom}
                        onChange={(choices, allow_custom) => updateSummaryRow(si, { choices, allow_custom })}
                      />
                    )}
                    {sr.source_type === 'literal' && <span style={{ color: '#888', fontSize: 11 }}>固定：{sr.literal}</span>}
                  </td>
                )}
                {/* 汇总行 × 汇总列：留空 */}
                {summaryCols.map(sc => <td key={sc.id} style={{ ...TD, background: '#fafafa' }} />)}
              </tr>
            );
          })}
        </tbody>
      </table>
      )}

      {/* 右键菜单（绝对定位） */}
      {ctxMenu && (
        <div style={{ position: 'absolute', left: ctxMenu.x, top: ctxMenu.y, zIndex: 1000 }}>
          <Dropdown menu={{ items: ctxMenu.items, onClick: () => setCtxMenu(null) }} open={true} onOpenChange={(v) => { if (!v) setCtxMenu(null); }}>
            <span />
          </Dropdown>
        </div>
      )}

      {/* 单元格默认值编辑（数据格右键「配置默认值」） */}
      <Modal
        open={!!defaultEdit}
        title={defaultEdit ? `单元格默认值 · ${rowLabel(defaultEdit.si)} / ${params[defaultEdit.pi]?.label || ''}` : ''}
        onCancel={() => setDefaultEdit(null)}
        onOk={saveCellDefault}
        okText="保存"
        width={380}
        destroyOnHidden
      >
        <p style={{ fontSize: 12, color: '#888', marginTop: 0 }}>
          录入时该格预填此值（实验员可改）；清空 = 移除默认值。仅对模板内的这一格生效，录入期新增的行回退列级存量默认值。
        </p>
        <AutoGrowTextArea
          autoFocus
          value={defaultEdit?.value ?? ''}
          onChange={(e) => setDefaultEdit(d => d ? { ...d, value: e.target.value } : d)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveCellDefault(); } }}
          placeholder={isTextMatrix ? '如：符合' : '如：23.5'}
        />
      </Modal>
    </div>
    {/* 图例：颜色区分三类区域 */}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 8, fontSize: 11, color: '#8c8c8c' }}>
      <LegendItem color={C_SAMPLE} label="试样数据（可变·报告按试样展开）" />
      <LegendItem color={C_OTHER} label="统计行 / 统计列（逐格手填，不算试样：限值/平均/判定等）" />
      <LegendItem color={C_SUMMARY} label="汇总行 / 汇总列（整行 / 整列一个值）" />
    </div>
    </>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 12, height: 12, background: color, border: '1px solid #d0d7e2', borderRadius: 2, display: 'inline-block' }} />
      {label}
    </span>
  );
}

const TH: React.CSSProperties = { border: '1px solid #e2e8f0', padding: '6px 8px', background: '#f2f5fb', color: '#26334d', fontWeight: 500 };
const TD: React.CSSProperties = { border: '1px solid #e8edf3', padding: '5px 7px' };

/**
 * 内联选项编辑器：input_choice 类型汇总行专用
 * 支持：通过 tags 模式输入选项 + 切换"允许其他（自定义）"
 */
function ChoicesInlineEditor({
  choices, allowCustom, onChange,
}: {
  choices: string[];
  allowCustom: boolean;
  onChange: (choices: string[], allowCustom: boolean) => void;
}) {
  return (
    <Space size={6} onClick={(e) => e.stopPropagation()} style={{ width: '100%', justifyContent: 'center' }}>
      <Tag color="blue" style={{ fontSize: 10, margin: 0 }}>选择框</Tag>
      <AntSelect
        mode="tags"
        size="small"
        style={{ minWidth: 220 }}
        value={choices}
        onChange={(v) => onChange(v, allowCustom)}
        placeholder="输入选项，回车添加（如 符合 / 不符合）"
        tokenSeparators={[',', '，']}
      />
      <Tooltip title="允许实验员录入时填'其他（自定义）'">
        <Space size={4}>
          <Switch size="small" checked={allowCustom} onChange={(v) => onChange(choices, v)} />
          <span style={{ fontSize: 11, color: '#888' }}>其他</span>
        </Space>
      </Tooltip>
    </Space>
  );
}
