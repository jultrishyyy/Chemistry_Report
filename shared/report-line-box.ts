/** Typst leading only separates lines; CSS line-height also gives the first and
 * last line half-leading. Explicit report line-height must include those edges. */
export function reportTypstLineBox(content: string, leading: string): string {
  if (!/^\d+(?:\.\d+)?(?:em|pt|cm|mm|in)$/.test(leading)) return content;
  return `#set par(leading: ${leading})\n#set block(spacing: 0pt)\n#pad(top: 0.5 * ${leading}, bottom: 0.5 * ${leading})[${content}]`;
}
