// Real layout verification; no screenshots or temporary report files required.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { richDocumentToTypst } = require('../shared/report-rich-document.ts');
const text = value => ({ type: 'text', text: value });
function layout(content, width = 300) {
  const source = `#set page(width: ${width}pt, height: auto, margin: 5pt)\n` +
    richDocumentToTypst({ type: 'doc', content: [{ type: 'paragraph', content }] });
  const result = spawnSync('typst', ['compile', '--format', 'svg', '-', '-'], { input: source, encoding: 'utf8' });
  assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
  const glyphs = [];
  for (const group of result.stdout.matchAll(/<g class="typst-text" transform="matrix\(1 0 0 -1 ([\d.-]+) ([\d.-]+)\)">([\s\S]*?)<\/g>/g)) {
    for (const glyph of group[3].matchAll(/<use\b[^>]*\sx="([\d.-]+)"[^>]*\sy="([\d.-]+)"/g)) {
      glyphs.push({ x: Number(group[1]) + Number(glyph[1]), y: Number(group[2]) + Number(glyph[2]) });
    }
  }
  assert.ok(glyphs.length, 'must inspect actual laid-out glyphs');
  return glyphs;
}
const one = layout([text('A B')]), five = layout([text('A     B')]);
assert.ok(five[1].x > one[1].x + 5, 'additional spaces must increase the distance');
assert.ok(layout([text('    AB')])[0].x > layout([text('AB')])[0].x + 5, 'leading spaces must remain');
assert.deepEqual(layout([text('A  '), text('   B')]), five, 'node boundaries must not collapse spaces');
assert.ok(layout([text('A\u3000\u3000B')])[1].x > one[1].x);
const styled = layout([{ ...text('A  '), marks: [{ type: 'bold' }] },
  { ...text('   B'), marks: [{ type: 'reportTextStyle', attrs: { fontSize: 18 } }] }]);
const styledNoSpaces = layout([{ ...text('A'), marks: [{ type: 'bold' }] },
  { ...text('B'), marks: [{ type: 'reportTextStyle', attrs: { fontSize: 18 } }] }]);
assert.ok(styled[1].x > styledNoSpaces[1].x + 5);
const broken = layout([text('A'), { type: 'hardBreak' }, text('    B')]);
assert.ok(broken[1].y > broken[0].y && broken[1].x > broken[0].x + 5);
const wrapped = layout([text('AA BB CC DD EE FF GG HH')], 70);
assert.ok(new Set(wrapped.map(g => g.y)).size > 1, 'ordinary spaces must still allow wrapping');
assert.ok(wrapped.every(g => g.x >= 5 && g.x < 65), 'text must stay inside the narrow text area');
console.log('Real Typst whitespace: leading/repeated/full-width spaces, format boundaries, hard breaks and automatic wrapping passed');
