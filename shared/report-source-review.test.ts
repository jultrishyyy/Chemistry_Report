import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectReportSourceChanges, validSourceReviews } from './report-source-review';
import { renderContentDoc } from './typst-generator.ts';

function fixture() {
  return { source_review_revision: 'generation-1', projects: [{ name: '密度', ctx: {
    source_record_data_id: 7,
    linked_record_template: { version: 1, groups: [{ fields: [{ type: 'free_grid', code: 'f', label: '试验数据' }] }] },
    record_raw_data: { f: { 'r::c': '1.2345', __free_table_structure__: {
      rows: [{ id: 'r', entry_added: false }, { id: 'extra', entry_added: true }],
      columns: [{ id: 'c', entry_added: false }], cells: { 'r::c': '1' }, spans: {},
    } } },
  } }] };
}
test('explicit review survives JSON save; wrong revisions and removed additions expire', () => {
  const snapshot = fixture(), signature = collectReportSourceChanges(snapshot)[0].signature;
  const saved = JSON.parse(JSON.stringify({ source_reviews: [signature] }));
  assert.deepEqual(validSourceReviews(snapshot, saved.source_reviews), [signature]);
  snapshot.source_review_revision = 'generation-2';
  assert.deepEqual(validSourceReviews(snapshot, saved.source_reviews), []);
  snapshot.projects[0].ctx.record_raw_data.f.__free_table_structure__.rows.pop();
  assert.deepEqual(collectReportSourceChanges(snapshot), []);
});
test('ordinary data and formatting edits do not alter structural review; topology does', () => {
  const snapshot = fixture(), signature = collectReportSourceChanges(snapshot)[0].signature;
  const raw = snapshot.projects[0].ctx.record_raw_data.f;
  raw['r::c'] = '9.87';
  raw.__free_table_structure__.cells['r::c'] = 'changed header';
  Object.assign(raw.__free_table_structure__, { default_number_fmt: { mode: 'decimals', digits: 2 }, cell_styles: { 'r::c': { weight: 'bold' } } });
  assert.equal(collectReportSourceChanges(snapshot)[0].signature, signature, 'header warnings are separate');
  raw.__free_table_structure__.columns.push({ id: 'added-column', entry_added: true });
  assert.notEqual(collectReportSourceChanges(snapshot)[0].signature, signature);
});
test('sample expansion without ordinary additions is not a warning; identity separates same names', () => {
  const snapshot = fixture();
  snapshot.projects.push(structuredClone(snapshot.projects[0]));
  const changes = collectReportSourceChanges(snapshot);
  assert.notEqual(changes[0].signature, changes[1].signature);
  assert.deepEqual(validSourceReviews(snapshot, [changes[0].signature, changes[0].signature, 'forged', 1]), [changes[0].signature]);
  for (const project of snapshot.projects) {
    project.ctx.record_raw_data.f.__free_table_structure__.rows = [{ id: 's0', entry_added: false }, { id: 's1', entry_added: false }];
  }
  assert.equal(collectReportSourceChanges(snapshot).length, 0);
  assert.deepEqual(validSourceReviews(null, [changes[0].signature]), []);
});
test('merge signatures are stable across JSON object key order', () => {
  const snapshot = fixture(), table = snapshot.projects[0].ctx.record_raw_data.f.__free_table_structure__;
  table.spans = { 'r::c': { rowspan: 2, colspan: 1 } };
  const signature = collectReportSourceChanges(snapshot)[0].signature;
  table.spans = { 'r::c': { colspan: 1, rowspan: 2 } };
  assert.equal(collectReportSourceChanges(snapshot)[0].signature, signature);
});
test('review metadata does not change report rendering', () => {
  const doc = { cover: { groups: [], ctx: {} }, projects: [] };
  const before = renderContentDoc(doc);
  const reviewed = { ...doc, source_review_revision: 'new-generation', source_reviews: [collectReportSourceChanges(fixture())[0].signature] };
  assert.equal(renderContentDoc(reviewed), before);
});
