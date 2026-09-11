import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportFigureArrow, reportFigureBlankSide } from './report-figure-navigation';

test('first horizontal arrow locates edge, repeated arrow leaves it, vertical arrows navigate directly', () => {
  assert.deepEqual(reportFigureArrow('ArrowLeft', null), { side: -1, navigate: false });
  assert.deepEqual(reportFigureArrow('ArrowLeft', -1), { side: -1, navigate: true });
  assert.deepEqual(reportFigureArrow('ArrowRight', 1), { side: 1, navigate: true });
  assert.deepEqual(reportFigureArrow('ArrowRight', -1), { side: 1, navigate: false });
  assert.deepEqual(reportFigureArrow('ArrowUp', null), { side: -1, navigate: true });
  assert.deepEqual(reportFigureArrow('ArrowDown', null), { side: 1, navigate: true });
  assert.equal(reportFigureArrow('Enter', null), null);
});
test('blank hit testing respects actual scaled frame geometry', () => {
  assert.equal(reportFigureBlankSide(110, { top: 100, height: 200 }), -1);
  assert.equal(reportFigureBlankSide(290, { top: 100, height: 200 }), 1);
  assert.equal(reportFigureBlankSide(150, { top: 100, height: 100 }), 1);
});
