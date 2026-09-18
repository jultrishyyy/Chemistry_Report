import type { FieldGroup } from './types';
export const SIGNATURE_POSITION_OPTIONS = [
  { value: 'first_page_bottom', label: '首页底部' },
  { value: 'flow', label: '随正文' },
  { value: 'current_page_bottom', label: '当前页底部' },
] as const;
export function signaturePosition(group: FieldGroup): NonNullable<FieldGroup['signature_position']> {
  return group.signature_position ?? (group.style?.vertical_align === 'bottom' ? 'first_page_bottom' : 'flow');
}
export function fixedFirstPageSignature(group: FieldGroup): boolean {
  return group.fields.some(field => field.signature_line) && (group.signature_position === 'first_page_bottom'
    || (group.signature_position == null && group.style?.vertical_align === 'bottom'));
}
