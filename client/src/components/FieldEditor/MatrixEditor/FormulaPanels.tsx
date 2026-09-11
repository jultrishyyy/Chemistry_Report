/**
 * FormulaPanels.tsx — 从 MatrixFormulaCanvas 提取的公式编辑面板
 * 供 MatrixEditor 复用
 */
import { useState, useMemo, useEffect } from 'react';
import {
  Button, Select as AntSelect, InputNumber, Space, Tag, Form, Alert, Tabs, Input,
} from 'antd';
import { CheckOutlined, CloseOutlined } from '@ant-design/icons';
import type {
  DataMatrixConfig, FieldDefinition, MatrixParameterDef, MatrixSummaryRowDef, RecordTemplate,
} from '../../../../../shared/types';
import { FORMULA_TYPES, execute, type Formula, type FormulaType } from '../../../../../shared/formula-engine';
import { matrixDataKey, makeMatrixColumnSource, parseMatrixColumnSource, matrixSummaryColumnFlatKey } from '../../../../../shared/matrix-flatten';
import AutoGrowTextArea from '../../AutoGrowTextArea';

const ALLOWED_FORMULA_TYPES: FormulaType[] = [
  'average', 'sum', 'max', 'min', 'round_format',
  'percentage', 'unit_convert', 'custom',
];

function cellCode(matrixCode: string, sampleIdx: number, paramCode: string): string {
  return `${matrixCode}__${matrixDataKey(`s${sampleIdx}`, paramCode)}`;
}

function describeCode(code: string, template: RecordTemplate): string {
  const col = parseMatrixColumnSource(code);
  if (col) {
    for (const g of template.groups) for (const f of g.fields) {
      if (f.type === 'data_matrix' && f.code === col.matrixCode) {
        const p = f.matrix?.parameters.find(x => x.code === col.paramCode);
        return `${f.label} · ${p?.label || col.paramCode} · 全部试样`;
      }
    }
    return `${col.paramCode} · 全部试样`;
  }
  for (const g of template.groups) {
    for (const f of g.fields) {
      if (f.type === 'data_matrix' && f.matrix) {
        const prefix = `${f.code}__`;
        if (code.startsWith(prefix)) {
          const tail = code.slice(prefix.length);
          // 非试样行（其他行/每列统计）：summary__{rowId}__{param}
          if (tail.startsWith('summary__')) {
            const rest = tail.slice('summary__'.length);
            const us = rest.indexOf('__');
            if (us < 0) continue;
            const rowId = rest.slice(0, us), param = rest.slice(us + 2);
            const sr = f.matrix.summary_rows?.find(s => s.id === rowId);
            const p = f.matrix.parameters.find(x => x.code === param);
            return `${f.label} · ${sr?.label || rowId} · ${p?.label || param}`;
          }
          const m = tail.match(/^s(\d+)__(.+)$/);
          if (!m) continue;
          const p = f.matrix.parameters.find(x => x.code === m[2]);
          return `${f.label} · 试样${Number(m[1]) + 1} · ${p?.label || m[2]}`;
        }
      } else if (f.code === code) {
        return f.label;
      }
    }
  }
  return code;
}

// ─── 按行公式面板 ─────────────────────────────────────────────────────
export function CellFormulaPanel({
  param, params, onSave, onCancel,
}: {
  param: MatrixParameterDef;
  params: MatrixParameterDef[];
  onSave: (expr: string, decimals: number) => void;
  onCancel: () => void;
}) {
  // PLACEHOLDER_CELL_FORMULA_PANEL
  const [expression, setExpression] = useState(param.cell_formula || '');
  const [decimals, setDecimals] = useState(param.cell_formula_decimals ?? 2);
  const otherParams = params.filter(p => p.id !== param.id);

  const insertCode = (code: string) => {
    setExpression(prev => prev + (prev && !/[\s(+\-*/]$/.test(prev) ? ' ' : '') + code);
  };

  return (
    <div style={{ position: 'relative', background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 6, padding: 12 }}>
      <Button type="text" size="small" icon={<CloseOutlined />} aria-label="关闭公式设置" title="关闭"
        onClick={onCancel} style={{ position: 'absolute', top: 5, right: 5, zIndex: 2, color: '#8a94a6' }} />
      <Alert type="warning" showIcon style={{ marginBottom: 10 }}
        message={`列「${param.label}」的按行公式`}
        description="该列每行的值由本行其他列计算得出；录入时该列自动置灰显示结果。" />
      <Form layout="vertical" size="small">
        <Form.Item label="表达式" extra={<span>支持 <code>+ - * / ( )</code> 和列 code</span>}>
          <Input value={expression} onChange={(e) => setExpression(e.target.value)}
            placeholder="如：burn_distance / burn_time * 60" />
          <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: '#888' }}>点击插入列 code：</span>
            {otherParams.length === 0 && <span style={{ fontSize: 11, color: '#aaa' }}>（先添加其他参数列）</span>}
            {otherParams.map(p => (
              <Tag key={p.code} style={{ cursor: 'pointer', margin: 0 }} onClick={() => insertCode(p.code)}>
                {p.label} <span style={{ color: '#888' }}>({p.code})</span>
              </Tag>
            ))}
          </div>
        </Form.Item>
        <Form.Item label="保留小数位">
          <InputNumber min={0} max={10} value={decimals} onChange={(v) => setDecimals(Number(v ?? 2))} />
        </Form.Item>
      </Form>
      <Space>
        <Button type="primary" size="small" icon={<CheckOutlined />}
          disabled={!expression.trim()} onClick={() => onSave(expression.trim(), decimals)}>保存</Button>
      </Space>
    </div>
  );
}

// ─── 每列统计面板 ─────────────────────────────────────────────────────
export function PerColumnPanel({
  row, onSave, onCancel,
}: {
  row: MatrixSummaryRowDef;
  onSave: (patch: Partial<MatrixSummaryRowDef>) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(row.label || '平均值');
  const [aggregate, setAggregate] = useState<NonNullable<MatrixSummaryRowDef['aggregate']>>(row.aggregate || 'average');
  const [decimals, setDecimals] = useState<number>(row.decimals ?? 2);

  return (
    <div style={{ position: 'relative', background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 6, padding: 12 }}>
      <Button type="text" size="small" icon={<CloseOutlined />} aria-label="关闭统计设置" title="关闭"
        onClick={onCancel} style={{ position: 'absolute', top: 5, right: 5, zIndex: 2, color: '#8a94a6' }} />
      <Alert type="success" showIcon style={{ marginBottom: 10 }}
        message="每列统计行"
        description="每个参数列独立对所有试样行做聚合（平均/和/最值）。" />
      <Form layout="vertical" size="small">
        <Form.Item label="行标签（首列文字）">
          <AutoGrowTextArea value={label} onChange={(e) => setLabel(e.target.value)} placeholder="如：平均值" />
        </Form.Item>
        <Form.Item label="聚合方式">
          <AntSelect value={aggregate} onChange={(v) => setAggregate(v as any)} style={{ width: 160 }}
            options={[
              { value: 'average', label: '平均值' },
              { value: 'sum', label: '求和' },
              { value: 'max', label: '最大值' },
              { value: 'min', label: '最小值' },
            ]} />
        </Form.Item>
        <Form.Item label="保留小数位">
          <InputNumber min={0} max={10} value={decimals} onChange={(v) => setDecimals(Number(v ?? 2))} />
        </Form.Item>
      </Form>
      <Space>
        <Button type="primary" size="small" icon={<CheckOutlined />}
          onClick={() => onSave({ label, aggregate, decimals })}>保存</Button>
      </Space>
    </div>
  );
}

// ─── 单元格级公式面板 ─────────────────────────────────────────────────
export function PerCellFormulaPanel({
  sampleIdx, paramIdx, params, field, template, config, onSave, onClear, onCancel,
  existing: existingOverride, selfCode: selfCodeOverride, title,
}: {
  sampleIdx: number;
  paramIdx: number;
  params: MatrixParameterDef[];
  field: FieldDefinition;
  template: RecordTemplate;
  config: DataMatrixConfig;
  onSave: (formula: Formula) => void;
  onClear: () => void;
  onCancel: () => void;
  /** 显式传入既有公式（"其他行"用：公式存在 summary_rows 而非 config.cell_formulas） */
  existing?: Formula;
  /** 自身单元格 code（从数据源里排除自己）；其他行无对应试样格，传 null 即不排除 */
  selfCode?: string | null;
  /** 顶部提示标题覆盖（其他行用） */
  title?: string;
}) {
  const param = params[paramIdx];
  const cellKey = matrixDataKey(`s${sampleIdx}`, param.code);
  const existing = existingOverride ?? config.cell_formulas?.[cellKey];

  const [formulaType, setFormulaType] = useState<FormulaType>(existing?.type || 'average');
  const [decimals, setDecimals] = useState<number>(existing?.decimals ?? 2);
  const [extraParams, setExtraParams] = useState<Record<string, any>>(existing?.params || {});
  const [sources, setSources] = useState<string[]>(existing?.sources || []);
  const [expression, setExpression] = useState(existing?.expression || '');

  const [preview, setPreview] = useState<string>('—');
  useEffect(() => {
    const mock: Record<string, any> = {};
    sources.forEach((s, i) => { mock[s] = (i + 1) * 10; });
    try {
      const r = execute({
        type: formulaType, sources, decimals, params: extraParams,
        expression: formulaType === 'custom' ? expression : undefined,
      }, mock);
      setPreview(r === null || r === undefined ? '(无结果)' : String(r));
    } catch { setPreview('(计算错误)'); }
  }, [formulaType, sources, decimals, extraParams, expression]);

  const selectedSet = useMemo(() => new Set(sources), [sources]);
  const toggleCells = (codes: string[]) => {
    const selfCode = selfCodeOverride !== undefined ? selfCodeOverride : cellCode(field.code, sampleIdx, param.code);
    const eligible = selfCode ? codes.filter(c => c !== selfCode) : codes;
    const allOn = eligible.every(c => selectedSet.has(c));
    if (allOn) setSources(sources.filter(s => !eligible.includes(s)));
    else setSources(Array.from(new Set([...sources, ...eligible])));
  };
  const removeOne = (code: string) => setSources(sources.filter(s => s !== code));

  const allMatrices = useMemo(() => {
    const list: FieldDefinition[] = [];
    for (const g of template.groups) for (const f of g.fields) {
      if (f.type === 'data_matrix' && f.matrix) list.push(f);
    }
    return list;
  }, [template]);

  const scalarFields = useMemo(() => {
    const list: { code: string; label: string }[] = [];
    for (const g of template.groups) for (const f of g.fields) {
      if (f.type === 'number' || f.type === 'computed') list.push({ code: f.code, label: f.label });
    }
    return list;
  }, [template]);

  const tabItems = [
    ...allMatrices.map((mf) => ({
      key: `m_${mf.id}`,
      label: mf.id === field.id ? `${mf.label}（本表）` : mf.label,
      children: <SourceGridPicker matrixField={mf} matrixConfig={mf.id === field.id ? config : mf.matrix!} selected={selectedSet} onToggleCells={toggleCells} sourcesOrder={formulaType === 'custom' ? sources : undefined} />,
    })),
    { key: 'scalar', label: '其他字段', children: <ScalarPicker fields={scalarFields} selected={selectedSet} onToggle={toggleCells} /> },
  ];

  return (
    <div style={{ position: 'relative', background: '#e6fffb', border: '1px solid #87e8de', borderRadius: 6, padding: 12 }}>
      <Button type="text" size="small" icon={<CloseOutlined />} aria-label="关闭单元格公式" title="关闭"
        onClick={onCancel} style={{ position: 'absolute', top: 5, right: 5, zIndex: 2, color: '#8a94a6' }} />
      <Alert type="info" showIcon style={{ marginBottom: 10 }}
        message={title ?? `单元格公式 — 行${sampleIdx + 1} × ${param.label}`}
        description="为这一格配置独立公式，录入时该格变为只读。" />
      <FormulaForm formulaType={formulaType} setFormulaType={setFormulaType} decimals={decimals} setDecimals={setDecimals}
        extraParams={extraParams} setExtraParams={setExtraParams} expression={expression} setExpression={setExpression}
        sources={sources} template={template} />
      <Form layout="vertical" size="small">
        <Form.Item label="数据源（点击下方表格选取）">
          <Tabs size="small" items={tabItems} defaultActiveKey={`m_${field.id}`} />
        </Form.Item>
      </Form>
      <SelectedChips sources={sources} template={template} onRemove={removeOne} onClear={() => setSources([])} />
      <PreviewBox preview={preview} />
      <Space>
        <Button type="primary" size="small" icon={<CheckOutlined />} disabled={sources.length === 0}
          onClick={() => onSave({ type: formulaType, sources, decimals, params: extraParams, expression: formulaType === 'custom' ? expression : undefined })}>保存</Button>
        {existing && <Button size="small" danger onClick={onClear}>清除公式</Button>}
      </Space>
    </div>
  );
}

// ─── 跨列汇总公式面板 ─────────────────────────────────────────────────
export function SummaryFormulaPanel({
  row, field, template, config, onSave, onCancel,
}: {
  row: MatrixSummaryRowDef;
  field: FieldDefinition;
  template: RecordTemplate;
  config: DataMatrixConfig;
  onSave: (patch: Partial<MatrixSummaryRowDef>) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(row.label || '汇总公式');
  const [formulaType, setFormulaType] = useState<FormulaType>(row.formula?.type || 'average');
  const [decimals, setDecimals] = useState<number>(row.formula?.decimals ?? 2);
  const [extraParams, setExtraParams] = useState<Record<string, any>>(row.formula?.params || {});
  const [sources, setSources] = useState<string[]>(row.formula?.sources || []);
  const [expression, setExpression] = useState(row.formula?.expression || '');

  const [preview, setPreview] = useState<string>('—');
  useEffect(() => {
    const mock: Record<string, any> = {};
    sources.forEach((s, i) => { mock[s] = (i + 1) * 10; });
    try {
      const r = execute({
        type: formulaType, sources, decimals, params: extraParams,
        expression: formulaType === 'custom' ? expression : undefined,
      }, mock);
      setPreview(r === null || r === undefined ? '(无结果)' : String(r));
    } catch { setPreview('(计算错误)'); }
  }, [formulaType, sources, decimals, extraParams, expression]);

  const selectedSet = useMemo(() => new Set(sources), [sources]);
  const toggleCells = (codes: string[]) => {
    const allOn = codes.every(c => selectedSet.has(c));
    if (allOn) setSources(sources.filter(s => !codes.includes(s)));
    else setSources(Array.from(new Set([...sources, ...codes])));
  };
  const removeOne = (code: string) => setSources(sources.filter(s => s !== code));

  const allMatrices = useMemo(() => {
    const list: FieldDefinition[] = [];
    for (const g of template.groups) for (const f of g.fields) {
      if (f.type === 'data_matrix' && f.matrix) list.push(f);
    }
    return list;
  }, [template]);

  const scalarFields = useMemo(() => {
    const list: { code: string; label: string }[] = [];
    for (const g of template.groups) for (const f of g.fields) {
      if (f.type === 'number' || f.type === 'computed') list.push({ code: f.code, label: f.label });
    }
    return list;
  }, [template]);

  const tabItems = [
    ...allMatrices.map((mf) => ({
      key: `m_${mf.id}`,
      label: mf.id === field.id ? `${mf.label}（本表）` : mf.label,
      children: <SourceGridPicker matrixField={mf} matrixConfig={mf.id === field.id ? config : mf.matrix!} selected={selectedSet} onToggleCells={toggleCells} sourcesOrder={formulaType === 'custom' ? sources : undefined} />,
    })),
    { key: 'scalar', label: '其他字段', children: <ScalarPicker fields={scalarFields} selected={selectedSet} onToggle={toggleCells} /> },
  ];

  return (
    <div style={{ position: 'relative', background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 6, padding: 12 }}>
      <Button type="text" size="small" icon={<CloseOutlined />} aria-label="关闭汇总公式" title="关闭"
        onClick={onCancel} style={{ position: 'absolute', top: 5, right: 5, zIndex: 2, color: '#8a94a6' }} />
      <Alert type="warning" showIcon style={{ marginBottom: 10 }}
        message="跨列汇总公式行"
        description="整行一个公式值，横跨所有参数列；点击下方画布中的单元格选取数据源。" />
      <Form layout="vertical" size="small">
        <Form.Item label="行标签（首列文字）">
          <AutoGrowTextArea value={label} onChange={(e) => setLabel(e.target.value)} placeholder="如：平均值" />
        </Form.Item>
      </Form>
      <FormulaForm formulaType={formulaType} setFormulaType={setFormulaType} decimals={decimals} setDecimals={setDecimals}
        extraParams={extraParams} setExtraParams={setExtraParams} expression={expression} setExpression={setExpression}
        sources={sources} template={template} />
      <Form layout="vertical" size="small">
        <Form.Item label="数据源（点击下方表格选取）">
          <Tabs size="small" items={tabItems} defaultActiveKey={`m_${field.id}`} />
        </Form.Item>
      </Form>
      <SelectedChips sources={sources} template={template} onRemove={removeOne} onClear={() => setSources([])} />
      <PreviewBox preview={preview} />
      <Space>
        <Button type="primary" size="small" icon={<CheckOutlined />}
          onClick={() => onSave({ label, source_type: 'formula', formula: { type: formulaType, sources, decimals, params: extraParams, expression: formulaType === 'custom' ? expression : undefined } })}>保存</Button>
      </Space>
    </div>
  );
}

// ─── 数据源网格选择器 ─────────────────────────────────────────────────
export function SourceGridPicker({
  matrixField, matrixConfig, selected, onToggleCells, sourcesOrder,
}: {
  matrixField: FieldDefinition;
  matrixConfig: DataMatrixConfig;
  selected: Set<string>;
  onToggleCells: (codes: string[]) => void;
  /** 当传入时，被选中的格子显示 v1/v2/v3...（用于 custom 自定义表达式模式） */
  sourcesOrder?: string[];
}) {
  const cfg = matrixConfig;
  const params = cfg.parameters || [];
  const n = cfg.default_sample_count || 1;
  const isTextMatrix = cfg.cell_type === 'text';

  if (params.length === 0) return <Alert type="warning" showIcon message="此矩阵尚未配置参数列" />;

  const colCodes = (pcode: string) => Array.from({ length: n }, (_, i) => cellCode(matrixField.code, i, pcode));
  const rowCodes = (sIdx: number) => params.filter(() => !isTextMatrix).map(p => cellCode(matrixField.code, sIdx, p.code));
  const allCodes = () => {
    if (isTextMatrix) return [];
    const all: string[] = [];
    for (let i = 0; i < n; i++) for (const p of params) all.push(cellCode(matrixField.code, i, p.code));
    return all;
  };

  // custom 自定义表达式（v1/v2…按位置对应）下，整列必须是稳定的具体格子，不能用"随试样数变化"的符号列。
  const customMode = !!sourcesOrder;
  const colToken = (pcode: string) => makeMatrixColumnSource(matrixField.code, pcode);
  const colSelected = (pcode: string) => !customMode && selected.has(colToken(pcode));
  const allColTokens = params.map(p => colToken(p.code));

  // 非试样行（其他行 / 每列统计）——逐列有格，可手动点选；整列只勾试样、不碰这些。
  const nonSampleRows = (cfg.summary_rows || []).filter(sr =>
    sr.source_type === 'per_column_aggregate' ||
    (sr.per_column && ['input_text', 'input_number', 'input_choice'].includes(sr.source_type)));
  const summaryCellKey = (rowId: string, pcode: string) => matrixSummaryColumnFlatKey(matrixField.code, rowId, pcode);

  const allSelected = !isTextMatrix && (customMode
    ? (allCodes().length > 0 && allCodes().every(c => selected.has(c)))
    : (allColTokens.length > 0 && allColTokens.every(t => selected.has(t))));

  // sourcesOrder 提供时，根据 code 查找其变量索引（v1, v2, ...）
  const varLabelOf = (code: string): string | null => {
    if (!sourcesOrder) return null;
    const idx = sourcesOrder.indexOf(code);
    return idx >= 0 ? `v${idx + 1}` : null;
  };

  return (
    <div>
      {isTextMatrix && <Alert type="info" showIcon message="文本型矩阵不可用于数值公式" />}
      {!isTextMatrix && <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>{customMode
        ? '自定义表达式按位置 v1/v2… 对应，列头/行头/单元格都选具体格子。'
        : `点击列头＝整列「全部试样」（录入时增删试样自动跟随，不是逐行勾选）；点单元格＝只选某个具体试样。${nonSampleRows.length ? '灰色「非试样」行（其他行/汇总行）整列不会自动勾，需要时自己点选。' : ''}`}</div>}
      <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ ...TH, cursor: isTextMatrix ? 'default' : 'pointer', background: allSelected ? '#bae0ff' : '#fafafa' }}
              onClick={() => !isTextMatrix && onToggleCells(customMode ? allCodes() : allColTokens)}>{cfg.axis_header || '试样'}</th>
            {params.map(p => {
              const cells = isTextMatrix ? [] : colCodes(p.code);
              const litColAll = !isTextMatrix && cells.length > 0 && cells.every(c => selected.has(c));
              const headerOn = colSelected(p.code) || litColAll;
              return (
                <th key={p.code} style={{ ...TH, cursor: isTextMatrix ? 'default' : 'pointer', background: headerOn ? '#bae0ff' : '#fafafa' }}
                  onClick={() => !isTextMatrix && onToggleCells(customMode ? cells : [colToken(p.code)])}>
                  {p.label}{p.unit ? ` (${p.unit})` : ''}
                  {colSelected(p.code) && <span style={{ fontSize: 9, color: '#1677ff', marginLeft: 4, fontWeight: 'bold' }}>·整列</span>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: n }, (_, i) => {
            const rc = rowCodes(i);
            const rowAll = rc.length > 0 && rc.every(c => selected.has(c));
            return (
              <tr key={i}>
                <td style={{ ...TH, cursor: isTextMatrix ? 'default' : 'pointer', background: rowAll ? '#bae0ff' : '#fafafa', textAlign: 'center' }}
                  onClick={() => !isTextMatrix && onToggleCells(rc)}>
                  {cfg.default_sample_labels?.[i] ?? `${cfg.row_header_prefix || '试样'} ${i + 1}`}
                </td>
                {params.map(p => {
                  const c = cellCode(matrixField.code, i, p.code);
                  const litOn = !isTextMatrix && selected.has(c);
                  const colOn = !isTextMatrix && colSelected(p.code);
                  const vLabel = litOn ? varLabelOf(c) : null;
                  // 整列选中＝该列【试样格】浅蓝高亮（=已选）；个别试样单独点为实心 ✓。非试样行不在本网格、整列不会勾到。
                  return (
                    <td key={p.code} onClick={() => !isTextMatrix && onToggleCells([c])}
                      title={colOn && !litOn ? '本列已整列选中（只含真实试样，随试样数自动跟随）；如只想要某个试样，点这一格单独选' : undefined}
                      style={{ ...TD, cursor: isTextMatrix ? 'not-allowed' : 'pointer', background: isTextMatrix ? '#f5f5f5' : litOn ? '#1677ff' : colOn ? '#eaf3ff' : '#fff', color: isTextMatrix ? '#bbb' : litOn ? '#fff' : '#333', textAlign: 'center', minWidth: 52, userSelect: 'none', fontWeight: vLabel ? 'bold' : 'normal' }}>
                      {isTextMatrix ? '—' : litOn ? (vLabel || '✓') : ''}
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {/* 非试样行（其他行 / 每列统计）：逐格可手动点选；整列不会勾到它们 */}
          {!isTextMatrix && nonSampleRows.map(sr => {
            const cells = params.map(p => summaryCellKey(sr.id, p.code));
            const rowAll = cells.length > 0 && cells.every(c => selected.has(c));
            return (
              <tr key={sr.id}>
                <td style={{ ...TH, cursor: 'pointer', background: rowAll ? '#bae0ff' : '#f5f5f5', textAlign: 'center', color: '#888' }}
                  title="非试样行（其他行/汇总行）——整列不会自动勾它；点行头选整行、点格选单格"
                  onClick={() => onToggleCells(cells)}>
                  {sr.label || '汇总'}
                  <div style={{ fontSize: 9, color: '#bbb', fontWeight: 'normal' }}>非试样</div>
                </td>
                {params.map(p => {
                  const key = summaryCellKey(sr.id, p.code);
                  const on = selected.has(key);
                  const vLabel = on ? varLabelOf(key) : null;
                  return (
                    <td key={p.code} onClick={() => onToggleCells([key])}
                      style={{ ...TD, cursor: 'pointer', background: on ? '#1677ff' : '#fafafa', color: on ? '#fff' : '#333', textAlign: 'center', minWidth: 52, userSelect: 'none', fontWeight: vLabel ? 'bold' : 'normal' }}>
                      {on ? (vLabel || '✓') : ''}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── 共用子组件 ───────────────────────────────────────────────────────

function ScalarPicker({ fields, selected, onToggle }: { fields: { code: string; label: string }[]; selected: Set<string>; onToggle: (codes: string[]) => void }) {
  if (!fields.length) return <Alert type="info" showIcon message="本模板没有可用的普通数字字段" />;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {fields.map(f => {
        const on = selected.has(f.code);
        return (
          <Tag.CheckableTag key={f.code} checked={on} onChange={() => onToggle([f.code])}
            style={{ padding: '4px 10px', border: '1px solid #d9d9d9', fontSize: 12 }}>
            {f.label} <span style={{ color: on ? '#fff' : '#999', fontSize: 11 }}>({f.code})</span>
          </Tag.CheckableTag>
        );
      })}
    </div>
  );
}

function FormulaForm({ formulaType, setFormulaType, decimals, setDecimals, extraParams, setExtraParams, expression, setExpression, sources, template }: {
  formulaType: FormulaType; setFormulaType: (t: FormulaType) => void;
  decimals: number; setDecimals: (d: number) => void;
  extraParams: Record<string, any>; setExtraParams: (p: Record<string, any>) => void;
  expression: string; setExpression: (e: string) => void;
  sources: string[]; template: RecordTemplate;
}) {
  return (
    <Form layout="vertical" size="small">
      <Form.Item label="公式类型">
        <AntSelect value={formulaType} onChange={(v) => setFormulaType(v as FormulaType)} style={{ width: '100%' }}
          options={FORMULA_TYPES.filter(f => ALLOWED_FORMULA_TYPES.includes(f.type)).map(f => ({ value: f.type, label: `${f.label} — ${f.description}` }))} />
      </Form.Item>
      <Form.Item label="保留小数位">
        <InputNumber min={0} max={10} value={decimals} onChange={(v) => setDecimals(Number(v ?? 2))} />
      </Form.Item>
      {formulaType === 'unit_convert' && (
        <Form.Item label="单位换算">
          <Space>
            <span>×</span>
            <InputNumber value={extraParams.factor ?? 1} onChange={(v) => setExtraParams({ ...extraParams, factor: v })} />
            <span>+</span>
            <InputNumber value={extraParams.offset ?? 0} onChange={(v) => setExtraParams({ ...extraParams, offset: v })} />
          </Space>
        </Form.Item>
      )}
      {formulaType === 'custom' && (
        <Form.Item label="自定义表达式">
          <Input value={expression} onChange={(e) => setExpression(e.target.value)} placeholder="如：(v1 + v2 + v3) / 3" />
          <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>变量 v1/v2/v3... 按已选数据源顺序对应</div>
          {sources.length > 0 && (
            <div style={{ marginTop: 4 }}>
              {sources.map((s, i) => <Tag key={s} color="blue" style={{ marginBottom: 2 }}>v{i + 1} = {describeCode(s, template)}</Tag>)}
            </div>
          )}
        </Form.Item>
      )}
    </Form>
  );
}

function SelectedChips({ sources, template, onRemove, onClear }: { sources: string[]; template: RecordTemplate; onRemove: (c: string) => void; onClear: () => void }) {
  return (
    <div style={{ padding: 8, background: '#fafafa', border: '1px solid #e8e8e8', borderRadius: 4, marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <strong style={{ fontSize: 12 }}>已选 {sources.length} 项</strong>
        {sources.length > 0 && <Button size="small" type="link" danger onClick={onClear}>清空</Button>}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 72, overflowY: 'auto' }}>
        {sources.length === 0 && <span style={{ fontSize: 12, color: '#888' }}>尚未选择数据源</span>}
        {sources.map(c => (
          <Tag key={c} closable closeIcon={<CloseOutlined />} onClose={(e) => { e.preventDefault(); onRemove(c); }}>
            {describeCode(c, template)}
          </Tag>
        ))}
      </div>
    </div>
  );
}

function PreviewBox({ preview }: { preview: string }) {
  return (
    <div style={{ padding: 8, background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 4, marginBottom: 10 }}>
      <strong>实时预览：</strong> <Tag color="blue">{preview}</Tag>
      <span style={{ fontSize: 11, color: '#888', marginLeft: 6 }}>(mock: 各项依次 10, 20, 30...)</span>
    </div>
  );
}

const TH: React.CSSProperties = { border: '1px solid #ddd', padding: '6px 10px', background: '#fafafa', fontWeight: 'normal' };
const TD: React.CSSProperties = { border: '1px solid #ddd', padding: '6px 8px' };
