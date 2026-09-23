export const REPORT_ENDING_RULE = '除非另有说明，报告参照 ILAC-G8:09/2019/CNAS-GL015:2022 使用简单接受（w=0）二元判定规则进行符合性判定。';
export const REPORT_ENDING_LABEL = '——报告结束——';

export interface ReportEndingConfig {
  enabled?: boolean;
  rule?: string;
  label?: string;
}

export function reportEndingConfig(value: unknown): Required<ReportEndingConfig> {
  if (value === true) {
    return { enabled: true, rule: REPORT_ENDING_RULE, label: REPORT_ENDING_LABEL };
  }
  const config = value && typeof value === 'object' ? value as ReportEndingConfig : {};
  return {
    enabled: config.enabled === true,
    rule: typeof config.rule === 'string' ? config.rule : REPORT_ENDING_RULE,
    label: typeof config.label === 'string' ? config.label : REPORT_ENDING_LABEL,
  };
}

function escapeTypstMarkup(value: string): string {
  return value.replace(/([\\#$*_\[\]@<>`~])/g, '\\$1').replace(/\r\n?|\n/g, '#linebreak()');
}

export function renderReportEnding(value: unknown): string {
  const config = reportEndingConfig(value);
  if (!config.enabled) return '';
  const rule = escapeTypstMarkup(config.rule);
  const label = escapeTypstMarkup(config.label);
  return `\n#block(width: 100%, breakable: false, above: 1em)[
#set par(justify: false)
#align(left)[#text(weight: 400, style: "normal", stroke: none)[${rule}]]
#v(0.4em)
#align(center)[#text(weight: 400, style: "normal", stroke: none)[${label}]]
]\n`;
}
