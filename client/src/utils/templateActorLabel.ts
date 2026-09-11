/** Display-only normalization; keep original audit identity in storage and permission checks. */
export function templateActorLabel(name: string | null | undefined): string {
  if (name === 'matrix-free-grid-migration') return '系统升级';
  return name || '—';
}
