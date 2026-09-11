// Cross-editor formatting, model integrity and actual React event routing (no DB writes).
const assert = require('node:assert/strict');
const { JSDOM } = require('../client/node_modules/jsdom');
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: 'http://localhost' });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'DOMParser', 'getComputedStyle', 'ShadowRoot', 'SVGElement']) Object.defineProperty(global, key, { configurable: true, value: dom.window[key] });
global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
global.IS_REACT_ACT_ENVIRONMENT = true;
global.ResizeObserver = window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
window.Range.prototype.getClientRects = () => [];
window.Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 });
window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
const React = require('../client/node_modules/react');
const { createRoot } = require('../client/node_modules/react-dom/client');
const { Editor, EditorContent, useEditor } = require('../client/node_modules/@tiptap/react');
const { reportParagraphExtensions } = require('../client/src/components/ReportEditor/reportParagraphModel.ts');
const { prepareCrossTextFormat } = require('../client/src/components/ReportEditor/reportCrossSelectionModel.ts');
const { default: CrossSelection, useReportCrossText, ReportCrossFigure } = require('../client/src/components/ReportEditor/ReportCrossSelection.tsx');
const { applyReportTableFont, reportFontStyle, reportTableFontValues, reportStyleFontValues } = require('../shared/report-bulk-font.ts');
const { useEditorHistory } = require('../client/src/hooks/useEditorHistory.ts');
const { encodeReportRichDocument: encode, readReportRichDocument: read, reportRichPlainText, richDocumentToTypst } = require('../shared/report-rich-document.ts');
const initial = encode({ type: 'doc', content: [
  { type: 'paragraph', content: [{ type: 'text', text: 'A  B　C' }] },
  { type: 'reportSpacer', attrs: { height: '0.8cm' } },
  { type: 'paragraph' },
  { type: 'paragraph', content: [{ type: 'text', text: '编制：  张三' }] },
] });
const root = createRoot(document.getElementById('root'));
const editors = [];
let values, update, commits = 0, queue;
function Text({ index, value, write }) {
  const editor = useEditor({ extensions: reportParagraphExtensions(), content: read(value), immediatelyRender: false });
  useReportCrossText(editor, write);
  React.useEffect(() => { if (editor) { editors[index] = editor; editor.commands.setContent(read(value), { emitUpdate: false }); } }, [editor, value]);
  return React.createElement(EditorContent, { editor });
}
function Harness() {
  const [doc, setDoc] = React.useState([initial, encode({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '项目  二' }] }] })]);
  const [host, setHost] = React.useState(null);
  values = doc; update = setDoc;
  return React.createElement(CrossSelection, { host, enabled: true, revision: doc, onActive() {}, batch: commit => {
    queue = doc.slice(); commit(); setDoc(queue); commits++;
  } }, React.createElement('div', { className: 'report-document-toolbar', ref: setHost }),
  React.createElement('div', { className: 'report-document-paper' }, doc.map((value, index) => React.createElement(Text, { key: index, index, value, write: v => { queue[index] = v; } }))));
}
const settle = () => React.act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });
const press = async (key, options = {}) => {
  const event = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  await React.act(async () => editors[0].view.dom.dispatchEvent(event)); return event;
};
const click = async text => {
  const button = [...document.querySelectorAll('.report-cross-tools button')].find(b => b.textContent === text);
  assert.ok(button, text); await React.act(async () => button.click()); await settle();
};
let mixedHistory, mixedQueue;
function MixedHarness() {
  const history = useEditorHistory({ text: [initial, initial], table: { id: 't', type: 'free_grid', free_table: { columns: [{ id: 'c', label: 'C' }], rows: [{ id: 'r' }], cells: { 'r::c': '8' } } }, image: {} });
  mixedHistory = history;
  const doc = history.value;
  const [host, setHost] = React.useState(null);
  return React.createElement(CrossSelection, { host, enabled: true, revision: doc, onActive() {}, batch: commit => {
    mixedQueue = structuredClone(doc); commit(); history.setValueTransaction(mixedQueue); return JSON.stringify(mixedQueue) !== JSON.stringify(doc);
  } }, React.createElement('div', { className: 'report-document-toolbar', ref: setHost }), React.createElement('div', { className: 'report-document-paper' },
    React.createElement(Text, { index: 0, value: doc.text[0], write: v => { mixedQueue.text[0] = v; } }),
    React.createElement(ReportCrossFigure, { kind: 'table', snapshot: JSON.stringify(doc.table), values: reportTableFontValues(doc.table), prepare: patch => () => applyReportTableFont(mixedQueue.table, patch) }, React.createElement('table', null, React.createElement('tbody', null, React.createElement('tr', null, React.createElement('td', null, '8'))))),
    React.createElement(ReportCrossFigure, { kind: 'image', snapshot: JSON.stringify(doc.image), values: [reportStyleFontValues(doc.image)], prepare: patch => () => { mixedQueue.image = { ...mixedQueue.image, ...reportFontStyle(patch) }; } }, React.createElement('span', null, '图片标题')),
    React.createElement(Text, { index: 1, value: doc.text[1], write: v => { mixedQueue.text[1] = v; } })));
}
(async () => {
  let editor;
  try {
    editor = new Editor({ extensions: reportParagraphExtensions(), content: read(initial) });
    const before = editor.state.doc;
    const partial = prepareCrossTextFormat(editor, 2, 5, { font: 'Times New Roman', fontSize: 14, bold: true, spaceAfter: 9 });
    assert.equal(editor.state.doc, before, 'preparation must not mutate the source editor');
    assert.equal(reportRichPlainText(partial), reportRichPlainText(initial));
    assert.deepEqual(read(partial).content.slice(1), read(initial).content.slice(1), 'spacer, blank and unselected paragraphs remain byte-equivalent');
    const texts = read(partial).content[0].content;
    assert.equal(texts[0].text, 'A'); assert.equal(texts[0].marks, undefined);
    assert.equal(texts[1].text, '  B'); assert.ok(texts[1].marks.some(m => m.attrs?.font === 'Times New Roman'));
    assert.ok(richDocumentToTypst(read(partial)).includes('font: ("Times New Roman", "Arial")'));
    assert.equal(prepareCrossTextFormat(editor, 1, 4, { font: 'unknown);#panic()' }), initial, 'invalid font cannot inject Typst');
    assert.throws(() => prepareCrossTextFormat(editor, 0, 99999, { bold: true }));
    await React.act(async () => root.render(React.createElement(Harness))); await settle();
    const original = values.slice();
    assert.equal((await press('a', { ctrlKey: true })).defaultPrevented, true);
    assert.ok(editors.every(e => e.view.dom.querySelector('.report-cross-selected')));
    assert.deepEqual(values, original, 'selecting must not write the document');
    assert.equal((await press('Delete')).defaultPrevented, true);
    assert.deepEqual(values, original);
    await click('B'); assert.equal(commits, 1);
    assert.ok(values.every(value => read(value).content[0].content.every(n => n.marks.some(m => m.type === 'bold'))));
    assert.equal(reportRichPlainText(values[0]), reportRichPlainText(original[0]));
    await click('I'); assert.equal(commits, 2, 'selection survives first formatting and allows a second operation');
    assert.ok(values.every(value => read(value).content[0].content.every(n => n.marks.some(m => m.type === 'italic'))));
    await press('Escape'); assert.equal(document.querySelector('.report-cross-tools'), null);
    await press('a', { metaKey: true });
    await React.act(async () => update(original)); await settle();
    assert.equal(document.querySelector('.report-cross-tools'), null, 'external undo/reload invalidates offsets');
    // Forward and reverse cross-editor drag with exact first/last offsets.
    editors[0].view.posAtCoords = () => ({ pos: 2 }); editors[1].view.posAtCoords = () => ({ pos: 4 });
    const pointer = async (type, target, options) => React.act(async () => target.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, ...options })));
    await pointer('pointerdown', editors[0].view.dom);
    document.elementFromPoint = () => editors[1].view.dom;
    await pointer('pointermove', editors[1].view.dom);
    await pointer('pointerup', editors[1].view.dom);
    await click('B');
    assert.equal(read(values[0]).content[0].content[0].text, 'A');
    assert.equal(read(values[0]).content[0].content[0].marks, undefined, 'first unselected character stays unchanged');
    assert.equal(read(values[1]).content[0].content.at(-1).marks, undefined, 'last unselected character stays unchanged');
    await press('Escape');
    await pointer('pointerdown', editors[1].view.dom);
    document.elementFromPoint = () => editors[0].view.dom;
    await pointer('pointermove', editors[0].view.dom); await pointer('pointerup', editors[0].view.dom);
    await click('I');
    assert.equal(read(values[0]).content[0].content[0].marks, undefined);
    assert.equal(read(values[1]).content[0].content.at(-1).marks, undefined);
    const committed = commits;
    await React.act(async () => editors[1].commands.insertContent('external'));
    await click('B');
    assert.equal(commits, committed, 'one stale target rejects the entire operation before any callback');
    await React.act(async () => root.render(React.createElement(MixedHarness))); await settle();
    const mixedOriginal = structuredClone(mixedHistory.value);
    await press('a', { ctrlKey: true });
    assert.equal(document.querySelectorAll('[data-cross-selected]').length, 2, 'full selection includes table and image title');
    assert.ok(document.querySelector('[role="status"]').textContent.includes('1 张表格'));
    assert.equal(document.querySelector('[aria-label="跨区行距"]').disabled, true, 'mixed spacing cannot rewrite unrelated block geometry');
    await click('仅选正文');
    assert.equal(document.querySelectorAll('[data-cross-selected]').length, 0);
    assert.equal(document.querySelector('[aria-label="跨区行距"]').disabled, false);
    assert.deepEqual(mixedHistory.value, mixedOriginal, 'scope controls never write the document');
    await press('a', { ctrlKey: true });
    await click('B');
    assert.equal(mixedHistory.value.table.table_style.body_bold, true);
    assert.equal(mixedHistory.value.image.weight, 'bold');
    assert.deepEqual(mixedHistory.value.table.free_table, mixedOriginal.table.free_table);
    await press('i', { ctrlKey: true }); await settle();
    assert.equal(mixedHistory.value.image.italic, true);
    assert.equal(mixedHistory.value.table.table_style.italic, true);
    await React.act(async () => mixedHistory.undo()); await settle();
    assert.equal(mixedHistory.value.table.table_style.italic, undefined);
    assert.equal(mixedHistory.value.image.italic, undefined);
    await React.act(async () => mixedHistory.undo()); await settle();
    assert.deepEqual(mixedHistory.value, mixedOriginal, 'one undo restores every part of each mixed batch');
    await press('a', { ctrlKey: true });
    await React.act(async () => document.querySelector('[aria-label="跨区字号"]').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    assert.equal(document.querySelectorAll('[data-cross-selected]').length, 0, 'Escape works while a toolbar number input owns focus');
    console.log('Cross selection: partial/reverse drag, Ctrl/Cmd+A, sequential atomic formatting, whitespace/spacer preservation, invalid fonts, delete protection and external revision invalidation passed');
  } finally {
    editor?.destroy();
    await React.act(async () => { root.unmount(); await new Promise(resolve => setTimeout(resolve, 3500)); require('../client/node_modules/antd').message.destroy(); });
    dom.window.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
