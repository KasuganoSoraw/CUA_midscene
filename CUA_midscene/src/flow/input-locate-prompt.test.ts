import assert from 'node:assert/strict';
import { deriveInputLocatePrompt } from './input-locate-prompt.js';

assert.equal(
  deriveInputLocatePrompt('在 Chrome 地址栏/搜索栏中输入 {{value}}'),
  'Chrome 地址栏/搜索栏',
);

assert.equal(
  deriveInputLocatePrompt('在 Book a flight 预订组件的 From（出发地）输入框中输入 {{value}}'),
  'Book a flight 预订组件的 From（出发地）输入框',
);

assert.equal(
  deriveInputLocatePrompt('在 Book a flight 预订组件的 To（目的地）输入框中继续输入 {{value}}，以进一步过滤到 Los/Lagos 等匹配项'),
  'Book a flight 预订组件的 To（目的地）输入框',
);

assert.throws(() => deriveInputLocatePrompt('输入 {{value}}'), /无法从 input prompt 推导 locatePrompt/);

console.log('input locate prompt 测试通过');
