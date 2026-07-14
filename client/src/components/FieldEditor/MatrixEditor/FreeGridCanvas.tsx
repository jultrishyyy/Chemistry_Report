/**
 * FreeGridCanvas — F0「自由表格(free_grid)」的统一网格编辑器（原始记录模板用）。
 *
 * 所有格子结构相同：自定义行/列、任意矩形合并（含表头）、每格标「表头」或「录入格」。
 *  - 点格子 = 选中 + 可直接输入固定文字；按住 Shift 点另一格 = 框选矩形区（用于合并/批量标记）。
 *  - 合并写 free_table.spans[主格]；被盖格渲染时跳过（与出片端 renderFreeGridTypst 同口径）。
 *  - 「表头」写 header_cells（出片加粗）；「录入格」写 input_cells（录入时可填，值存 raw_data[code]，不写模板）。
 */
import { useState, useEffect } from 'react';
import { Button, Input, InputNumber, Select, Tooltip, Popover, message } from 'antd';
import { PlusOutlined, MergeCellsOutlined, SplitCellsOutlined } from '@ant-design/icons';
import type { FieldDefinition, RecordTemplate, CellBinding } from '../../../../../shared/types';
import BindingPickerModal, { BindingSummary } from '../../ReportEditor/BindingPickerModal';

type FT = NonNullable<FieldDefinition['free_table']>;

const DEFAULT_FT: FT = {
  columns: [{ id: 'c1', label: '' }, { id: 'c2', label: '' }, { id: 'c3', label: '' }],
  rows: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }],
  cells: {}, header_cells: {}, input_cells: {},
};

export default function FreeGridCanvas({ field, onChange, linkedRecord }: {
  field: FieldDefinition;
  onChange: (patch: Partial<FieldDefinition>) => void;
  /** 报告侧编辑时传入关联的原始记录模板 → 每格可「绑定原始记录」自动取值。记录侧不传＝无绑定入口。 */
  linkedRecord?: RecordTemplate | null;
}) {
  const ft: FT = field.free_table || DEFAULT_FT;
  const cols = ft.columns || [];
  const rows = ft.rows || [];
  const cells = ft.cells || {};
  const spans = ft.spans || {};
  const headerCells = ft.header_cells || {};
  const inputCells = ft.input_cells || {};
  const cellBindings = ft.cell_bindings || {};
  const update = (patch: Partial<FT>) => onChange({ free_table: { ...ft, ...patch } });

  const keyAt = (ri: number, ci: number) => `${rows[ri].id}::${cols[ci].id}`;

  // ─── 矩形选区（Shift 框选）──────────────────────────────────────
  const [sel, setSel] = useState<{ r0: number; c0: number; r1: number; c1: number } | null>(null);
  const range = sel && {
    minR: Math.min(sel.r0, sel.r1), maxR: Math.max(sel.r0, sel.r1),
    minC: Math.min(sel.c0, sel.c1), maxC: Math.max(sel.c0, sel.c1),
  };
  const selCount = range ? (range.maxR - range.minR + 1) * (range.maxC - range.minC + 1) : 0;
  // Excel 式框选：在格上按下并拖动即框选矩形区（松开结束）；Shift+点＝从当前选区扩展
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const up = () => setDragging(false);
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);
  const onCellDown = (ri: number, ci: number, e: React.MouseEvent) => {
    const k = keyAt(ri, ci);
    if (fx && pickSrc) {   // 公式选来源模式：点格切换是否作来源（目标格自身除外）
      if (k !== fx.target) setFx({ ...fx, sources: fx.sources.includes(k) ? fx.sources.filter(x => x !== k) : [...fx.sources, k] });
      return;
    }
    if (e.shiftKey && sel) setSel({ ...sel, r1: ri, c1: ci });
    else { setSel({ r0: ri, c0: ci, r1: ri, c1: ci }); setDragging(true); }
  };
  const onCellEnter = (ri: number, ci: number) => {
    if (dragging) setSel(s => (s ? { ...s, r1: ri, c1: ci } : { r0: ri, c0: ci, r1: ri, c1: ci }));
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

  // ─── 行列增删 ───────────────────────────────────────────────────
  const addRow = () => update({ rows: [...rows, { id: `r_${Date.now()}` }] });
  const addCol = () => update({ columns: [...cols, { id: `c_${Date.now()}`, label: '' }] });
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
    };
  };
  const delRows = () => {
    if (!range || rows.length <= 1) { message.info('至少保留一行'); return; }
    const removed = new Set(rows.slice(range.minR, range.maxR + 1).map(r => r.id));
    update({ rows: rows.filter(r => !removed.has(r.id)), ...cleanMaps((rid) => removed.has(rid)) });
    setSel(null);
  };
  const delCols = () => {
    if (!range || cols.length <= 1) { message.info('至少保留一列'); return; }
    const removed = new Set(cols.slice(range.minC, range.maxC + 1).map(c => c.id));
    update({ columns: cols.filter(c => !removed.has(c.id)), ...cleanMaps((_rid, cid) => removed.has(cid)) });
    setSel(null);
  };
  // 尺寸直填：把网格调整到 N 行 / N 列（末尾增减，保留已有内容/合并/标记）
  const setRowCount = (n: number | null) => {
    const t = Math.max(1, Math.min(50, Math.round(n || 1)));
    if (t === rows.length) return;
    if (t > rows.length) update({ rows: [...rows, ...Array.from({ length: t - rows.length }, (_, i) => ({ id: `r_${Date.now()}_${i}` }))] });
    else { const rm = new Set(rows.slice(t).map(r => r.id)); update({ rows: rows.slice(0, t), ...cleanMaps((rid) => rm.has(rid)) }); setSel(null); }
  };
  const setColCount = (n: number | null) => {
    const t = Math.max(1, Math.min(30, Math.round(n || 1)));
    if (t === cols.length) return;
    if (t > cols.length) update({ columns: [...cols, ...Array.from({ length: t - cols.length }, (_, i) => ({ id: `c_${Date.now()}_${i}`, label: '' }))] });
    else { const rm = new Set(cols.slice(t).map(c => c.id)); update({ columns: cols.slice(0, t), ...cleanMaps((_rid, cid) => rm.has(cid)) }); setSel(null); }
  };

  // ─── 合并 / 拆分 ─────────────────────────────────────────────────
  const mergeSel = () => {
    if (!range || selCount <= 1) { message.info('按住 Shift 点另一格，选中至少两个相邻格'); return; }
    const { minR, maxR, minC, maxC } = range;
    const mainKey = keyAt(minR, minC);
    // 清掉被盖格的文字/标记（避免残留），主格保留
    const inRange = (rid: string, cid: string) => {
      const ri = rows.findIndex(r => r.id === rid), ci = cols.findIndex(c => c.id === cid);
      return ri >= minR && ri <= maxR && ci >= minC && ci <= maxC && !(ri === minR && ci === minC);
    };
    const cleaned = cleanMaps(inRange);
    update({
      ...cleaned,
      spans: { ...cleaned.spans, [mainKey]: { colspan: maxC - minC + 1, rowspan: maxR - minR + 1 } },
    });
    setSel({ r0: minR, c0: minC, r1: minR, c1: minC });
  };
  const splitSel = () => {
    if (!range) return;
    const next = { ...spans };
    let changed = false;
    for (let ri = range.minR; ri <= range.maxR; ri++) for (let ci = range.minC; ci <= range.maxC; ci++) {
      const k = keyAt(ri, ci); if (next[k]) { delete next[k]; changed = true; }
    }
    if (!changed) { message.info('选区里没有合并格'); return; }
    update({ spans: next });
  };
  const selHasMerge = !!range && (() => {
    for (let ri = range.minR; ri <= range.maxR; ri++) for (let ci = range.minC; ci <= range.maxC; ci++) {
      if (spans[keyAt(ri, ci)]) return true;
    }
    return false;
  })();

  // ─── 标记：表头 / 录入格 ─────────────────────────────────────────
  // 表头/录入/绑定/公式 四种为【互斥角色】：设其一即清掉这些格上的其它角色
  // （修「标了录入/公式后切不到表头」——原来各标记独立，渲染时录入/公式盖过表头）
  const stripFrom = (keys: string[], keep: string): Partial<FT> => {
    const strip = <T,>(m: Record<string, T> | undefined): Record<string, T> => { const n = { ...(m || {}) }; for (const k of keys) delete n[k]; return n; };
    const p: any = {};
    if (keep !== 'header_cells') p.header_cells = strip(headerCells);
    if (keep !== 'input_cells') p.input_cells = strip(inputCells);
    if (keep !== 'cell_bindings') p.cell_bindings = strip(cellBindings);
    if (keep !== 'cell_formulas') p.cell_formulas = strip(cellFx);
    return p;
  };
  const toggleMark = (mapName: 'header_cells' | 'input_cells') => {
    if (!range) { message.info('先点选格子'); return; }
    const src = mapName === 'header_cells' ? headerCells : inputCells;
    const keys: string[] = [];
    for (let ri = range.minR; ri <= range.maxR; ri++) for (let ci = range.minC; ci <= range.maxC; ci++) {
      if (!covered.has(`${ri},${ci}`)) keys.push(keyAt(ri, ci));
    }
    const allOn = keys.every(k => src[k]);
    const next: Record<string, true> = { ...src };
    for (const k of keys) { if (allOn) delete next[k]; else next[k] = true; }
    update({ [mapName]: next, ...(allOn ? {} : stripFrom(keys, mapName)) } as Partial<FT>);
  };

  const setCellText = (ri: number, ci: number, text: string) =>
    update({ cells: { ...cells, [keyAt(ri, ci)]: text } });

  // ─── F1 报告侧：每格绑定原始记录 ────────────────────────────────
  const [bindOpen, setBindOpen] = useState(false);
  const [bindKey, setBindKey] = useState<string | null>(null);
  const setCellBinding = (k: string, b: CellBinding) => update({ cell_bindings: { ...cellBindings, [k]: b }, ...stripFrom([k], 'cell_bindings') });
  const clearCellBinding = (k: string) => { const n = { ...cellBindings }; delete n[k]; update({ cell_bindings: n }); };
  const selCellKey = (range && selCount === 1) ? keyAt(range.minR, range.minC) : null;

  // ─── F2 样品带（报告侧）：标记某行/列随样品数自动展开 ───────────
  const sampleBand = ft.sample_band;
  const recordMatrices = (linkedRecord?.groups || []).flatMap(g => g.fields || [])
    .filter((f: any) => f.type === 'data_matrix').map((f: any) => ({ code: f.code, label: f.label || f.code }));
  const [bandMatrixSel, setBandMatrixSel] = useState<string | undefined>(undefined);
  const bandMatrix = bandMatrixSel || sampleBand?.matrix_code || recordMatrices[0]?.code;
  const selRowId = range ? rows[range.minR]?.id : null;
  const selColId = range ? cols[range.minC]?.id : null;
  const setBand = (axis: 'row' | 'col') => {
    const ref = axis === 'row' ? selRowId : selColId;
    if (!ref || !bandMatrix) { message.info('先选中带内一个格，并选择「样品来源矩阵」'); return; }
    update({ sample_band: { axis, matrix_code: bandMatrix, ref } });
  };
  const cellInBand = (k: string | null): boolean => {
    if (!k || !sampleBand) return false;
    const [rid, cid] = k.split('::');
    return sampleBand.axis === 'row' ? rid === sampleBand.ref : cid === sampleBand.ref;
  };

  // ─── F3 每格公式（平均/求和/最值/阈值判定；来源引用其它格）────────
  const cellFx = ft.cell_formulas || {};
  const FX_LABELS: Record<string, string> = { average: '平均', sum: '求和', max: '最大', min: '最小', threshold: '阈值判定' };
  const [fx, setFx] = useState<{ target: string; type: string; sources: string[]; op?: string; threshold?: number; decimals?: number } | null>(null);
  const [pickSrc, setPickSrc] = useState(false);
  const openFx = () => {
    if (!selCellKey) return;
    const cur: any = cellFx[selCellKey];
    setFx(cur
      ? { target: selCellKey, type: cur.type, sources: cur.sources || [], op: cur.params?.operator, threshold: cur.params?.threshold, decimals: cur.decimals }
      : { target: selCellKey, type: 'average', sources: [], decimals: 2 });
    setPickSrc(true);
  };
  const saveFx = () => {
    if (!fx) return;
    if (!fx.sources.length) { message.info('请「＋点格添加来源」选择来源格'); return; }
    const f: any = { type: fx.type, sources: fx.sources };
    if (fx.type === 'threshold') f.params = { operator: fx.op || '>=', threshold: fx.threshold ?? 0, pass: '合格', fail: '不合格' };
    if ((fx.type === 'average' || fx.type === 'sum') && fx.decimals != null) f.decimals = fx.decimals;
    update({ cell_formulas: { ...cellFx, [fx.target]: f }, ...stripFrom([fx.target], 'cell_formulas') });
    setFx(null); setPickSrc(false);
  };
  const removeFx = (k: string) => { const n = { ...cellFx }; delete n[k]; update({ cell_formulas: n }); };

  // ─── 单元格设置：单位 / 选择框(可选项) / 数字格式 ─────────────────
  const cellUnits = ft.cell_units || {};
  const cellOptions = ft.cell_options || {};
  const cellNumFmt = ft.cell_number_fmt || {};
  const setUnit = (k: string, u: string) => { const n = { ...cellUnits }; if (u) n[k] = u; else delete n[k]; update({ cell_units: n }); };
  const setOptions = (k: string, opts: string[]) => { const n = { ...cellOptions }; if (opts?.length) n[k] = opts; else delete n[k]; update({ cell_options: n }); };
  const setNumFmt = (k: string, fmt: { mode: 'decimals' | 'scientific' | 'significant'; digits: number } | undefined) => { const n: Record<string, any> = { ...cellNumFmt }; if (fmt) n[k] = fmt; else delete n[k]; update({ cell_number_fmt: n }); };
  const hasCellSettings = (k: string) => !!(cellUnits[k] || cellOptions[k]?.length || cellNumFmt[k]);
  const cellSettingsPanel = (k: string) => (
    <div style={{ width: 250, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <div style={{ fontSize: 12, color: '#555', marginBottom: 3 }}>单位（表头/数值显示为「值（单位）」）</div>
        <Input size="small" placeholder="如 MPa（留空=无）" value={cellUnits[k]} onChange={(e) => setUnit(k, e.target.value)} />
      </div>
      <div>
        <div style={{ fontSize: 12, color: '#555', marginBottom: 3 }}>选择框：录入时从选项里选（可把表头做成可选项）</div>
        <Select size="small" mode="tags" style={{ width: '100%' }} placeholder="输入选项回车添加" value={cellOptions[k] || []} onChange={(v) => setOptions(k, v as string[])} open={false} suffixIcon={null} />
      </div>
      <div>
        <div style={{ fontSize: 12, color: '#555', marginBottom: 3 }}>数字格式</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Select size="small" style={{ flex: 1 }} value={cellNumFmt[k]?.mode || ''} placeholder="不格式化"
            onChange={(m) => setNumFmt(k, m ? { mode: m as any, digits: cellNumFmt[k]?.digits ?? 2 } : undefined)}
            options={[{ value: '', label: '不格式化' }, { value: 'decimals', label: '小数位' }, { value: 'scientific', label: '科学计数法' }, { value: 'significant', label: '有效数字' }]} />
          {cellNumFmt[k]?.mode && <InputNumber size="small" style={{ width: 68 }} min={0} max={10} value={cellNumFmt[k]?.digits ?? 2}
            onChange={(v) => setNumFmt(k, { mode: cellNumFmt[k]!.mode, digits: (v as number) ?? 2 })} addonAfter="位" />}
        </div>
      </div>
    </div>
  );

  // ─── 渲染 ────────────────────────────────────────────────────────
  const td: React.CSSProperties = { border: '1px solid #eaecef', padding: 0, minWidth: 70, height: 36, verticalAlign: 'middle', position: 'relative' };
  const gLabel: React.CSSProperties = { fontSize: 12, color: '#8c8c8c' };
  const sep: React.CSSProperties = { width: 1, height: 16, background: '#e8e8e8', margin: '0 3px' };
  const hasSel = !!range;
  return (
    <div style={{ border: '1px solid #eef0f3', borderRadius: 8, padding: 12, background: '#fff' }}>
      {/* 主工具栏：尺寸 + 结构（常显、精简） */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <span style={gLabel}>尺寸</span>
        <InputNumber size="small" min={1} max={50} style={{ width: 52 }} value={rows.length} onChange={setRowCount} />
        <span style={{ color: '#bbb' }}>×</span>
        <InputNumber size="small" min={1} max={30} style={{ width: 52 }} value={cols.length} onChange={setColCount} />
        <span style={sep} />
        <Tooltip title="末尾加一行"><Button size="small" icon={<PlusOutlined />} onClick={addRow}>行</Button></Tooltip>
        <Tooltip title="末尾加一列"><Button size="small" icon={<PlusOutlined />} onClick={addCol}>列</Button></Tooltip>
        <span style={{ ...gLabel, color: '#bbb', marginLeft: 4 }}>· 点格输入文字，拖动框选多格</span>
      </div>

      {/* 选中操作栏：有选区才出现，按功能分组 */}
      {hasSel && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 10, padding: '8px 10px', background: '#f7f9fc', border: '1px solid #eef0f3', borderRadius: 6 }}>
          <span style={{ ...gLabel, color: '#1677ff', fontWeight: 500 }}>已选 {selCount} 格</span>
          <span style={sep} />
          <Button size="small" type="primary" ghost icon={<MergeCellsOutlined />} disabled={selCount <= 1} onClick={mergeSel}>合并</Button>
          <Button size="small" icon={<SplitCellsOutlined />} disabled={!selHasMerge} onClick={splitSel}>拆分</Button>
          <Button size="small" danger onClick={delRows}>删行</Button>
          <Button size="small" danger onClick={delCols}>删列</Button>
          <span style={sep} />
          <Tooltip title="标为/取消 表头（出片加粗、跨页重复）"><Button size="small" onClick={() => toggleMark('header_cells')}>表头</Button></Tooltip>
          <Tooltip title="标为/取消 录入格（数据录入时由工程师填值）"><Button size="small" onClick={() => toggleMark('input_cells')}>录入格</Button></Tooltip>
          <Tooltip title="给所选单格设公式（平均/求和/最值/阈值判定；来源引用其它格）"><Button size="small" disabled={!selCellKey} onClick={openFx}>公式</Button></Tooltip>
          {selCellKey && cellFx[selCellKey] && <Button size="small" onClick={() => removeFx(selCellKey)}>移除公式</Button>}
          {selCellKey
            ? <Popover trigger="click" placement="bottom" title="单元格设置" content={cellSettingsPanel(selCellKey)}><Button size="small">单位/选项/格式</Button></Popover>
            : <Tooltip title="选中单个格后可设 单位 / 选择框 / 数字格式"><Button size="small" disabled>单位/选项/格式</Button></Tooltip>}
          {linkedRecord && <>
            <span style={sep} />
            <Tooltip title="给所选单格绑定原始记录（报告生成时自动取值）">
              <Button size="small" type="primary" ghost disabled={!selCellKey} onClick={() => { if (selCellKey) { setBindKey(selCellKey); setBindOpen(true); } }}>绑定记录</Button>
            </Tooltip>
            {selCellKey && cellBindings[selCellKey] && <Button size="small" onClick={() => clearCellBinding(selCellKey)}>清除绑定</Button>}
          </>}
          {linkedRecord && recordMatrices.length > 0 && <>
            <span style={sep} />
            <span style={gLabel}>样品带</span>
            <Select size="small" style={{ width: 116 }} placeholder="来源矩阵" value={bandMatrix}
              onChange={setBandMatrixSel} options={recordMatrices.map(m => ({ value: m.code, label: m.label }))} />
            <Tooltip title="所选格所在【行】设为样品带（报告按该矩阵样品数自动展开成多行）"><Button size="small" disabled={!selRowId} onClick={() => setBand('row')}>行</Button></Tooltip>
            <Tooltip title="所选格所在【列】设为样品带（每列一个样品）"><Button size="small" disabled={!selColId} onClick={() => setBand('col')}>列</Button></Tooltip>
            {sampleBand && <Button size="small" danger onClick={() => update({ sample_band: undefined })}>取消</Button>}
          </>}
        </div>
      )}
      {fx && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8, padding: '6px 10px', background: '#f9f0ff', border: '1px solid #d3adf7', borderRadius: 6 }}>
          <span style={{ fontSize: 12, color: '#722ed1' }}>公式 · 目标格 <b>{fx.target}</b>：</span>
          <Select size="small" style={{ width: 110 }} value={fx.type} onChange={(t) => setFx({ ...fx, type: t })}
            options={Object.entries(FX_LABELS).map(([v, l]) => ({ value: v, label: l }))} />
          {fx.type === 'threshold' && <>
            <Select size="small" style={{ width: 64 }} value={fx.op || '>='} onChange={(op) => setFx({ ...fx, op })}
              options={['>=', '>', '<=', '<', '=='].map(o => ({ value: o, label: o }))} />
            <InputNumber size="small" style={{ width: 84 }} placeholder="阈值" value={fx.threshold} onChange={(v) => setFx({ ...fx, threshold: v ?? 0 })} />
          </>}
          <Button size="small" type={pickSrc ? 'primary' : 'default'} onClick={() => setPickSrc(!pickSrc)}>{pickSrc ? '点格选来源中…（点此完成）' : '＋点格添加来源'}</Button>
          <span style={{ fontSize: 11, color: '#8c8c8c' }}>来源：{fx.sources.length ? fx.sources.join('、') : '（未选）'}</span>
          {fx.sources.length > 0 && <Button size="small" onClick={() => setFx({ ...fx, sources: [] })}>清空</Button>}
          <Button size="small" type="primary" onClick={saveFx}>确定</Button>
          <Button size="small" onClick={() => { setFx(null); setPickSrc(false); }}>取消</Button>
        </div>
      )}
      <div style={{ overflowX: 'auto', border: '1px solid #eaecef', borderRadius: 6, display: 'inline-block', maxWidth: '100%' }}>
        <table style={{ borderCollapse: 'collapse', userSelect: dragging ? 'none' : undefined }}>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={r.id}>
                {cols.map((c, ci) => {
                  if (covered.has(`${ri},${ci}`)) return null;
                  const k = keyAt(ri, ci);
                  const sp = spans[k];
                  const cspan = Math.min(Math.max(sp?.colspan ?? 1, 1), cols.length - ci);
                  const rspan = Math.min(Math.max(sp?.rowspan ?? 1, 1), rows.length - ri);
                  const isHeader = !!headerCells[k];
                  const isInput = !!inputCells[k];
                  const binding = cellBindings[k];
                  const inBand = cellInBand(k);
                  const hasFx = cellFx[k];
                  const isSrc = !!(fx && pickSrc && fx.sources.includes(k));
                  const inSel = !!range && ri >= range.minR && ri <= range.maxR && ci >= range.minC && ci <= range.maxC;
                  const bg = hasFx ? '#f9f0ff' : binding ? '#fff7e6' : isInput ? '#e6f7ff' : isHeader ? '#f4f6fa' : inBand ? '#effcfb' : '#fff';
                  return (
                    <td key={c.id} colSpan={cspan > 1 ? cspan : undefined} rowSpan={rspan > 1 ? rspan : undefined}
                      style={{ ...td, background: bg, boxShadow: inSel ? 'inset 0 0 0 2px #1677ff' : isSrc ? 'inset 0 0 0 2px #eb2f96' : undefined, cursor: 'cell', ...(inBand ? { borderLeft: '3px solid #13c2c2' } : {}) }}
                      onMouseDown={(e) => onCellDown(ri, ci, e)}
                      onMouseEnter={() => onCellEnter(ri, ci)}>
                      {hasFx ? (
                        <div style={{ fontSize: 11, padding: '4px 6px', color: '#722ed1', fontWeight: isHeader ? 700 : 400 }} title="公式格">ƒ {FX_LABELS[(hasFx as any).type] || '公式'}</div>
                      ) : binding ? (
                        <div style={{ fontSize: 11, padding: '4px 6px', fontWeight: isHeader ? 700 : 400 }} title="绑定原始记录">
                          <BindingSummary value={binding} linkedRecord={linkedRecord || null} />
                        </div>
                      ) : (
                        <Input
                          size="small" variant="borderless"
                          value={cells[k] ?? ''}
                          placeholder={isInput ? '录入' : ''}
                          onChange={(e) => setCellText(ri, ci, e.target.value)}
                          style={{ textAlign: 'center', fontWeight: isHeader ? 700 : 400, color: isInput && !cells[k] ? '#9cc2ff' : undefined }} />
                      )}
                      {hasCellSettings(k) && <span style={{ position: 'absolute', top: 0, right: 2, fontSize: 9, color: '#722ed1', lineHeight: 1 }} title="有单元格设置（单位/选项/数字格式）">⚙</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 10, fontSize: 11, color: '#8c8c8c', alignItems: 'center' }}>
        {[
          { c: '#f4f6fa', t: '表头' },
          { c: '#e6f7ff', t: '录入格' },
          ...(linkedRecord ? [{ c: '#fff7e6', t: '绑定记录' }] : []),
          { c: '#f9f0ff', t: '公式' },
        ].map(x => (
          <span key={x.t} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 12, height: 12, background: x.c, border: '1px solid #e0e0e0', borderRadius: 3 }} />{x.t}
          </span>
        ))}
        {linkedRecord && recordMatrices.length > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 12, height: 12, background: '#effcfb', border: '1px solid #e0e0e0', borderLeft: '3px solid #13c2c2', borderRadius: 2 }} />样品带
          </span>
        )}
        <span style={{ color: '#bbb' }}>· 拖动框选多格，选中后在上方操作栏合并/标记/公式{linkedRecord ? '/绑定/样品带' : ''}</span>
      </div>
      {linkedRecord && bindKey && (
        <BindingPickerModal
          open={bindOpen}
          value={cellBindings[bindKey] || { source: 'literal', text: cells[bindKey] || '' }}
          linkedRecord={linkedRecord}
          allowedSources={cellInBand(bindKey)
            ? ['literal', 'record_field', 'record_cell', 'record_summary', 'record_header', 'record_cell_sample', 'record_sample_label', 'record_sample_index']
            : ['literal', 'record_field', 'record_cell', 'record_summary', 'record_header']}
          bandMatrixCode={cellInBand(bindKey) ? sampleBand?.matrix_code : undefined}
          title={cellInBand(bindKey) ? '样品带单元格：选「当前试样」按样品自动展开' : '为单元格绑定原始记录数据源'}
          onChange={(b) => setCellBinding(bindKey, b)}
          onClose={() => setBindOpen(false)}
        />
      )}
    </div>
  );
}
