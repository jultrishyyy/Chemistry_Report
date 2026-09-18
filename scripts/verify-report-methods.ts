import { pool } from '../server/src/db';
import { matchRequisitionScope } from '../server/src/services/external-report-info';
import { availableReportAssignments, splitReportMethodMatches } from '../shared/report-generation-selection';
import { buildReportTypst } from '../server/src/routes/reports';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { uploadsDir } from '../config/index';
import { MOCK_IMAGE_DIR } from '../shared/mock-data';
import { renderFreeGridTypst, renderContentDoc, UPLOAD_IMAGE_PATH_PREFIX } from '../shared/typst-generator';
const order = process.argv[2] || 'MOCK-EXT-002';
try {
  const wo = (await pool.query('SELECT payload FROM work_orders WHERE order_no=$1', [order])).rows[0];
  const report = (await pool.query('SELECT cover_template_id FROM reports WHERE report_no=$1 ORDER BY id DESC LIMIT 1', [`${order}-1#`])).rows[0];
  const match = splitReportMethodMatches(await matchRequisitionScope(pool, order, { samples: wo.payload.samples }));
  const assignments = availableReportAssignments(match);
  const built = await buildReportTypst({ order_no: order, cover_template_id: report.cover_template_id, project_assignments: assignments, mock_context: {} });
  console.log(JSON.stringify({ available: assignments.map(a => ({ record: a.record_data_id, template: a.project_template_id })),
    unavailable: match.filter(m => !m.assignments.some(a => a.project_template_candidates?.length)).map(m => ({ project: m.project_name, method: m.method_name })),
    rendered: built.contentDoc?.projects.map(p => ({ title: p.title, record: (p.ctx as any).source_record_data_id })) }, null, 2));
  if (order === 'MOCK-EXT-002') {
    const projects = built.contentDoc!.projects;
    assert.deepEqual(projects.map(p => (p.ctx as any).source_record_data_id), [72, 73, 74, 75]);
    const third = projects.find(p => (p.ctx as any).source_record_data_id === 74)!;
    const grid = third.groups.flatMap(g => g.fields).find(f => f.type === 'free_grid')!;
    const table = renderFreeGridTypst(grid, grid.free_table!, undefined, third.ctx as any);
    assert.doesNotMatch(table, /row:s[34]#/);
    assert.match(table, /row:s2#/);
    const density = projects.find(p => (p.ctx as any).source_record_data_id === 75)!;
    const densityPdf = renderContentDoc({ ...built.contentDoc!, projects: [density] });
    const imagePath = (density.ctx as any).record_raw_data.photos_before[0].rel_path;
    assert.ok(densityPdf.includes(imagePath), 'Density source photograph must be present in PDF source');
    const sample = built.contentDoc!.cover.groups.flatMap(g=>g.fields).find(f=>f.type === 'report_sample_table');
    assert.ok(sample && built.finalTypst.includes('PP-T20'));
    const source = built.finalTypst.split(UPLOAD_IMAGE_PATH_PREFIX).join(uploadsDir + '/').split(MOCK_IMAGE_DIR).join(process.cwd() + '/samples/sample-images');
    const pdf = spawnSync('typst', ['compile', '--root', '/', '--font-path', 'fonts', '-', '-'], { input: source, maxBuffer: 20 * 1024 * 1024 });
    assert.equal(pdf.status, 0, pdf.stderr.toString());
    assert.equal(pdf.stdout.subarray(0,5).toString(), '%PDF-');
    console.log('Verified: method order 1/2/3/density; empty rows excluded; density image included; PDF compilation passed.');
  }
  assert.deepEqual([...built.assignmentRecIds].sort((a,b)=>a-b), assignments.map(a=>a.record_data_id).sort((a,b)=>a-b));
} finally { await pool.end(); }
