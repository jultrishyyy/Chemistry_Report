const assert = require('node:assert/strict');
const { JSDOM } = require('../client/node_modules/jsdom');
const { revealInScrollPanes } = require('../client/src/utils/scrollWithin.ts');
const { document } = new JSDOM('<main><div><table><tbody><tr><td></td></tr></tbody></table></div></main>').window;
const hidden = document.querySelector('main');
const pane = document.querySelector('div');
const cell = document.querySelector('td');
hidden.style.overflowY = 'hidden';
pane.style.overflowY = 'auto';
pane.style.overflowX = 'auto';
for (const node of [hidden, pane, document.body, document.documentElement]) {
  for (const [key, value] of Object.entries({ clientWidth: 200, clientHeight: 100, scrollWidth: 800, scrollHeight: 900 })) {
    Object.defineProperty(node, key, { value });
  }
  node.scrollTo = () => { throw Error('Hidden/root ancestors must not scroll'); };
}
pane.getBoundingClientRect = () => ({ top: 0, left: 0 });
pane.scrollTo = ({ top, left }) => { pane.scrollTop = top; pane.scrollLeft = left; };
let rect;
cell.getBoundingClientRect = () => rect;
cell.scrollIntoView = () => { throw Error('Native ancestor scrolling must not run'); };
rect = { top: 120, bottom: 140, height: 20, left: 220, right: 250 };
revealInScrollPanes(cell);
assert.equal(pane.scrollTop, 40);
assert.equal(pane.scrollLeft, 50);
rect = { top: 20, bottom: 40, height: 20, left: 20, right: 50 };
revealInScrollPanes(cell);
assert.equal(pane.scrollTop, 40, 'visible cells do not jump');
assert.equal(pane.scrollLeft, 50);
rect = { top: -100, bottom: -80, height: 20, left: -100, right: -70 };
revealInScrollPanes(cell);
assert.equal(pane.scrollTop, 0);
assert.equal(pane.scrollLeft, 0);
rect = { top: 1000, bottom: 1020, height: 20, left: 900, right: 930 };
revealInScrollPanes(cell, { block: 'center' });
assert.equal(pane.scrollTop, 800, 'clamp to bottom');
assert.equal(pane.scrollLeft, 600, 'clamp to right');
revealInScrollPanes(null);
console.log('Scroll panes: horizontal/vertical navigation, visible cells, bounds and hidden/root isolation passed');
