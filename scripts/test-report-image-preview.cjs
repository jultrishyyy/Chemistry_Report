const assert = require('node:assert/strict');
const React = require('../client/node_modules/react');
const { renderToStaticMarkup } = require('../client/node_modules/react-dom/server');
const Preview = require('../client/src/components/ReportEditor/ReportImagePreview.tsx').default;
const { reportImagePreview } = require('../shared/report-image-preview.ts');
const model = reportImagePreview({ id: 'p', code: 'p', type: 'report_photo_table', label: '', photo_table: {
  header: '<script>标题</script>', caption_label: '说明', caption_text: '真实图片', cols: 2,
  photos: [{ rel_path: 'first.png' }, { rel_path: 'second.png', display_width_cm: 4, display_height_cm: 3 }, { rel_path: 'third.png' }],
} });
const html = renderToStaticMarkup(React.createElement(Preview, { model }));
assert.equal((html.match(/<img /g) || []).length, 3);
assert.ok(!/<(?:input|button|textarea|select)\b/.test(html));
assert.ok(!html.includes('<script>')); assert.ok(html.includes('&lt;script&gt;'));
assert.ok(html.includes('third.png')); assert.ok(html.includes('真实图片'));
assert.ok(html.includes('grid-column:1 / -1'));
console.log('Report image preview: all photos, safe titles, caption, solo layout and no editing controls passed');
