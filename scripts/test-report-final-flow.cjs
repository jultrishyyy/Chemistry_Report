// Non-mutating integration: report model -> save-shaped JSON -> PDF + real markers.
// Does not call production save/approval routes or write any database records.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { renderContentDoc } = require('../shared/typst-generator.ts');
const { reportTextRuns, reportTextRunValue, updateReportTextRun } = require('../shared/report-text-runs.ts');
const { encodeReportRichDocument } = require('../shared/report-rich-document.ts');
const { makeReportManualTable } = require('../shared/report-document-editing.ts');
const { detachReportFigureNotes } = require('../shared/report-detached-notes.ts');
const rich = text => encodeReportRichDocument({ type: 'doc', content: [{ type: 'paragraph', attrs: { spaceBefore: 0, spaceAfter: 8, lineGap: 0.8 }, content: [{ type: 'text', text }] }] });
const group = () => ({ id: 'group', label: '', layout: 'vertical', fields: [
  { id: 'body', code: 'body', label: '', hide_label: true, type: 'text', default_value: 'Original' },
  makeReportManualTable('table'),
  { id: 'note', code: 'note', label: '', hide_label: true, type: 'text', default_value: 'After table' },
] });
const doc = { cover: { groups: [{ id: 'cover', label: '', layout: 'vertical', fields: [
  { id: 'intro', code: 'intro', type: 'text', label: '', hide_label: true, default_value: 'Cover' },
]}], ctx: {} }, projects: [0, 1].map(i => ({ name: `Project ${i + 1}`, page_break: true, groups: [group()], ctx: {} })) };
const cover = doc.cover.groups[0];
cover.report_document = { version: 1, value: rich('Cover    edited') };
for (const [i, project] of doc.projects.entries()) {
  const g = project.groups[0];
  const snapshot = JSON.stringify(g);
  const run = reportTextRuns(g)[0];
  reportTextRunValue(run, field => field.default_value || '');
  assert.equal(JSON.stringify(g), snapshot);
  updateReportTextRun(g, run.ids, rich(`Project ${i + 1}    edited`));
}
const styledTable = doc.projects[0].groups[0].fields.find(field => field.id === 'table').free_table;
const styledCell = `${styledTable.rows[0].id}::${styledTable.columns[0].id}`;
styledTable.cells[styledCell] = 'Edited cell\nSecond line';
styledTable.cell_styles = { [styledCell]: { size: '14pt', weight: 'bold', color: '#1677ff', align: 'left', line_height: '0.3em' } };
styledTable.columns[0].style = { line_height: '0.4em' };
styledTable.row_height_mode = 'track';
styledTable.header_height = '1cm';
styledTable.rows.forEach(row => { row.height = '1cm'; });
styledTable.columns.forEach(col => { col.width = '3cm'; });
doc.projects[0].groups[0].fields.find(field => field.id === 'table').caption = 'Note  with spaces\nAnother line';
doc.projects[0].groups = detachReportFigureNotes(doc.projects[0].groups);
doc.projects[0].report_heading = rich('1) Editable    project heading');
const saved = JSON.stringify(doc), reopened = JSON.parse(saved);
const source = renderContentDoc(doc);
assert.equal(renderContentDoc(reopened), source, 'save-shaped JSON roundtrip must preserve the exact report source');
assert.equal(JSON.stringify(doc), saved, 'rendering must not mutate the report model');
const args = ['--package-path', path.resolve('typst-packages')];
const pdf = spawnSync('typst', ['compile', ...args, '-', '-'], { input: source, maxBuffer: 8 * 1024 * 1024 });
assert.ifError(pdf.error); assert.equal(pdf.status, 0, pdf.stderr?.toString());
assert.equal(pdf.stdout.subarray(0, 5).toString(), '%PDF-');
const query = spawnSync('typst', ['query', ...args, '-', '<__fepos__>', '--field', 'value'], { input: source, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
assert.ifError(query.error); assert.equal(query.status, 0, query.stderr);
const markers = JSON.parse(query.stdout);
const marker = code => markers.find(m => m.kind === 'field' && m.code === code);
for (const code of ['cover::cover__body', 'proj0::body', 'proj1::body', 'proj0::__project_heading__']) assert.ok(marker(code), `missing click target ${code}`);
assert.ok(marker('proj1::body').page > marker('proj0::body').page, 'same field code in later project must resolve to its own page');
console.log('Final report model flow: read-only projection, mixed edits, JSON reopen, actual multi-project PDF and unique text markers passed');
