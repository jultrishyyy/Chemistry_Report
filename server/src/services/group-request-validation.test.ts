import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isDatabaseId } from '../../../shared/database-id.js';
import { validateGroupResourceId, groupOperationError } from './group-request-validation.js';
import { VersionFlowError } from './template-versions.js';

test('database IDs reject tree keys, NaN, missing and out-of-range values', () => {
  for (const id of [1, '12', 2147483647]) assert.equal(isDatabaseId(id), true);
  for (const id of ['family-1', 'report-group-2', 'NaN', NaN, undefined, null, '', 0, -1, '1.5', '1e2', 2147483648]) assert.equal(isDatabaseId(id), false);
});

function response() {
  return { code: 200, body: {} as any, status(code: number) { this.code = code; return this; }, json(body: any) { this.body = body; return this; } };
}
test('invalid group IDs stop before SQL, valid IDs continue', () => {
  for (const value of ['NaN', 'family-1', 'report-group-2', 'undefined']) {
    const res = response(); let passed = false;
    validateGroupResourceId({} as any, res as any, () => { passed = true; }, value);
    assert.equal(passed, false); assert.equal(res.code, 400);
    assert.match(res.body.error, /刷新/); assert.doesNotMatch(res.body.error, /NaN|integer|syntax/);
  }
  let passed = false;
  validateGroupResourceId({} as any, response() as any, () => { passed = true; }, '7');
  assert.equal(passed, true);
});
test('archive failures retain actionable business messages but hide database details', () => {
  const known = response();
  groupOperationError(known as any, new VersionFlowError('项目组已删除', 409));
  assert.equal(known.code, 409); assert.equal(known.body.error, '项目组已删除');
  const unexpected = response();
  groupOperationError(unexpected as any, new Error('invalid input syntax for type integer: "NaN"'));
  assert.equal(unexpected.code, 500); assert.match(unexpected.body.error, /稍后重试/);
  assert.doesNotMatch(unexpected.body.error, /NaN|integer|syntax/);
});
test('both template lists pass the persistent family ID, even for an empty group', () => {
  const record = readFileSync(new URL('../../../client/src/pages/RecordTemplate/List.tsx', import.meta.url), 'utf8');
  const report = readFileSync(new URL('../../../client/src/pages/ReportTemplate/List.tsx', import.meta.url), 'utf8');
  assert.match(record, /TestTemplateGroupArchiveActions group=\{\{ \.\.\.r, id: r.family_id \}\}/);
  assert.match(report, /TestTemplateGroupArchiveActions kind="report" group=\{\{ \.\.\.row, id: row.family_id \}/);
});
