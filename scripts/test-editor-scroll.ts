import assert from 'node:assert/strict';
import { scrollWithin } from '../client/src/utils/scrollWithin.ts';
let top = -1;
const container = {
  scrollTop: 200, clientHeight: 400, scrollHeight: 1400,
  getBoundingClientRect: () => ({ top: 100 }),
  scrollTo: (options: { top: number }) => { top = options.top; },
} as unknown as HTMLElement;
const target = (y: number, height: number) => ({
  getBoundingClientRect: () => ({ top: y, height }),
  scrollIntoView: () => { throw Error('Must not scroll hidden ancestors'); },
}) as unknown as Element;
scrollWithin(container, target(500, 100)); assert.equal(top, 450);
scrollWithin(container, target(-500, 100)); assert.equal(top, 0);
scrollWithin(container, target(3000, 100)); assert.equal(top, 1000);
scrollWithin(container, target(100, 600)); assert.equal(top, 200);
console.log('Editor pane scrolling: 4 assertions passed');
