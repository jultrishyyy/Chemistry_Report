import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyReportMetaSnapshot, reportMetaSnapshotMatches } from './report-meta-snapshot';
import type { ReportContentDoc, ReportMeta } from './types';

const meta = (patch: Partial<ReportMeta> = {}): ReportMeta => ({
  verify_code: '900011', report_no: 'R-1', cover_report_no: 'R-1', issue_date: '2026-07-01',
  company_name: '接口公司', company_address: '接口地址', fax: '', phone: '', website: '',
  report_note: '', qualification_note: '', ...patch,
});
const doc = (): ReportContentDoc => ({
  cover: { name: '首页', groups: [], layout_options: { header_footer: { title: '检测报告', report_note: '演示备注' } }, ctx: { report_meta: meta({ report_note: '演示备注' }) } },
  projects: [{ name: '项目', title: '项目', page_break: true, groups: [], ctx: { report_meta: meta({ report_note: '演示备注' }) } }],
});

test('interface metadata replaces demo notes in header, body and signature bindings without changing layout', () => {
  const before = doc(), expected = meta();
  assert.equal(reportMetaSnapshotMatches(before, expected), false);
  const after = applyReportMetaSnapshot(before, expected, { title: '检测报告', ...expected });
  assert.equal(reportMetaSnapshotMatches(after, expected), true);
  assert.equal(after.cover.layout_options?.header_footer?.report_note, '');
  assert.equal(after.cover.ctx.report_meta.report_note, '');
  assert.equal(after.projects[0].ctx.report_meta.report_note, '');
  assert.equal(after.cover.layout_options?.header_footer?.title, '检测报告');
  assert.equal(before.cover.ctx.report_meta.report_note, '演示备注', 'source snapshot is immutable');
});
