/**
 * report-blocks.ts — ReportBlock[] → Typst 源码 转换器
 *
 * 用于把结构化报告模板渲染成可编译的 Typst。
 *
 * 当前实现：cover 类型 block（rich_text/cover_meta/conclusion_table/sample_image_table/equipment_table）
 *           + project 类型（result_table/kv_list）。无数据时按占位渲染。
 *
 * 与原始记录的 typst-generator 共享 record-theme 包，最终 PDF 风格统一。
 */
import type {
  ReportBlock, CellBinding, EquipmentRecord, RecordTemplate,
} from './types';

// ─── 上下文 ────────────────────────────────────────────────────────────
/** 渲染时可注入的运行时数据（生成报告阶段用；预览阶段大部分为空，仅显示占位） */
export interface ReportRenderContext {
  /** 委托单上下文 */
  order?: {
    order_no?: string;
    customer_name?: string;
    sample_name?: string;
    received_at?: string;
  };
  /** 用于结论汇总表：每个项目一行 */
  project_summary?: Array<{
    name: string;
    standard?: string;
    conclusion?: string;
  }>;
  /** 设备汇总表的解析结果（按 cell_path 查 equipment_library 后的最终行） */
  equipment_rows?: Array<{
    name: string;
    model?: string;
    asset_code: string;
    calibration: string;  // 已格式化好的 "YYYY-MM-DD ~ YYYY-MM-DD"
  }>;
  /** 当前项目的关联原始记录模板（用于 record_cell / record_summary 解析展示标签） */
  linked_record_template?: RecordTemplate | null;
  /** 当前项目的实际录入数据（已经 flatten 过的 key-value：包含 matrix flat keys 和汇总键） */
  record_flat_data?: Record<string, any>;
  /** 用于 sample_image_table：image_field_code → 数据 url 或占位说明 */
  image_values?: Record<string, string | null>;
}

// ─── 工具 ──────────────────────────────────────────────────────────────
function esc(s: string): string {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

function bracketEsc(s: string): string {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

/** 解析一个 CellBinding，返回字符串结果（不进行公式计算 — 公式计算由调用方提前完成） */
export function resolveBinding(b: CellBinding | undefined, ctx: ReportRenderContext): string {
  if (!b) return '—';
  switch (b.source) {
    case 'literal':
      return b.text ?? '';
    case 'order': {
      // v2 兼容：order 键集已在 v3 扩展（OrderMetaKey），v2 仅认历史 4 键，其余取不到落占位
      const v = (ctx.order as Record<string, any> | undefined)?.[b.key];
      return v ?? `[${b.key}]`;
    }
    case 'system':
      if (b.key === 'today') return new Date().toISOString().slice(0, 10);
      if (b.key === 'now') return new Date().toLocaleString();
      return '';
    case 'record_field': {
      const v = ctx.record_flat_data?.[b.field_code];
      return v === null || v === undefined || v === '' ? '—' : String(v);
    }
    case 'record_cell': {
      const key = `${b.matrix_code}__s${b.sample_idx}__${b.param_code}`;
      const v = ctx.record_flat_data?.[key];
      return v === null || v === undefined || v === '' ? '—' : String(v);
    }
    case 'record_summary': {
      const key = b.param_code
        ? `${b.matrix_code}__summary__${b.row_id}__${b.param_code}`
        : `${b.matrix_code}__summary__${b.row_id}`;
      const v = ctx.record_flat_data?.[key];
      return v === null || v === undefined || v === '' ? '—' : String(v);
    }
    case 'record_formula':
      // 公式由上游提前 execute 后写入 ctx.record_flat_data；这里若没数据就空白
      return '—';
  }
  return '';
}

// ─── 单个 block 渲染 ───────────────────────────────────────────────────

function renderRichText(b: Extract<ReportBlock, { kind: 'rich_text' }>): string {
  // 简单处理：去 HTML 标签，保留换行
  const text = (b.html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
  if (!text.trim()) return '';
  // Typst 里多段用 raw block
  return text.split('\n').map(line => bracketEsc(line)).join('\\\n');
}

function renderCoverMeta(b: Extract<ReportBlock, { kind: 'cover_meta' }>, ctx: ReportRenderContext): string {
  if (!b.fields?.length) return '';
  const lines: string[] = [];
  lines.push('#table(columns: (auto, 1fr), stroke: 0.5pt, inset: 6pt,');
  for (const f of b.fields) {
    const val = resolveBinding(f.binding, ctx);
    lines.push(`  [*${bracketEsc(f.label)}*], [${bracketEsc(val)}],`);
  }
  lines.push(')');
  return lines.join('\n');
}

function renderConclusionTable(b: Extract<ReportBlock, { kind: 'conclusion_table' }>, ctx: ReportRenderContext): string {
  const cols = b.columns && b.columns.length ? b.columns : ['项目', '标准', '结论'];
  const rows = ctx.project_summary || [];
  const lines: string[] = [];
  lines.push(`#table(columns: ${cols.length}, stroke: 0.5pt, inset: 6pt,`);
  lines.push('  ' + cols.map(c => `[*${bracketEsc(c)}*]`).join(', ') + ',');
  if (rows.length === 0) {
    lines.push(`  table.cell(colspan: ${cols.length})[（无项目数据 — 生成报告时自动填充）],`);
  } else {
    for (const r of rows) {
      const row = cols.map(c => {
        if (c.includes('项目') || c.toLowerCase().includes('item')) return bracketEsc(r.name);
        if (c.includes('标准') || c.toLowerCase().includes('standard')) return bracketEsc(r.standard ?? '—');
        if (c.includes('结论') || c.toLowerCase().includes('result')) return bracketEsc(r.conclusion ?? '—');
        return '—';
      }).map(x => `[${x}]`).join(', ');
      lines.push('  ' + row + ',');
    }
  }
  lines.push(')');
  return lines.join('\n');
}

function renderSampleImageTable(b: Extract<ReportBlock, { kind: 'sample_image_table' }>, _ctx: ReportRenderContext): string {
  const cols = Math.max(1, Math.min(b.columns || 2, 4));
  const rows = Math.max(1, Math.min(b.rows || 1, 6));
  const lines: string[] = [];
  lines.push(`#table(columns: ${cols}, stroke: 0.5pt, inset: 12pt,`);
  for (let i = 0; i < rows * cols; i++) {
    lines.push('  [#align(center + horizon)[[图片占位]]],');
  }
  lines.push(')');
  return lines.join('\n');
}

function renderEquipmentTable(_b: Extract<ReportBlock, { kind: 'equipment_table' }>, ctx: ReportRenderContext): string {
  const lines: string[] = [];
  lines.push('#table(columns: 4, stroke: 0.5pt, inset: 6pt,');
  lines.push('  [*设备名称*], [*设备型号*], [*设备编号*], [*校准有效期*],');
  const rows = ctx.equipment_rows || [];
  if (rows.length === 0) {
    lines.push('  table.cell(colspan: 4)[（无设备数据 — 生成报告时自动汇集）],');
  } else {
    for (const r of rows) {
      lines.push(`  [${bracketEsc(r.name)}], [${bracketEsc(r.model ?? '')}], [${bracketEsc(r.asset_code)}], [${bracketEsc(r.calibration)}],`);
    }
  }
  lines.push(')');
  return lines.join('\n');
}

function renderResultTable(b: Extract<ReportBlock, { kind: 'result_table' }>, ctx: ReportRenderContext): string {
  const cols = b.columns || [];
  const rows = b.rows || [];
  if (cols.length === 0 || rows.length === 0) return '#text(fill: gray)[(结果表未配置)]';
  const lines: string[] = [];
  lines.push(`#table(columns: ${cols.length}, stroke: 0.5pt, inset: 6pt,`);
  lines.push('  ' + cols.map(c => `[*${bracketEsc(c.label)}*]`).join(', ') + ',');
  for (const r of rows) {
    const cells: string[] = [];
    for (const c of cols) {
      const cell = b.cells.find(x => x.rowId === r.id && x.colId === c.id);
      const v = cell ? resolveBinding(cell.binding, ctx) : (c.id === 'label' && r.label ? r.label : '—');
      cells.push(`[${bracketEsc(v)}]`);
    }
    lines.push('  ' + cells.join(', ') + ',');
  }
  lines.push(')');
  return lines.join('\n');
}

function renderKvList(b: Extract<ReportBlock, { kind: 'kv_list' }>, ctx: ReportRenderContext): string {
  if (!b.items?.length) return '';
  const lines: string[] = [];
  lines.push('#table(columns: (auto, 1fr), stroke: 0.5pt, inset: 6pt,');
  for (const it of b.items) {
    const v = resolveBinding(it.binding, ctx);
    lines.push(`  [*${bracketEsc(it.label)}*], [${bracketEsc(v)}],`);
  }
  lines.push(')');
  return lines.join('\n');
}

export function renderBlock(b: ReportBlock, ctx: ReportRenderContext): string {
  switch (b.kind) {
    case 'rich_text': return renderRichText(b);
    case 'cover_meta': return renderCoverMeta(b, ctx);
    case 'conclusion_table': return renderConclusionTable(b, ctx);
    case 'sample_image_table': return renderSampleImageTable(b, ctx);
    case 'equipment_table': return renderEquipmentTable(b, ctx);
    case 'result_table': return renderResultTable(b, ctx);
    case 'kv_list': return renderKvList(b, ctx);
    default: return '';
  }
}

// ─── 整份报告渲染 ──────────────────────────────────────────────────────

export interface RenderReportOptions {
  title?: string;
  coverBlocks?: ReportBlock[];
  /** 项目区块：每个元素是一个项目的 blocks + 该项目的 context */
  projects?: Array<{
    name: string;
    blocks: ReportBlock[];
    record_flat_data?: Record<string, any>;
    linked_record_template?: RecordTemplate | null;
  }>;
  baseCtx: ReportRenderContext;
}

export function renderReportTypst(opts: RenderReportOptions): string {
  const { title = '检测报告', coverBlocks = [], projects = [], baseCtx } = opts;
  const lines: string[] = [];
  lines.push('#import "@local/record-theme:0.1.0": *');
  lines.push('');
  lines.push(`#show: record-theme.with(title: "${esc(title)}", org: "广电计量")`);
  lines.push('');

  // 首页
  for (const b of coverBlocks) {
    const piece = renderBlock(b, baseCtx);
    if (piece) {
      lines.push(piece);
      lines.push('');
    }
  }

  // 各项目
  for (const proj of projects) {
    lines.push('#pagebreak()');
    lines.push(`#section("${esc(proj.name)}")[]`);
    lines.push('');
    const ctx: ReportRenderContext = {
      ...baseCtx,
      record_flat_data: proj.record_flat_data,
      linked_record_template: proj.linked_record_template,
    };
    for (const b of proj.blocks) {
      const piece = renderBlock(b, ctx);
      if (piece) {
        lines.push(piece);
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}
