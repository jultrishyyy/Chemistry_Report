/**
 * 自由表格跨表公式引用。
 *
 * 同表引用继续使用历史键 `rowId::colId`；只有跨表引用才加前缀，既保持旧模板
 * 兼容，也避免用户调整表格显示名称后破坏依赖关系。
 */
import type { Formula } from './types';

/** When a sample expands, aliases must move with their source keys. */
export function remapFreeGridFormula(formula: Formula, map: (source: string) => string): Formula {
  const sources = (formula.sources || []).map(map);
  const remap = (values: Record<string, unknown> | undefined) => values
    ? Object.fromEntries(Object.entries(values).map(([source, value]) => [map(source), value])) : undefined;
  return { ...formula, sources, ...(formula.params ? { params: { ...formula.params,
    ...(formula.params.source_aliases ? { source_aliases: remap(formula.params.source_aliases) } : {}),
    ...(formula.params.source_labels ? { source_labels: remap(formula.params.source_labels) } : {}),
  } } : {}) };
}
const CROSS_TABLE_PREFIX = '@free-grid:';

export interface FreeGridCellReference {
  fieldCode: string;
  cellKey: string;
}

export function encodeFreeGridCellReference(fieldCode: string, cellKey: string): string {
  return `${CROSS_TABLE_PREFIX}${encodeURIComponent(fieldCode)}:${encodeURIComponent(cellKey)}`;
}

export function decodeFreeGridCellReference(source: string): FreeGridCellReference | null {
  if (!source.startsWith(CROSS_TABLE_PREFIX)) return null;
  const body = source.slice(CROSS_TABLE_PREFIX.length);
  const separator = body.indexOf(':');
  if (separator < 1) return null;
  try {
    return {
      fieldCode: decodeURIComponent(body.slice(0, separator)),
      cellKey: decodeURIComponent(body.slice(separator + 1)),
    };
  } catch {
    return null;
  }
}

export function resolveFreeGridCellReference(source: string, currentFieldCode: string): FreeGridCellReference {
  return decodeFreeGridCellReference(source) || { fieldCode: currentFieldCode, cellKey: source };
}
