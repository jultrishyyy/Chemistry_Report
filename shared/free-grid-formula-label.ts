import type { FieldDefinition, Formula } from './types';
import { resolveFreeGridCellReference } from './free-grid-formula';
import { formulaRangeLabel } from './formula-grid-selection';
import { mapFormulaCode } from './spreadsheet-expression';
type Table = NonNullable<FieldDefinition['free_table']>;
export function freeGridAddress(table: Table, key: string): string {
  return formulaRangeLabel(table, [key]) || '已删除的格子';
}
export function freeGridFormulaLabel(formula: Formula, owner: string, tableOf: (code: string) => Table | undefined, nameOf: (code: string) => string): string {
  const sources = formula.sources || [];
  const labels = sources.map(source => {
    const ref = resolveFreeGridCellReference(source, owner), table = tableOf(ref.fieldCode);
    const address = table ? freeGridAddress(table, ref.cellKey) : '来源不可用';
    return ref.fieldCode === owner ? address : `${nameOf(ref.fieldCode)}!${address}`;
  });
  if (formula.type === 'custom') {
    const replacements: Record<string, string> = {};
    sources.forEach((source, i) => {
      replacements[`v${i + 1}`] = labels[i];
      const alias = formula.params?.source_aliases?.[source];
      if (typeof alias === 'string') replacements[alias] = labels[i];
    });
    return '=' + mapFormulaCode(String(formula.expression || '').replace(/^=\s*/, ''), code => code.replace(/\b[A-Za-z_][A-Za-z0-9_]*\b/g, token => replacements[token] ?? token));
  }
  const table = tableOf(owner);
  const compact = table && sources.every(source => resolveFreeGridCellReference(source, owner).fieldCode === owner) ? formulaRangeLabel(table, sources) : undefined;
  return `=${({ average: 'AVERAGE', sum: 'SUM', max: 'MAX', min: 'MIN' } as Record<string, string>)[formula.type] || formula.type.toUpperCase()}(${compact || labels.join(', ')})`;
}
