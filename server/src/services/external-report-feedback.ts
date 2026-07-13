/**
 * 外部报告回执（P-Flow-2 场景3）—— 入站接缝（mock 可手动触发）。
 *
 * 报告以 PDF 回传外部（接口 1.4）后，外部审批给回执：通过 / 需修改(+建议)。
 * 本模块解析回执契约；处理（置报告状态 + 建返工工单）在 routes/external.ts。
 *
 * 当前：mock —— 外部系统未对接，演示期由前端「模拟外部回执」或 curl 直接 POST
 * /api/external/report-feedback 触发。真实接入＝外部按本契约 POST（或我方轮询）。
 *
 * 见《待实现内容.md》第 7 节（7.4 外部反馈接口设计 / 7.8 P-Flow-2）。
 */

export interface ParsedReportFeedback {
  /** 定位报告：三者任一（优先 report_id > report_no > sys_number） */
  report_id?: number;
  report_no?: string;
  sys_number?: string;
  order_no?: string;
  decision: 'approved' | 'needs_revision';
  /** 修改建议（needs_revision 时，多条合并为一段） */
  suggestion?: string;
  /** 外部回执 id（防重/追溯） */
  external_ref?: string;
}

const str = (v: any): string | undefined => {
  if (v === null || v === undefined) return undefined;
  const t = String(v).trim();
  return t === '' ? undefined : t;
};

/** 解析外部回执（兼容 PascalCase / 内部蛇形键）。 */
export function parseReportFeedback(raw: any): ParsedReportFeedback {
  if (!raw || typeof raw !== 'object') throw new Error('回执数据为空或格式错误');
  const rawDecision = (str(raw.decision) || str(raw.Decision) || '').toLowerCase();
  const decision: 'approved' | 'needs_revision' =
    /approve|pass|通过|同意/.test(rawDecision) ? 'approved'
    : /revis|reject|需修改|退回|不通过/.test(rawDecision) ? 'needs_revision'
    : (() => { throw new Error(`无法识别的 decision：${rawDecision || '(空)'}（需 approved / needs_revision）`); })();

  // 建议：suggestions[] / suggestion / Suggestions 文本
  let suggestion: string | undefined;
  const sg = raw.suggestions ?? raw.Suggestions ?? raw.suggestion ?? raw.Suggestion;
  if (Array.isArray(sg)) suggestion = sg.map((s: any) => (s?.field ? `[${s.field}] ` : '') + (str(s?.text) || str(s) || '')).filter(Boolean).join('；') || undefined;
  else suggestion = str(sg);

  const report_id = raw.report_id ?? raw.ReportId;
  return {
    report_id: typeof report_id === 'number' ? report_id : undefined,
    report_no: str(raw.report_no) || str(raw.ReportNumber),
    sys_number: str(raw.sys_number) || str(raw.SysNumber),
    order_no: str(raw.order_no) || str(raw.OrderNumber),
    decision,
    suggestion,
    external_ref: str(raw.external_ref) || str(raw.ExternalRef),
  };
}
