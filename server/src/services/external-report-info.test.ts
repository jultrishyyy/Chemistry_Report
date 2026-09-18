import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReportMetaFromReq, parseReportInfos } from './external-report-info';
import { resolveReportMeta } from './external-report-meta';

test('official 1.2 names map to header code and signature notes for the corresponding report', async () => {
  const parsed = parseReportInfos({ OrderNumber: 'O-1', ReportList: [{
    SysNumber: 'S-1', ReportNumber: 'R-1', CheckCode: '992933', Language: '中文',
    SecondAuditeDate: '2026-07-01T10:20:30', ReportRemark: '', QualificationRemark: '',
    CustomerName: '客户甲', SampleList: [{ SampleName: '样品甲', TaskList: [] }],
  }] }).requisitions[0];
  const meta = buildReportMetaFromReq(parsed);
  assert.equal(meta.verify_code, '992933');
  assert.equal(meta.report_no, 'R-1');
  assert.equal(meta.issue_date, '2026-07-01');
  assert.equal(meta.report_note, '');
  assert.equal(meta.qualification_note, '');
  assert.equal(meta.customer_name, '客户甲');

  const resolved = await resolveReportMeta('O-1', meta);
  assert.equal(resolved.report_note, '', 'an explicit interface row must not inherit demo report remarks');
  assert.equal(resolved.qualification_note, '', 'an explicit interface row must not inherit demo qualification remarks');
  assert.equal(resolved.verify_code, '992933');
});
