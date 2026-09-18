export type ChoiceDisplay = { layout?: 'inline' | 'lines'; separator?: string; marker?: 'none' | 'number' | 'number_parentheses' | 'bullet'; show_marker_for_single?: boolean; ending?: string };
/** Presentation only: raw choices and binding identities remain unchanged. */
export function formatChoiceValue(value: unknown, config?: ChoiceDisplay): string {
  const values = (Array.isArray(value) ? value : [value]).map(item => {
    const v = item && typeof item === 'object' && 'custom' in item ? item.custom : item;
    return v == null ? '' : String(v);
  }).filter(v => v !== '');
  if (config?.layout !== 'lines') return values.join(config?.separator ?? '、');
  const marker = values.length === 1 && config.show_marker_for_single === false ? 'none' : config.marker;
  return values.map((v, index) => `${marker === 'number' ? `${index + 1}. ` : marker === 'number_parentheses' ? `（${index + 1}） ` : marker === 'bullet' ? '• ' : ''}${v}${config.ending ?? ''}`).join('\n');
}
