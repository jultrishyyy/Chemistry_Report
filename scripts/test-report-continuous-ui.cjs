// React integration in jsdom; real browser pagination/IME still requires manual QA.
const assert = require('node:assert/strict');
const { JSDOM } = require('../client/node_modules/jsdom');
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: 'http://localhost' });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'DOMParser', 'getComputedStyle', 'ShadowRoot', 'SVGElement']) {
  Object.defineProperty(global, key, { configurable: true, value: dom.window[key] });
}
global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
global.IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no layout observer. Menu behavior is tested here, not its positioning.
global.ResizeObserver = window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
// ProseMirror scroll commands need Range geometry; jsdom does not lay out text.
window.Range.prototype.getClientRects = () => [];
window.Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 });
window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
const React = require('../client/node_modules/react');
const { createRoot } = require('../client/node_modules/react-dom/client');
const ReportContinuousText = require('../client/src/components/ReportEditor/ReportContinuousText.tsx').default;
const ReportParagraphEditor = require('../client/src/components/ReportEditor/ReportParagraphEditor.tsx').default;
const ReportCellTextArea = require('../client/src/components/ReportEditor/ReportCellTextArea.tsx').default;
const { encodeReportRichDocument, readReportRichDocument } = require('../shared/report-rich-document.ts');
const { deleteBlankBesideFigure } = require('../shared/report-blank-boundary.ts');
const { ReportInsertionContext } = require('../client/src/components/ReportEditor/ReportInsertionContext.ts');
const { ReportToolbarContext, isReportToolbarOverlay, retainsReportTextSelection } = require('../client/src/components/ReportEditor/ReportToolbarContext.ts');
const { default: ReportPaperViewport, reportPaperScale } = require('../client/src/components/ReportEditor/ReportPaperViewport.tsx');
const ReportFigureEdges = require('../client/src/components/ReportEditor/ReportFigureEdges.tsx').default;
const ImageListEditor = require('../client/src/components/ImageListEditor.tsx').default;
const ReportImagePreview = require('../client/src/components/ReportEditor/ReportImagePreview.tsx').default;
const ReportImageLayoutToolbar = require('../client/src/components/ReportEditor/ReportImageLayoutToolbar.tsx').default;
const ReportImageManagerPopover = require('../client/src/components/ReportEditor/ReportImageManagerPopover.tsx').default;
const { reportFigureClickTarget } = require('../client/src/components/ReportEditor/reportFigureClick.ts');
const { default: ReportFigureTools, ReportFigureToolsContext } = require('../client/src/components/ReportEditor/ReportFigureTools.tsx');
const { canEditContinuousText, continuousTextValue } = require('../shared/report-continuous-text.ts');
const { reportTextRuns, updateReportTextRun } = require('../shared/report-text-runs.ts');
const { REPORT_SEED_SNAPSHOTS } = require('../shared/seed-report-templates.data.ts');
const { resolveReportFieldValue } = require('../shared/typst-generator.ts');
const group = REPORT_SEED_SNAPSHOTS.find(t => t.template_kind === 'cover').field_definitions.find(g => g.id === 'cg_meta');
assert.ok(canEditContinuousText(group), 'standard basic-info section must actually use the new editor');
const resolve = field => resolveReportFieldValue(field, {});
let changes = 0;
const props = { group, resolve, readOnly: false, font: '', size: 10.5, onChange: () => changes++, onFocus() {}, onReset() {}, onInsertAfter() {} };
const root = createRoot(document.getElementById('root'));
(async () => {
  try {
    await React.act(async () => { root.render(React.createElement(ReportContinuousText, props)); });
    assert.equal(document.querySelectorAll('[role="textbox"]').length, 1);
    assert.equal(document.querySelectorAll('input, textarea').length, 0);
    assert.ok(document.querySelector('[role="textbox"]').textContent.includes('单位名称：'));
    assert.ok(document.querySelector('[role="textbox"]').textContent.includes('以下样品信息由委托方提供'));
    assert.ok(document.querySelector('.report-text-spacer'));
    assert.equal(changes, 0, 'opening must not save a conversion');
    let focusCalls = 0;
    await React.act(async () => { root.render(React.createElement(ReportContinuousText, { ...props, onFocus: () => focusCalls++ })); });
    const activeBody = document.querySelector('[role="textbox"]');
    await React.act(async () => { activeBody.click(); activeBody.click(); });
    assert.equal(focusCalls, 2, 'clicking already-active prose must request PDF focus again');
    await React.act(async () => { document.querySelector('.report-paragraph-tools').click(); });
    assert.equal(focusCalls, 2, 'toolbar clicks must not request another PDF jump');
    assert.equal(group.report_document, undefined);
    let inserted;
    await React.act(async () => { root.render(React.createElement(ReportContinuousText, { ...props, onInsert: (kind, value, split) => { inserted = { kind, value, split }; } })); });
    const insertButton = [...document.querySelectorAll('button')].find(button => button.textContent === '插入表格');
    assert.ok(insertButton);
    await React.act(async () => { insertButton.click(); });
    assert.equal(inserted.kind, 'table');
    assert.equal(inserted.value, continuousTextValue(group, resolve), 'stale-content guard compares the original model, not editor-normalized text nodes');
    assert.ok(inserted.split.after || inserted.split.before);
    const restored = { ...group, report_document: { version: 1, value: continuousTextValue(group, () => '重开内容') } };
    await React.act(async () => { root.render(React.createElement(ReportContinuousText, { ...props, group: restored })); });
    assert.ok(document.querySelector('[role="textbox"]').textContent.includes('重开内容'));
    assert.ok(!document.body.textContent.includes('恢复本段'));
    assert.equal(document.querySelector('[aria-label="正文编辑帮助"]'), null);
    assert.equal(document.querySelector('.report-continuous-actions'), null, 'removed actions must not leave a blank container');
    assert.equal(changes, 0, 'external restore must not emit an edit');
    await React.act(async () => { root.render(React.createElement(ReportContinuousText, { ...props, group: restored, readOnly: true })); });
    assert.equal(document.querySelectorAll('[contenteditable="true"], button').length, 0);
    assert.ok(document.body.textContent.includes('重开内容'));
    const directions = [];
    await React.act(async () => { root.render(React.createElement(ReportParagraphEditor, {
      value: '正文', onChange() {}, onBoundary: direction => { directions.push(direction); return true; },
    })); });
    const textbox = document.querySelector('[role="textbox"]');
    await React.act(async () => { textbox.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })); });
    assert.deepEqual(directions, [-1]);
    await React.act(async () => { textbox.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true, cancelable: true })); });
    assert.deepEqual(directions, [-1], 'selection extension must not jump to a figure');
    await React.act(async () => { root.render(React.createElement(ReportParagraphEditor, {
      value: '正文', onChange() {}, onBoundary: direction => { directions.push(direction); return true; },
      focusRequest: { token: 1, edge: 'end' },
    })); });
    await React.act(async () => { textbox.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })); });
    assert.deepEqual(directions, [-1, 1], 'focus requests must place the real editor selection at the requested end');
    await React.act(async () => { textbox.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })); });
    assert.deepEqual(directions, [-1, 1, 1], 'down at the document end must navigate to the next block');
    await React.act(async () => { textbox.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true, cancelable: true })); });
    assert.deepEqual(directions, [-1, 1, 1], 'shift-selection must never become block navigation');
    let formattedValue;
    await React.act(async () => { root.render(React.createElement(ReportParagraphEditor, {
      value: '正文', onChange: value => { formattedValue = value; },
    })); });
    await React.act(async () => { textbox.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true })); });
    await React.act(async () => { document.querySelector('[aria-label="正文字号"]').click(); });
    const sizeItem = [...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent.includes('14 pt'));
    assert.ok(sizeItem, 'font-size dropdown must open');
    await React.act(async () => { sizeItem.click(); });
    assert.ok(formattedValue?.includes('"fontSize":14'), 'dropdown must apply size to the retained text selection');
    assert.ok(textbox.innerHTML.includes('14pt'));
    await React.act(async () => { document.querySelector('[aria-label="正文颜色"]').click(); });
    const redItem = [...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent === '红色');
    assert.ok(redItem);
    await React.act(async () => { redItem.click(); });
    assert.ok(formattedValue.includes('"color":"#cf1322"'));
    assert.ok(formattedValue.includes('"fontSize":14'), 'changing color must retain the applied size');
    for (const font of ['Times New Roman', 'Arial']) {
      await React.act(async () => { document.querySelector('[aria-label="正文字体"]').click(); });
      const fontItem = [...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent === font);
      assert.ok(fontItem);
      await React.act(async () => { fontItem.click(); });
      assert.ok(formattedValue.includes(`"font":"${font}"`), 'local font changes must replace existing inline fonts, not only container styles');
      assert.ok(formattedValue.includes('"fontSize":14'));
      assert.ok(formattedValue.includes('"color":"#cf1322"'));
    }
    await React.act(async () => { document.querySelector('[aria-label="段落居中"]').click(); });
    assert.ok(formattedValue.includes('"textAlign":"center"'));
    let caretTarget, insertedFromToolbar, paragraphFromToolbar;
    await React.act(async () => { root.render(React.createElement(ReportInsertionContext.Provider, { value: target => { caretTarget = target; } },
      React.createElement(ReportParagraphEditor, { value: '前后', onChange: value => { paragraphFromToolbar = value; },
        onInsert: (kind, value, offset, split, options) => { insertedFromToolbar = { kind, value, split, options }; } })));
    });
    await React.act(async () => { document.querySelector('[role="textbox"]').focus(); });
    assert.ok(caretTarget, 'the document toolbar must receive the active caret target');
    await React.act(async () => { assert.equal(caretTarget.insert('paragraph'), true); });
    assert.ok(paragraphFromToolbar, 'unified insertion must change the active editor');
    await React.act(async () => { assert.equal(caretTarget.insert('image', { imageCount: 4 }), true); });
    assert.equal(insertedFromToolbar.kind, 'image');
    assert.equal(insertedFromToolbar.options.imageCount, 4, 'configured counts must travel with the retained caret target');
    assert.ok(insertedFromToolbar.split.before || insertedFromToolbar.split.after);
    await React.act(async () => { root.render(React.createElement('div', null, '已离开编辑器')); });
    assert.equal(caretTarget.insert('table'), false, 'a stale editor must never receive document insertions');
    const toolbarChanges = [];
    function SharedToolbarHarness({ second = true }) {
      const [host, setHost] = React.useState(null);
      const [activeId, activate] = React.useState(null);
      return React.createElement(ReportToolbarContext.Provider, { value: { host, activeId, activate } },
        React.createElement('div', { id: 'shared-toolbar', ref: setHost }),
        React.createElement('div', { id: 'shared-body', onClick: event => { if (event.target === event.currentTarget && !retainsReportTextSelection(event.target)) activate(null); }, onFocusCapture: event => { if (!isReportToolbarOverlay(event.target) && !retainsReportTextSelection(event.target) && !event.target.closest('.report-visual-paragraph, .report-paragraph-tools')) activate(null); } },
          React.createElement(ReportParagraphEditor, { key: 'one', value: '第一段', onChange: value => toolbarChanges.push(['one', value]), onInsert() {} }),
          second && React.createElement(ReportParagraphEditor, { key: 'two', value: '第二段', onChange: value => toolbarChanges.push(['two', value]), onInsert() {} })));
    }
    await React.act(async () => { root.render(React.createElement(SharedToolbarHarness)); });
    assert.equal(document.querySelectorAll('.report-paragraph-tools').length, 0, 'inactive prose must not show repeated tools');
    const sharedEditors = document.querySelectorAll('[role="textbox"]');
    await React.act(async () => { sharedEditors[1].focus(); });
    assert.equal(document.querySelectorAll('#shared-toolbar .report-paragraph-tools').length, 1);
    assert.equal(document.querySelectorAll('#shared-body button').length, 0, 'paragraph bodies must contain no local tools');
    assert.ok(!document.getElementById('shared-toolbar').textContent.includes('插入图片'), 'shared mode uses the existing document insertion menu');
    await React.act(async () => { sharedEditors[1].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true })); });
    await React.act(async () => { document.querySelector('[aria-label="正文加粗"]').click(); });
    assert.equal(toolbarChanges.at(-1)[0], 'two');
    assert.ok(toolbarChanges.at(-1)[1].includes('"bold"'));
    assert.ok(!toolbarChanges.some(([id]) => id === 'one'), 'formatting cannot change a different paragraph');
    await React.act(async () => { document.querySelector('[aria-label="正文字号"]').click(); });
    const sharedSize = [...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent.includes('18 pt'));
    assert.ok(sharedSize);
    await React.act(async () => { sharedSize.click(); });
    assert.equal(toolbarChanges.at(-1)[0], 'two');
    assert.ok(toolbarChanges.at(-1)[1].includes('"fontSize":18'), 'portaled dropdown must retain the target selection');
    await React.act(async () => { [...document.querySelectorAll('#shared-toolbar button')].find(button => button.textContent.includes('段后')).click(); });
    const spacingInput = document.querySelector('[aria-label="所选段落段后"]');
    assert.ok(spacingInput);
    await React.act(async () => {
      spacingInput.focus();
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(spacingInput, '12');
      spacingInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    assert.equal(document.querySelectorAll('#shared-toolbar .report-paragraph-tools').length, 1, 'popover focus must not unmount toolbar');
    assert.equal(spacingInput.closest('.report-paragraph-spacing-card').querySelector('button'), null, 'spacing updates need no apply/cancel buttons');
    assert.equal(document.activeElement, spacingInput, 'live updates must not steal numeric-input focus');
    assert.equal(spacingInput.closest('.ant-input-number').style.width, '144px');
    assert.equal(toolbarChanges.at(-1)[0], 'two');
    assert.ok(toolbarChanges.at(-1)[1].includes('"spaceAfter":12'), 'spacing applies to retained text selection after input focus');
    for (const value of ['13', '14', '', '0']) {
      const count = toolbarChanges.length;
      await React.act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(spacingInput, value);
        spacingInput.dispatchEvent(new window.Event('input', { bubbles: true }));
      });
      if (!value) assert.equal(toolbarChanges.length, count, 'clearing input must not write zero');
      else assert.ok(toolbarChanges.at(-1)[1].includes(`"spaceAfter":${value}`), 'consecutive adjustments retain the original target');
      assert.equal(document.activeElement, spacingInput);
    }
    await React.act(async () => {
      const range = document.createRange(); range.selectNode(sharedEditors[1]);
      window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
      document.dispatchEvent(new window.Event('selectionchange'));
      document.getElementById('shared-body').click();
    });
    assert.equal(document.querySelectorAll('#shared-toolbar .report-paragraph-tools').length, 1, 'whole-line selection ending outside the editor must retain prose tools');
    for (const [label, value, attr] of [['段前', 8, 'spaceBefore'], ['行距', 0.8, 'lineGap']]) {
      await React.act(async () => { [...document.querySelectorAll('#shared-toolbar button')].find(button => button.textContent.includes(label)).click(); });
      const input = document.querySelector(`[aria-label="所选段落${label}"]`);
      await React.act(async () => {
        input.focus();
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, String(value));
        input.dispatchEvent(new window.Event('input', { bubbles: true }));
      });
      assert.ok(toolbarChanges.at(-1)[1].includes(`"${attr}":${value}`), `${label}: ${JSON.stringify(toolbarChanges.at(-1))}`);
      assert.equal(document.querySelectorAll('#shared-toolbar .report-paragraph-tools').length, 1);
    }
    window.getSelection().removeAllRanges();
    await React.act(async () => { sharedEditors[0].focus(); });
    assert.equal(document.querySelectorAll('.report-paragraph-tools').length, 1, 'switching editors must retain one toolbar');
    assert.equal(document.querySelectorAll('[role="textbox"]')[0], sharedEditors[0], 'switching tools must not remount prose');
    await React.act(async () => { sharedEditors[1].focus(); });
    await React.act(async () => { root.render(React.createElement(SharedToolbarHarness, { second: false })); });
    assert.equal(document.querySelectorAll('.report-paragraph-tools').length, 0, 'destroyed editors must not leave live controls');
    const mixed = { id: 'project', label: '', layout: 'vertical', fields: [
      { id: 'a', code: 'a', label: '方法', type: 'text', default_value: '试验方法' },
      { id: 'b', code: 'b', label: '条件', type: 'text', default_value: '试验条件' },
      { id: 'table', code: 'table', label: '数据表', type: 'report_result_table' },
      { id: 'c', code: 'c', label: '浸渍液温度', type: 'text', default_value: '22.2', unit: '℃',
        style: { font: 'Songti SC', tracking: '1pt', space_before: '12pt' } },
    ] };
    const mixedSnapshot = JSON.stringify(mixed);
    const renderRuns = () => root.render(React.createElement(React.Fragment, null, ...reportTextRuns(mixed).map(run =>
      React.createElement(ReportContinuousText, { key: run.ids[0], group: run.group, resolve, readOnly: false,
        font: '', size: 10.5, onFocus() {}, onReset() {}, onChange(value) { updateReportTextRun(mixed, run.ids, value); } }))));
    await React.act(async () => { renderRuns(); });
    assert.equal(document.querySelectorAll('[role="textbox"]').length, 2, 'text before/after a table uses two prose editors');
    assert.equal(document.querySelectorAll('input, textarea').length, 0, 'source labels and values must not become separate inputs');
    assert.ok(document.querySelectorAll('[role="textbox"]')[1].textContent.includes('浸渍液温度：22.2 ℃'), 'a unit-bearing field must be editable prose, not a label/value form');
    const specialSection = document.querySelectorAll('.report-continuous-text')[1];
    assert.equal(specialSection.style.letterSpacing, '1pt');
    assert.equal(specialSection.style.marginTop, '12pt');
    assert.equal(JSON.stringify(mixed), mixedSnapshot, 'opening a mixed project must not write a conversion');
    const beforeEditor = document.querySelector('[role="textbox"]');
    updateReportTextRun(mixed, ['a', 'b'], continuousTextValue(reportTextRuns(mixed)[0].group, () => '修改后的内容'));
    await React.act(async () => { renderRuns(); });
    assert.equal(document.querySelector('[role="textbox"]'), beforeEditor, 'first edit must retain the editor DOM, not remount and lose focus');
    assert.ok(beforeEditor.textContent.includes('修改后的内容'));
    assert.equal(mixed.fields.find(f => f.id === 'table').type, 'report_result_table');
    assert.equal(reportPaperScale('fit', 1000, 700), 1);
    assert.ok(reportPaperScale('fit', 350, 700) < 0.5);
    assert.equal(reportPaperScale(1.5, 350, 700), 1.5, 'manual zoom must not change on viewport resize');
    assert.equal(reportPaperScale('fit', 0, 700), 1, 'hidden/unmeasured viewport must have a safe initial scale');
    const previousWidth = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'clientWidth');
    let viewportWidth = 600;
    Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return this.classList.contains('report-paper-scroll') ? viewportWidth : 0; } });
    try {
      await React.act(async () => { root.render(React.createElement(ReportPaperViewport, { contentWidthPt: 480 },
        React.createElement('div', { className: 'report-document-paper' }, React.createElement(ReportParagraphEditor, { value: '缩放正文', onChange() {} })))); });
      const zoomPaper = document.querySelector('.report-paper-scaled');
      const fixedWidth = zoomPaper.style.width, oldZoom = Number(zoomPaper.style.zoom);
      const stableBody = document.querySelector('[role="textbox"]');
      await React.act(async () => { stableBody.focus(); });
      viewportWidth = 300;
      await React.act(async () => { window.dispatchEvent(new window.Event('resize')); });
      assert.equal(zoomPaper.style.width, fixedWidth, 'fit must scale the page, not reflow its physical width');
      assert.ok(Number(zoomPaper.style.zoom) < oldZoom);
      assert.equal(document.querySelector('[role="textbox"]'), stableBody, 'resize must not recreate the editor');
      assert.equal(document.activeElement, stableBody, 'resize must retain editor focus');
      assert.equal(document.querySelector('[aria-label="报告编辑缩放"]'), null, 'no user-facing zoom selector remains');
      assert.equal(document.querySelector('.report-paper-zoom-tools'), null, 'automatic fit must not occupy a control row');
      await React.act(async () => { root.render(null); });
    } finally {
      if (previousWidth) Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', previousWidth);
      else delete window.HTMLElement.prototype.clientWidth;
    }
    const edgeDirections = []; let parentSelections = 0;
    let applied = 0;
    await React.act(async () => { root.render(React.createElement(ReportParagraphEditor, {
      value: '前文后文', onChange() {}, focusRequest: { token: 99, position: 3, onApplied: () => applied++ },
    })); });
    await React.act(async () => { await new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))); });
    const focusedSelection = window.getSelection();
    assert.equal(focusedSelection.anchorNode?.textContent, '前文后文');
    assert.equal(focusedSelection.anchorOffset, 2, 'numeric focus must restore the original deletion boundary');
    assert.equal(applied, 1, 'focus requests must acknowledge application once');
    await React.act(async () => { root.render(React.createElement('div', { onClick: () => parentSelections++ },
      React.createElement(ReportFigureEdges, { onContinue: direction => edgeDirections.push(direction) }))); });
    await React.act(async () => { document.querySelector('[aria-label="在图表前输入文字"]').click(); document.querySelector('[aria-label="在图表后输入文字"]').click(); });
    assert.deepEqual(edgeDirections, [-1, 1]);
    assert.equal(parentSelections, 0, 'edge continuation must not also toggle figure selection');
    assert.equal(document.body.textContent, '', 'edge controls must not add repeated plus signs or explanatory text');
    const figureHost = document.createElement('div');
    document.body.appendChild(figureHost);
    let outerClicks = 0, toolClicks = 0, lostFigureFocus = 0;
    const figureTools = label => React.createElement(ReportFigureToolsContext.Provider, { value: figureHost },
      React.createElement('div', { id: 'figure-source', onClick: () => outerClicks++,
        onFocusCapture: event => { if (!isReportToolbarOverlay(event.target)) lostFigureFocus++; } },
        React.createElement(ReportFigureTools, null,
          React.createElement('input', { 'aria-label': '图表标题', defaultValue: label }),
          React.createElement('button', { onClick: () => toolClicks++ }, label))));
    await React.act(async () => { root.render(figureTools('表格工具')); });
    assert.equal(document.querySelector('#figure-source').textContent, '', 'tools do not occupy document space');
    assert.equal(figureHost.querySelectorAll('button').length, 1);
    const titleInput = figureHost.querySelector('input');
    const mouseDown = new window.MouseEvent('mousedown', { bubbles: true, cancelable: true });
    titleInput.dispatchEvent(mouseDown);
    assert.equal(mouseDown.defaultPrevented, false, 'title input must retain normal focus/selection');
    await React.act(async () => { titleInput.focus(); });
    assert.equal(document.activeElement, titleInput);
    assert.equal(lostFigureFocus, 0, 'focus on portaled image controls must not clear the selected figure');
    await React.act(async () => { figureHost.querySelector('button').click(); });
    assert.equal(toolClicks, 1);
    assert.equal(outerClicks, 0, 'portaled controls must not toggle the figure selection');
    await React.act(async () => { root.render(figureTools('图片工具')); });
    assert.equal(figureHost.querySelectorAll('button').length, 1);
    assert.equal(figureHost.textContent, '图片工具');
    await React.act(async () => { root.render(null); });
    assert.equal(figureHost.childNodes.length, 0, 'deselection/unmount removes stale tools');
    figureHost.remove();
    let imageItems = [{ id: 'a', title: '第一张' }, { id: 'b', title: '第二张' }], finishUpload;
    const blankDeletes = [];
    await React.act(async () => { root.render(React.createElement(ReportParagraphEditor, {
      value: '', onChange() {}, onDeleteBoundary: direction => { blankDeletes.push(direction); return true; },
    })); });
    const blankEditor = document.querySelector('[role="textbox"]');
    for (const key of ['Backspace', 'Delete']) await React.act(async () => {
      const event = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      blankEditor.dispatchEvent(event);
      assert.equal(event.defaultPrevented, true);
    });
    assert.deepEqual(blankDeletes, [-1, 1]);
    await React.act(async () => { blankEditor.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Backspace', ctrlKey: true, bubbles: true, cancelable: true })); });
    assert.deepEqual(blankDeletes, [-1, 1], 'modified shortcuts must not delete across editor boundaries');
    await React.act(async () => { root.render(React.createElement(ReportParagraphEditor, {
      value: '  \u00a0', onChange() {}, onDeleteBoundary: direction => { blankDeletes.push(direction); return true; },
    })); });
    await React.act(async () => {
      const event = new window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true });
      document.querySelector('[role="textbox"]').dispatchEvent(event);
      assert.equal(event.defaultPrevented, true, 'whitespace-only paragraph can return to the adjacent figure');
    });
    assert.deepEqual(blankDeletes, [-1, 1, 1]);
    const edgeValue = encodeReportRichDocument({ type: 'doc', content: [{ type: 'paragraph' }, { type: 'paragraph', content: [{ type: 'text', text: '备注：保留' }] }] });
    const edgeGroups = [{ id: 'g', label: '', layout: 'vertical', fields: [
      { id: 'table', code: 'table', label: '', type: 'report_result_table' },
      { id: 'note', code: 'note', type: 'text', rich: true, hide_label: true, label: '', binding: { source: 'literal', text: edgeValue } },
    ] }];
    let deletedFirstBlank = false;
    await React.act(async () => { root.render(React.createElement(ReportParagraphEditor, {
      value: edgeValue, onChange() {}, focusRequest: { token: 99, edge: 'start' },
      onDeleteBoundary: () => { deletedFirstBlank = deleteBlankBesideFigure(edgeGroups, 'g', 'table', 1, f => f.binding?.text || ''); return deletedFirstBlank; },
    })); });
    await React.act(async () => {
      const event = new window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true });
      document.querySelector('[role="textbox"]').dispatchEvent(event);
      assert.equal(event.defaultPrevented, true);
    });
    assert.equal(deletedFirstBlank, true, 'Delete at the first blank of blank+note must reach the figure boundary handler');
    assert.equal(readReportRichDocument(edgeGroups[0].fields[1].binding.text).content[0].content[0].text, '备注：保留');
    let cellChanges = 0;
    const renderCell = lineHeight => root.render(React.createElement(ReportCellTextArea, { value: 'line one\nline two', style: { lineHeight, fontSize: '16px' }, onChange: () => cellChanges++ }));
    await React.act(async () => { renderCell('20px'); });
    const cell = document.querySelector('textarea');
    Object.defineProperty(cell, 'scrollHeight', { configurable: true, get: () => parseFloat(cell.style.lineHeight) * 2 + 8 });
    await React.act(async () => { cell.focus(); renderCell('36px'); });
    assert.equal(document.querySelector('textarea'), cell, 'line-height changes must not remount the cell');
    assert.ok(parseFloat(cell.style.height) >= 80, 'unchanged text must remeasure when line height changes');
    assert.equal(document.activeElement, cell);
    assert.equal(cellChanges, 0, 'remeasuring cannot change cell data');
    const imageProps = () => ({ items: imageItems, reportMode: true, help: '旧版长说明',
      onCreate: () => ({ id: 'new', title: '新增图片' }), onChange: next => { imageItems = next; },
      onUpload: () => new Promise(resolve => { finishUpload = resolve; }) });
    await React.act(async () => { root.render(React.createElement(ImageListEditor, imageProps())); });
    assert.ok(!document.body.textContent.includes('旧版长说明'));
    assert.equal(document.querySelectorAll('[aria-label$="更多操作"]').length, 2);
    const fileInput = document.querySelector('input[type="file"]');
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [new window.File(['photo'], 'photo.png', { type: 'image/png' })] });
    await React.act(async () => { fileInput.dispatchEvent(new window.Event('change', { bubbles: true })); });
    assert.equal(typeof finishUpload, 'function');
    imageItems = [imageItems[1], { ...imageItems[0], title: '上传中改名', photo: { display_width_cm: 9 } }];
    await React.act(async () => { root.render(React.createElement(ImageListEditor, imageProps())); });
    await React.act(async () => { finishUpload({ url: '/uploaded.png' }); });
    assert.equal(imageItems[0].photo, undefined, 'reordering during upload must not overwrite another photo');
    assert.equal(imageItems[1].photo.url, '/uploaded.png');
    assert.equal(imageItems[1].photo.display_width_cm, 9);
    assert.equal(imageItems[1].title, '上传中改名');
    await React.act(async () => { root.render(React.createElement(ImageListEditor, imageProps())); });
    assert.equal(document.querySelector('img').style.objectFit, 'contain');
    assert.ok(document.body.textContent.includes('替换图片'));
    await React.act(async () => { [...document.querySelectorAll('button')].find(button => button.textContent.includes('添加图片')).click(); });
    assert.equal(imageItems.at(-1).id, 'new');
    await React.act(async () => { root.render(React.createElement(ImageListEditor, imageProps())); });
    const removedUploadInput = document.querySelector('input[type="file"]');
    Object.defineProperty(removedUploadInput, 'files', { configurable: true, value: [new window.File(['photo'], 'second.png', { type: 'image/png' })] });
    await React.act(async () => { removedUploadInput.dispatchEvent(new window.Event('change', { bubbles: true })); });
    imageItems = imageItems.filter(item => item.id !== 'b');
    await React.act(async () => { root.render(React.createElement(ImageListEditor, imageProps())); });
    const afterRemoval = JSON.stringify(imageItems);
    await React.act(async () => { finishUpload({ url: '/must-not-restore.png' }); });
    assert.equal(JSON.stringify(imageItems), afterRemoval, 'a removed upload target must not be resurrected');
    await React.act(async () => { root.render(React.createElement(ImageListEditor, { ...imageProps(), readOnly: true })); });
    assert.equal(document.querySelectorAll('input[type="file"]').length, 0);
    assert.equal(document.querySelectorAll('[aria-label$="更多操作"]').length, 0);
    let editedImageTitle;
    const imageModel = { title: '', cols: 1, width: 7, height: 6, items: [{ title: '原图题' }] };
    await React.act(async () => { root.render(React.createElement(ReportImagePreview, { model: imageModel, onTitleChange: (index, title) => { editedImageTitle = [index, title]; } })); });
    const imageTitle = document.querySelector('[aria-label="图片 1 标题"]');
    assert.ok(imageTitle);
    assert.equal(reportFigureClickTarget(imageTitle), 'control', 'editing a title retains native caret behavior');
    assert.equal(document.querySelectorAll('input[type="file"]').length, 0, 'paper preview must not turn into an upload card');
    imageTitle.textContent = '修改图题';
    await React.act(async () => { imageTitle.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true })); });
    assert.deepEqual(editedImageTitle, [0, '修改图题']);
    await React.act(async () => { root.render(React.createElement(ReportImagePreview, { model: imageModel })); });
    assert.equal(document.querySelectorAll('[contenteditable="true"]').length, 0);
    assert.equal(reportFigureClickTarget(document.querySelector('figcaption')), 'image', 'a readonly title selects the image instead of jumping to the next paragraph');
    assert.equal(reportFigureClickTarget(document.querySelector('.report-image-empty')), 'image', 'empty photo placeholders select the image too');
    const actualImage = document.createElement('img');
    document.querySelector('.report-image-preview figure').appendChild(actualImage);
    assert.equal(reportFigureClickTarget(actualImage), 'image');
    assert.equal(reportFigureClickTarget(document.querySelector('.report-image-preview figure')), 'image');
    assert.equal(reportFigureClickTarget(document.getElementById('root')), 'space', 'outside whitespace retains the existing adjacent-prose behavior');
    const imagePatches = [];
    let stylePatch;
    const toolbarProps = { value: { title_mode: 'shared', cols: 1, seamless: true },
      onChange: patch => imagePatches.push(patch), onTitleModeChange() {},
      onTitleStyleChange: patch => { stylePatch = patch; }, inheritedFont: 'Arial', inheritedSize: 10 };
    await React.act(async () => { root.render(React.createElement(ReportImageLayoutToolbar, toolbarProps)); });
    assert.equal(imagePatches.length, 0, 'showing image tools must not rewrite the document');
    assert.equal(document.querySelector('[aria-label="图片余图位置"]'), null, 'single-column images need no orphan-position control');
    assert.ok(document.body.textContent.includes('跨页重复标题'));
    assert.ok(!document.body.textContent.includes('图片版式'));
    assert.ok(!document.body.textContent.includes('默认字体'));
    const widthInput = document.querySelector('input[aria-label="图片宽"]');
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(widthInput, '9');
      widthInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    assert.deepEqual(imagePatches, [{ width_cm: 9 }], 'size edits apply immediately, without unrelated photo/title patches');
    await React.act(async () => { document.querySelector('[aria-label="图片标题加粗"]').click(); });
    assert.deepEqual(stylePatch, { weight: 'regular' });
    const fontControl = document.querySelector('[aria-label="图片标题字体"]');
    await React.act(async () => { (fontControl.matches('input') ? fontControl : fontControl.querySelector('input') || fontControl).dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true })); });
    const kaiTiOption = [...document.querySelectorAll('.ant-select-item-option')].find(option => option.textContent === '楷体');
    assert.ok(kaiTiOption, 'image font menu must be reachable');
    await React.act(async () => { kaiTiOption.click(); });
    assert.deepEqual(stylePatch, { font: 'KaiTi' });
    await React.act(async () => { root.render(React.createElement(ReportImageLayoutToolbar, { ...toolbarProps, value: { cols: 2, title_mode: 'per' } })); });
    assert.ok(document.querySelector('[aria-label="图片余图位置"]'));
    assert.ok(!document.body.textContent.includes('跨页重复标题'));
    await React.act(async () => { root.render(React.createElement(ReportImageManagerPopover, null, React.createElement('div', { style: { height: 2000 } }, '图片管理内容'))); });
    await React.act(async () => { [...document.querySelectorAll('button')].find(button => button.textContent.includes('管理图片')).click(); });
    const managerContent = document.querySelector('.report-image-manager-content');
    assert.ok(managerContent);
    assert.equal(managerContent.style.overflow, 'auto');
    const expectedBounds = document.createElement('div');
    expectedBounds.style.maxHeight = 'min(360px, calc(50dvh - 72px))';
    assert.equal(managerContent.style.maxHeight, expectedBounds.style.maxHeight);
    const managerContainer = managerContent.closest('.ant-popover-container, .ant-popover-inner');
    assert.ok(managerContainer.style.width.includes('560px'));
    assert.equal(managerContainer.style.boxSizing, 'border-box');
    await React.act(async () => { document.querySelector('[aria-label="关闭设置卡"]').click(); });
    console.log('Continuous section React UI: shared tools, blank deletion, image titles, direct image controls and stable upload target passed');
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
  }
// Ant Design's popup cache timers can outlive unmount in jsdom. Exit only after
// all assertions and the awaited root/window cleanup have finished.
})().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
