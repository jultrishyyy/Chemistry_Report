const assert = require('node:assert/strict');
const { visibleReportGroups } = require('../client/src/utils/reportGroupVisibility.ts');
const groups = [
  { id: 1, template_kind: 'project', templates: [{ template_kind: 'project' }] },
  { id: 2, template_kind: 'cover', templates: [{ template_kind: 'cover' }] },
  { id: 3, template_kind: 'project', templates: [{ template_kind: 'cover' }, { template_kind: 'project' }] },
  { id: 4, template_kind: 'cover', templates: [] },
];
const before = JSON.stringify(groups);
const ids = rows => rows.map(row => row.id);
assert.deepEqual(ids(visibleReportGroups(groups, 'cover')), [2, 3]);
assert.deepEqual(ids(visibleReportGroups(groups, 'project')), [1, 3]);
assert.deepEqual(ids(visibleReportGroups(groups, 'cover_page')), []);
assert.deepEqual(ids(visibleReportGroups(groups, 'cover', { all: true })), [1, 2, 3, 4]);
assert.deepEqual(ids(visibleReportGroups(groups, 'cover', { groupId: 1 })), [1]);
assert.deepEqual(ids(visibleReportGroups(groups, 'cover', { groupId: 4 })), [4]);
assert.deepEqual(ids(visibleReportGroups(groups, 'cover', { groupId: 999 })), []);
assert.equal(JSON.stringify(groups), before, 'filtering never modifies shared groups or their members');
const attached = groups.map(group => group.id === 1 ? { ...group, templates: [...group.templates, { template_kind: 'cover' }] } : group);
assert.deepEqual(ids(visibleReportGroups(attached, 'cover')), [1, 2, 3]);
const detached = attached.map(group => group.id === 1 ? { ...group, templates: group.templates.filter(t => t.template_kind !== 'cover') } : group);
assert.deepEqual(ids(visibleReportGroups(detached, 'cover')), [2, 3]);
console.log('Report group visibility: type-specific lists, shared/all/empty groups, direct management, attach/detach and no mutation passed.');
