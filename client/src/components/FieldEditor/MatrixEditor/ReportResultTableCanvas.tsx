/**
 * ReportResultTableCanvas — 项目报告"检测结果表"的画布式编辑器
 *
 * UX 与原始记录的 MatrixEditor 高度相似：
 *  - 顶部表格画布：可改行/列表头（双击）、+列、+行、+汇总行、右键删除
 *  - 单击数据格 → 选中该格作为"目标"；下方展开"数据源选择"画布
 *  - 数据源画布：tabs（关联原始记录的每个矩阵 / 其他字段 / 自定义等）→ 点击源即绑定
 */
import { useState } from 'react';
import { Button, Tag, Tooltip, Input, InputNumber, Segmented, Switch, Radio, Popover } from 'antd';
import { PlusOutlined, ArrowUpOutlined, ArrowDownOutlined, DeleteOutlined } from '@ant-design/icons';
import type { FieldDefinition, RecordTemplate, CellBinding } from '../../../../../shared/types';
import BindingPickerModal, { BindingSummary } from '../../ReportEditor/BindingPickerModal';
import HeaderConfigCard from './HeaderConfigCard';

interface Props {
  field: FieldDefinition;
  onChange: (patch: Partial<FieldDefinition>) => void;
  linkedRecord: RecordTemplate | null;
}

// P-Map-11：项目检测结果表只暴露【原始记录】来源（统一 BindingPicker），其余（委托单/样品/测试/报告接口/系统）属首页。
const RESULT_TABLE_SOURCES = ['literal', 'record_field', 'record_cell', 'record_summary', 'record_header'];
// 表头（标题/备注）绑定只用原始记录里"按 code 取的"来源——字段 / 表头单位；不含具体某格/某汇总值（那是数据格的事）。
const HEADER_SOURCES = ['literal', 'record_field', 'record_header'];
// P-Map-13c：统计行/列(逐行/列绑定)＝紫(与原始记录"其他/统计"统一)；汇总行/列(跨)＝橙。区分两类。
const C_STATS = '#f9f0ff';

export default function ReportResultTableCanvas({ field, onChange, linkedRecord }: Props) {
  const cfg = field.result_table || {
    // 不使用试样带：最左「试样编号」行头列（行头默认 1/2/3，可编辑）+ 数据列；默认 3 行
    columns: [
      { id: 'col_sn', label: '试样编号', row_header: true },
      { id: 'col_item', label: '项目' },
      { id: 'col_standard', label: '标准要求' },
      { id: 'col_result', label: '测试结果' },
      { id: 'col_concl', label: '结论' },
    ],
    rows: [
      { id: 'r1', label: '1' },
      { id: 'r2', label: '2' },
      { id: 'r3', label: '3' },
    ],
    cells: [],
    summary_rows: [],
    summary_cols: [],
  } as NonNullable<FieldDefinition['result_table']>;

  // ─── 当前选中的"目标格"（用于绑定）──────────────────────────────
  type Target =
    | { kind: 'data'; rowId: string; colId: string }
    | { kind: 'sum_row'; sumRowId: string }
    | { kind: 'sum_row_cell'; sumRowId: string; colId: string }  // 按列汇总行的某一列格
    | { kind: 'sum_col'; sumColId: string }
    | { kind: 'sum_col_cell'; sumColId: string; rowId: string }  // 其他列(per_row)的某一行格
    // 表头目标（点表头→下方出现绑定面板，可绑「名称」或「备注/单位」）
    | { kind: 'col_h'; colId: string }
    | { kind: 'row_h'; rowId: string }   // P-Map-13c：行头(按列时参数行)——与列头同款绑定
    | { kind: 'sumrow_h'; id: string }
    | { kind: 'sumcol_h'; id: string };
  const [target, setTarget] = useState<Target | null>(null);
  // 表头单击选中/再次单击取消（选中即驱动上方操作栏 + 下方绑定面板）
  const toggleTarget = (t: Target) => setTarget(cur => (cur && JSON.stringify(cur) === JSON.stringify(t)) ? null : t);
  // 当前选中所在的行/列序号——表头(row_h/col_h)或数据格(data)都算，供"按选中处插入"用
  const selRowIdx = (): number => {
    const t = target as any;
    if (t?.kind === 'row_h') return (cfg.rows || []).findIndex(r => r.id === t.rowId);
    if (t?.kind === 'data') return (cfg.rows || []).findIndex(r => r.id === t.rowId);
    return -1;
  };
  const selColIdx = (): number => {
    const t = target as any;
    if (t?.kind === 'col_h') return (cfg.columns || []).findIndex(c => c.id === t.colId);
    if (t?.kind === 'data') return (cfg.columns || []).findIndex(c => c.id === t.colId);
    return -1;
  };
  // P-Map-11：统一绑定弹窗开关（点"选择/修改数据源"才开）
  const [bindOpen, setBindOpen] = useState(false);
  // 表头绑定时正在编辑哪一部分：名称(label) 或 备注/单位(note)
  const [hdrPart, setHdrPart] = useState<'label' | 'note'>('label');


  // ─── 列配置卡（双击/右键列头弹出，与原始记录数据表格同款 HeaderConfigCard）──────
  const [colCard, setColCard] = useState<string | null>(null);   // 静态列
  const [rowCard, setRowCard] = useState<string | null>(null);   // P-Map-13c：行头(按列参数行)配置卡
  const [sumColCard, setSumColCard] = useState<string | null>(null);  // 汇总列表头（P-Map-12：与数据列同款卡）
  const [sumRowCard, setSumRowCard] = useState<string | null>(null);  // 汇总行表头


  // 列宽/行高改为只在配置卡里用数字旋钮调整（不再有表头/行缘拖拽把手）。

  const update = (patch: Partial<NonNullable<FieldDefinition['result_table']>>) => {
    onChange({ result_table: { ...cfg, ...patch } });
  };

  // ─── 行列操作 ────────────────────────────────────────────────────
  const updateRow = (rowId: string, patch: any) => {
    update({ rows: cfg.rows.map(r => r.id === rowId ? { ...r, ...patch } : r) });
  };
  const updateCol = (colId: string, patch: any) => {
    update({ columns: cfg.columns.map(c => c.id === colId ? { ...c, ...patch } : c) });
  };
  const addRow = () => {
    const id = `r_${Date.now()}`;
    // 选中了某行(行头或该行某格) → 在其下方插入；否则末尾追加
    const at = selRowIdx();
    const rows = [...cfg.rows];
    if (at >= 0) rows.splice(at + 1, 0, { id, label: '' }); else rows.push({ id, label: '' });
    update({ rows });
  };
  const removeRow = (rowId: string) => {
    update({ rows: cfg.rows.filter(r => r.id !== rowId), cells: cfg.cells.filter(c => c.rowId !== rowId) });
    if (target && target.kind === 'data' && target.rowId === rowId) setTarget(null);
  };
  const moveRow = (idx: number, dir: -1 | 1) => {
    const next = [...cfg.rows];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    update({ rows: next });
  };
  const addCol = () => {
    const id = `c_${Date.now()}`;
    const newCol = { id, label: `列${cfg.columns.length + 1}` };
    // 选中了某列(列头或该列某格) → 在其右侧插入；否则末尾追加
    const at = selColIdx();
    const cols = [...cfg.columns];
    if (at >= 0) cols.splice(at + 1, 0, newCol); else cols.push(newCol);
    update({ columns: cols });
  };
  const removeCol = (colId: string) => {
    update({ columns: cfg.columns.filter(c => c.id !== colId), cells: cfg.cells.filter(c => c.colId !== colId) });
    if (target && target.kind === 'data' && target.colId === colId) setTarget(null);
  };
  const moveCol = (idx: number, dir: -1 | 1) => {
    const next = [...cfg.columns];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    update({ columns: next });
  };

  const setCellBinding = (rowId: string, colId: string, binding: CellBinding) => {
    const idx = cfg.cells.findIndex(c => c.rowId === rowId && c.colId === colId);
    const nextCells = [...cfg.cells];
    if (idx >= 0) nextCells[idx] = { ...nextCells[idx], binding };
    else nextCells.push({ rowId, colId, binding });
    update({ cells: nextCells });
  };
  const getCellBinding = (rowId: string, colId: string): CellBinding | null => {
    return cfg.cells.find(c => c.rowId === rowId && c.colId === colId)?.binding || null;
  };
  const clearCellBinding = (rowId: string, colId: string) => {
    update({ cells: cfg.cells.filter(c => !(c.rowId === rowId && c.colId === colId)) });
  };

  // 点数据格 → 选中为绑定目标
  const onCellClick = (ri: number, ci: number) => {
    setTarget({ kind: 'data', rowId: cfg.rows[ri].id, colId: cfg.columns[ci].id });
  };

  // ─── 汇总行（跨数据列单格） ─────────────────────────────────────
  const sumRows = cfg.summary_rows || [];
  const sumCols = cfg.summary_cols || [];
  // 选中了汇总行/列表头时 → 在其后插入；否则末尾追加
  const insertAfterSel = <T extends { id: string }>(arr: T[], item: T, selId: string | undefined): T[] => {
    const at = selId ? arr.findIndex(x => x.id === selId) : -1;
    const out = [...arr];
    if (at >= 0) out.splice(at + 1, 0, item); else out.push(item);
    return out;
  };
  const addSumRow = () => {
    const id = `sr_${Date.now()}`;
    const selId = target?.kind === 'sumrow_h' ? target.id : undefined;
    update({ summary_rows: insertAfterSel(sumRows, { id, label: '汇总', binding: { source: 'literal', text: '' } }, selId) });
  };
  const addSumRowPerCol = () => {
    const id = `sr_${Date.now()}`;
    const selId = target?.kind === 'sumrow_h' ? target.id : undefined;
    update({ summary_rows: insertAfterSel(sumRows, { id, label: '统计行', per_column: true, cells: [], binding: { source: 'literal', text: '' } }, selId) });
  };
  const removeSumRow = (id: string) => {
    update({ summary_rows: sumRows.filter(r => r.id !== id) });
    if (target?.kind === 'sum_row' && target.sumRowId === id) setTarget(null);
  };
  const moveSumRow = (id: string, dir: -1 | 1) => {
    const i = sumRows.findIndex(r => r.id === id); const j = i + dir;
    if (i < 0 || j < 0 || j >= sumRows.length) return;
    const next = [...sumRows]; [next[i], next[j]] = [next[j], next[i]];
    update({ summary_rows: next });
  };
  type SumRow = NonNullable<NonNullable<FieldDefinition['result_table']>['summary_rows']>[number];
  const updateSumRow = (id: string, patch: Partial<SumRow>) => {
    update({ summary_rows: sumRows.map(r => r.id === id ? { ...r, ...patch } : r) });
  };
  const setSumRowBinding = (id: string, binding: CellBinding) => {
    update({ summary_rows: sumRows.map(r => r.id === id ? { ...r, binding } : r) });
  };

  // ─── 汇总列(跨行单值) / 统计列(per_row 逐行) ─────────────────────────────
  const addSumCol = (perRow = false) => {
    const id = `sc_${Date.now()}`;
    const selId = target?.kind === 'sumcol_h' ? target.id : undefined;
    const item = perRow
      ? { id, label: '统计列', per_row: true, cells: [], binding: { source: 'literal' as const, text: '' } }
      : { id, label: '汇总', binding: { source: 'literal' as const, text: '' } };
    update({ summary_cols: insertAfterSel(sumCols, item, selId) });
  };
  const moveSumCol = (id: string, dir: -1 | 1) => {
    const i = sumCols.findIndex(c => c.id === id); const j = i + dir;
    if (i < 0 || j < 0 || j >= sumCols.length) return;
    const next = [...sumCols]; [next[i], next[j]] = [next[j], next[i]];
    update({ summary_cols: next });
  };
  const removeSumCol = (id: string) => {
    update({ summary_cols: sumCols.filter(c => c.id !== id) });
    if (target?.kind === 'sum_col' && target.sumColId === id) setTarget(null);
  };
  type SumCol = NonNullable<NonNullable<FieldDefinition['result_table']>['summary_cols']>[number];
  const updateSumCol = (id: string, patch: Partial<SumCol>) => {
    update({ summary_cols: sumCols.map(c => c.id === id ? { ...c, ...patch } : c) });
  };
  const setSumColBinding = (id: string, binding: CellBinding) => {
    update({ summary_cols: sumCols.map(c => c.id === id ? { ...c, binding } : c) });
  };

  // ─── 矩阵字段（仅用于「试样带」：选镜像矩阵 / 自动绑「当前试样」）──────
  // 只列【试样数据表】(kind!=='stats')——统计数据表无试样语义、不该出试样带，它的格子在绑定弹窗「数据表格」tab 逐格绑定(record_cell/record_summary)。
  const matrixFields = linkedRecord
    ? linkedRecord.groups.flatMap(g => g.fields).filter(f => f.type === 'data_matrix' && f.matrix && f.matrix.kind !== 'stats')
    : [];

  // ─── 当前 target 的 binding + setter ─────────────────────────────
  // 按列汇总行某列格的 binding get/set
  const getSumRowCell = (sumRowId: string, colId: string): CellBinding | null =>
    sumRows.find(r => r.id === sumRowId)?.cells?.find(c => c.colId === colId)?.binding || null;
  const setSumRowCell = (sumRowId: string, colId: string, binding: CellBinding | null) => {
    update({ summary_rows: sumRows.map(r => {
      if (r.id !== sumRowId) return r;
      const cells = (r.cells || []).filter(c => c.colId !== colId);
      if (binding) cells.push({ colId, binding });
      return { ...r, cells };
    }) });
  };
  // 其他列(per_row)某行格的 binding get/set（与汇总行 per_column 对偶）
  const getSumColCell = (sumColId: string, rowId: string): CellBinding | null =>
    (sumCols.find(c => c.id === sumColId) as any)?.cells?.find((x: any) => x.rowId === rowId)?.binding || null;
  const setSumColCell = (sumColId: string, rowId: string, binding: CellBinding | null) => {
    update({ summary_cols: sumCols.map(c => {
      if (c.id !== sumColId) return c;
      const cells = ((c as any).cells || []).filter((x: any) => x.rowId !== rowId);
      if (binding) cells.push({ rowId, binding });
      return { ...c, cells };
    }) });
  };

  const currentBinding: CellBinding | null = (() => {
    if (!target) return null;
    if (target.kind === 'data') return getCellBinding(target.rowId, target.colId);
    if (target.kind === 'sum_row') return sumRows.find(r => r.id === target.sumRowId)?.binding || null;
    if (target.kind === 'sum_row_cell') return getSumRowCell(target.sumRowId, target.colId);
    if (target.kind === 'sum_col') return sumCols.find(c => c.id === target.sumColId)?.binding || null;
    if (target.kind === 'sum_col_cell') return getSumColCell(target.sumColId, target.rowId);
    return null;
  })();

  const applyBinding = (b: CellBinding) => {
    if (!target) return;
    if (target.kind === 'data') setCellBinding(target.rowId, target.colId, b);
    else if (target.kind === 'sum_row') setSumRowBinding(target.sumRowId, b);
    else if (target.kind === 'sum_row_cell') setSumRowCell(target.sumRowId, target.colId, b);
    else if (target.kind === 'sum_col') setSumColBinding(target.sumColId, b);
    else if (target.kind === 'sum_col_cell') setSumColCell(target.sumColId, target.rowId, b);
  };

  const clearBinding = () => {
    if (!target) return;
    if (target.kind === 'data') clearCellBinding(target.rowId, target.colId);
    else if (target.kind === 'sum_row') setSumRowBinding(target.sumRowId, { source: 'literal', text: '' });
    else if (target.kind === 'sum_row_cell') setSumRowCell(target.sumRowId, target.colId, null);
    else if (target.kind === 'sum_col') setSumColBinding(target.sumColId, { source: 'literal', text: '' });
    else if (target.kind === 'sum_col_cell') setSumColCell(target.sumColId, target.rowId, null);
  };

  // ─── 表头目标（col_h / sumrow_h / sumcol_h）的"名称/备注"绑定 get/set ──────
  const isHeaderTarget = !!target && (target.kind === 'col_h' || target.kind === 'row_h' || target.kind === 'sumrow_h' || target.kind === 'sumcol_h');
  const getHeaderBinding = (part: 'label' | 'note'): CellBinding | null => {
    if (!target) return null;
    const key = part === 'label' ? 'label_binding' : 'note_binding';
    if (target.kind === 'col_h') return (cfg.columns.find(c => c.id === target.colId) as any)?.[key] || null;
    if (target.kind === 'row_h') return (cfg.rows.find(r => r.id === target.rowId) as any)?.[key] || null;
    if (target.kind === 'sumrow_h') return (sumRows.find(r => r.id === target.id) as any)?.[key] || null;
    if (target.kind === 'sumcol_h') return (sumCols.find(c => c.id === target.id) as any)?.[key] || null;
    return null;
  };
  // 表头当前的固定文字（label / note）——绑定弹窗未绑时「自定义」预填用：
  // 编辑卡/双击已填了名称，打开绑定弹窗选「自定义」应预填该名称（而不是空）。
  const getHeaderFixedText = (part: 'label' | 'note'): string => {
    if (!target) return '';
    const key = part === 'label' ? 'label' : 'note';
    if (target.kind === 'col_h') return ((cfg.columns.find(c => c.id === target.colId) as any)?.[key]) || '';
    if (target.kind === 'row_h') return ((cfg.rows.find(r => r.id === target.rowId) as any)?.[key]) || '';
    if (target.kind === 'sumrow_h') return ((sumRows.find(r => r.id === target.id) as any)?.[key]) || '';
    if (target.kind === 'sumcol_h') return ((sumCols.find(c => c.id === target.id) as any)?.[key]) || '';
    return '';
  };
  const setHeaderBinding = (part: 'label' | 'note', b: CellBinding | undefined) => {
    if (!target) return;
    const patch = { [part === 'label' ? 'label_binding' : 'note_binding']: b } as any;
    if (target.kind === 'col_h') updateCol(target.colId, patch);
    else if (target.kind === 'row_h') updateRow(target.rowId, patch);
    else if (target.kind === 'sumrow_h') updateSumRow(target.id, patch);
    else if (target.kind === 'sumcol_h') updateSumCol(target.id, patch);
  };

  // 表头显示名（纯文本，用于操作栏/面板标题）：绑了名称(自定义文字/原始记录字段)优先显示绑定值，否则用固定 label。
  const headerName = (item: any, fallback: string): string => {
    const b = item?.label_binding as CellBinding | undefined;
    if (b?.source === 'literal') return b.text || fallback;
    if (b?.source === 'record_field' && linkedRecord) {
      for (const g of linkedRecord.groups) {
        const f = g.fields.find((x: any) => x.code === (b as any).field_code);
        if (f) return f.label;
      }
    }
    // 表头单位/矩阵格等绑定取参数名近似显示；其余回退固定 label
    if (b && (b.source === 'record_header' || b.source === 'record_cell' || b.source === 'record_summary') && linkedRecord) {
      const pc = (b as any).param_code;
      if (pc) for (const g of linkedRecord.groups) {
        const mf = g.fields.find((x: any) => x.code === (b as any).matrix_code);
        if (mf?.matrix) { const p = mf.matrix.parameters.find((p: any) => p.code === pc); if (p) return p.label; }
      }
    }
    return item?.label || fallback;
  };

  const targetTitle = (() => {
    if (!target) return '';
    if (target.kind === 'data') {
      const r = cfg.rows.find(x => x.id === target.rowId);
      const c = cfg.columns.find(x => x.id === target.colId);
      return `${headerName(r, target.rowId)} × ${headerName(c, '')}`;
    }
    if (target.kind === 'sum_row') {
      const sr = sumRows.find(r => r.id === target.sumRowId);
      const kw = (sr as any)?.per_column ? '统计行' : '汇总行';
      return `${kw}：${headerName(sr, '')}`;
    }
    if (target.kind === 'sum_row_cell') {
      const sr = sumRows.find(r => r.id === target.sumRowId);
      const c = cfg.columns.find(x => x.id === target.colId);
      return `${headerName(sr, (sr as any)?.per_column ? '统计行' : '汇总行')} × ${headerName(c, '')}`;
    }
    if (target.kind === 'sum_col') {
      const c = sumCols.find(x => x.id === target.sumColId);
      const kw = (c as any)?.per_row ? '统计列' : '汇总列';
      return `${kw}「${headerName(c, '')}」`;
    }
    if (target.kind === 'sum_col_cell') {
      const c = sumCols.find(x => x.id === target.sumColId);
      const r = cfg.rows.find(x => x.id === target.rowId);
      return `${headerName(c, (c as any)?.per_row ? '统计列' : '汇总列')} × ${headerName(r, '')}`;
    }
    if (target.kind === 'col_h') return `列表头「${headerName(cfg.columns.find(c => c.id === target.colId), '')}」`;
    if (target.kind === 'row_h') return `行表头「${headerName(cfg.rows.find(r => r.id === target.rowId), '')}」`;
    if (target.kind === 'sumrow_h') {
      const sr = sumRows.find(r => r.id === target.id);
      return `${(sr as any)?.per_column ? '统计行' : '汇总行'}表头「${headerName(sr, '')}」`;
    }
    const sc = sumCols.find(c => c.id === target.id);
    return `${(sc as any)?.per_row ? '统计列' : '汇总列'}表头「${headerName(sc, '')}」`;
  })();

  // ─── P-Map-10/11c：试样带（把某行/列标记为按试样自动展开的重复区）──────
  const band = cfg.band;
  // 试样带固定作用于第一条数据行/列（画布不再让用户选具体行/列）；ref_id 失效时回退第一条，与渲染器一致
  const bandRowId = band?.axis === 'row' ? (cfg.rows.find(r => r.id === band.ref_id)?.id ?? cfg.rows[0]?.id) : undefined;
  const bandColId = band?.axis === 'col' ? (cfg.columns.find(c => c.id === band.ref_id)?.id ?? cfg.columns[0]?.id) : undefined;
  const isBandRow = (rowId: string) => band?.axis === 'row' && rowId === bandRowId;
  const isBandCol = (colId: string) => band?.axis === 'col' && colId === bandColId;
  // P-Map-13c：引导式「+ 试样带参数」——在非试样轴加一条参数(行/列)，其试样带格子默认绑 record_cell_sample
  // （取镜像矩阵首个参数，用户再点格在选择器里改对应原始参数）；试样轴的试样编号由朝向切换时已自动绑。
  const addBandParam = () => {
    if (!band) return;
    const bm = matrixFields.find(f => f.code === band.matrix_code);
    const fp = bm?.matrix?.parameters?.[0]?.code;
    const cb: CellBinding = fp
      ? { source: 'record_cell_sample', matrix_code: band.matrix_code, param_code: fp }
      : { source: 'literal', text: '' };
    if (band.axis === 'col') {
      // 参数=行：选中某行(行头或该行某格)→其下插入，否则末尾
      if (!bandColId) return;
      const id = `r_${Date.now()}`;
      const at = selRowIdx();
      const rows = [...cfg.rows];
      if (at >= 0) rows.splice(at + 1, 0, { id, label: `参数${cfg.rows.length + 1}` }); else rows.push({ id, label: `参数${cfg.rows.length + 1}` });
      update({ rows, cells: [...cfg.cells, { rowId: id, colId: bandColId, binding: cb }] });
    } else {
      // 参数=列：选中某列(列头或该列某格)→其右插入，否则末尾
      if (!bandRowId) return;
      const id = `c_${Date.now()}`;
      const at = selColIdx();
      const cols = [...cfg.columns];
      if (at >= 0) cols.splice(at + 1, 0, { id, label: `参数${cfg.columns.length + 1}` }); else cols.push({ id, label: `参数${cfg.columns.length + 1}` });
      update({ columns: cols, cells: [...cfg.cells, { rowId: bandRowId, colId: id, binding: cb }] });
    }
  };
  // P-Map-13c-2 修正：切换试样朝向时【按规范结构重建】，而非整表硬转置。
  // 因为"试样编号 + 试样带"本是试样轴的一部分，硬转会把试样编号误当成普通参数行/列。
  // 提取当前带里的参数(record_cell_sample 格)→ 按新朝向铺规范结构；汇总(summary_*)原样保留。
  // ⚠️ 只保留"参数(试样带数据)"；用户额外加的杂项列/per_column 汇总格转置后可能需重配。
  type BandParam = { label: string; binding: CellBinding; label_binding?: CellBinding; note?: string; note_binding?: CellBinding };
  const extractBandParams = (): BandParam[] => {
    const out: BandParam[] = [];
    if (band?.axis === 'row' && bandRowId) {
      for (const c of cfg.columns) {
        const b = getCellBinding(bandRowId, c.id);
        if (b?.source === 'record_cell_sample') out.push({ label: c.label || '', binding: b, label_binding: (c as any).label_binding, note: c.note, note_binding: (c as any).note_binding });
      }
    } else if (band?.axis === 'col' && bandColId) {
      for (const r of cfg.rows) {
        const b = getCellBinding(r.id, bandColId);
        if (b?.source === 'record_cell_sample') out.push({ label: r.label || '', binding: b, label_binding: (r as any).label_binding, note: (r as any).note, note_binding: (r as any).note_binding });
      }
    } else {
      // 无带（从「关」启用试样带 / 还原普通表）：把现有普通数据列当参数，跳过序号/行头列，保留用户已建的列
      for (const c of cfg.columns) {
        if ((c as any).sample_index || (c as any).row_header || (c as any).label_binding?.source === 'record_sample_index') continue;
        const b = cfg.cells.find(x => x.colId === c.id)?.binding;
        out.push({ label: c.label || '', binding: b || { source: 'literal', text: '' }, label_binding: (c as any).label_binding, note: c.note, note_binding: (c as any).note_binding });
      }
    }
    return out;
  };
  const rebuildBand = (newAxis: 'row' | 'col') => {
    const mc = band?.matrix_code || matrixFields[0]?.code || '';
    const idx: CellBinding = { source: 'record_sample_index', matrix_code: mc };
    let params = extractBandParams();
    if (params.length === 0) {
      // 无任何参数可承接（如空表）→ 放一个默认参数占位（优先取镜像矩阵首个参数，用户再点「+参数」加更多/改绑定）
      const bm = matrixFields.find(f => f.code === mc);
      const fp = bm?.matrix?.parameters?.[0];
      params = [{ label: fp?.label || '参数1', binding: fp ? { source: 'record_cell_sample', matrix_code: mc, param_code: fp.code } : { source: 'literal', text: '' } }];
    }
    const stamp = Date.now();
    if (newAxis === 'row') {
      // 按行：左上角列「试样编号」(普通可编辑角标列，PDF 列头取此 label) + 各参数列(列头=参数名/可绑) + 一条样板行(向下展开)
      // 试样序号落在【行格】(record_sample_index→灰色 1,2,3…)，作各行行头，而非把整列做成灰色序号列
      const idxCol = { id: `c_idx_${stamp}`, label: '试样编号' };
      const pCols = params.map((p, i) => ({ id: `c_p${stamp}_${i}`, label: p.label || `参数${i + 1}`, label_binding: p.label_binding, note: p.note, note_binding: p.note_binding }));
      const bandRow = { id: `r_band_${stamp}` };
      const cells = [
        { rowId: bandRow.id, colId: idxCol.id, binding: idx },
        ...pCols.map((c, i) => ({ rowId: bandRow.id, colId: c.id, binding: params[i].binding })),
      ];
      update({ columns: [idxCol, ...pCols], rows: [bandRow], cells, band: { axis: 'row', matrix_code: mc, ref_id: bandRow.id } });
    } else {
      // 按列：行头列「试样编号」(row_header，每行=参数行头/可绑) + 试样带列(列头=试样序号，向右展开) + 各参数一行
      const nameCol = { id: `c_name_${stamp}`, label: '试样编号', row_header: true };
      const bandCol = { id: `c_band_${stamp}`, label: '试样序号（自动设置）', label_binding: idx, sample_index: true };
      const pRows = params.map((p, i) => ({ id: `r_p${stamp}_${i}`, label: p.label || `参数${i + 1}`, label_binding: p.label_binding, note: p.note, note_binding: p.note_binding }));
      const cells = pRows.map((r, i) => ({ rowId: r.id, colId: bandCol.id, binding: params[i].binding }));
      update({ columns: [nameCol, bandCol], rows: pRows, cells, band: { axis: 'col', matrix_code: mc, ref_id: bandCol.id } });
    }
  };
  // 关闭试样带 → 还原普通静态表：最左「试样编号」行头列（行头默认 1/2/3、可编辑）+ 把带内参数各还原成数据列；
  // 默认 3 行；去掉序号/行头标记与「当前试样」相对绑定（无带语境下无意义，逐格由用户重绑），所有表头恢复普通可右键编辑。
  const unband = () => {
    const params = extractBandParams();
    const stamp = Date.now();
    const snCol = { id: `c_sn_${stamp}`, label: '试样编号', row_header: true };
    const dataCols = params.map((p, i) => ({ id: `c_${stamp}_${i}`, label: p.label || `列${i + 1}`, label_binding: p.label_binding, note: p.note, note_binding: p.note_binding }));
    const rows = ['1', '2', '3'].map((n, i) => ({ id: `r_${stamp}_${i}`, label: n }));
    update({ columns: [snCol, ...dataCols], rows, cells: [], band: undefined });
  };
  const targetInBand = target?.kind === 'data' && (isBandRow(target.rowId) || isBandCol(target.colId));
  // 带内格子用「试样带·当前试样」来源（record_cell_sample/record_sample_label）；带外/汇总用常规原始记录来源
  const BAND_CELL_SOURCES = ['literal', 'record_field', 'record_cell_sample', 'record_sample_label', 'record_sample_index', 'record_header'];
  const modalAllowed = targetInBand ? BAND_CELL_SOURCES : RESULT_TABLE_SOURCES;
  // 试样带「列头」可绑试样序号/试样名（出列模式：试样编号在列表头递增，对齐出行模式行格）
  const headerIsBandCol = target?.kind === 'col_h' && isBandCol(target.colId);
  const headerSources = headerIsBandCol ? [...HEADER_SOURCES, 'record_sample_index', 'record_sample_label'] : HEADER_SOURCES;
  const modalBandMatrix = (targetInBand || headerIsBandCol) ? band?.matrix_code : undefined;

  return (
    <div>
      {/* ─── 表格版式（跨页/行距/对齐/空值，与数据表格同口径）─── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, marginBottom: 12, padding: '8px 12px', background: '#fafafa', border: '1px solid #eee', borderRadius: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 500 }}>表格版式：</span>
        <Tooltip title="整表尽量不跨页；放不下时整体移到下一页（超过一整页的超长表仍会自动跨页、不丢数据）">
          <span style={{ fontSize: 12 }}>
            <Switch size="small" checked={cfg.keep_together !== false} onChange={(v) => update({ keep_together: v })} /> 尽量同页
          </span>
        </Tooltip>
        <Tooltip title="跨页时在续页重复表头（仅真跨页时生效）">
          <span style={{ fontSize: 12 }}>
            <Switch size="small" checked={cfg.repeat_header_on_break !== false} onChange={(v) => update({ repeat_header_on_break: v })} /> 跨页重复表头
          </span>
        </Tooltip>
        <span style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>对齐：
          <Segmented size="small" value={cfg.cell_align || 'center'} onChange={(v) => update({ cell_align: v as 'left' | 'center' | 'right' })}
            options={[{ value: 'left', label: '左' }, { value: 'center', label: '中' }, { value: 'right', label: '右' }]} />
        </span>
        <Tooltip title="行与行的疏密（单元格上下内边距），缺省 8pt">
          <span style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>行内留白：
            <InputNumber size="small" style={{ width: 70 }} min={0} max={40} step={1} placeholder="默认"
              value={cfg.cell_inset_y ? parseFloat(cfg.cell_inset_y) : undefined}
              onChange={(v) => update({ cell_inset_y: v == null ? undefined : `${v}pt` })} /> pt
          </span>
        </Tooltip>
        <span style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>空值符：
          <Input size="small" style={{ width: 64 }} placeholder="—" value={cfg.empty_cell_display ?? ''}
            onChange={(e) => update({ empty_cell_display: e.target.value || undefined })} />
        </span>
      </div>

      {/* 头部说明 */}
      <div style={{ background: '#e6f4ff', border: '1px solid #91caff', padding: 10, borderRadius: 4, marginBottom: 12, fontSize: 12 }}>
        <strong>检测结果表编辑：</strong>
        <ul style={{ margin: '6px 0 0 20px', padding: 0 }}>
          <li><strong>点击 / 右键任意表头</strong>（数据列 · 汇总行 · 汇总列，统一一致）弹出「配置」卡：改<strong>标题 · 备注</strong>、<strong>分组表头</strong>、以及<strong>「随录入变化」绑定</strong>（标题/单位/备注可跟随录入所选单位、客户/标准要求等）；<strong>点卡片以外区域即关闭</strong>，不必非点确定</li>
          <li><strong>列宽 / 行高</strong>：右键表头/行头打开「配置」卡，在卡片里用数字旋钮设置列宽(fr)/行高(pt)，留空＝自动</li>
          <li>点击任意数据格 → 上方紧凑条「选择/修改数据源」打开统一弹窗（关联原始记录的字段/矩阵格/汇总/表头单位）即绑定</li>
          <li>生成报告时，<strong>每行最后一列的值</strong>会自动作为该项目的「结论」参与首页结论汇总表</li>
        </ul>
      </div>

      {/* ─── 试样带（按试样自动展开某行/列）─── */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8, padding: 10, background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#389e0d' }}>试样自动展开</span>
        <Tooltip title="试样自动展开＝表里「按试样自动重复」的那一行/列：录了几个试样就展开成几行/几列，不用手动加行。关＝固定行列、逐格绑定。">
          <span style={{ fontSize: 11, color: '#8c8c8c', cursor: 'help' }}>（？这是什么）</span>
        </Tooltip>
        <Radio.Group
          optionType="button" buttonStyle="solid" size="small"
          value={band?.axis || 'off'}
          disabled={matrixFields.length === 0}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'off') { unband(); return; }       // 关：还原普通表（列头/行头都普通可编辑）
            const axis = v as 'row' | 'col';
            if (band?.axis === axis) return;              // 已是该模式
            // 关→带 / 带→带：统一按规范结构重建（试样编号角标 + 序号轴 + 参数 + 保留汇总）
            rebuildBand(axis);
          }}
          options={[
            { value: 'off', label: '关（固定行列）' },
            { value: 'row', label: '每行一个试样 ↓' },
            { value: 'col', label: '每列一个试样 →' },
          ]} />
        {matrixFields.length > 0 && (() => {
          // P-Map-13b-4：提示原始记录该矩阵的试样轴，方便选试样行/列
          const bm = matrixFields.find(f => f.code === (band?.matrix_code || matrixFields[0]?.code));
          const rawCol = bm?.matrix?.sample_axis === 'col';
          return <Tag color={rawCol ? 'geekblue' : 'default'} style={{ fontSize: 11 }}>原始记录试样为{rawCol ? '列 → 建议每列一个试样' : '行 → 建议每行一个试样'}</Tag>;
        })()}
        {matrixFields.length === 0 && (
          <span style={{ fontSize: 11, color: '#999' }}>
            {linkedRecord?.groups.some(g => g.fields.some(f => f.type === 'data_matrix' && f.matrix))
              ? '已关联的都是「统计数据表」，不按试样展开——请点数据格在弹窗「数据表格」tab 逐格绑定'
              : '需先关联含数据矩阵的原始记录'}
          </span>
        )}
        {band && (
          <div style={{ fontSize: 11, color: '#52c41a', flexBasis: '100%', lineHeight: 1.6 }}>
            试样轴已自动出「试样编号」(1,2,3…递增)；点上方「参数{band.axis === 'col' ? '行' : '列'}」加参数，每格点一下在下方选「所有试样·某参数」绑定。
            <b>数据按试样自动对位，无需手动转置</b>（原始记录试样是行还是列都不影响）。按<b>实际录入的试样数</b>自动展开（只展开试样，汇总不计入）。
          </div>
        )}
      </div>


      {/* ─── 结构工具栏（新增按钮集中在表格上方，与原始记录表格一致；分类：参数 / 其他 / 汇总）─── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: '#8c8c8c' }}>新增：</span>
        {/* 参数 */}
        {band ? (
          // 试样带激活：参数加在「非试样轴」——按列出→参数行、按行出→参数列（轴感知，单一按钮）
          <Tooltip title="参数：每格取「所有试样·某参数」，按试样自动展开；按列=参数行、按行=参数列">
            <Button size="small" type="primary" ghost icon={<PlusOutlined />} onClick={addBandParam}>参数{band.axis === 'col' ? '行' : '列'}</Button>
          </Tooltip>
        ) : (
          <>
            <Tooltip title="数据行：手动一行（逐格绑定）"><Button size="small" icon={<PlusOutlined />} onClick={addRow}>数据行</Button></Tooltip>
            <Tooltip title="参数列：手动一列（逐格绑定）"><Button size="small" icon={<PlusOutlined />} onClick={addCol}>参数列</Button></Tooltip>
          </>
        )}
        <span style={{ width: 1, height: 18, background: '#d9d9d9', margin: '0 2px' }} />
        {/* 统计（逐行/列，每格绑定，不算试样） */}
        <Tooltip title="统计行：底部一行、每个数据列一格（逐列绑定，如各列平均值/限值）"><Button size="small" icon={<PlusOutlined />} onClick={addSumRowPerCol}>统计行</Button></Tooltip>
        <Tooltip title="统计列：右侧一列、每个数据行一格（逐行绑定，如各试样的判定/平均）"><Button size="small" icon={<PlusOutlined />} onClick={() => addSumCol(true)}>统计列</Button></Tooltip>
        <span style={{ width: 1, height: 18, background: '#d9d9d9', margin: '0 2px' }} />
        {/* 汇总（跨行/列，整行/列一个值） */}
        <Tooltip title="汇总行：底部一行、整行一个值（跨列）"><Button size="small" icon={<PlusOutlined />} onClick={addSumRow}>汇总行</Button></Tooltip>
        <Tooltip title="汇总列：右侧一列、整列一个值（跨行）"><Button size="small" icon={<PlusOutlined />} onClick={() => addSumCol(false)}>汇总列</Button></Tooltip>
      </div>

      {/* ─── 选中表头时的操作栏（删除 / 移动；行头无左右、列头无上下）─── */}
      {isHeaderTarget && (() => {
        const k = target!.kind;
        const colIdx = k === 'col_h' ? cfg.columns.findIndex(c => c.id === (target as any).colId) : -1;
        const rowIdx = k === 'row_h' ? cfg.rows.findIndex(r => r.id === (target as any).rowId) : -1;
        const doDelete = () => {
          if (k === 'col_h') removeCol((target as any).colId);
          else if (k === 'row_h') removeRow((target as any).rowId);
          else if (k === 'sumcol_h') removeSumCol((target as any).id);
          else if (k === 'sumrow_h') removeSumRow((target as any).id);
          setTarget(null);
        };
        return (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8, padding: '6px 10px', background: '#e6f4ff', border: '1px solid #91caff', borderRadius: 6 }}>
            <span style={{ fontSize: 12, color: '#0958d9' }}>已选中：<b>{targetTitle}</b></span>
            {k === 'col_h' && <>
              <Button size="small" disabled={colIdx <= 0} onClick={() => moveCol(colIdx, -1)}>← 左移</Button>
              <Button size="small" disabled={colIdx < 0 || colIdx >= cfg.columns.length - 1} onClick={() => moveCol(colIdx, 1)}>右移 →</Button>
            </>}
            {k === 'row_h' && <>
              <Button size="small" disabled={rowIdx <= 0} icon={<ArrowUpOutlined />} onClick={() => moveRow(rowIdx, -1)}>上移</Button>
              <Button size="small" disabled={rowIdx < 0 || rowIdx >= cfg.rows.length - 1} icon={<ArrowDownOutlined />} onClick={() => moveRow(rowIdx, 1)}>下移</Button>
            </>}
            {k === 'sumcol_h' && (() => {
              const i = sumCols.findIndex(c => c.id === (target as any).id);
              return <>
                <Button size="small" disabled={i <= 0} onClick={() => moveSumCol((target as any).id, -1)}>← 左移</Button>
                <Button size="small" disabled={i < 0 || i >= sumCols.length - 1} onClick={() => moveSumCol((target as any).id, 1)}>右移 →</Button>
              </>;
            })()}
            {k === 'sumrow_h' && (() => {
              const i = sumRows.findIndex(r => r.id === (target as any).id);
              return <>
                <Button size="small" disabled={i <= 0} icon={<ArrowUpOutlined />} onClick={() => moveSumRow((target as any).id, -1)}>上移</Button>
                <Button size="small" disabled={i < 0 || i >= sumRows.length - 1} icon={<ArrowDownOutlined />} onClick={() => moveSumRow((target as any).id, 1)}>下移</Button>
              </>;
            })()}
            <Button size="small" danger icon={<DeleteOutlined />} onClick={doDelete}>删除</Button>
            <Button size="small" type="text" onClick={() => setTarget(null)}>取消选中</Button>
          </div>
        );
      })()}

      {/* ─── 结果表画布 ─── */}
      <div style={{ overflowX: 'auto', marginBottom: 12, border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', boxShadow: '0 1px 3px rgba(16,40,80,0.05)' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
          <thead>
            <tr>
              {/* 第一个真实列头即报告表格左上角（无左侧管理列、无右侧操作列）——行的增删/上下移走「行头」右键配置卡与选中操作栏 */}
              {cfg.columns.map((c, ci) => {
                // 试样序号列：认 rebuildBand 的显式标记；兼容旧按列表（仅试样带列才有的 label_binding=record_sample_index，精确、不会误判普通表头）
                const isSampleIdx = (c as any).sample_index === true
                  || (c as any).label_binding?.source === 'record_sample_index';
                if (isSampleIdx) {
                  // 试样序号列（按试样出列的试样带）：序号/名称自动，不可改文字/绑定；但可点开设【这一列的列宽】——
                  // 所有试样列都用这一条模板列展开、宽度一致，故改一次即应用到全部。
                  return (
                    <th key={c.id} style={{ ...th, background: '#f2f5fb', color: '#888', cursor: 'pointer' }}
                      title="试样序号：随录入试样自动 1,2,3…；点开可设这一列（所有试样列）的列宽">
                      <Popover trigger={['click', 'contextMenu']} placement="bottom" title="试样列宽（应用到所有试样列）"
                        content={
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 0' }}>
                            <span style={{ fontSize: 12, color: '#555' }}>列宽</span>
                            <InputNumber size="small" style={{ width: 90 }} min={0.3} max={8} step={0.1} placeholder="自动"
                              value={(c as any).width && /fr$/.test((c as any).width) ? parseFloat((c as any).width) : undefined}
                              onChange={(v) => updateCol(c.id, { width: v ? `${v}fr` : undefined })} />
                            <span style={{ fontSize: 11, color: '#999' }}>fr（留空=自动）</span>
                          </div>
                        }>
                        <div>
                          {c.label || '试样序号（自动设置）'}
                          <div style={{ fontSize: 9, color: '#bbb', lineHeight: 1, fontWeight: 400 }}>自动 1,2,3… · 点设列宽</div>
                        </div>
                      </Popover>
                    </th>
                  );
                }
                return (
                <th key={c.id} style={{ ...th, position: 'relative', cursor: 'pointer', ...(target?.kind === 'col_h' && target.colId === c.id ? { outline: '2px solid #1677ff', outlineOffset: -2 } : {}) }}
                  title="点击 = 在下方绑定名称/备注(单位)；右键 = 改固定文字/分组/移动/删除"
                  onClick={() => toggleTarget({ kind: 'col_h', colId: c.id })}
                  onContextMenu={(e) => { e.preventDefault(); setColCard(c.id); }}>
                  <HeaderConfigCard
                    title="列配置（固定文字）"
                    open={colCard === c.id}
                    value={{ label: c.label, group: c.group, note: c.note }}
                    showGroup
                    noteFixedOnly
                    closeOnOutsideClick
                    onClose={() => setColCard(null)}
                    onSave={(patch) => updateCol(c.id, { label: patch.label || '列', group: patch.group, note: patch.note })}
                    actions={[
                      ...(ci > 0 ? [{ key: 'left', label: '← 左移', onClick: () => moveCol(ci, -1) }] : []),
                      ...(ci < cfg.columns.length - 1 ? [{ key: 'right', label: '右移 →', onClick: () => moveCol(ci, 1) }] : []),
                      { key: 'del', label: '删除本列', danger: true, onClick: () => removeCol(c.id) },
                    ]}
                    extra={
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontSize: 12, color: '#555' }}>列宽</span>
                        <InputNumber size="small" style={{ width: 90 }} min={0.3} max={8} step={0.1} placeholder="自动"
                          value={(c as any).width && /fr$/.test((c as any).width) ? parseFloat((c as any).width) : undefined}
                          onChange={(v) => updateCol(c.id, { width: v ? `${v}fr` : undefined })} />
                        <span style={{ fontSize: 11, color: '#999' }}>fr（留空=自动）</span>
                      </div>
                    }
                  >
                    <div style={{ padding: '2px 4px', minWidth: 56 }}>
                      {(c as any).label_binding ? (
                        <div style={{ fontWeight: 500 }} title="列头取值来自绑定（在下方面板可改/清）">
                          <BindingSummary value={(c as any).label_binding} linkedRecord={linkedRecord} />
                        </div>
                      ) : (
                        <div style={{ fontWeight: 500 }}>{c.label}</div>
                      )}
                      {(c.group || c.note) && (
                        <div style={{ fontSize: 10, color: '#8c8c8c', lineHeight: 1.4, marginTop: 1, fontWeight: 400 }}>
                          {c.group && <span style={{ color: '#722ed1' }}>▤{c.group} </span>}
                          {c.note && <span>（{c.note}）</span>}
                        </div>
                      )}
                    </div>
                  </HeaderConfigCard>
                </th>
                );
              })}
              {/* 汇总列头 */}
              {sumCols.map(sc => (
                <th key={sc.id} style={{ ...th, background: (sc as any).per_row ? C_STATS : '#fff7e6', position: 'relative', cursor: 'pointer', ...(target?.kind === 'sumcol_h' && target.id === sc.id ? { outline: '2px solid #1677ff', outlineOffset: -2 } : {}) }}
                  title="点击 = 在下方绑定名称/备注(单位)；右键 = 改固定文字/删除"
                  onClick={() => toggleTarget({ kind: 'sumcol_h', id: sc.id })}
                  onContextMenu={(e) => { e.preventDefault(); setSumColCard(sc.id); }}>
                  <HeaderConfigCard
                    title={(sc as any).per_row ? '统计列配置（固定文字）' : '汇总列配置（固定文字）'}
                    open={sumColCard === sc.id}
                    value={{ label: sc.label, note: sc.note }}
                    noteFixedOnly
                    closeOnOutsideClick
                    onClose={() => setSumColCard(null)}
                    onSave={(patch) => updateSumCol(sc.id, { label: patch.label || ((sc as any).per_row ? '统计' : '汇总'), note: patch.note })}
                    actions={[{ key: 'del', label: (sc as any).per_row ? '删除统计列' : '删除汇总列', danger: true, onClick: () => removeSumCol(sc.id) }]}
                    extra={
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontSize: 12, color: '#555' }}>列宽</span>
                        <InputNumber size="small" style={{ width: 90 }} min={0.3} max={8} step={0.1} placeholder="自动"
                          value={sc.width && /fr$/.test(sc.width) ? parseFloat(sc.width) : undefined}
                          onChange={(v) => updateSumCol(sc.id, { width: v ? `${v}fr` : undefined })} />
                        <span style={{ fontSize: 11, color: '#999' }}>fr（留空=自动）</span>
                      </div>
                    }
                  >
                    <div style={{ padding: '2px 4px' }}>
                      <div style={{ color: (sc as any).per_row ? '#722ed1' : '#d48806' }}>
                        {/* 绑了名称（字段/自定义）就显示绑定值，否则才显示固定标签「统计/汇总」 */}
                        {(sc as any).label_binding
                          ? <BindingSummary value={(sc as any).label_binding} linkedRecord={linkedRecord} />
                          : sc.label}
                        {(sc as any).per_row ? <Tag color="purple" style={{ fontSize: 10, marginLeft: 4 }}>统计</Tag> : <Tag color="gold" style={{ fontSize: 10, marginLeft: 4 }}>汇总</Tag>}
                      </div>
                      {sc.note && <div style={{ fontSize: 10, color: '#8c8c8c' }}>（{sc.note}）</div>}
                    </div>
                  </HeaderConfigCard>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cfg.rows.map((r, ri) => (
              <tr key={r.id}>
                {/* 数据格 */}
                {cfg.columns.map((c, ci) => {
                  // P-Map-13c：行头列——该格渲染为"行头"(行名 + 配置卡 + 点击绑名称/单位)，与列头同款编辑
                  if ((c as any).row_header) {
                    const isRowTarget = target?.kind === 'row_h' && target.rowId === r.id;
                    return (
                      <td key={c.id} style={{ ...th, position: 'relative', cursor: 'pointer', ...(isRowTarget ? { outline: '2px solid #1677ff', outlineOffset: -2 } : {}) }}
                        title="点击=在下方绑定名称/备注(单位)；右键=改固定文字/上下移/删除"
                        onClick={() => toggleTarget({ kind: 'row_h', rowId: r.id })}
                        onContextMenu={(e) => { e.preventDefault(); setRowCard(r.id); }}>
                        <HeaderConfigCard title="行头配置（固定文字）" open={rowCard === r.id} value={{ label: r.label || '', note: (r as any).note }}
                          noteFixedOnly closeOnOutsideClick onClose={() => setRowCard(null)}
                          onSave={(patch) => updateRow(r.id, { label: patch.label || '', note: patch.note })}
                          actions={[
                            ...(ri > 0 ? [{ key: 'up', label: '↑ 上移', onClick: () => moveRow(ri, -1) }] : []),
                            ...(ri < cfg.rows.length - 1 ? [{ key: 'down', label: '下移 ↓', onClick: () => moveRow(ri, 1) }] : []),
                            { key: 'del', label: '删除本行', danger: true, onClick: () => removeRow(r.id) },
                          ]}
                          extra={
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span style={{ fontSize: 12, color: '#555' }}>行高</span>
                              <InputNumber size="small" style={{ width: 90 }} min={0} max={200} step={4} placeholder="自动"
                                value={(r as any).height && /pt$/.test((r as any).height) ? parseFloat((r as any).height) : undefined}
                                onChange={(v) => updateRow(r.id, { height: v ? `${v}pt` : undefined })} />
                              <span style={{ fontSize: 11, color: '#999' }}>pt（留空=自动）</span>
                            </div>
                          }>
                          <div style={{ padding: '2px 4px', minWidth: 56, fontWeight: 500 }}>
                            {(r as any).label_binding
                              ? <BindingSummary value={(r as any).label_binding} linkedRecord={linkedRecord} />
                              : (r.label || '(行头)')}
                            {(r as any).note && <div style={{ fontSize: 10, color: '#8c8c8c', fontWeight: 400 }}>（{(r as any).note}）</div>}
                          </div>
                        </HeaderConfigCard>
                      </td>
                    );
                  }
                  // 试样序号（试样带按行→试样编号格，自动展开 1,2,3…）——序号自动、不可绑定；
                  // 但可点开设【这一行（所有试样行）的行高】，所有试样行用同一条模板行展开、高度一致，改一次即全部应用。
                  if (getCellBinding(r.id, c.id)?.source === 'record_sample_index') {
                    return (
                      <td key={c.id} style={{ ...td, textAlign: 'center', background: '#f2f5fb', color: '#888', fontWeight: 500, cursor: 'pointer' }}
                        title="试样序号：随录入试样自动 1,2,3…；点开可设这一行（所有试样行）的行高">
                        <Popover trigger={['click', 'contextMenu']} placement="bottom" title="试样行高（应用到所有试样行）"
                          content={
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 0' }}>
                              <span style={{ fontSize: 12, color: '#555' }}>行高</span>
                              <InputNumber size="small" style={{ width: 90 }} min={0} max={200} step={4} placeholder="自动"
                                value={(r as any).height && /pt$/.test((r as any).height) ? parseFloat((r as any).height) : undefined}
                                onChange={(v) => updateRow(r.id, { height: v ? `${v}pt` : undefined })} />
                              <span style={{ fontSize: 11, color: '#999' }}>pt（留空=自动）</span>
                            </div>
                          }>
                          <div>1,2,3…<div style={{ fontSize: 9, color: '#bbb', lineHeight: 1 }}>自动 · 点设行高</div></div>
                        </Popover>
                      </td>
                    );
                  }
                  const isTarget = target?.kind === 'data' && target.rowId === r.id && target.colId === c.id;
                  const binding = getCellBinding(r.id, c.id);
                  const inBand = isBandRow(r.id) || isBandCol(c.id);
                  return (
                    <td key={c.id} style={{
                      ...td,
                      textAlign: 'center',
                      cursor: 'pointer',
                      background: isTarget ? '#e6f4ff' : inBand ? '#f6ffed' : binding ? '#fff' : '#fafafa',
                      border: isTarget ? '2px solid #1677ff' : inBand ? '1px solid #b7eb8f' : td.border,
                    }}
                      onClick={() => onCellClick(ri, ci)}>
                      {inBand && <div style={{ fontSize: 9, color: '#52c41a', lineHeight: 1 }}>所有试样</div>}
                      {binding ? (
                        <div style={{ fontSize: 11, padding: 4 }}>
                          <BindingSummary value={binding} linkedRecord={linkedRecord} />
                        </div>
                      ) : (
                        <div style={{ fontSize: 11, color: '#bbb', padding: 4 }}>未绑定<br/>(点击配置)</div>
                      )}
                    </td>
                  );
                })}
                {/* 汇总列(跨行,首行 rowSpan) / 其他列(per_row,逐行每格) */}
                {sumCols.map(sc => {
                  if ((sc as any).per_row) {
                    const isCellT = target?.kind === 'sum_col_cell' && target.sumColId === sc.id && target.rowId === r.id;
                    const cb = getSumColCell(sc.id, r.id);
                    return (
                      <td key={sc.id} style={{ ...td, textAlign: 'center', cursor: 'pointer', background: isCellT ? '#bae0ff' : cb ? '#fffbe6' : C_STATS, border: isCellT ? '2px solid #d48806' : td.border }}
                        onClick={() => setTarget({ kind: 'sum_col_cell', sumColId: sc.id, rowId: r.id })}>
                        {cb ? <div style={{ fontSize: 11, padding: 4 }}><BindingSummary value={cb} linkedRecord={linkedRecord} /></div>
                          : <div style={{ fontSize: 11, color: '#bbb', padding: 4 }}>未绑定</div>}
                      </td>
                    );
                  }
                  if (ri !== 0) return null;
                  const isTarget = target?.kind === 'sum_col' && target.sumColId === sc.id;
                  const binding = sc.binding;
                  return (
                    <td key={sc.id} rowSpan={cfg.rows.length}
                      style={{ ...td, textAlign: 'center', cursor: 'pointer', background: isTarget ? '#bae0ff' : binding ? '#fffbe6' : '#fff7e6', border: isTarget ? '2px solid #d48806' : td.border }}
                      onClick={() => setTarget({ kind: 'sum_col', sumColId: sc.id })}>
                      {binding ? <div style={{ fontSize: 11, padding: 4 }}><BindingSummary value={binding} linkedRecord={linkedRecord} /></div>
                        : <div style={{ fontSize: 11, color: '#bbb', padding: 4 }}>未绑定</div>}
                    </td>
                  );
                })}
              </tr>
            ))}

            {/* 汇总行 */}
            {sumRows.map(sr => {
              const isTarget = target?.kind === 'sum_row' && target.sumRowId === sr.id;
              return (
                <tr key={sr.id}>
                  <td style={{ ...th, textAlign: 'left', background: sr.per_column ? C_STATS : '#fffbe6', cursor: 'pointer', ...(target?.kind === 'sumrow_h' && target.id === sr.id ? { outline: '2px solid #1677ff', outlineOffset: -2 } : {}) }}
                    title="点击 = 在下方绑定名称/备注(单位)；右键 = 改固定文字/删除"
                    onClick={() => toggleTarget({ kind: 'sumrow_h', id: sr.id })}
                    onContextMenu={(e) => { e.preventDefault(); setSumRowCard(sr.id); }}>
                    <HeaderConfigCard
                      title={sr.per_column ? '统计行配置（固定文字）' : '汇总行配置（固定文字）'}
                      open={sumRowCard === sr.id}
                      value={{ label: sr.label, note: sr.note }}
                      noteFixedOnly
                      closeOnOutsideClick
                      onClose={() => setSumRowCard(null)}
                      onSave={(patch) => updateSumRow(sr.id, { label: patch.label || (sr.per_column ? '统计' : '汇总'), note: patch.note })}
                      actions={[{ key: 'del', label: sr.per_column ? '删除统计行' : '删除汇总行', danger: true, onClick: () => removeSumRow(sr.id) }]}
                    >
                      <div style={{ color: sr.per_column ? '#722ed1' : '#d48806', fontWeight: 'bold', padding: '2px 4px' }}>
                        {/* 绑了名称（字段/自定义）就显示绑定值，否则才显示固定标签「统计行/汇总行」 */}
                        {(sr as any).label_binding
                          ? <BindingSummary value={(sr as any).label_binding} linkedRecord={linkedRecord} />
                          : sr.label}
                        {sr.note && <span style={{ fontWeight: 400, color: '#8c8c8c' }}>（{sr.note}）</span>}
                        {sr.per_column ? <Tag color="purple" style={{ fontSize: 10, marginLeft: 4 }}>统计行</Tag> : <Tag color="gold" style={{ fontSize: 10, marginLeft: 4 }}>汇总行</Tag>}
                      </div>
                    </HeaderConfigCard>
                  </td>
                  {sr.per_column ? (
                    <>
                      {/* 按列汇总：每个数据列一格（如各列平均值），点格在下方绑定 */}
                      {cfg.columns.slice(1).map(c => {
                        const isCellT = target?.kind === 'sum_row_cell' && target.sumRowId === sr.id && target.colId === c.id;
                        const b = sr.cells?.find(x => x.colId === c.id)?.binding;
                        return (
                          <td key={c.id}
                            style={{ ...td, textAlign: 'center', cursor: 'pointer', background: isCellT ? '#bae0ff' : (b ? '#fffbe6' : C_STATS), border: isCellT ? '2px solid #d48806' : td.border }}
                            onClick={() => setTarget({ kind: 'sum_row_cell', sumRowId: sr.id, colId: c.id })}>
                            {b ? <div style={{ fontSize: 11, padding: 4 }}><BindingSummary value={b} linkedRecord={linkedRecord} /></div>
                              : <div style={{ fontSize: 11, color: '#bbb', padding: 4 }}>未绑定</div>}
                          </td>
                        );
                      })}
                    </>
                  ) : (
                    <td colSpan={Math.max(cfg.columns.length - 1, 1)}
                      style={{
                        ...td, textAlign: 'center', cursor: 'pointer',
                        background: isTarget ? '#bae0ff' : '#fffbe6',
                        border: isTarget ? '2px solid #d48806' : td.border,
                      }}
                      onClick={() => setTarget({ kind: 'sum_row', sumRowId: sr.id })}>
                      {sr.binding ? (
                        <div style={{ fontSize: 11, padding: 4 }}>
                          <BindingSummary value={sr.binding} linkedRecord={linkedRecord} />
                        </div>
                      ) : (
                        <div style={{ fontSize: 11, color: '#bbb', padding: 4 }}>未绑定（点击配置）</div>
                      )}
                    </td>
                  )}
                  {/* 汇总行 × 汇总列：留空 */}
                  {sumCols.map(sc => <td key={sc.id} style={{ ...td, background: '#fafafa' }} />)}
                </tr>
              );
            })}

          </tbody>
        </table>
      </div>

      {/* ─── 表头目标 → 下方出现「名称 / 备注(单位)」两项绑定（点表头即选中；编辑文字走右键卡片）─── */}
      {target && isHeaderTarget && (
        <div style={{ border: '2px solid #1677ff', borderRadius: 6, padding: 12, background: '#fafcff' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
            <strong style={{ fontSize: 13 }}>「{targetTitle}」表头数据绑定</strong>
            <span style={{ fontSize: 11, color: '#888' }}>名称、备注(单位) 可分别绑定数据来源——二者皆绑或只绑其一；不绑则用右键卡片里填的固定文字</span>
            <Button size="small" style={{ marginLeft: 'auto' }} onClick={() => setTarget(null)}>收起</Button>
          </div>
          {(['label', 'note'] as const).map(part => {
            const b = getHeaderBinding(part);
            return (
              <div key={part} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ width: 70, fontSize: 12, color: '#555' }}>{part === 'label' ? '名称' : '备注/单位'}</span>
                <span style={{ flex: 1, fontSize: 12, minWidth: 0 }}>
                  {b
                    ? <BindingSummary value={b} linkedRecord={linkedRecord} />
                    : (getHeaderFixedText(part)
                        ? <span style={{ color: '#555' }}>固定文字：<b style={{ color: '#222' }}>{getHeaderFixedText(part)}</b></span>
                        : <span style={{ color: '#bbb' }}>固定文字（右键表头编辑）</span>)}
                </span>
                <Button size="small" type="primary" ghost onClick={() => { setHdrPart(part); setBindOpen(true); }}>{b ? '改绑定' : '绑定'}</Button>
                {b && <Button size="small" danger onClick={() => setHeaderBinding(part, undefined)}>清除</Button>}
              </div>
            );
          })}
        </div>
      )}

      {/* ─── 数据格 / 汇总格目标 → 单一数据源绑定 ─── */}
      {target && !isHeaderTarget && (
        <div style={{ border: '2px solid #1677ff', borderRadius: 6, padding: 12, background: '#fafcff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 13 }}>「{targetTitle}」</strong>
            <span style={{ fontSize: 12 }}>
              {currentBinding
                ? <BindingSummary value={currentBinding} linkedRecord={linkedRecord} />
                : <span style={{ color: '#bbb' }}>未绑定</span>}
            </span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <Button size="small" type="primary" onClick={() => setBindOpen(true)}>选择 / 修改数据源</Button>
              {currentBinding && <Button size="small" danger onClick={clearBinding}>清除绑定</Button>}
              <Button size="small" onClick={() => setTarget(null)}>收起</Button>
            </div>
          </div>
        </div>
      )}

      {!target && (
        <div style={{ padding: 10, background: '#fffbe6', border: '1px dashed #ffe58f', borderRadius: 4, color: '#888', fontSize: 12 }}>
          点<b>数据格 / 汇总格</b> → 这里选数据源；点<b>任意表头</b>（列/汇总行/汇总列）→ 这里出现「名称 / 备注(单位)」绑定。右键表头 = 改固定文字/分组/删除。
        </div>
      )}

      {/* 统一绑定弹窗——项目结果表只暴露原始记录来源；表头绑定走"名称/备注"对应槽位 */}
      <BindingPickerModal
        open={bindOpen}
        value={(isHeaderTarget ? getHeaderBinding(hdrPart) : currentBinding) || { source: 'literal', text: isHeaderTarget ? getHeaderFixedText(hdrPart) : '' }}
        linkedRecord={linkedRecord}
        allowedSources={isHeaderTarget ? headerSources : modalAllowed}
        bandMatrixCode={modalBandMatrix}
        title={isHeaderTarget
          ? `为「${targetTitle}」绑定${hdrPart === 'label' ? '名称' : '备注/单位'}`
          : (target ? `为「${targetTitle}」${targetInBand ? '（所有试样）' : ''}选择数据源` : '选择数据来源')}
        onChange={isHeaderTarget ? (b) => setHeaderBinding(hdrPart, b) : applyBinding}
        onClose={() => setBindOpen(false)}
      />
    </div>
  );
}


const th: React.CSSProperties = { border: '1px solid #e2e8f0', padding: '8px 10px', background: '#f2f5fb', color: '#26334d', fontWeight: 500, verticalAlign: 'top' };
const td: React.CSSProperties = { border: '1px solid #e8edf3', padding: '8px 10px', verticalAlign: 'middle' };
