// Compile the new rich-text renderer with the real Typst executable, using stdin/stdout.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { richTextToTypst } = require('../shared/typst-generator.ts');
const { encodeReportRichDocument } = require('../shared/report-rich-document.ts');
const raw = encodeReportRichDocument({ type: 'doc', content: [
  { type: 'paragraph', content: [{ type: 'text', text: 'Bold and italic * literal # text', marks: [{ type: 'bold' }, { type: 'italic' }] }, { type: 'hardBreak' }, { type: 'text', text: 'Next line' }] },
  { type: 'paragraph' },
  { type: 'paragraph', attrs: { textAlign: 'right' }, content: [{ type: 'text', text: 'Colored text', marks: [{ type: 'reportTextStyle', attrs: { fontSize: 14, color: '#cf1322' } }, { type: 'bold' }] }] },
  { type: 'reportSpacer', attrs: { height: '0.5cm' } },
  { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bullet' }] },
    { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nested item' }] }] }] }] }] },
] });
const result = spawnSync('typst', ['compile', '-', '-'], { input: richTextToTypst(raw), maxBuffer: 4 * 1024 * 1024 });
assert.ifError(result.error); assert.equal(result.status, 0, result.stderr?.toString());
assert.equal(result.stdout.subarray(0, 5).toString(), '%PDF-');
console.log('Real Typst compilation: combined marks, literal special characters, line break, blank paragraph and nested lists passed');
