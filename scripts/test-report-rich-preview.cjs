// TSX_TSCONFIG_PATH=client/tsconfig.app.json node --import tsx scripts/test-report-rich-preview.cjs
const assert = require('node:assert/strict');
const React = require('../client/node_modules/react');
const { renderToStaticMarkup } = require('../client/node_modules/react-dom/server');
const Preview = require('../client/src/components/ReportEditor/ReportRichText.tsx').default;
const { encodeReportRichDocument } = require('../shared/report-rich-document.ts');
const render = value => renderToStaticMarkup(React.createElement(Preview, { value }));
assert.ok(render('**加粗**和*斜体*').includes('<strong>加粗</strong>和<em>斜体</em>'));
assert.ok(!render('**加粗**').includes('**'));
assert.equal((render('第一段\n\n第二段').match(/<p /g) || []).length, 2);
assert.ok(render('第一行\n第二行').includes('<br/>'));
assert.ok(render('- 项目一\n- 项目二').includes('项目二'));
assert.ok(!render('<img src=x onerror=alert(1)>').includes('<img'));
assert.ok(render('<script>bad()</script>').includes('&lt;script&gt;'));
const formatted = render(encodeReportRichDocument({ type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: 'center' }, content: [
  { type: 'text', text: '样式', marks: [{ type: 'reportTextStyle', attrs: { fontSize: 14, color: '#cf1322' } }] },
] }] }));
assert.ok(formatted.includes('text-align:center'));
assert.ok(formatted.includes('font-size:14pt')); assert.ok(formatted.includes('color:#cf1322'));
console.log('Report document preview: formatted text, paragraphs, line breaks, lists and HTML escaping passed');
