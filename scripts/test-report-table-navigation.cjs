const assert = require('node:assert/strict');
const { JSDOM } = require('../client/node_modules/jsdom');
const dom = new JSDOM('<table><tbody><tr><td rowspan="2"><textarea id="a" readonly></textarea></td><td><textarea id="b" readonly></textarea></td></tr><tr><td><textarea id="c" readonly></textarea></td></tr><tr><td><textarea id="d" readonly></textarea></td><td><textarea id="e" readonly></textarea></td></tr></tbody></table>');
for (const name of ['HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement']) global[name] = dom.window[name];
dom.window.HTMLElement.prototype.scrollIntoView = function () {};
const { handleExcelTableKeyDown } = require('../client/src/utils/excelTableNavigation.ts');
function press(id, key, options = {}, onBoundary, onBackwardBoundary) {
  const target = dom.window.document.getElementById(id); target.focus();
  let prevented = false;
  handleExcelTableKeyDown({ target, key, nativeEvent: {}, defaultPrevented: false,
    preventDefault() { prevented = true; }, stopPropagation() {}, ...options }, onBoundary, onBackwardBoundary);
  return { id: dom.window.document.activeElement.id, prevented };
}
assert.equal(press('a', 'ArrowDown').id, 'd', 'skip rows covered by rowspan');
assert.equal(press('c', 'ArrowLeft').id, 'a', 'left enters merged anchor');
assert.equal(press('b', 'ArrowDown').id, 'c');
assert.equal(press('d', 'ArrowUp').id, 'a');
assert.equal(press('d', 'Enter').id, 'e', 'last-row Enter moves right');
assert.equal(press('e', 'Enter').prevented, true);
assert.equal(press('b', 'Enter', { shiftKey: true }).prevented, false, 'editing newline is native');
assert.equal(press('b', 'ArrowDown', { nativeEvent: { isComposing: true } }).id, 'b');
let exits = 0;
assert.equal(press('d', 'ArrowDown', {}, () => exits++).prevented, true);
assert.equal(press('b', 'ArrowRight', {}, () => exits++).prevented, true);
assert.equal(exits, 2, 'bottom and right borders exit to report content');
press('a', 'ArrowDown', {}, () => exits++);
press('b', 'ArrowUp', {}, () => exits++);
assert.equal(exits, 2, 'interior navigation and upward edge do not exit forward');
let backward = 0;
assert.equal(press('a', 'ArrowUp', {}, undefined, () => backward++).prevented, true);
assert.equal(press('a', 'ArrowLeft', {}, undefined, () => backward++).prevented, true);
assert.equal(backward, 2, 'report can exit above and before the first cell');
for (const options of [{ shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
  assert.equal(press('a', 'ArrowUp', options, undefined, () => backward++).prevented, false);
}
assert.equal(backward, 2, 'selection and OS shortcuts do not accidentally leave the table');
assert.equal(press('a', 'ArrowUp').prevented, false, 'record entry without report callbacks retains its boundary behavior');
console.log('Report table shared navigation: arrows, merged cells, Enter, newline and IME guards passed');
