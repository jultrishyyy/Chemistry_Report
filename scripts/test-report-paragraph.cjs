// Real ProseMirror editor under jsdom; not a browser layout test.
const assert = require('node:assert/strict');
const { JSDOM } = require('../client/node_modules/jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'http://localhost' });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'DOMParser', 'getComputedStyle']) {
  Object.defineProperty(global, key, { configurable: true, value: dom.window[key] });
}
global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
const { Editor } = require('../client/node_modules/@tiptap/react');
const { reportParagraphExtensions, reportEditorValue, reportEditorSplit } = require('../client/src/components/ReportEditor/reportParagraphModel.ts');
const { readReportRichDocument, reportRichPlainText, encodeReportRichDocument } = require('../shared/report-rich-document.ts');
const { richTextToTypst } = require('../shared/typst-generator.ts');
const editor = new Editor({ element: document.body.appendChild(document.createElement('div')), extensions: reportParagraphExtensions(), content: readReportRichDocument('前后') });
try {
  editor.commands.setTextSelection({ from: 1, to: 2 }); editor.commands.toggleBold(); editor.commands.toggleItalic();
  let raw = reportEditorValue(editor);
  assert.ok(editor.getHTML().includes('<strong><em>前</em></strong>') || editor.getHTML().includes('<em><strong>前</strong></em>'));
  assert.equal(reportRichPlainText(raw), '前后'); assert.ok(!editor.getHTML().includes('**'));
  assert.ok(richTextToTypst(raw).includes('#strong[')); assert.ok(richTextToTypst(raw).includes('#emph['));
  editor.commands.undo(); assert.deepEqual(editor.getJSON().content[0].content[0].marks, [{ type: 'bold' }]);
  editor.commands.redo(); assert.ok(editor.getJSON().content[0].content[0].marks.length);
  editor.commands.setTextSelection(2);
  const split = reportEditorSplit(editor);
  assert.equal(reportRichPlainText(split.before), '前'); assert.equal(reportRichPlainText(split.after), '后');
  editor.commands.setContent(readReportRichDocument('前后'), { emitUpdate: false }); editor.commands.setTextSelection(2); editor.commands.setHardBreak();
  assert.equal(reportRichPlainText(reportEditorValue(editor)), '前\n后'); assert.ok(richTextToTypst(reportEditorValue(editor)).includes('#linebreak()'));
  editor.commands.setContent(readReportRichDocument('前后')); editor.commands.setTextSelection(2); editor.commands.splitBlock();
  assert.equal(editor.getJSON().content.length, 2);
  editor.commands.setContent(readReportRichDocument('项目')); editor.commands.toggleBulletList();
  assert.ok(editor.getHTML().includes('<ul>')); assert.ok(richTextToTypst(reportEditorValue(editor)).includes('#list('));
  editor.commands.setContent(readReportRichDocument('恢复的**内容**'), { emitUpdate: false });
  assert.equal(editor.getText(), '恢复的内容'); assert.ok(editor.getHTML().includes('<strong>内容</strong>'));
  editor.commands.setContent('<p><b>粘贴</b><script>alert(1)</script><img src=x onerror=alert(1)></p>');
  assert.ok(!editor.getHTML().includes('<script')); assert.ok(!editor.getHTML().includes('<img'));
  raw = reportEditorValue(editor);
  assert.equal(encodeReportRichDocument(readReportRichDocument(raw)), raw);
  // Former field boundaries are now normal paragraph boundaries in one editor.
  editor.commands.setContent({ type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: '单位：甲' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '地址：乙' }] },
    { type: 'reportSpacer', attrs: { height: '0.5cm' } },
    { type: 'paragraph', content: [{ type: 'text', text: '日期：2025' }] },
  ] });
  assert.equal(editor.getJSON().content[2].attrs.height, '0.5cm');
  editor.commands.setTextSelection(7); // start of second paragraph
  editor.commands.joinBackward();
  assert.equal(editor.getJSON().content[0].content[0].text, '单位：甲地址：乙');
  raw = reportEditorValue(editor);
  editor.commands.setContent(readReportRichDocument(raw));
  assert.equal(reportEditorValue(editor), raw);
  editor.commands.setContent(readReportRichDocument('前后'));
  editor.commands.setTextSelection({ from: 1, to: 2 });
  editor.commands.setMark('reportTextStyle', { fontSize: 14, color: '#cf1322' });
  assert.equal(editor.state.selection.from, 1); assert.equal(editor.state.selection.to, 2);
  editor.commands.updateAttributes('paragraph', { textAlign: 'center' });
  raw = reportEditorValue(editor);
  assert.ok(richTextToTypst(raw).includes('size: 14pt')); assert.ok(richTextToTypst(raw).includes('#align(center)'));
  assert.ok(editor.getHTML().includes('font-size: 14pt') || editor.getHTML().includes('font-size:14pt'));
  editor.commands.setTextSelection(2);
  const styledSplit = reportEditorSplit(editor);
  assert.ok(richTextToTypst(styledSplit.before).includes('size: 14pt'));
  assert.ok(richTextToTypst(styledSplit.after).includes('#align(center)'));
  editor.commands.setContent(editor.getHTML());
  assert.equal(reportEditorValue(editor), raw, 'supported HTML styles round-trip');
  editor.commands.selectAll(); editor.commands.unsetAllMarks(); editor.commands.resetAttributes('paragraph', 'textAlign');
  assert.equal(reportRichPlainText(reportEditorValue(editor)), '前后');
  assert.ok(!reportEditorValue(editor).includes('reportTextStyle'));
  assert.ok(!reportEditorValue(editor).includes('textAlign'));
  editor.commands.setContent(readReportRichDocument('第一段\n\n第二段'));
  editor.commands.selectAll(); editor.commands.updateAttributes('paragraph', { textAlign: 'right' });
  assert.ok(editor.getJSON().content.every(node => node.attrs.textAlign === 'right'), 'alignment applies to every selected paragraph');
  console.log('Real visual paragraph: marks, undo/redo, splitting, line breaks, lists, external restore and HTML filtering passed');
} finally { editor.destroy(); dom.window.close(); }
