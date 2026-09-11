import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpreadsheetClipboard, serializeSpreadsheetClipboard } from '../client/src/utils/spreadsheetClipboard';

test('Excel clipboard preserves rectangular values, blank cells and terminal protocol newline', () => {
  assert.deepEqual(parseSpreadsheetClipboard('1\t2\r\n\t4\r\n'), [['1', '2'], ['', '4']]);
  assert.deepEqual(parseSpreadsheetClipboard('a\t\r\n\t\r\n'), [['a', ''], ['', '']]);
});
test('Excel clipboard roundtrips multiline cells, tabs, quotes and precision without formatting', () => {
  const values = [['备注\n第二行', '1.234567890123', ''], ['含\t制表符', '"引号"', '  空格  ']];
  assert.deepEqual(parseSpreadsheetClipboard(serializeSpreadsheetClipboard(values)), values);
  assert.deepEqual(parseSpreadsheetClipboard('"第一行\n第二行"\t"a""b"\r\n'), [['第一行\n第二行', 'a"b']]);
});
