const assert = require('node:assert/strict');
const React = require('../client/node_modules/react');
const { renderToStaticMarkup } = require('../client/node_modules/react-dom/server');
const FormRenderer = require('../client/src/components/FormRenderer/index.tsx').default;
const field = { id: 'f', code: 'f', label: '结论', type: 'record_conclusion', record_conclusion: {
  mode: 'children', project_name: '项目', project_summary: { judgment_enabled: true, conclusion_enabled: false },
  items: [{ id: 'i', code: 'i', name: '子项目', name_mode: 'custom' }],
} };
const template = { name: '测试', groups: [{ id: 'g', label: '结论', fields: [field] }] };
const data = { f: { project_judgment_requirement: '标准要求', items: [{ item_code: 'i', judgment_requirement: '客户要求' }] } };
const before = JSON.stringify(data);
const render = () => renderToStaticMarkup(React.createElement(FormRenderer, { template, data, onChange() {} }));
const html = render();
assert.ok(html.includes('标准要求') && html.includes('客户要求'));
assert.ok(!html.includes('<textarea'), 'legacy conclusion judgments no longer use always-visible textareas');
assert.equal(JSON.stringify(data), before);
data.f.items[0].judgment_requirement = '自定义旧内容';
const custom = render();
assert.ok(custom.includes('其他（自定义）') && custom.includes('自定义旧内容'));
console.log('Legacy project and child judgments render as single selects; custom legacy text is preserved.');
