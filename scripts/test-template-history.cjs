// Template-shaped React histories plus wiring guards for all three template pages. No API writes.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { JSDOM } = require('../client/node_modules/jsdom');
const dom = new JSDOM('<div id="root"></div>');
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node']) Object.defineProperty(global, key, { configurable: true, value: dom.window[key] });
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('../client/node_modules/react');
const { createRoot } = require('../client/node_modules/react-dom/client');
const { useEditorHistory } = require('../client/src/hooks/useEditorHistory.ts');
const root = createRoot(document.getElementById('root'));
let history, initial, saved;
function Harness({ kind }) {
  initial = { id: 7, name: kind, groups: [{ id: 'g', label: '分区', fields: [
    { id: 'table', code: 'table', type: 'free_grid', free_table: { columns: [{ id: 'c', label: '' }], rows: [{ id: 'r' }], cells: { 'r::c': '1.23456789' }, cell_formulas: { 'r::c': { type: 'sum', sources: ['a'] } } } },
    { id: 'image', code: 'image', type: 'image', image_photos: [{ id: 'photo', url: '/existing-photo' }] },
  ] }], layout_options: { theme_config: { font: 'FangSong', body_size: '10.5pt' } } };
  history = useEditorHistory(initial);
  const edit = fn => history.setValue(prev => { const next = structuredClone(prev); fn(next); return next; });
  return React.createElement('div', { onPointerDownCapture: history.closeGroup, onFocusCapture: history.closeGroup },
    React.createElement('button', { id: 'name', onClick: () => edit(t => { t.name += '修改'; }) }, '名称'),
    React.createElement('button', { id: 'size', onClick: () => edit(t => { t.layout_options.theme_config.body_size = '14pt'; }) }, '字号'),
    React.createElement('button', { id: 'cell', onClick: () => edit(t => { t.groups[0].fields[0].free_table.cells['r::c'] = '9'; }) }, '单元格'),
    React.createElement('button', { id: 'save', onClick: () => { history.closeGroup(); saved = structuredClone(history.value); } }, '保存'));
}
const click = id => React.act(async () => {
  const button = document.getElementById(id);
  button.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true })); button.click();
});
(async () => {
  try {
    for (const kind of ['原始记录模板', '报告首页模板', '项目模板']) {
      await React.act(async () => root.render(React.createElement(Harness, { key: kind, kind })));
      const original = structuredClone(history.value), states = [JSON.stringify(original)];
      for (const id of ['name', 'size', 'cell']) {
        await click(id); states.push(JSON.stringify(history.value)); await click('save');
        assert.equal(history.canUndo, true); assert.equal(history.canReset, true);
      }
      for (let i = 2; i >= 0; i--) {
        await React.act(async () => history.undo()); assert.equal(JSON.stringify(history.value), states[i]);
        await click('save'); assert.equal(history.canRedo, true);
      }
      for (let i = 1; i <= 3; i++) {
        await React.act(async () => history.redo()); assert.equal(JSON.stringify(history.value), states[i]);
      }
      await click('save');
      await React.act(async () => history.reset()); assert.deepEqual(history.value, original);
      await React.act(async () => history.undo()); assert.deepEqual(history.value, saved);
      assert.deepEqual(history.value.groups[0].fields[0].free_table.cell_formulas, original.groups[0].fields[0].free_table.cell_formulas);
      assert.deepEqual(history.value.groups[0].fields[1], original.groups[0].fields[1]);
    }
    // Prevent a future refactor from reintroducing baseline replacement inside normal saves.
    for (const file of ['client/src/pages/RecordTemplate/Editor.tsx', 'client/src/pages/ReportTemplate/useReportTemplateEditor.ts']) {
      const source = readFileSync(file, 'utf8');
      const save = source.slice(source.indexOf('const handleSave ='), source.indexOf('useAutoSave({'));
      assert.ok(save.length > 0);
      assert.ok(!/replace\w*Baseline\(/.test(save), `${file}: saving must not reset entry history`);
      assert.ok(save.includes('templateHistory.closeGroup()'));
    }
    for (const file of ['CoverEditor', 'ProjectEditor']) {
      const source = readFileSync(`client/src/pages/ReportTemplate/${file}.tsx`, 'utf8');
      assert.ok(source.includes('{...ed.historyEvents}'));
      assert.ok(source.includes('<EditorHistoryControls disabled={saving}'));
    }
    const record = readFileSync('client/src/pages/RecordTemplate/Editor.tsx', 'utf8');
    assert.ok(record.includes('onPointerDownCapture={templateHistory.closeGroup} onFocusCapture={templateHistory.closeGroup}'));
    assert.match(record, /<EditorHistoryControls\s+disabled=\{saving\}/);
    console.log('Template histories: three template kinds, rapid distinct operations, saves, undo/redo/reset, formulas/photos preserved, and page wiring guards passed');
  } finally { await React.act(async () => root.unmount()); dom.window.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
