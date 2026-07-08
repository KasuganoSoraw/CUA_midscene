import assert from 'node:assert/strict';
import { textToKeyboardSequence } from './keyboard-type-action.js';

assert.deepEqual(textToKeyboardSequence('47405'), ['4', '7', '4', '0', '5']);

assert.deepEqual(textToKeyboardSequence('QATAR AIRWAYS'), [
  'Shift+Q',
  'Shift+A',
  'Shift+T',
  'Shift+A',
  'Shift+R',
  'Space',
  'Shift+A',
  'Shift+I',
  'Shift+R',
  'Shift+W',
  'Shift+A',
  'Shift+Y',
  'Shift+S',
]);

assert.deepEqual(textToKeyboardSequence('abc_123@example.com'), [
  'a',
  'b',
  'c',
  'Shift+-',
  '1',
  '2',
  '3',
  'Shift+2',
  'e',
  'x',
  'a',
  'm',
  'p',
  'l',
  'e',
  '.',
  'c',
  'o',
  'm',
]);

assert.throws(() => textToKeyboardSequence('中文'), /不支持字符 "中"/);

console.log('KeyboardTypeText 映射测试通过');
