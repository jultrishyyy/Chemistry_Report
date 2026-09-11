// Actual React history + shortcut routing. No database or production report writes.
const assert = require('node:assert/strict');
const { JSDOM } = require('../client/node_modules/jsdom');
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node']) Object.defineProperty(global, key, { configurable: true, value: dom.window[key] });
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('../client/node_modules/react');
const { createRoot } = require('../client/node_modules/react-dom/client');
const { useEditorHistory } = require('../client/src/hooks/useEditorHistory.ts');
const { reportHistoryShortcut } = require('../client/src/utils/reportHistoryShortcut.ts');
let history, childCalls = 0;
const initial = { blocks: [{ id: 'table', cells: ['1.234567'] }, { id: 'image' }] };
function Harness() {
  history = useEditorHistory(initial);
  return React.createElement('div', { onKeyDownCapture: event => {
    const action = reportHistoryShortcut(event.nativeEvent);
    if (!action) return;
    event.preventDefault(); event.stopPropagation(); history[action]();
  } }, React.createElement('div', { className: 'report-document-paper' },
    React.createElement('textarea', { id: 'cell', onKeyDown: () => childCalls++ }),
    React.createElement('div', { id: 'text', className: 'report-visual-paragraph', contentEditable: true, suppressContentEditableWarning: true, onKeyDown: () => childCalls++ }),
    React.createElement('div', { className: 'ant-popover' }, React.createElement('input', { id: 'draft' })),
    React.createElement('div', { id: 'title', contentEditable: true, suppressContentEditableWarning: true }),
  ));
}
const root = createRoot(document.getElementById('root'));
const press = async (id, key, options = {}) => {
  const event = new window.KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true, ...options });
  await React.act(async () => document.getElementById(id).dispatchEvent(event));
  return event.defaultPrevented;
};
(async () => {
  const now = Date.now; let clock = now(); Date.now = () => clock;
  try {
    await React.act(async () => root.render(React.createElement(Harness)));
    const change = async fn => { clock += 500; await React.act(async () => history.setValue(previous => { const next = structuredClone(previous); fn(next); return next; })); };
    const states = [JSON.stringify(history.value)];
    await change(doc => { doc.blocks[0].cells[0] = '9'; }); states.push(JSON.stringify(history.value));
    await change(doc => { doc.blocks.reverse(); }); states.push(JSON.stringify(history.value));
    await change(doc => { doc.blocks.push({ id: 'copy', cells: ['9'] }); }); states.push(JSON.stringify(history.value));
    await change(doc => { doc.note = '修改备注'; }); states.push(JSON.stringify(history.value));
    for (let i = states.length - 2; i >= 0; i--) {
      assert.equal(await press(i % 2 ? 'cell' : 'text', 'z'), true);
      assert.equal(JSON.stringify(history.value), states[i]);
    }
    assert.equal(childCalls, 0, 'document undo must not also trigger native/Tiptap undo');
    assert.equal(await press('text', 'z'), true, 'empty history still shields stale local history');
    assert.equal(await press('cell', 'z', { ctrlKey: false, metaKey: true, shiftKey: true }), true);
    assert.equal(JSON.stringify(history.value), states[1]);
    assert.equal(await press('cell', 'y'), true);
    assert.equal(JSON.stringify(history.value), states[2]);
    const before = JSON.stringify(history.value);
    for (const id of ['draft', 'title']) assert.equal(await press(id, 'z'), false);
    assert.equal(await press('cell', 'z', { isComposing: true }), false);
    assert.equal(await press('cell', 'z', { altKey: true }), false);
    assert.equal(JSON.stringify(history.value), before);
    await change(doc => { doc.note = '撤回后的新编辑'; });
    assert.equal(history.canRedo, false);
    await React.act(async () => history.replaceBaseline(initial));
    assert.equal(history.canUndo, false); assert.equal(history.canRedo, false);
    await change(doc => { doc.note = '批量前输入'; });
    const preBatch = JSON.stringify(history.value);
    await React.act(async () => history.setValueTransaction(previous => ({ ...previous, titleStyle: 14, bodyStyle: 14 })));
    const formatted = JSON.stringify(history.value);
    await React.act(async () => history.setValue(previous => ({ ...previous, note: '紧接着输入' })));
    await React.act(async () => history.undo());
    assert.equal(JSON.stringify(history.value), formatted, 'typing after batch remains a separate undo');
    await React.act(async () => history.undo());
    assert.equal(JSON.stringify(history.value), preBatch, 'one undo restores all batch targets, not preceding typing');
    await React.act(async () => history.redo());
    assert.equal(JSON.stringify(history.value), formatted);
    // Manual and timer saves are acknowledgements, never new entry baselines.
    await React.act(async () => history.replaceBaseline(initial));
    const savedStates = [JSON.stringify(history.value)];
    for (let i = 1; i <= 4; i++) {
      await change(doc => { doc.note = `操作${i}`; });
      const submitted = history.value;
      await React.act(async () => history.acceptSavedValue(submitted, structuredClone(submitted)));
      savedStates.push(JSON.stringify(history.value));
      assert.equal(history.canUndo, true, 'saving cannot clear undo');
      assert.equal(history.canReset, true, 'saving cannot replace entry baseline');
    }
    for (let i = 3; i >= 0; i--) {
      await React.act(async () => history.undo());
      assert.equal(JSON.stringify(history.value), savedStates[i]);
      const submitted = history.value;
      await React.act(async () => history.acceptSavedValue(submitted, structuredClone(submitted)));
      assert.equal(history.canRedo, true, 'autosaving an undo must preserve redo');
    }
    for (let i = 1; i <= 4; i++) {
      await React.act(async () => history.redo());
      assert.equal(JSON.stringify(history.value), savedStates[i]);
    }
    await React.act(async () => history.reset());
    assert.deepEqual(history.value, initial, 'reset means entry, even after several saves');
    await React.act(async () => history.undo());
    assert.equal(JSON.stringify(history.value), savedStates[4], 'reset itself is reversible');
    const submitted = history.value;
    await change(doc => { doc.note = '保存等待期间继续输入'; });
    const newer = JSON.stringify(history.value);
    await React.act(async () => history.acceptSavedValue(submitted, { ...submitted, recoveredPhoto: 'server-photo' }));
    assert.equal(JSON.stringify(history.value), newer, 'late save response cannot overwrite newer typing');
    const current = history.value;
    await React.act(async () => history.acceptSavedValue(current, { ...current, recoveredPhoto: 'server-photo' }));
    assert.equal(history.value.recoveredPhoto, 'server-photo', 'server normalization is accepted when input has not advanced');
    await React.act(async () => history.reset());
    assert.deepEqual(history.value, initial, 'server normalization does not rewrite entry snapshot');
    await React.act(async () => history.replaceBaseline(initial));
    await change(doc => { doc.note = '第一个点击操作'; });
    const clickState = JSON.stringify(history.value);
    await React.act(async () => history.closeGroup());
    clock += 20;
    await React.act(async () => history.setValue(previous => ({ ...previous, note: '另一个点击操作' })));
    await React.act(async () => history.undo());
    assert.equal(JSON.stringify(history.value), clickState, 'different pointer/focus operations cannot merge within 400ms');
    await React.act(async () => history.replaceBaseline(initial));
    for (let i = 0; i < 25; i++) {
      clock += 100;
      await React.act(async () => history.setValue(previous => ({ ...previous, note: String(i) })));
    }
    await React.act(async () => history.undo());
    assert.equal(history.canUndo, true, 'uninterrupted typing is bounded rather than merging indefinitely');
    console.log('Report undo/redo: cells, move, paste-shaped copy, prose, chronological restore, Mac shortcuts, native drafts and history reset passed');
  } finally { Date.now = now; await React.act(async () => root.unmount()); dom.window.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
