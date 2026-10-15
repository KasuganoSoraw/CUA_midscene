import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { translate } from '../../review/web/src/i18n.js';

const webRoot = new URL('../../review/web/src/', import.meta.url);

test('等待配置以两列展示条件和最长等待时间', async () => {
  const app = await readFile(new URL('App.vue', webRoot), 'utf8');
  const css = await readFile(new URL('review.css', webRoot), 'utf8');
  assert.match(app, /class="wait-fields wide"/);
  assert.match(app, /v-model\.number="editor\.timeoutMs"[^>]*min="1"/);
  assert.match(css, /\.wait-fields\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.equal(translate('zh-CN', 'review.waitCondition'), '等待触发条件');
  assert.equal(translate('zh-CN', 'review.timeout'), '等待时长（毫秒）');
});

test('等待配置使用 UCD 信息图标与选择箭头', async () => {
  const app = await readFile(new URL('App.vue', webRoot), 'utf8');
  const select = await readFile(new URL('components/ReviewSelect.vue', webRoot), 'utf8');
  assert.match(app, /assets\/ucd\/action-info\.svg/);
  assert.match(app, /assets\/ucd\/wait-info\.svg/);
  assert.match(select, /assets\/ucd\/select-arrow\.svg/);
});
