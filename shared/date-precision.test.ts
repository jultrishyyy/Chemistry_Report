import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDateByPrecision } from './date-precision';

test('formats dates with Chinese year-month-day-hour markers', () => {
  assert.equal(formatDateByPrecision('2026-08-06T14:35:00', 'day', '年月日时'), '2026年08月06日');
  assert.equal(formatDateByPrecision('2026-08-06T14:35:00', 'hour', '年月日时'), '2026年08月06日14时');
  assert.equal(formatDateByPrecision('2026-08-06T14:35:00', 'minute', '年月日时'), '2026年08月06日14时35分');
});

test('keeps existing date separator formats unchanged', () => {
  assert.equal(formatDateByPrecision('2026-08-06T14:35:00', 'hour', '-'), '2026-08-06 14:00');
  assert.equal(formatDateByPrecision('2026-08-06T14:35:00', 'hour', '/'), '2026/08/06 14:00');
});
