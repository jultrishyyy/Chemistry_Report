import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rebaseRecordSave } from './record-save-rebase';

test('autosave response preserves typing, table changes and removals made during request', () => {
  const sent = { text: 'old', grid: { a: '1', b: '2' }, equipment: ['A'], removed: 'old' };
  const current = { text: 'new', grid: { a: '3', b: '2' }, equipment: ['A', 'B'] };
  const saved = { ...sent, grid: { a: '1', b: '2', computed: '3' }, audit_date: 'today' };
  assert.deepEqual(rebaseRecordSave(sent, current, saved), {
    text: 'new', grid: { a: '3', b: '2', computed: '3' }, equipment: ['A', 'B'], audit_date: 'today',
  });
  assert.equal(sent.text, 'old');
  assert.equal(saved.removed, 'old');
});
test('unchanged input receives normalized saved data; cleared cell stays empty', () => {
  assert.deepEqual(rebaseRecordSave({ n: 1 }, { n: 1 }, { n: '1.00' }), { n: '1.00' });
  assert.deepEqual(rebaseRecordSave({ grid: { a: '1' } }, { grid: { a: '' } }, { grid: { a: '1.00' } }), { grid: { a: '' } });
});
