/**
 * MatrixEditor — 统一画布化矩阵编辑器
 * 工具栏（基本设置）+ MatrixCanvas（交互式表格）+ 公式面板
 */
import { useState, useEffect } from 'react';
import { Space, Switch, Select as AntSelect, InputNumber, Divider, Form, Input, Collapse, Button, Modal, message, Tooltip } from 'antd';
import { CopyOutlined, SnippetsOutlined } from '@ant-design/icons';
import type { DataMatrixConfig, FieldDefinition, MatrixSummaryRowDef, RecordTemplate, ExcelImportMapping } from '../../../../../shared/types';
import type { Formula } from '../../../../../shared/formula-engine';
import { matrixDataKey, uniqueCode } from '../../../../../shared/matrix-flatten';
import MatrixCanvas, { type FormulaTarget } from './MatrixCanvas';
import { CellFormulaPanel, PerCellFormulaPanel, PerColumnPanel, SummaryFormulaPanel } from './FormulaPanels';

interface Props {
  field: FieldDefinition;
  template: RecordTemplate;
  config: DataMatrixConfig;
  onChange: (c: DataMatrixConfig) => void;
}

export default function MatrixEditor({ field, template, config, onChange }: Props) {
  const [formulaTarget, setFormulaTarget] = useState<FormulaTarget | null>(null);

  const params = config.parameters || [];
  const summaries = config.summary_rows || [];

  // 切换为文本类型时：关闭已打开的公式面板（仅对 cell/cell_col 类型的目标）
  useEffect(() => {
    if (config.cell_type === 'text' && formulaTarget && (formulaTarget.kind === 'cell' || formulaTarget.kind === 'cell_col')) {
      setFormulaTarget(null);
    }
  }, [config.cell_type, formulaTarget]);

  const handleFormulaTargetChange = (t: FormulaTarget | null) => {
    if (t && formulaTarget && JSON.stringify(t) === JSON.stringify(formulaTarget)) {
      setFormulaTarget(null);
    } else {
      setFormulaTarget(t);
    }
  };

  const closePanel = () => setFormulaTarget(null);

  // ── 复制 / 粘贴表头配置（表头一样时免重建；跨字段/跨模板，存 localStorage）──
  const CLIP_KEY = 'demo_matrixHeaderClipboard';
  const [hasClip, setHasClip] = useState<boolean>(() => !!localStorage.getItem(CLIP_KEY));

  const copyHeader = () => {
    // 复制整张表的结构（列/汇总行/汇总列/单元格类型/对齐/小数位/角头/分组等）；不含录入值（值在 record_data）
    try {
      localStorage.setItem(CLIP_KEY, JSON.stringify(config));
      setHasClip(true);
      message.success('已复制本表格表头配置，可在另一个数据表格里「粘贴表头」');
    } catch { message.error('复制失败'); }
  };

  const pasteHeader = () => {
    const raw = localStorage.getItem(CLIP_KEY);
    if (!raw) { message.warning('剪贴板为空，请先在某个表格点「复制表头」'); return; }
    let src: DataMatrixConfig;
    try { src = JSON.parse(raw); } catch { message.error('剪贴板内容无效'); return; }
    Modal.confirm({
      title: '粘贴表头配置',
      content: '将用复制的表头结构（列 / 汇总行 / 汇总列 / 类型 / 对齐 / 小数位等）覆盖当前表格的结构，已录入的数据不受影响。继续？',
      okText: '覆盖粘贴',
      cancelText: '取消',
      onOk: () => {
        const stamp = Date.now();
        // 重生成参数列 id（纯 React key，无外部引用）；保留 code（保住公式/默认值/报告映射），保留汇总行列 id
        const parameters = (src.parameters || []).map((p, i) => ({ ...p, id: `p_${stamp}_${i}` }));
        onChange({ ...src, parameters });
        message.success('已粘贴表头配置');
      },
    });
  };

  return (
    <div>
      {/* 「类型配置」内容（扁平，无子 tab）：数据语义 + 表格版式 + 录入权限 + 表头复用/Excel。
          字段级「版式」(整表文字/备注/对齐)＝FieldPropsPanel 顶层「版式」Tab，与项目报告表格一致。 */}
      {/* 数据语义：用途 / 行列数 / 单元格类型 / 小数位 */}
      <Form layout="inline" size="small" style={{ rowGap: 8 }}>
        <Form.Item label="表格用途" tooltip="试样数据＝每行/列是一个试样、有「试样为行/列」轴、报告里可按实际录入试样数自动展开；统计数据＝行是固定统计项（平均值/最大值/限值…），无试样轴、不按试样展开、表头为普通命名行，报告里逐格绑定">
          <AntSelect style={{ width: 110 }} value={config.kind || 'sample'}
            onChange={(v) => onChange({ ...config, kind: v as 'sample' | 'stats', ...(v === 'stats' ? { sample_axis: undefined } : {}) })}
            options={[{ value: 'sample', label: '试样数据' }, { value: 'stats', label: '统计数据' }]} />
        </Form.Item>
        <Form.Item label="行数">
          <InputNumber min={1} max={99} style={{ width: 70 }} value={config.default_sample_count}
            onChange={(v) => {
              const newCount = v ?? 1;
              const cur = config.default_sample_count || 1;
              // 行名兜底与渲染端一致（`${prefix} ${i+1}`），避免画布/录入/PDF 三端显示不一
              const prefix = config.row_header_prefix || '试样';
              const labels = [...(config.default_sample_labels || Array.from({ length: cur }, (_, i) => `${prefix} ${i + 1}`))];
              if (newCount > labels.length) {
                for (let i = labels.length; i < newCount; i++) labels.push(`${prefix} ${i + 1}`);
              } else if (newCount < labels.length) {
                labels.length = newCount;
              }
              onChange({ ...config, default_sample_count: newCount, default_sample_labels: labels });
            }} />
        </Form.Item>
        <Form.Item label="列数">
          <InputNumber min={0} max={50} style={{ width: 70 }} value={(config.parameters || []).length}
            onChange={(v) => {
              const newCount = v ?? 0;
              const params = [...(config.parameters || [])];
              if (newCount > params.length) {
                const used = new Set(params.map(p => p.code));
                for (let i = params.length; i < newCount; i++) {
                  const code = uniqueCode(`col_${i + 1}`, used);
                  used.add(code);
                  params.push({ id: `p${Date.now()}_${i}`, code, label: `参数${i + 1}` });
                }
              } else if (newCount < params.length) {
                params.length = newCount;
              }
              onChange({ ...config, parameters: params });
            }} />
        </Form.Item>
        <Form.Item label="单元格类型">
          <AntSelect style={{ width: 80 }} value={config.cell_type}
            onChange={(v) => {
              if (v === 'text') {
                // 切换到文本时，清除所有数值公式相关的配置
                const cleanedParams = (config.parameters || []).map(p => ({ ...p, cell_formula: undefined, cell_formula_decimals: undefined }));
                onChange({ ...config, cell_type: 'text', parameters: cleanedParams, cell_formulas: undefined });
              } else {
                onChange({ ...config, cell_type: v as 'number' | 'text' });
              }
            }}
            options={[{ value: 'number', label: '数字' }, { value: 'text', label: '文本' }]} />
        </Form.Item>
        {config.cell_type !== 'text' && (
          <Form.Item label="小数位" tooltip="整表统一：手填数字在 PDF/报告显示时四舍五入并补零到此位数（公式列用各自公式的小数位；留空 = 按录入原样显示）">
            <InputNumber min={0} max={6} style={{ width: 64 }} placeholder="原样"
              value={config.decimals}
              onChange={(v) => onChange({ ...config, decimals: v ?? undefined })} />
          </Form.Item>
        )}
      </Form>

      {/* 表格版式（对齐/留白/空值/跨页）——与项目报告结果表「表格版式」同口径，留在类型配置里随表格一起改 */}
      <Divider plain style={{ margin: '10px 0 6px' }}><span style={{ fontSize: 11, color: '#888' }}>表格版式</span></Divider>
      <Form layout="inline" size="small" style={{ rowGap: 8 }}>
        <Form.Item label="单元格对齐">
          <AntSelect style={{ width: 90 }} value={config.cell_align || 'center'}
            onChange={(v) => onChange({ ...config, cell_align: v as 'left' | 'center' | 'right' })}
            options={[{ value: 'left', label: '左对齐' }, { value: 'center', label: '居中' }, { value: 'right', label: '右对齐' }]} />
        </Form.Item>
        <Form.Item label="行内留白" tooltip="表格里行与行的疏密 = 单元格上下内边距(pt)。调大=行更松、调小=行更紧。注意：分区样式里的「行距」是段内多行文字的行间距，不影响表格行距；要调表格行距请用这里。缺省=默认 5pt">
          <InputNumber min={0} max={40} style={{ width: 100 }} placeholder="默认" addonAfter="pt"
            value={config.cell_inset_y ? parseFloat(config.cell_inset_y) : undefined}
            onChange={(v) => onChange({ ...config, cell_inset_y: v != null ? `${v}pt` : undefined })} />
        </Form.Item>
        <Form.Item label="空值符" tooltip="空单元格在 PDF 里显示的占位符，缺省「—」。改这里只影响留空的格子。">
          <Input size="small" style={{ width: 70 }} placeholder="—" value={config.empty_cell_display ?? ''}
            onChange={(e) => onChange({ ...config, empty_cell_display: e.target.value || undefined })} />
        </Form.Item>
      </Form>
      <Space direction="vertical" size={2} style={{ fontSize: 12, marginTop: 6 }}>
        <Space size={6}>
          <Switch size="small" checked={config.keep_together !== false} onChange={(v) => onChange({ ...config, keep_together: v })} />
          <span>PDF 尽量同页（表格整体不跨页）</span>
          <span style={{ color: '#999' }}>（放不下整体移到下一页；超过一整页的超长表仍自动跨页）</span>
        </Space>
        <Space size={6}>
          <Tooltip title="仅当表格确实跨页时生效——开启「尽量同页」时表格通常整体一页、不跨页">
            <span>
              <Switch size="small" disabled={config.keep_together !== false}
                checked={config.repeat_header_on_break !== false}
                onChange={(v) => onChange({ ...config, repeat_header_on_break: v })} />
              <span style={{ marginLeft: 8 }}>跨页时续页重复表头</span>
            </span>
          </Tooltip>
        </Space>
      </Space>

      {/* 录入权限 */}
      <Divider plain style={{ margin: '10px 0 6px' }}><span style={{ fontSize: 11, color: '#888' }}>录入权限</span></Divider>
      <Space direction="vertical" size={2} style={{ fontSize: 12 }}>
        <Space size={6}><Switch size="small" checked={config.allow_add_remove_samples !== false} onChange={(v) => onChange({ ...config, allow_add_remove_samples: v })} /> 录入时允许增删行<span style={{ color: '#999' }}>（默认开放，关掉=固定行数）</span></Space>
        <Space size={6}><Switch size="small" checked={config.allow_add_remove_parameters} onChange={(v) => onChange({ ...config, allow_add_remove_parameters: v })} /> 录入时允许增删列</Space>
        <Space size={6}><Switch size="small" checked={!!config.allow_edit_parameter_labels_at_entry} onChange={(v) => onChange({ ...config, allow_edit_parameter_labels_at_entry: v })} /> 录入时允许改列名</Space>
        <Space size={6}><Switch size="small" checked={!!config.allow_edit_sample_labels_at_entry} onChange={(v) => onChange({ ...config, allow_edit_sample_labels_at_entry: v })} /> 录入时允许改行名</Space>
      </Space>

      {/* 表头复用 + Excel 导入 */}
      <Divider plain style={{ margin: '10px 0 6px' }}><span style={{ fontSize: 11, color: '#888' }}>表头复用 / Excel 导入</span></Divider>
      <Space style={{ marginBottom: 8 }} size={8} wrap>
        <Button size="small" icon={<CopyOutlined />} onClick={copyHeader}>复制表头</Button>
        <Button size="small" icon={<SnippetsOutlined />} disabled={!hasClip} onClick={pasteHeader}>粘贴表头</Button>
        <span style={{ fontSize: 11, color: '#999' }}>表头一样时：一张表「复制表头」→ 另一张表「粘贴表头」</span>
      </Space>
      <Collapse size="small" items={[{
        key: 'excel',
        label: <span style={{ fontSize: 12 }}>Excel 导入配置{config.excel_import?.enabled ? ' ✓' : ''}</span>,
        children: (
          <ExcelImportConfig value={config.excel_import} params={params} onChange={(v) => onChange({ ...config, excel_import: v })} />
        ),
      }]} />

      {/* 画布 */}
      <MatrixCanvas
        config={config}
        onChange={onChange}
        formulaTarget={formulaTarget}
        onSelectFormulaTarget={handleFormulaTargetChange}
      />

      {/* 公式编辑面板 */}
      {formulaTarget && (
        <>
          <Divider plain style={{ margin: '12px 0' }}>
            {panelTitle(formulaTarget, params, summaries, config)}
          </Divider>

          {formulaTarget.kind === 'cell_col' && (
            <CellFormulaPanel
              param={params[formulaTarget.paramIdx]}
              params={params}
              onSave={(expr, dec) => {
                const np = [...params];
                np[formulaTarget.paramIdx] = { ...np[formulaTarget.paramIdx], cell_formula: expr, cell_formula_decimals: dec };
                onChange({ ...config, parameters: np });
                closePanel();
              }}
              onCancel={closePanel}
            />
          )}

          {formulaTarget.kind === 'cell' && (
            <PerCellFormulaPanel
              sampleIdx={formulaTarget.sampleIdx}
              paramIdx={formulaTarget.paramIdx}
              params={params}
              field={field}
              template={template}
              config={config}
              onSave={(formula) => {
                const key = matrixDataKey(`s${formulaTarget.sampleIdx}`, params[formulaTarget.paramIdx].code);
                const cf = { ...(config.cell_formulas || {}), [key]: formula };
                onChange({ ...config, cell_formulas: cf });
                closePanel();
              }}
              onClear={() => {
                const key = matrixDataKey(`s${formulaTarget.sampleIdx}`, params[formulaTarget.paramIdx].code);
                const cf = { ...(config.cell_formulas || {}) };
                delete cf[key];
                onChange({ ...config, cell_formulas: Object.keys(cf).length ? cf : undefined });
                closePanel();
              }}
              onCancel={closePanel}
            />
          )}

          {formulaTarget.kind === 'other_cell' && (() => {
            const sr = summaries[formulaTarget.rowIdx];
            const p = params[formulaTarget.paramIdx];
            if (!sr || !p) return null;
            // 复用试样格公式面板（PerCellFormulaPanel），写到该「其他行」此列的 cell_formulas（Formula，与试样格同款）
            const writeFx = (formula: Formula | null) => {
              const rows = [...summaries];
              const cf = { ...(sr.cell_formulas || {}) };
              if (formula) cf[p.code] = formula; else delete cf[p.code];
              rows[formulaTarget.rowIdx] = { ...sr, cell_formulas: Object.keys(cf).length ? cf : undefined };
              onChange({ ...config, summary_rows: rows });
              closePanel();
            };
            return (
              <PerCellFormulaPanel
                sampleIdx={formulaTarget.rowIdx}
                paramIdx={formulaTarget.paramIdx}
                params={params}
                field={field}
                template={template}
                config={config}
                existing={sr.cell_formulas?.[p.code]}
                selfCode={null}
                title={`其他行公式 — 「${sr.label}」× ${p.label}`}
                onSave={(formula) => writeFx(formula)}
                onClear={() => writeFx(null)}
                onCancel={closePanel}
              />
            );
          })()}

          {formulaTarget.kind === 'per_column' && (
            <PerColumnPanel
              row={summaries[formulaTarget.rowIdx]}
              onSave={(patch) => {
                const rows = [...summaries];
                rows[formulaTarget.rowIdx] = { ...rows[formulaTarget.rowIdx], ...patch };
                onChange({ ...config, summary_rows: rows });
                closePanel();
              }}
              onCancel={closePanel}
            />
          )}

          {formulaTarget.kind === 'summary_formula' && (
            <SummaryFormulaPanel
              row={summaries[formulaTarget.rowIdx]}
              field={field}
              template={template}
              config={config}
              onSave={(patch) => {
                const rows = [...summaries];
                rows[formulaTarget.rowIdx] = { ...rows[formulaTarget.rowIdx], ...patch };
                onChange({ ...config, summary_rows: rows });
                closePanel();
              }}
              onCancel={closePanel}
            />
          )}

          {formulaTarget.kind === 'other_col_cell' && (() => {
            const sc = (config.summary_cols || []).find(c => c.id === formulaTarget.colId);
            if (!sc) return null;
            const sid = `s${formulaTarget.sampleIdx}`;
            // 统计列某格公式＝与试样格完全同款（PerCellFormulaPanel），写到该列的 cell_formulas[sampleId]
            const writeFx = (formula: Formula | null) => {
              const cf = { ...(sc.cell_formulas || {}) };
              if (formula) cf[sid] = formula; else delete cf[sid];
              onChange({
                ...config,
                summary_cols: (config.summary_cols || []).map(c =>
                  c.id === sc.id ? { ...c, cell_formulas: Object.keys(cf).length ? cf : undefined } : c),
              });
              closePanel();
            };
            return (
              <PerCellFormulaPanel
                sampleIdx={formulaTarget.sampleIdx}
                paramIdx={0}
                params={params}
                field={field}
                template={template}
                config={config}
                existing={sc.cell_formulas?.[sid]}
                selfCode={null}
                title={`统计列单元格公式 — 「${sc.label}」× ${config.default_sample_labels?.[formulaTarget.sampleIdx] ?? `${config.row_header_prefix || '试样'} ${formulaTarget.sampleIdx + 1}`}`}
                onSave={(formula) => writeFx(formula)}
                onClear={() => writeFx(null)}
                onCancel={closePanel}
              />
            );
          })()}

          {formulaTarget.kind === 'sumcol_span_formula' && (() => {
            const sc = (config.summary_cols || []).find(c => c.id === formulaTarget.colId);
            if (!sc) return null;
            // 汇总列(跨行单值)公式＝与汇总行跨列公式同款（SummaryFormulaPanel）；置 source_type=formula
            return (
              <SummaryFormulaPanel
                row={{ id: sc.id, label: sc.label, source_type: 'formula', formula: sc.formula } as any}
                field={field}
                template={template}
                config={config}
                onSave={(patch) => {
                  onChange({
                    ...config,
                    summary_cols: (config.summary_cols || []).map(c =>
                      c.id === sc.id ? { ...c, source_type: 'formula', formula: (patch as any).formula ?? c.formula } : c),
                  });
                  closePanel();
                }}
                onCancel={closePanel}
              />
            );
          })()}
        </>
      )}
    </div>
  );
}

function panelTitle(t: FormulaTarget, params: any[], summaries: MatrixSummaryRowDef[], config: DataMatrixConfig): string {
  const prefix = config.row_header_prefix || '试样';
  if (t.kind === 'cell_col') return `按行公式 — 列「${params[t.paramIdx]?.label}」`;
  if (t.kind === 'cell') {
    const rowName = config.default_sample_labels?.[t.sampleIdx] ?? `${prefix} ${t.sampleIdx + 1}`;
    return `单元格公式 — ${rowName} × ${params[t.paramIdx]?.label}`;
  }
  if (t.kind === 'other_cell') return `其他行单元格公式 — 「${summaries[t.rowIdx]?.label}」× ${params[t.paramIdx]?.label}`;
  if (t.kind === 'other_col_cell') {
    const sn = config.default_sample_labels?.[t.sampleIdx] ?? `${config.row_header_prefix || '试样'} ${t.sampleIdx + 1}`;
    return `统计列单元格公式 — 「${(config.summary_cols || []).find(c => c.id === t.colId)?.label || ''}」× ${sn}`;
  }
  if (t.kind === 'sumcol_span_formula') return `汇总列公式（整列一个值）— 「${(config.summary_cols || []).find(c => c.id === t.colId)?.label || ''}」`;
  if (t.kind === 'per_column') return `每列统计 — 「${summaries[t.rowIdx]?.label}」`;
  return `跨列汇总 — 「${summaries[t.rowIdx]?.label}」`;
}

// ─── Excel 导入配置子组件 ─────────────────────────────────────────────
const colLetter = (i: number) => String.fromCharCode(65 + i); // 0→A

function ExcelImportConfig({
  value,
  params,
  onChange,
}: {
  value?: ExcelImportMapping;
  params: { code: string; label: string; cell_formula?: string }[];
  onChange: (v: ExcelImportMapping) => void;
}) {
  const v = value || { enabled: false, sheet_name: '' };
  const startRow1 = (v.data_start_row ?? 2) + 1;      // 存储 0-based，界面按"第 N 行"显示
  const startCol = v.data_start_col ?? 0;             // 0=A 列

  /**
   * 数据块模式示意：只导入从 (起始行, 起始列) 开始的矩形数据块。
   * 行名/列头不读 Excel（由模板配置）——起始行上方、起始列左侧整体跳过。
   */
  const colCount = Math.max(startCol + params.length, startCol + 2, 4);
  const cellInfo = (rowIdx1: number, colIdx: number): { text: string; bg: string; color?: string } => {
    if (rowIdx1 < startRow1 || colIdx < startCol) {
      const isOrigin = rowIdx1 === 1 && colIdx === 0;
      return { text: isOrigin ? '表头区(跳过)' : '', bg: '#f0f0f0', color: '#999' };
    }
    const pi = colIdx - startCol;
    if (pi < params.length) {
      // 公式列不导入（录入页只读、由公式计算），示意图里明确标出
      if (params[pi].cell_formula?.trim()) return { text: `ƒ ${params[pi].label}(跳过)`, bg: '#fff7e6', color: '#d46b08' };
      return { text: params[pi].label, bg: '#f6ffed', color: '#389e0d' };
    }
    return { text: '(多余列)', bg: '#fffbe6', color: '#b08400' };
  };

  return (
    <Form layout="vertical" size="small">
      <Form.Item style={{ marginBottom: 8 }}>
        <Switch checked={v.enabled} onChange={(checked) => onChange({ ...v, enabled: checked })}
          checkedChildren="允许导入" unCheckedChildren="关闭" />
        <span style={{ fontSize: 11, color: '#888', marginLeft: 8 }}>
          只导入数据块——行名/列头由模板配置，Excel 里的表头区整体跳过
        </span>
      </Form.Item>
      {v.enabled && (
        <>
          <Space size={12} wrap style={{ marginBottom: 8 }}>
            <Form.Item label="Excel Sheet 名称" style={{ marginBottom: 0 }}>
              <Input style={{ width: 160 }} value={v.sheet_name} onChange={(e) => onChange({ ...v, sheet_name: e.target.value })}
                placeholder="如：测试结果" />
            </Form.Item>
            <Form.Item label="数据从第几行开始" style={{ marginBottom: 0 }}
              tooltip="表头占几行就从下一行开始。如表头 2 行 → 数据从第 3 行开始">
              <InputNumber min={1} max={21} value={startRow1}
                onChange={(n) => onChange({ ...v, data_start_row: (n ?? 1) - 1 })}
                addonBefore="第" addonAfter="行" style={{ width: 130 }} />
            </Form.Item>
            <Form.Item label="数据从哪一列开始" style={{ marginBottom: 0 }}
              tooltip="行名（试样名）列在数据左侧时，从它右边那列开始。如 A 列是行名 → 数据从 B 列开始">
              <AntSelect style={{ width: 100 }} value={startCol}
                onChange={(n) => onChange({ ...v, data_start_col: n })}
                options={Array.from({ length: 12 }, (_, i) => ({ value: i, label: `${colLetter(i)} 列` }))} />
            </Form.Item>
          </Space>

          {/* 示意图：你的 Excel 应长这样 */}
          <Form.Item label="导入示意（你的 Excel 应长这样）" style={{ marginBottom: 0 }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr>
                  <th style={{ ...EX_TH, width: 28 }} />
                  {Array.from({ length: colCount }, (_, c) => (
                    <th key={c} style={{ ...EX_TH, minWidth: 64 }}>{colLetter(c)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: Math.min(startRow1 - 1 + 3, 8) }, (_, r) => {
                  const row1 = r + 1;
                  return (
                    <tr key={r}>
                      <td style={{ ...EX_TH, textAlign: 'center' }}>{row1}</td>
                      {Array.from({ length: colCount }, (_, c) => {
                        const info = cellInfo(row1, c);
                        return (
                          <td key={c} style={{ ...EX_TD, background: info.bg, color: info.color || '#555' }}>
                            {info.text}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
              灰 = 表头区（行名/列头由模板配置，导入时跳过）· 绿 = 数据块（按模板列顺序整块导入）·
              橙 ƒ = 公式列（不导入，由公式按其他列自动计算）。
              导入后行/列多了可自行删，少了模板允许时会自动补（行名/列头需自行确认）
            </div>
          </Form.Item>
        </>
      )}
    </Form>
  );
}

const EX_TH: React.CSSProperties = { border: '1px solid #d9dee8', background: '#f2f5fb', padding: '2px 6px', color: '#666', fontWeight: 500 };
const EX_TD: React.CSSProperties = { border: '1px solid #e4e8f0', padding: '2px 6px', textAlign: 'center' };
