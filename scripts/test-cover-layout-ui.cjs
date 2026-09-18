// Layout interaction checks; jsdom does not validate real browser pagination.
const assert = require('node:assert/strict');
const { JSDOM } = require('../client/node_modules/jsdom');
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: 'http://localhost' });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLBodyElement', 'HTMLHtmlElement', 'Element', 'Node', 'MutationObserver', 'DOMParser', 'getComputedStyle', 'ShadowRoot', 'SVGElement']) {
  Object.defineProperty(global, key, { configurable: true, value: dom.window[key] });
}
global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
global.IS_REACT_ACT_ENVIRONMENT = true;
global.ResizeObserver = window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
window.Range.prototype.getClientRects = () => [];
window.Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 });
window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
require.extensions['.css'] = () => {};
const React = require('../client/node_modules/react');
const { createRoot } = require('../client/node_modules/react-dom/client');
const CoverEditor = require('../client/src/components/ReportEditor/CoverTemplateLayoutEditor.tsx').default;
const template = { name: '首页', version: 1, groups: [{ id: 'g', label: '', layout: 'vertical', fields: [
  { id: 'text', code: 'text', type: 'text', label: '', hide_label: true, binding: { source: 'literal', text: '保留  空格' } },
  { id: 'space', code: 'space', type: 'spacer', label: '', spacer_height: '1.2cm' },
  { id: 'customer', code: 'customer', type: 'text', label: '单位', label_width: 'none', binding: { source: 'order', key: 'customer_name' } },
  { id: 'logo', code: 'logo', type: 'image', label: 'Logo' },
  { id: 'fixedLogo', code: 'fixedLogo', type: 'static_content', static_kind: 'images', label: '固定标识', static_images: [{ id: 'asset', name: '标识', display_width_cm: 4 }] },
  { id: 'fixedTable', code: 'fixedTable', type: 'static_content', static_kind: 'table', label: '固定表格', static_table: { rows: [{ id: 'r1' }, { id: 'r2' }], columns: [{ id: 'c1', label: '' }, { id: 'c2', label: '' }], cells: { 'r1::c1': '固定文字' } } },
] }] };
let changes = 0, configured, caretInsertions = 0, blockInsertions = 0;
const props = { template, readOnly: false, resolve: () => '示例单位', onChange: () => changes++, onConfigure: (...args) => { configured = args; }, onFocus() {},
  onContinueFigure: () => 'text', onInsert: () => { blockInsertions++; }, onInsertAtText: () => { caretInsertions++; } };
const root = createRoot(document.getElementById('root'));
const click = async element => { assert.ok(element); await React.act(async () => element.click()); };
(async () => {
  const snapshot = JSON.stringify(template);
  await React.act(async () => root.render(React.createElement(CoverEditor, props)));
  assert.equal(document.querySelector('[contenteditable=true]').textContent, '保留  空格');
  assert.equal(document.querySelector('.cover-layout-spacer').style.height, '1.2cm');
  assert.equal(changes, 0, 'mount must not persist projected rich text');
  assert.ok(Math.abs(parseFloat(document.querySelector('.cover-layout-paper').style.width) - 17 * 72 / 2.54) < 0.01, 'paper uses the PDF content width instead of the available split pane width');
  await click(document.querySelector('.cover-binding-token'));
  assert.ok(document.querySelector('.ant-drawer'), 'mapped field opens its source editor');
  assert.equal(document.querySelector('[aria-label="动态字段名称"]').value, '单位');
  await click(document.querySelector('.ant-drawer-close'));
  await click([...document.querySelectorAll('button')].find(b => b.textContent.includes('Logo') && b.textContent.includes('配置')));
  assert.deepEqual(configured, ['field', 'logo']);
  await click(document.querySelector('[aria-label="固定图片"]'));
  assert.ok(document.querySelector('.report-document-toolbar [aria-label="Logo宽度"]'), 'image controls are in the shared toolbar');
  assert.equal(Number(document.querySelector('[aria-label="Logo宽度"]').value), 4);
  await click(document.querySelector('[aria-label="选择留白"]'));
  assert.equal(document.querySelector('[aria-label="留白高度"]').value, '1.2');
  assert.equal(document.querySelector('[aria-label="Logo宽度"]'), null);
  const cell = document.querySelector('.cover-static-table [data-grid-cell="0-0"]');
  assert.ok(cell, 'fixed table is rendered directly');
  await React.act(async () => cell.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0 })));
  await React.act(async () => document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true })));
  assert.ok(document.querySelector('.report-document-toolbar').textContent.includes('合并'));
  assert.ok(!document.querySelector('.cover-static-table').textContent.includes('整表列宽'), 'controls live above the paper');
  await click(document.querySelector('[aria-label="在图表后输入文字"]'));
  assert.ok(document.activeElement?.classList.contains('report-visual-paragraph'), 'edge click moves the caret into adjacent prose');
  await click([...document.querySelectorAll('button')].find(b => b.textContent === '插入 Logo / 图片'));
  assert.equal(caretInsertions, 1, 'ordinary prose uses the live caret insertion target');
  assert.equal(blockInsertions, 0, 'caret insertion must not also append a block');
  const axios = require('../client/node_modules/axios').default;
  const originalPost = axios.post;
  let uploadedForm, logoCalls = [];
  axios.post = async (_url, form) => { uploadedForm = form; return { data: { id: 'uploaded', rel_path: 'logo.png' } }; };
  const logoProps = { ...props, onInsertLogo: (...args) => { logoCalls.push(args); return 'newLogo'; } };
  await React.act(async () => root.render(React.createElement(CoverEditor, logoProps)));
  await click([...document.querySelectorAll('button')].find(b => b.textContent === '插入 Logo / 图片'));
  assert.equal(logoCalls.length, 0, 'opening or cancelling picker must not insert an empty block');
  const picker = document.querySelector('[aria-label="选择 Logo 图片"]');
  const png = new File(['png-test'], 'logo.png', { type: 'image/png' });
  Object.defineProperty(picker, 'files', { configurable: true, value: [png] });
  await React.act(async () => picker.dispatchEvent(new window.Event('change', { bubbles: true })));
  assert.equal(logoCalls.length, 1);
  assert.equal(logoCalls[0][2].rel_path, 'logo.png');
  assert.ok(logoCalls[0][3], 'capture the prose split before opening the picker');
  assert.equal(uploadedForm.get('file').type, 'image/png', 'do not flatten transparent PNG to JPEG');
  let finishUpload;
  axios.post = () => new Promise(resolve => { finishUpload = resolve; });
  await click([...document.querySelectorAll('button')].find(b => b.textContent === '插入 Logo / 图片'));
  await React.act(async () => picker.dispatchEvent(new window.Event('change', { bubbles: true })));
  await React.act(async () => root.render(React.createElement(CoverEditor, { ...logoProps, readOnly: true })));
  await React.act(async () => finishUpload({ data: { id: 'late', rel_path: 'late.png' } }));
  assert.equal(logoCalls.length, 1, 'losing edit permission during upload must not insert');
  axios.post = originalPost;
  await React.act(async () => root.render(React.createElement(CoverEditor, { ...props, readOnly: true })));
  assert.equal(document.querySelector('[contenteditable=true]'), null);
  assert.equal(document.querySelector('[aria-label="留白高度"]'), null);
  assert.equal(document.querySelector('.cover-static-table').disabled, true);
  assert.equal(changes, 0);
  assert.equal(JSON.stringify(template), snapshot);
  const { deleteCoverBlankParagraph } = require('../shared/cover-text-boundaries.ts');
  const { updateCoverField } = require('../shared/cover-template-editing.ts');
  const { encodeReportRichDocument } = require('../shared/report-rich-document.ts');
  const { REPORT_SEED_SNAPSHOTS } = require('../shared/seed-report-templates.data.ts');
  const seed = REPORT_SEED_SNAPSHOTS.find(t => t.template_kind === 'cover');
  const oldCover = { name: seed.name, version: 1, groups: structuredClone(seed.field_definitions), layout_options: structuredClone(seed.layout_options) };
  const oldSnapshot = JSON.stringify(oldCover);
  let legacyUpdate;
  await React.act(async () => root.render(React.createElement(CoverEditor, { ...props, template: oldCover,
    onChange: (g, f, change) => { legacyUpdate = updateCoverField(oldCover, g, f, change); },
  })));
  assert.equal(document.querySelectorAll('.cover-legacy-line.is-signature').length, 3, 'all original signature lines are visible on the document');
  assert.ok(!document.body.textContent.includes('查看版式配置'), 'legacy groups must not be replaced by a configuration button');
  assert.ok(document.querySelectorAll('[aria-label="编辑固定正文"]').length > 0, 'old fixed text is editable in place');
  assert.equal(legacyUpdate, undefined, 'opening old templates does not rewrite them');
  const legacyLabel = document.querySelector('[aria-label="编辑正文标签"]');
  await React.act(async () => legacyLabel.focus());
  assert.ok(document.querySelector('.cover-legacy-format-toolbar'), 'legacy label activates the common format toolbar');
  await click(document.querySelector('.cover-legacy-format-toolbar [aria-label="加粗"]'));
  assert.ok(legacyUpdate.groups.flatMap(g => g.fields).some(f => f.label_style?.weight === 'regular'));
  const boundValue = document.querySelector('.cover-legacy-line .cover-binding-token');
  await click(boundValue);
  assert.ok(document.querySelector('.cover-legacy-format-toolbar').textContent.includes('字段值'));
  await click(document.querySelector('.cover-legacy-format-toolbar [aria-label="加粗"]'));
  assert.ok(legacyUpdate.groups.flatMap(g => g.fields).some(f => f.value_style?.weight === 'bold' && f.binding?.source === 'report_meta'), 'formatting a value preserves its dynamic binding');
  const legacyText = document.querySelector('[aria-label="编辑固定正文"]');
  const originalLegacyText = legacyText.textContent;
  await React.act(async () => { legacyText.textContent = '  直接编辑旧正文  '; legacyText.dispatchEvent(new window.Event('input', { bubbles: true })); });
  assert.ok(legacyUpdate.groups.some(g => g.fields.some(f => f.binding?.text === '  直接编辑旧正文  ')));
  assert.equal(JSON.stringify(oldCover), oldSnapshot);
  await React.act(async () => root.render(React.createElement(CoverEditor, { ...props, template: legacyUpdate })));
  await React.act(async () => document.querySelector('[aria-label="编辑固定正文"]').focus());
  await React.act(async () => root.render(React.createElement(CoverEditor, { ...props, template: oldCover })));
  assert.equal(document.querySelector('[aria-label="编辑固定正文"]').textContent, originalLegacyText, 'undo/reset updates focused legacy text');
  await React.act(async () => root.render(React.createElement(CoverEditor, { ...props, template: oldCover, readOnly: true })));
  assert.equal(document.querySelector('[contenteditable="plaintext-only"]'), null, 'legacy direct text also respects readonly');
  const { commitCoverTextRun } = require('../shared/cover-text-runs.ts');
  const LegacyText = require('../client/src/components/ReportEditor/CoverLegacyText.tsx').default;
  let rangeTemplate;
  function RangeHarness() {
    const [value, setValue] = React.useState({ name: '选区', version: 1, groups: [{ id: 'g', label: '', layout: 'vertical', fields: [{ id: 'f', code: 'f', type: 'text', label: '标签', label_width: '8em', binding: { source: 'literal', text: 'ABCD' } }] }] });
    const [host, setHost] = React.useState(null);
    rangeTemplate = value;
    return React.createElement(React.Fragment, null, React.createElement('div', { ref: setHost }), React.createElement(LegacyText, { field: value.groups[0].fields[0], group: value.groups[0], readOnly: false, active: true, host, resolve: () => '', onConfigure() {}, onChange: change => setValue(updateCoverField(value, 'g', 'f', change)) }));
  }
  await React.act(async () => root.render(React.createElement(RangeHarness)));
  const partial = document.querySelector('[aria-label="编辑固定正文"]');
  await React.act(async () => {
    partial.focus(); const range = document.createRange();
    range.setStart(partial.firstChild.firstChild, 1); range.setEnd(partial.firstChild.firstChild, 3);
    window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
    partial.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
  });
  await click(document.querySelector('.cover-legacy-format-toolbar [aria-label="加粗"]'));
  assert.equal(rangeTemplate.groups[0].fields[0].cover_text_styles.value.spans[0].from, 1);
  assert.equal(rangeTemplate.groups[0].fields[0].cover_text_styles.value.spans[0].to, 3);
  assert.equal(partial.querySelector('[style*="bold"]').textContent, 'BC', 'only selected characters become bold');
  assert.equal(window.getSelection().toString(), 'BC', 'formatting retains the native selection');
  await click(document.querySelector('.cover-legacy-format-toolbar [aria-label="加粗"]'));
  assert.equal(rangeTemplate.groups[0].fields[0].cover_text_styles.value.spans[0].style.weight, 'regular', 'second click removes selected bold');
  const labelText = document.querySelector('[aria-label="编辑正文标签"]');
  await React.act(async () => {
    const range = document.createRange();
    range.setStart(labelText.firstChild.firstChild, 1);
    range.setEnd(partial.childNodes[1].firstChild, 1);
    window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
    partial.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
  });
  assert.equal(window.getSelection().toString(), '签：AB');
  await click(document.querySelector('.cover-legacy-format-toolbar [aria-label="加粗"]'));
  assert.equal(labelText.querySelector('[style*="bold"]').textContent, '签');
  assert.equal(window.getSelection().toString(), '签：AB', 'cross-part selection survives both DOM updates');
  assert.equal(rangeTemplate.groups[0].fields[0].cover_text_styles.label.spans[0].from, 1);
  assert.equal(rangeTemplate.groups[0].fields[0].binding.text, 'ABCD');
  await click(document.querySelector('.cover-legacy-format-toolbar [aria-label="斜体"]'));
  assert.equal(window.getSelection().toString(), '签：AB');
  assert.equal(rangeTemplate.groups[0].fields[0].cover_text_styles.label.spans[0].style.italic, true);
  assert.equal(rangeTemplate.groups[0].fields[0].cover_text_styles.value.spans[0].style.italic, true);
  const { restoreTextRange, textRange } = require('../client/src/components/ReportEditor/CoverLegacyText.tsx');
  const pressLegacy = async (element, key) => React.act(async () => {
    element.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
  await React.act(async () => {
    partial.focus(); restoreTextRange(partial, { text: 'ABCD', from: 0, to: 0 });
  });
  await pressLegacy(partial, 'ArrowLeft');
  assert.equal(document.activeElement, labelText, 'left at value start enters label');
  assert.equal(textRange(labelText).from, labelText.textContent.length);
  await pressLegacy(labelText, 'ArrowRight');
  assert.equal(document.activeElement, partial, 'right at label end enters value');
  await React.act(async () => restoreTextRange(partial, { text: 'ABCD', from: 4, to: 4 }));
  await pressLegacy(partial, ' ');
  await pressLegacy(partial, 'Enter');
  assert.equal(rangeTemplate.groups[0].fields[0].binding.text, 'ABCD \n', 'trailing space and newline preserved');
  assert.equal(textRange(partial).from, 6, 'caret retained after newline');
  await pressLegacy(partial, 'Backspace');
  await pressLegacy(partial, 'Backspace');
  assert.equal(rangeTemplate.groups[0].fields[0].binding.text, 'ABCD');
  await React.act(async () => restoreTextRange(partial, { text: 'ABCD', from: 0, to: 4 }));
  await pressLegacy(partial, ' ');
  await pressLegacy(partial, 'Backspace');
  assert.equal(rangeTemplate.groups[0].fields[0].binding.text, '');
  await pressLegacy(partial, 'Enter');
  assert.equal(rangeTemplate.groups[0].fields[0].binding.text, '\n', 'empty text remains editable');
  await React.act(async () => restoreTextRange(partial, { text: '\n', from: 0, to: 0 }));
  await pressLegacy(partial, 'Delete');
  assert.equal(rangeTemplate.groups[0].fields[0].binding.text, '');
  const { formatCoverSelection } = require('../shared/cover-template-editing.ts');
  const multiInitial = { name: '跨字段', version: 1, groups: ['g1', 'g2'].map((id, index) => ({ id, label: '', layout: 'vertical', fields: [
    { id, code: id, type: 'text', label: index ? 'CD' : 'AB', label_width: '8em', binding: { source: 'literal', text: index ? '456' : '123' } },
  ] })) };
  let multiValue, resetMulti, multiChanges = 0;
  function MultiHarness() {
    const [value, setValue] = React.useState(multiInitial);
    multiValue = value; resetMulti = setValue;
    return React.createElement(CoverEditor, { template: value, readOnly: false, resolve: () => '动态值', onFocus() {}, onConfigure() {},
      onChange: (g, f, change) => setValue(previous => updateCoverField(previous, g, f, change)),
      onFormatSelection: (targets, patch) => { multiChanges++; setValue(previous => formatCoverSelection(previous, targets, patch)); },
    });
  }
  await React.act(async () => root.render(React.createElement(MultiHarness)));
  const multiInputs = document.querySelectorAll('[aria-label="编辑固定正文"]');
  await React.act(async () => {
    multiInputs[0].focus(); const range = document.createRange();
    range.setStart(multiInputs[0].firstChild.firstChild, 1); range.setEnd(multiInputs[1].firstChild.firstChild, 2);
    window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
    multiInputs[1].dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
  });
  assert.ok(document.querySelector('[aria-label="跨字段加粗"]'), 'cross-group drag activates the shared selection toolbar');
  assert.equal(document.querySelector('.cover-legacy-format-toolbar'), null, 'last field toolbar must not remain active');
  const crossText = window.getSelection().toString();
  await click(document.querySelector('[aria-label="跨字段加粗"]'));
  assert.equal(multiChanges, 1, 'one format action commits once for all fields');
  assert.equal(multiValue.groups[0].fields[0].cover_text_styles.value.spans[0].from, 1);
  assert.equal(multiValue.groups[1].fields[0].cover_text_styles.value.spans[0].to, 2);
  assert.equal(multiValue.groups[1].fields[0].cover_text_styles.label.spans[0].style.weight, 'bold');
  assert.equal(window.getSelection().toString(), crossText, 'cross-field selection survives rendering');
  await click(document.querySelector('[aria-label="跨字段斜体"]'));
  assert.equal(multiValue.groups[0].fields[0].cover_text_styles.value.spans[0].style.italic, true);
  assert.equal(multiValue.groups[1].fields[0].cover_text_styles.value.spans[0].style.italic, true);
  await React.act(async () => resetMulti(multiInitial));
  assert.equal(multiInputs[0].querySelector('[style*="italic"]'), null, 'history restore refreshes all selected fields');
  await React.act(async () => {
    const dynamic = structuredClone(multiInitial);
    dynamic.groups[1].fields[0].binding = { source: 'order', key: 'customer_name' };
    resetMulti(dynamic);
  });
  await React.act(async () => {
    const token = document.querySelector('.cover-binding-token'), range = document.createRange();
    range.setStart(multiInputs[0].firstChild.firstChild, 1); range.setEnd(token.firstChild, 2);
    window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
    token.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
  });
  assert.ok(document.querySelector('.cover-multi-format-toolbar').textContent.includes('动态字段'));
  assert.equal(document.querySelector('[aria-label="跨字段加粗"]'), null, 'unsupported mixed selection cannot apply a partial batch');
  assert.equal(multiChanges, 2);
  assert.deepEqual(multiValue.groups[1].fields[0].binding, { source: 'order', key: 'customer_name' });
  await React.act(async () => {
    const range = document.createRange(); range.selectNodeContents(multiInputs[0]); range.collapse(true);
    window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
    multiInputs[0].dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
  });
  assert.equal(document.querySelector('.cover-multi-format-toolbar'), null, 'single-field click exits multi-selection');
  assert.ok(document.querySelector('.cover-legacy-format-toolbar'));
  await React.act(async () => {
    const spaced = structuredClone(multiInitial);
    spaced.layout_options = { theme_config: { margin_h: '3cm', line_gap: '8pt' } };
    spaced.groups[0].hide_title = true;
    spaced.groups[0].style = { block_spacing: '0pt', space_before: '5pt' };
    spaced.groups[1].label = '基本信息';
    spaced.groups[1].title_style = { font: 'Arial', size: '18pt', weight: 'regular', color: '#123456' };
    spaced.groups[0].fields[0].style = { space_before: '3', margin: { left: '12pt' } };
    resetMulti(spaced);
  });
  const spacedField = document.querySelector('[data-cover-field="g1"]');
  assert.equal(spacedField.style.marginBottom, '0pt');
  assert.equal(spacedField.style.paddingTop, '3pt');
  assert.equal(spacedField.style.paddingLeft, '12pt');
  assert.ok(Math.abs(parseFloat(document.querySelector('.cover-layout-paper').style.width) - 15 * 72 / 2.54) < 0.01, 'changing page margins updates content width without rewriting text');
  const hiddenSection = document.querySelector('[data-cover-section="g1"]');
  assert.equal(hiddenSection.style.marginBottom, '0pt', 'no fixed tail spacing on hidden sections');
  assert.equal(hiddenSection.querySelector('.cover-layout-group').style.paddingTop, '5pt');
  assert.equal(hiddenSection.querySelector('.cover-layout-section-title'), null);
  const shownTitle = document.querySelector('[data-cover-section="g2"] .cover-layout-section-title');
  assert.equal(shownTitle.textContent, '基本信息');
  assert.equal(shownTitle.style.fontSize, '18pt');
  assert.equal(shownTitle.style.fontWeight, 'normal');
  await React.act(async () => {
    const grid = structuredClone(multiInitial);
    grid.groups = [grid.groups[0]]; grid.groups[0].layout = 'two-col';
    grid.groups[0].style = { block_spacing: '0pt' };
    grid.groups[0].fields.push({ id: 'blank', code: 'blank', type: 'spacer', label: '', spacer_height: '3cm' },
      { id: 'right', code: 'right', type: 'text', label: '右侧', label_width: '20em', style: { align: 'right' }, binding: { source: 'literal', text: 'ABC' } });
    resetMulti(grid);
  });
  const gridChunks = document.querySelectorAll('.cover-layout-grid-chunk');
  assert.equal(gridChunks.length, 2);
  assert.equal(gridChunks[0].style.columnGap, '24pt');
  assert.equal(gridChunks[0].style.rowGap, '0pt');
  assert.equal(gridChunks[1].style.gridTemplateColumns, 'repeat(1, minmax(0, 1fr))');
  assert.equal(document.querySelector('[aria-label="选择留白"]'), null);
  assert.equal(multiValue.groups[0].fields[1].spacer_height, '3cm', 'grid projection does not remove stored spacers');
  assert.equal(document.querySelector('[data-cover-field="right"] .cover-legacy-line').style.paddingLeft, '0px', 'grid fields ignore vertical-only label width');
  const visualGroup = { id: 'visual', label: '', layout: 'vertical', style: { font: 'Arial', size: '20pt', weight: 'bold', color: '#123456' }, fields: [] };
  const visualField = { id: 'visual', code: 'visual', type: 'text', label: '温度', unit: '℃', label_width: '6em',
    style: { size: '0.5em', weight: 'regular' }, value_style: { size: '2em', color: '#ff0000', italic: true }, binding: { source: 'order', key: 'temperature' } };
  await React.act(async () => root.render(React.createElement(LegacyText, { field: visualField, group: visualGroup, theme: { label_weight: 'regular' }, readOnly: false, active: false, resolve: () => '22.2', onChange() {}, onConfigure() {} })));
  const visualLine = document.querySelector('.cover-legacy-line');
  assert.equal(visualLine.style.fontSize, '10pt', 'label width em uses the field font size');
  assert.equal(document.querySelector('.cover-binding-token').parentElement.style.fontSize, '20pt');
  assert.equal(document.querySelector('.cover-binding-token').parentElement.style.color, 'rgb(255, 0, 0)');
  const unit = document.querySelector('.cover-legacy-unit');
  assert.equal(unit.style.fontSize, '10pt', 'unit must not inherit the independent value size');
  assert.equal(unit.style.color, 'rgb(18, 52, 86)');
  assert.equal(unit.style.fontStyle, 'normal');
  assert.equal(unit.textContent, ' ℃');
  assert.equal(visualLine.style.paddingLeft, '60pt', 'fixed label width is the hanging indent at the field font size');
  assert.equal(visualLine.style.gridTemplateColumns, '', 'ordinary text must not align label and value in separate grid columns');
  for (const align of ['left', 'center', 'right']) {
    const alignedField = { ...visualField, style: { ...visualField.style, align }, binding: { source: 'literal', text: '第一行  保留空格\n第二行\n\n第四行' } };
    await React.act(async () => root.render(React.createElement(LegacyText, { field: alignedField, group: visualGroup, readOnly: false, active: false, resolve: () => '', onChange() {}, onConfigure() {} })));
    const alignedLine = document.querySelector('.cover-legacy-line');
    assert.equal(alignedLine.style.textAlign, align, 'alignment belongs to the complete paragraph');
    assert.equal(alignedLine.querySelector('[aria-label="编辑固定正文"]').textContent, alignedField.binding.text, 'layout cannot normalize spaces or explicit blank lines');
  }
  await React.act(async () => root.render(React.createElement(LegacyText, { field: { ...visualField, signature_line: true }, group: visualGroup, readOnly: false, active: false, resolve: () => '', onChange() {}, onConfigure() {} })));
  assert.equal(document.querySelector('.cover-legacy-line').style.paddingLeft, '', 'signature rows retain their original geometry');
  assert.equal(document.querySelector('.cover-legacy-line').style.gridTemplateColumns, 'max-content minmax(0, 1fr)');
  await React.act(async () => root.render(React.createElement(LegacyText, { field: { ...visualField, hide_label: true }, group: { ...visualGroup, layout: 'two-col' }, readOnly: false, active: false, resolve: () => '', onChange() {}, onConfigure() {} })));
  assert.equal(document.querySelector('.cover-legacy-label'), null);
  assert.equal(document.querySelector('.cover-legacy-unit'), null);
  assert.equal(document.querySelector('.cover-binding-token').textContent, '', 'empty hidden-label binding must not render its source label as a value');
  assert.equal(document.querySelector('.cover-binding-token').getAttribute('aria-label'), '温度', 'empty binding remains discoverable and configurable');
  const { startCoverBody } = require('../shared/cover-template-editing.ts');
  for (const withGroup of [false, true]) {
    const blank = { name: '空白', version: 1, groups: withGroup ? [{ id: 'empty', label: '', layout: 'vertical', hide_title: true, fields: [] }] : [] };
    let blankValue, blankReset, starts = 0;
    function BlankHarness() {
      const [value, setValue] = React.useState(blank);
      blankValue = value; blankReset = setValue;
      return React.createElement(CoverEditor, { template: value, readOnly: false, resolve: () => '', onFocus() {}, onConfigure() {},
        onChange: (g, f, change) => setValue(previous => updateCoverField(previous, g, f, change)),
        onStartBody: g => { starts++; const result = startCoverBody(value, g, 'new_group', 'new_body'); setValue(result.template); return result; },
      });
    }
    await React.act(async () => root.render(React.createElement(BlankHarness)));
    assert.equal(starts, 0, 'opening an empty template must not create content');
    assert.deepEqual(blankValue, blank);
    await click(document.querySelector('.cover-empty-body'));
    await React.act(async () => new Promise(resolve => setTimeout(resolve, 30)));
    const body = document.querySelector('[contenteditable=true]');
    assert.ok(body, 'blank page click creates a direct text editor');
    assert.equal(document.activeElement, body, 'caret moves into the new body automatically');
    assert.equal(starts, 1);
    await React.act(async () => body.editor.view.dispatch(body.editor.state.tr.insertText('新建正文  保留空格')));
    assert.ok(JSON.stringify(blankValue).includes('新建正文  保留空格'));
    const saved = JSON.parse(JSON.stringify(blankValue));
    await React.act(async () => blankReset(saved));
    assert.equal(document.querySelector('[contenteditable=true]').textContent, '新建正文  保留空格');
    await React.act(async () => blankReset(blank));
    assert.ok(document.querySelector('.cover-empty-body'), 'reset returns to a usable empty-page entry');
    await React.act(async () => root.render(React.createElement(CoverEditor, { template: blank, readOnly: true, resolve: () => '', onChange() {}, onFocus() {}, onConfigure() {}, onStartBody: () => { throw Error('readonly'); } })));
    assert.equal(document.querySelector('.cover-empty-body'), null, 'readonly cannot initialize editable content');
  }
  const { insertConfiguredCoverField } = require('../shared/cover-template-editing.ts');
  let addedTemplate, additionCount = 0;
  function AddFieldHarness() {
    const [value, setValue] = React.useState(multiInitial);
    addedTemplate = value;
    return React.createElement(CoverEditor, { template: value, readOnly: false, resolve: () => '', onChange() {}, onConfigure: (...args) => { configured = args; }, onFocus() {},
      onInsertConfiguredField: (g, after, field) => { additionCount++; setValue(previous => insertConfiguredCoverField(previous, g, after, field)); return field.id; },
    });
  }
  await React.act(async () => root.render(React.createElement(AddFieldHarness)));
  const beforeAdding = JSON.stringify(addedTemplate);
  await click([...document.querySelectorAll('button')].find(button => button.textContent === '添加字段'));
  assert.ok(document.querySelector('.ant-drawer-body').textContent.includes('字段类别'), 'addition reuses the original field category configuration');
  assert.ok(document.querySelector('.ant-drawer-body').textContent.includes('字段值'));
  assert.equal(additionCount, 0, 'opening the configuration must not insert a placeholder');
  await click([...document.querySelectorAll('.ant-drawer-footer button')].find(button => button.textContent.replace(/\s/g, '') === '取消'));
  assert.equal(JSON.stringify(addedTemplate), beforeAdding);
  await click([...document.querySelectorAll('button')].find(button => button.textContent === '添加字段'));
  const categorySelect = document.querySelector('.ant-drawer-body .ant-select');
  await React.act(async () => categorySelect.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true })));
  const dateOption = [...document.querySelectorAll('.ant-select-item-option')].find(option => option.textContent.includes('日期') && !option.textContent.includes('范围'));
  await click(dateOption);
  await click([...document.querySelectorAll('.ant-drawer-footer button')].find(button => button.textContent === '添加到正文'));
  assert.equal(additionCount, 1);
  assert.equal(addedTemplate.groups[0].fields.length, 2);
  assert.equal(addedTemplate.groups[0].fields[1].type, 'date');
  assert.equal(addedTemplate.groups[0].fields[1].label, '新字段');
  assert.equal(addedTemplate.groups[0].fields[1].cover_configured_field, true);
  await click([...document.querySelectorAll('.cover-layout-insert-tools button')].find(button => button.textContent === '字段设置'));
  assert.deepEqual(configured, ['field', addedTemplate.groups[0].fields[1].code], 'newly inserted field can reopen the full configuration immediately');
  let flowChanges = 0, flowValue;
  function FlowHarness() {
    const [value, setValue] = React.useState({ name: '连续正文', version: 1, groups: [{ id: 'g', label: '', layout: 'vertical', fields: [
      { id: 'one', code: 'one', type: 'text', label: '', hide_label: true, binding: { source: 'literal', text: '第一段  ' } },
      { id: 'two', code: 'two', type: 'text', label: '', hide_label: true, binding: { source: 'order', key: 'customer_name' } },
    ] }] });
    flowValue = value;
    return React.createElement(CoverEditor, { template: value, readOnly: false, resolve: () => '', onConfigure() {}, onFocus() {},
      onChange: (g, f, change) => { flowChanges++; setValue(updateCoverField(value, g, f, change)); },
      onChangeRun: (run, text) => { flowChanges++; setValue(commitCoverTextRun(value, run.groupId, run.ids, run.value, text)); },
    });
  }
  await React.act(async () => root.render(React.createElement(FlowHarness)));
  assert.equal(document.querySelectorAll('[contenteditable=true]').length, 1, 'adjacent text and mapping share one editor');
  assert.equal(flowChanges, 0, 'rendering continuous prose must not rewrite fields');
  const prose = document.querySelector('.report-visual-paragraph');
  const view = prose.editor.view;
  assert.equal(view.state.doc.childCount, 2);
  await React.act(async () => view.dispatch(view.state.tr.addMark(1, view.state.doc.content.size - 1, view.state.schema.marks.bold.create())));
  assert.equal(flowChanges, 1, 'cross-paragraph formatting commits once');
  assert.equal(flowValue.groups[0].fields.length, 1);
  assert.equal(flowValue.groups[0].fields[0].cover_source_fields.length, 2);
  assert.ok(flowValue.groups[0].fields[0].binding.text.includes('templateField'));
  assert.ok(flowValue.groups[0].fields[0].binding.text.includes('templateEmptyPolicy'), 'editing retains conditional empty visibility');
  assert.ok(flowValue.groups[0].fields[0].binding.text.includes('templateSpacing'), 'editing retains generated spacing provenance');
  assert.equal(document.querySelectorAll('[contenteditable=true]').length, 1, 'editor remains mounted after first change');
  await click(document.querySelector('.cover-binding-token'));
  assert.ok(document.querySelector('[aria-label="动态字段名称"]'), 'mapping configuration remains available in continuous prose');
  await click(document.querySelector('.ant-drawer-close'));
  let navChanges = 0, currentNav;
  function NavigationHarness() {
    const [value, setValue] = React.useState({ name: '首页', version: 1, groups: [{ id: 'g', layout: 'vertical', label: '', fields: [
      { id: 'before', code: 'before', type: 'text', label: '', hide_label: true, binding: { source: 'literal', text: '' } },
      { id: 'figure', code: 'figure', type: 'static_content', static_kind: 'images', label: '', static_images: [] },
      { id: 'after', code: 'after', type: 'text', label: '', hide_label: true, rich: true, binding: { source: 'literal', text: encodeReportRichDocument({ type: 'doc', content: [{ type: 'paragraph' }, { type: 'paragraph', content: [{ type: 'text', text: '保留备注' }] }] }) } },
    ] }] });
    currentNav = value;
    return React.createElement(CoverEditor, { template: value, readOnly: false, resolve: () => '', onConfigure() {}, onFocus() {},
      onContinueFigure: (_g, _f, direction) => direction === 1 ? 'after' : 'before',
      onChange: (g, f, change) => { navChanges++; setValue(updateCoverField(value, g, f, change)); },
      onDeleteBlank: (g, f, index, direction) => {
        const result = deleteCoverBlankParagraph(value, g, f, index, direction);
        if (result) { navChanges++; setValue(result.template); return result; }
      },
    });
  }
  await React.act(async () => root.render(React.createElement(NavigationHarness)));
  const press = async key => {
    await React.act(async () => document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
    // TipTap applies programmatic focus on the next animation frame.
    await React.act(async () => new Promise(resolve => requestAnimationFrame(resolve)));
  };
  await React.act(async () => document.querySelector('.report-visual-paragraph').focus());
  await press('ArrowDown');
  assert.ok(document.activeElement.classList.contains('report-figure-edge-before'));
  await press('ArrowRight');
  assert.ok(document.activeElement.classList.contains('report-figure-edge-after'));
  await press('ArrowDown');
  assert.ok(document.activeElement.classList.contains('report-visual-paragraph'));
  assert.equal(navChanges, 0, 'arrow navigation must never write template content');
  await press('Delete');
  assert.equal(navChanges, 1);
  assert.ok(document.activeElement.classList.contains('report-figure-edge-after'));
  assert.ok(currentNav.groups[0].fields[2].binding.text.includes('保留备注'));
  await press('ArrowDown');
  assert.ok(document.activeElement.textContent.includes('保留备注'));
  assert.equal(navChanges, 1);
  await React.act(async () => root.unmount());
  const { Editor } = require('../client/node_modules/@tiptap/react');
  const { Slice, Fragment } = require('../client/node_modules/@tiptap/pm/model');
  const { templateFieldExtension } = require('../client/src/components/ReportEditor/CoverInlineEditor.tsx');
  const { reportParagraphExtensions, reportEditorValue, reportEditorSplit } = require('../client/src/components/ReportEditor/reportParagraphModel.ts');
  const editor = new Editor({ element: document.createElement('div'), extensions: [...reportParagraphExtensions(), templateFieldExtension(() => {})], content: { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: '前文' }, { type: 'templateField', attrs: { reference: { id: 'ref-1', label: '单位', binding: { source: 'order', key: 'customer_name' } } } }, { type: 'text', text: '后文' },
  ] }] } });
  const originalNode = editor.state.doc.firstChild.child(1);
  let pasted = new Slice(Fragment.from(originalNode), 0, 0);
  editor.view.someProp('transformPasted', transform => { pasted = transform(pasted, editor.view); });
  assert.notEqual(pasted.content.firstChild.attrs.reference.id, 'ref-1');
  assert.deepEqual(pasted.content.firstChild.attrs.reference.binding, originalNode.attrs.reference.binding);
  editor.commands.setTextSelection(4);
  editor.view.dispatch(editor.state.tr.replaceSelection(pasted));
  const two = reportEditorValue(editor);
  assert.equal((two.match(/templateField/g) || []).length, 2);
  editor.commands.setTextSelection({ from: 3, to: 4 });
  editor.commands.deleteSelection();
  assert.equal((reportEditorValue(editor).match(/templateField/g) || []).length, 1);
  editor.commands.undo();
  assert.ok(reportEditorValue(editor).includes('ref-1'));
  editor.commands.setTextSelection(2);
  const { insertCoverBlockAtText } = require('../shared/cover-text-boundaries.ts');
  const value = reportEditorValue(editor), split = reportEditorSplit(editor);
  const boundaryTemplate = { name: '首页', version: 1, groups: [{ id: 'g', layout: 'vertical', label: '', fields: [{ id: 'text', code: 'text', type: 'text', hide_label: true, label: '', rich: true, binding: { source: 'literal', text: value } }] }] };
  const splitResult = insertCoverBlockAtText(boundaryTemplate, 'g', 'text', { value, ...split }, 'table', 'inserted', 'tail');
  assert.deepEqual(splitResult.groups[0].fields.map(f => f.id), ['text', 'inserted', 'tail']);
  editor.destroy();
  const QuickLayout = require('../client/src/components/FieldEditor/CoverQuickLayout.tsx').default;
  const quickContainer = document.createElement('div'); document.body.appendChild(quickContainer);
  const quickRoot = createRoot(quickContainer);
  let quickValue, quickWrites = 0;
  function QuickHarness({ readOnly = false, selectedId = 'customer' }) {
    const [value, setValue] = React.useState(template);
    quickValue = value;
    return React.createElement(QuickLayout, { template: value, selectedId, readOnly, onSelect() {}, onConfigure() {}, onChange(patch) {
      quickWrites++;
      setValue(previous => ({ ...previous, groups: previous.groups.map(group => ({ ...group, fields: group.fields.map(field => field.id === selectedId ? { ...field, ...patch } : field) })) }));
    } });
  }
  await React.act(async () => quickRoot.render(React.createElement(QuickHarness)));
  assert.equal(quickWrites, 0, 'opening quick layout never changes template');
  await click(document.querySelector('[aria-label="整行居中"]'));
  assert.equal(quickValue.groups[0].fields[2].style.align, 'center');
  assert.deepEqual(quickValue.groups[0].fields[2].binding, template.groups[0].fields[2].binding);
  const beforeInput = document.querySelector('[aria-label="字段段前间距"]');
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(beforeInput, '2');
    beforeInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  assert.equal(quickValue.groups[0].fields[2].style.space_before, '2pt', 'spacing commits immediately');
  assert.equal(quickValue.groups[0].fields[2].style.align, 'center', 'spacing retains alignment');
  assert.deepEqual(quickValue.groups[0].fields[1], template.groups[0].fields[1], 'existing spacer unchanged');
  await React.act(async () => quickRoot.render(React.createElement(QuickHarness, { readOnly: true })));
  assert.equal(document.querySelector('[aria-label="字段段前间距"]').disabled, true);
  await React.act(async () => quickRoot.render(React.createElement(QuickHarness, { selectedId: 'space' })));
  assert.equal(document.querySelector('[aria-label="整行居中"]').disabled, true, 'special layout protected');
  const SpacerResize = require('../client/src/components/FieldEditor/CoverSpacerResize.tsx').default;
  let spacerWrites = [];
  await React.act(async () => quickRoot.render(React.createElement(SpacerResize, { value: '12pt', readOnly: false, onChange: value => spacerWrites.push(value) })));
  const slider = document.querySelector('[aria-label="留白高度"]');
  slider.setPointerCapture = () => {};
  const pointer = async (type, y) => React.act(async () => slider.dispatchEvent(new window.MouseEvent(type, { bubbles: true, clientY: y, button: 0 })));
  await pointer('pointerdown', 0); await pointer('pointermove', 40);
  assert.equal(spacerWrites.length, 0, 'drag preview does not create history');
  await pointer('pointerup', 40);
  assert.deepEqual(spacerWrites, ['42pt'], 'one commit on release');
  await pointer('pointerdown', 0); await pointer('pointermove', 20);
  await React.act(async () => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' })));
  await pointer('pointerup', 20);
  assert.equal(spacerWrites.length, 1, 'escape cancels without writes');
  await React.act(async () => quickRoot.render(React.createElement(SpacerResize, { value: '12pt', readOnly: true, onChange: value => spacerWrites.push(value) })));
  await pointer('pointerdown', 0); await pointer('pointermove', 20); await pointer('pointerup', 20);
  assert.equal(spacerWrites.length, 1, 'readonly cannot resize');
  Object.defineProperty(global, 'localStorage', { configurable: true, value: window.localStorage });
  HTMLElement.prototype.scrollIntoView = () => {};
  const FieldEditor = require('../client/src/components/FieldEditor').default;
  const batchInitial = { name: '批量', version: 1, groups: [{ id: 'g', label: '正文', layout: 'vertical', fields: ['a', 'b', 'c'].map(id => ({ id, code: id, type: 'text', label: id, binding: { source: 'literal', text: '原文' } })) }] };
  let batchValue, batchWrites = 0;
  function BatchHarness() {
    const [value, setValue] = React.useState(batchInitial); batchValue = value;
    return React.createElement(FieldEditor, { template: value, editorMode: 'report-cover', onChange: value => { batchWrites++; setValue(value); } });
  }
  await React.act(async () => quickRoot.render(React.createElement(BatchHarness)));
  const row = id => document.querySelector(`[data-field-clipboard="${id}"] .fe-row`);
  await click(row('a'));
  assert.ok(document.querySelector('.ant-drawer-open'), 'single click opens original field properties');
  await React.act(async () => row('c').dispatchEvent(new window.MouseEvent('click', { bubbles: true, shiftKey: true })));
  assert.equal(document.querySelectorAll('.fe-row.fe-selected').length, 1, 'shift no longer selects multiple fields');
  assert.equal(document.querySelector('[aria-label="首页批量排版"]'), null);
  assert.equal(document.querySelector('[aria-label="留白高度"]'), null);
  assert.equal(batchWrites, 0, 'selection does not change saved content');
  assert.deepEqual(batchValue, batchInitial);
  await React.act(async () => row('b').dispatchEvent(new window.MouseEvent('click', { bubbles: true, ctrlKey: true })));
  assert.equal(document.querySelectorAll('.fe-row.fe-selected').length, 1, 'ctrl click remains single selection');
  await click(row('a'));
  assert.ok(document.querySelector('.ant-drawer-open'), 'single click switches the original field settings');
  const nestedSign = { ...batchInitial, groups: [...batchInitial.groups, { id: 'sign', parent_group_id: 'g', label: '签署', layout: 'vertical', fields: [{ id: 'author', code: 'author', type: 'text', label: '编制', signature_line: true }] }] };
  let signatureUpdate;
  await React.act(async () => quickRoot.render(React.createElement(FieldEditor, { template: nestedSign, editorMode: 'report-cover', onChange: value => { signatureUpdate = value; } })));
  const positionButton = () => [...document.querySelectorAll('[aria-label="签署位置设置"] button')].find(button => button.textContent === '首页底部');
  assert.ok(positionButton());
  assert.equal(positionButton().disabled, false, 'nested signature position can be changed');
  assert.equal(positionButton().closest('.ant-card-head'), null, 'position controls are outside the crowded header');
  assert.equal(document.querySelector('[data-fe-node="sign"] .ant-card-head .ant-segmented'), null, 'cover signature has no duplicate legacy position selector');
  await click(positionButton());
  assert.equal(signatureUpdate.groups[1].signature_position, 'first_page_bottom');
  assert.equal(signatureUpdate.groups[1].parent_group_id, 'g');
  await React.act(async () => quickRoot.render(React.createElement(FieldEditor, { template: nestedSign, editorMode: 'report-cover', readOnly: true, onChange() { throw Error('readonly write'); } })));
  assert.equal(positionButton().disabled, true, 'readonly is still protected');
  const { categoriesForGroup } = require('../client/src/components/FieldEditor/field-types.ts');
  const { SECTION_PRESETS } = require('../client/src/components/FieldEditor/section-presets.ts');
  const sampleMenu = categoriesForGroup('report-cover', 'images');
  assert.deepEqual(sampleMenu.slice(0, 3).map(item => item.key), ['image', 'text', 'report_sample_description_table']);
  assert.equal(sampleMenu.some(item => item.key === 'report_sample_table'), false);
  assert.equal(categoriesForGroup('record', 'images').some(item => item.key === 'report_sample_table'), false);
  assert.equal(SECTION_PRESETS.find(preset => preset.key === 'cover_sample_photos').label, '样品描述');
  assert.equal(SECTION_PRESETS.find(preset => preset.key === 'cover_sample_table').editors.includes('report-cover'), true);
  const { sectionPresetsForEditor } = require('../client/src/components/FieldEditor/section-presets.ts');
  assert.deepEqual(sectionPresetsForEditor('report-cover').map(preset => preset.label), ['基本信息', '签署信息', '样品信息', '检测结论', '样品描述']);
  let generatedId = 0;
  for (const [key, title, types] of [
    ['cover_sample_table', '样品信息：', ['text', 'report_sample_table']],
    ['cover_conclusion', '检测结论：', ['text', 'report_conclusion_table']],
    ['cover_sample_photos', '样品描述：', ['text', 'report_sample_description_table', 'report_photo_table']],
  ]) {
    const group = SECTION_PRESETS.find(preset => preset.key === key).build(() => `preset_${++generatedId}`);
    assert.equal(group.hide_title, true);
    assert.deepEqual(group.fields.map(field => field.type), types);
    assert.equal(group.fields[0].binding.text, title);
    assert.equal(group.fields[0].style.font, 'FangSong');
    assert.equal(group.fields[0].style.size, '10pt');
    assert.ok(group.fields.every(field => field.hide_label), 'only independent heading is rendered, without duplicate labels');
  }
  await React.act(async () => quickRoot.unmount());
  const sourceContainer = document.createElement('div'); document.body.appendChild(sourceContainer);
  const sourceRoot = createRoot(sourceContainer);
  // PDF worker requires a browser bundler; this harness tests source grid/clipboard only.
  const viewerModule = require.resolve('../client/src/components/TypstViewer');
  const savedViewer = require.cache[viewerModule];
  require.cache[viewerModule] = { id: viewerModule, filename: viewerModule, loaded: true, exports: { __esModule: true, default: () => null } };
  const SourcePanel = require('../client/src/components/ReportEditor/ReportSourceDataPanel.tsx').default;
  const sourceTemplate = { name: '原始记录', version: 1, groups: [{ id: 'g', label: '', layout: 'vertical', fields: [{ id: 'f', code: 'f', label: '来源表', type: 'free_grid', free_table: { rows: [{ id: 'r' }], columns: [{ id: 'a' }, { id: 'b' }], cells: { 'r::a': '<样品>', 'r::b': '不重复' }, spans: { 'r::a': { colspan: 2 } } } }] }] };
  await React.act(async () => sourceRoot.render(React.createElement(SourcePanel, { sources: [{ name: '项目', ctx: { linked_record_template: sourceTemplate, record_raw_data: {} } }] })));
  assert.equal(document.querySelector('[aria-label="原始数据表格"] td').colSpan, 2);
  await React.act(async () => document.querySelector('[aria-label="原始数据表格"] td').dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0 })));
  const copied = {};
  await React.act(async () => {
    const event = new window.Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { setData: (type, value) => { copied[type] = value; } } });
    document.querySelector('[aria-label="原始数据表格"]').dispatchEvent(event);
  });
  assert.equal(copied['text/plain'], '<样品>\t');
  assert.ok(copied['text/html'].includes('colspan="2"'));
  assert.ok(copied['text/html'].includes('&lt;样品&gt;'), 'clipboard HTML is escaped');
  const sourceProps = { sources: [{ name: '缺快照项目', ctx: {} }, { name: '项目', ctx: { linked_record_template: sourceTemplate, record_raw_data: {} } }], target: { index: 1, code: 'f', token: 1 } };
  await React.act(async () => sourceRoot.render(React.createElement(SourcePanel, sourceProps)));
  assert.ok(!sourceContainer.textContent.includes('复制选区') && !sourceContainer.textContent.includes('复制整表') && !sourceContainer.textContent.includes('插入所选表格'));
  await React.act(async () => sourceContainer.querySelector('td').dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0 })));
  await React.act(async () => { sourceContainer.querySelector('td').dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, button: 2 })); });
  assert.ok([...document.querySelectorAll('[role="menuitem"]')].some(item => item.textContent === '复制'));
  assert.ok([...document.querySelectorAll('[role="menuitem"]')].some(item => item.textContent.includes('原始数据只读') && item.getAttribute('aria-disabled') === 'true'));
  const reviewEvents = [];
  const reviewProps = { ...sourceProps, reviews: [{ index: 1, code: 'f', reviewed: false }], onReview: (...args) => reviewEvents.push(args) };
  await React.act(async () => sourceRoot.render(React.createElement(SourcePanel, reviewProps)));
  assert.equal(reviewEvents.length, 0, 'selecting/copying/inserting must never implicitly confirm review');
  await React.act(async () => [...sourceContainer.querySelectorAll('button')].find(button => button.textContent === '标记已核对').click());
  assert.deepEqual(reviewEvents, [[1, 'f', true]]);
  await React.act(async () => sourceRoot.render(React.createElement(SourcePanel, { ...reviewProps, reviews: [{ index: 1, code: 'f', reviewed: true }] })));
  await React.act(async () => [...sourceContainer.querySelectorAll('button')].find(button => button.textContent.includes('撤销核对')).click());
  assert.deepEqual(reviewEvents[1], [1, 'f', false]);
  await React.act(async () => sourceRoot.render(React.createElement(SourcePanel, { ...reviewProps, readOnly: true })));
  assert.equal([...sourceContainer.querySelectorAll('button')].find(button => button.textContent === '标记已核对').disabled, true);
  await React.act(async () => sourceRoot.render(React.createElement(SourcePanel, { ...sourceProps, readOnly: true, onInsert: () => { throw Error('readonly insertion'); } })));
  assert.ok(!sourceContainer.textContent.includes('插入所选表格'));
  await React.act(async () => sourceRoot.render(React.createElement(SourcePanel, { ...sourceProps, target: { index: 0, token: 2 } })));
  assert.ok(sourceContainer.textContent.includes('未保存可查看的原始数据快照'));
  assert.ok(sourceContainer.querySelector('[aria-label="原始数据项目"]'), 'missing snapshot must not trap the project selector');
  const legacyTemplate = { name: '旧记录', version: 1, groups: [{ id: 'legacy', fields: [{ id: 'm', code: 'm', type: 'data_matrix', label: '旧试验数据', matrix: { cell_type: 'number', default_sample_count: 1, parameters: [{ id: 'p', code: 'p', label: '透光率', unit: '%' }] } }] }] };
  await React.act(async () => sourceRoot.render(React.createElement(SourcePanel, { sources: [{ name: '旧项目', ctx: { linked_record_template: legacyTemplate, record_raw_data: { m: { sample_ids: ['s0'], cells: { s0__p: '90.78' } } } } }], target: { index: 0, token: 3 } })));
  assert.ok(sourceContainer.textContent.includes('90.78'), 'legacy matrix must not be excluded from the copyable table view');
  await React.act(async () => [...sourceContainer.querySelectorAll('td')].find(cell => cell.textContent === '90.78').dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0 })));
  const legacyCopied = {};
  await React.act(async () => {
    const event = new window.Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { setData: (type, value) => { legacyCopied[type] = value; } } });
    sourceContainer.querySelector('[aria-label="原始数据表格"]').dispatchEvent(event);
  });
  assert.equal(legacyCopied['text/plain'], '90.78');
  global.DOMParser = window.DOMParser;
  const { reportTableClipboard } = require('../client/src/utils/reportTableClipboard.ts');
  assert.deepEqual(reportTableClipboard(copied['text/html'], copied['text/plain']), { cells: [['<样品>', '']], spans: [{ row: 0, col: 0, rowspan: 1, colspan: 2 }] });
  assert.deepEqual(reportTableClipboard('', '1\t2\r\n3\t4'), { cells: [['1', '2'], ['3', '4']] });
  assert.equal(reportTableClipboard('', '普通说明文字'), null);
  assert.throws(() => reportTableClipboard('<table><tr><td colspan="51">x</td></tr></table>', ''), /限制/);
  const fullTemplate = structuredClone(legacyTemplate);
  fullTemplate.groups[0].fields.unshift({ id: 'description', code: 'description', label: '样品说明', type: 'textarea' });
  fullTemplate.groups[0].fields.push({ ...fullTemplate.groups[0].fields[1], id: 'second', code: 'second', label: '第二张表' });
  const fullProps = { sources: [{ name: '项目', ctx: { linked_record_template: fullTemplate, record_raw_data: { description: '第一行  保留空格\n第二行', m: { sample_ids: ['s0'], cells: { s0__p: '90.78' } }, second: { sample_ids: ['s0'], cells: { s0__p: '12.34' } } } } }], target: { index: 0, token: 4 } };
  await React.act(async () => sourceRoot.render(React.createElement(SourcePanel, fullProps)));
  assert.equal(sourceContainer.querySelectorAll('[aria-label="原始数据表格"]').length, 2);
  assert.ok(sourceContainer.textContent.includes('第一行  保留空格\n第二行'));
  assert.ok(sourceContainer.textContent.includes('12.34'));
  const nativeRange = document.createRange();
  nativeRange.selectNodeContents(sourceContainer.querySelector('[data-source-field="description"]'));
  window.getSelection().removeAllRanges(); window.getSelection().addRange(nativeRange);
  let nativeCopy;
  await React.act(async () => {
    nativeCopy = new window.Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(nativeCopy, 'clipboardData', { value: { setData: () => { throw Error('native text selection hijacked'); } } });
    sourceContainer.querySelector('[aria-label="原始数据表格"]').dispatchEvent(nativeCopy);
  });
  assert.equal(nativeCopy.defaultPrevented, false, 'native selected text stays available to browser Ctrl/Cmd+C');
  window.getSelection().removeAllRanges();
  await React.act(async () => sourceRoot.render(React.createElement(SourcePanel, { ...fullProps, pdf: true })));
  await React.act(async () => sourceRoot.render(React.createElement(SourcePanel, fullProps)));
  assert.equal(sourceContainer.querySelectorAll('[aria-label="原始数据表格"]').length, 2, 'record/PDF switching retains the data view');
  const photoTemplate = { name: '照片记录', version: 1, groups: [{ id: 'photos', fields: [{ id: 'photo', code: 'photo', type: 'image', label: '原样照片' }] }] };
  const photoRaw = { photo: [{ url: '/api/images/file?p=original.png', rel_path: 'original.png' }] }, rawBefore = JSON.stringify(photoRaw);
  await React.act(async () => sourceRoot.render(React.createElement(SourcePanel, { sources: [{ name: '项目', ctx: { linked_record_template: photoTemplate, record_raw_data: photoRaw } }] })));
  const sourcePhoto = sourceContainer.querySelector('[aria-label="选择原始图片：原样照片"]');
  await React.act(async () => sourcePhoto.click());
  assert.equal(document.activeElement, sourcePhoto);
  const photoClipboard = {};
  await React.act(async () => {
    const event = new window.Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { setData: (key, value) => { photoClipboard[key] = value; } } });
    sourcePhoto.dispatchEvent(event);
  });
  const { readReportPhoto } = require('../client/src/utils/reportPhotoClipboard.ts');
  const photoData = readReportPhoto({ getData: key => photoClipboard[key] || '' });
  assert.equal(photoData.title, '原样照片');
  assert.equal(photoData.photo.url, photoRaw.photo[0].url);
  photoData.photo.url = 'modified';
  assert.equal(readReportPhoto({ getData: key => photoClipboard[key] || '' }).photo.url, photoRaw.photo[0].url);
  assert.equal(JSON.stringify(photoRaw), rawBefore);
  assert.equal(readReportPhoto({ getData: () => '' }), undefined, 'ordinary title text is not a photo');
  const ImageListEditor = require('../client/src/components/ImageListEditor.tsx').default;
  let replacedItems;
  const imageListProps = { reportMode: true, items: [{ id: 'slot', title: '旧图片', photo: { url: '/old.png' } }], onChange: value => { replacedItems = value; }, onUpload: async () => undefined, onCreate: () => ({ id: 'new', title: '' }) };
  await React.act(async () => sourceRoot.render(React.createElement(ImageListEditor, imageListProps)));
  const pastePhoto = () => {
    const event = new window.Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { getData: key => photoClipboard[key] || '' } });
    sourceContainer.querySelector('[tabindex="0"]').dispatchEvent(event);
  };
  await React.act(async () => pastePhoto());
  assert.equal(replacedItems[0].photo.url, photoRaw.photo[0].url);
  assert.equal(replacedItems[0].title, '原样照片');
  replacedItems = undefined;
  await React.act(async () => sourceRoot.render(React.createElement(ImageListEditor, { ...imageListProps, readOnly: true })));
  await React.act(async () => pastePhoto());
  assert.equal(replacedItems, undefined);
  await React.act(async () => sourceRoot.unmount());
  if (savedViewer) require.cache[viewerModule] = savedViewer; else delete require.cache[viewerModule];
  await React.act(async () => root.unmount());
  dom.window.close();
  console.log('Cover layout mount, inline source drawer, readonly, clipboard identities, deletion and undo checks passed');
  // This is a one-shot assertion harness; Ant Design popup timers can outlive jsdom.
  process.exit(0);
})().catch(error => { console.error(error); dom.window.close(); process.exit(1); });
