/**
 * FreeGridCanvas — F0「自由表格(free_grid)」的统一网格编辑器（原始记录模板用）。
 *
 * 所有格子结构相同：自定义行/列、任意矩形合并（含表头）、每格标「表头」或「录入格」。
 *  - 点格子 = 选中 + 可直接输入固定文字；按住 Shift 点另一格 = 框选矩形区（用于合并/批量标记）。
 *  - 合并写 free_table.spans[主格]；被盖格渲染时跳过（与出片端 renderFreeGridTypst 同口径）。
 *  - 「表头」写 header_cells（出片加粗）；「录入格」写 input_cells（录入时可填，值存 raw_data[code]，不写模板）。
 */
import { useState, useEffect } from 'react';
import { Button, Input, InputNumber, Select, Tooltip, message } from 'antd';
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
    update({ [mapName]: next } as Partial<FT>);
  };

  const setCellText = (ri: number, ci: number, text: string) =>
    update({ cells: { ...cells, [keyAt(ri, ci)]: text } });

  // ─── F1 报告侧：每格绑定原始记录 ────────────────────────────────
  const [bindOpen, setBindOpen] = useState(false);
  const [bindKey, setBindKey] = useState<string | null>(null);
  const setCellBinding = (k: string, b: CellBinding) => update({ cell_bindings: { ...cellBindings, [k]: b } });
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
    update({ cell_formulas: { ...cellFx, [fx.target]: f } });
    setFx(null); setPickSrc(false);
  };
  const removeFx = (k: string) => { const n = { ...cellFx }; delete n[k]; update({ cell_formulas: n }); };

  // ─── 渲染 ────────────────────────────────────────────────────────
  const td: React.CSSProperties = { border: '1px solid #d9d9d9', padding: 0, minWidth: 64, height: 34, verticalAlign: 'middle' };
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: '#8c8c8c' }}>尺寸：</span>
        <InputNumber size="small" min={1} max={50} style={{ width: 54 }} value={rows.length} onChange={setRowCount} />
        <span style={{ fontSize: 12, color: '#8c8c8c' }}>行 ×</span>
        <InputNumber size="small" min={1} max={30} style={{ width: 54 }} value={cols.length} onChange={setColCount} />
        <span style={{ fontSize: 12, color: '#8c8c8c' }}>列</span>
        <span style={{ width: 1, height: 18, background: '#d9d9d9' }} />
        <span style={{ fontSize: 12, color: '#8c8c8c' }}>结构：</span>
        <Tooltip title="在末尾加一行"><Button size="small" icon={<PlusOutlined />} onClick={addRow}>行</Button></Tooltip>
        <Tooltip title="在末尾加一列"><Button size="small" icon={<PlusOutlined />} onClick={addCol}>列</Button></Tooltip>
        <Button size="small" danger disabled={!range} onClick={delRows}>删所选行</Button>
        <Button size="small" danger disabled={!range} onClick={delCols}>删所选列</Button>
        <span style={{ width: 1, height: 18, background: '#d9d9d9' }} />
        <Button size="small" type="primary" ghost icon={<MergeCellsOutlined />} disabled={selCount <= 1} onClick={mergeSel}>合并{selCount > 1 ? ` ${selCount} 格` : ''}</Button>
        <Button size="small" icon={<SplitCellsOutlined />} disabled={!selHasMerge} onClick={splitSel}>拆分</Button>
        <span style={{ width: 1, height: 18, background: '#d9d9d9' }} />
        <Tooltip title="把所选格标为/取消表头（出片加粗，跨页重复）"><Button size="small" disabled={!range} onClick={() => toggleMark('header_cells')}>表头</Button></Tooltip>
        <Tooltip title="把所选格标为/取消录入格（录入时可填值）"><Button size="small" disabled={!range} onClick={() => toggleMark('input_cells')}>录入格</Button></Tooltip>
        {linkedRecord && <>
          <span style={{ width: 1, height: 18, background: '#d9d9d9' }} />
          <Tooltip title="给所选单元格绑定原始记录的字段/单元格（报告生成时自动取值）">
            <Button size="small" type="primary" ghost disabled={!selCellKey} onClick={() => { if (selCellKey) { setBindKey(selCellKey); setBindOpen(true); } }}>绑定原始记录</Button>
          </Tooltip>
          <Button size="small" disabled={!selCellKey || !cellBindings[selCellKey]} onClick={() => { if (selCellKey) clearCellBinding(selCellKey); }}>清除绑定</Button>
        </>}
        {linkedRecord && recordMatrices.length > 0 && <>
          <span style={{ width: 1, height: 18, background: '#d9d9d9' }} />
          <span style={{ fontSize: 12, color: '#8c8c8c' }}>样品带：</span>
          <Select size="small" style={{ width: 128 }} placeholder="样品来源矩阵" value={bandMatrix}
            onChange={setBandMatrixSel} options={recordMatrices.map(m => ({ value: m.code, label: m.label }))} />
          <Tooltip title="把所选格所在的【行】设为样品带：报告生成时按该矩阵实际样品数自动展开成多行（带内格用「当前试样」绑定）">
            <Button size="small" disabled={!selRowId} onClick={() => setBand('row')}>设为样品带·行</Button>
          </Tooltip>
          <Tooltip title="把所选格所在的【列】设为样品带（每列一个样品）">
            <Button size="small" disabled={!selColId} onClick={() => setBand('col')}>·列</Button>
          </Tooltip>
          {sampleBand && <Button size="small" danger onClick={() => update({ sample_band: undefined })}>取消样品带</Button>}
        </>}
        <span style={{ width: 1, height: 18, background: '#d9d9d9' }} />
        <Tooltip title="给所选单格设公式（平均/求和/最值/阈值判定；来源引用其它格。样品带内=逐样品，带外=聚合整列）">
          <Button size="small" disabled={!selCellKey} onClick={openFx}>公式</Button>
        </Tooltip>
        {selCellKey && cellFx[selCellKey] && <Button size="small" onClick={() => removeFx(selCellKey)}>移除公式</Button>}
      </div>
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
      <div style={{ overflowX: 'auto' }}>
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
                  const bg = hasFx ? '#f9f0ff' : binding ? '#fffbe6' : inBand ? '#e6fffb' : isInput ? '#e6f4ff' : isHeader ? '#f6ffed' : '#fff';
                  return (
                    <td key={c.id} colSpan={cspan > 1 ? cspan : undefined} rowSpan={rspan > 1 ? rspan : undefined}
                      style={{ ...td, background: bg, outline: isSrc ? '2px dashed #eb2f96' : inSel ? '2px solid #722ed1' : undefined, outlineOffset: -2, cursor: 'cell' }}
                      onMouseDown={(e) => onCellDown(ri, ci, e)}
                      onMouseEnter={() => onCellEnter(ri, ci)}>
                      {hasFx ? (
                        <div style={{ fontSize: 11, padding: '2px 4px', minHeight: 20, color: '#722ed1', fontWeight: isHeader ? 700 : 400 }}>
                          ƒ {FX_LABELS[(hasFx as any).type] || '公式'}
                        </div>
                      ) : binding ? (
                        <div style={{ fontSize: 11, padding: '2px 4px', minHeight: 20, fontWeight: isHeader ? 700 : 400 }}>
                          <BindingSummary value={binding} linkedRecord={linkedRecord || null} />
                        </div>
                      ) : (
                        <Input
                          size="small" bordered={false} variant="borderless"
                          value={cells[k] ?? ''}
                          placeholder={isInput ? '录入格' : ''}
                          onChange={(e) => setCellText(ri, ci, e.target.value)}
                          style={{ textAlign: 'center', fontWeight: isHeader ? 700 : 400, color: isInput && !cells[k] ? '#69b1ff' : undefined }} />
                      )}
                      {(isHeader || isInput || binding || inBand || hasFx) && (
                        <div style={{ fontSize: 8, lineHeight: 1, color: hasFx ? '#722ed1' : inBand ? '#08979c' : binding ? '#d48806' : isInput ? '#1677ff' : '#52c41a', paddingBottom: 2 }}>
                          {[isHeader ? '表头' : '', hasFx ? '公式' : binding ? '绑定' : isInput ? '录入' : '', inBand ? '样品带' : ''].filter(Boolean).join('·')}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 6 }}>
        点格子选中并直接输入固定文字；<b>在格上按住鼠标拖动</b>即可框选多个格（松开结束；也可按住 Shift 点另一格扩展）→ 合并 / 标记表头 / 标记录入格。<b>录入格</b>（蓝底）在数据录入时由工程师填值。{linkedRecord && <>选中<b>单个格</b>可「<b>绑定原始记录</b>」（黄底）报告生成时自动取值。</>}
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
