import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  messages,
  resolveLocale,
  translate,
} from '../../review/web/src/i18n.js';
import { shouldDetectDisplays } from '../../review/web/src/recording-display.js';

const appPath = fileURLToPath(new URL('../../review/web/src/App.vue', import.meta.url));
const indexPath = fileURLToPath(new URL('../../review/web/index.html', import.meta.url));
const recordingPath = fileURLToPath(new URL('../../review/web/src/components/RecordingWorkspace.vue', import.meta.url));
const confirmDialogPath = fileURLToPath(new URL('../../review/web/src/components/ConfirmDialog.vue', import.meta.url));

test('workbench locale resolution follows query, storage, then browser language', () => {
  assert.equal(resolveLocale({ query: 'en-US', stored: 'zh-CN', browserLanguages: ['zh-CN'] }), 'en-US');
  assert.equal(resolveLocale({ query: 'invalid', stored: 'zh-CN', browserLanguages: ['en-US'] }), 'zh-CN');
  assert.equal(resolveLocale({ browserLanguages: ['zh-Hans-CN', 'en-US'] }), 'zh-CN');
  assert.equal(resolveLocale({ browserLanguages: ['ja-JP', 'en-US'] }), 'en-US');
});

test('workbench locale catalogs stay aligned and interpolate parameters', () => {
  assert.deepEqual(Object.keys(messages['en-US']).sort(), Object.keys(messages['zh-CN']).sort());
  assert.equal(translate('zh-CN', 'common.steps', { count: 3 }), '3 个步骤');
  assert.equal(translate('en-US', 'common.steps', { count: 3 }), '3 steps');
  assert.equal(translate('en-US', 'recording.created', { scene: 'mail', task: 'send' }), 'Created task mail/send');
  assert.equal(translate('zh-CN', 'review.taskDeleted', { scene: 'mail', task: 'send' }), '任务 mail/send 已删除');
  assert.equal(translate('en-US', 'recording.deleted', { recording: 'Recording_1' }), 'Deleted recording Recording_1');
});

test('recording workflow detects displays only while the recorder is inactive', () => {
  assert.equal(shouldDetectDisplays('idle'), true);
  assert.equal(shouldDetectDisplays('failed'), true);
  for (const phase of ['arming', 'armed', 'starting', 'recording', 'stopping'] as const) {
    assert.equal(shouldDetectDisplays(phase), false, phase);
  }
});

test('ordinary workbench copy hides implementation names and gates developer assets', async () => {
  const [app, index, recording, confirmDialog] = await Promise.all([
    readFile(appPath, 'utf8'),
    readFile(indexPath, 'utf8'),
    readFile(recordingPath, 'utf8'),
    readFile(confirmDialogPath, 'utf8'),
  ]);

  assert.doesNotMatch(app, /Midscene|CUA 本地任务工作台|canonical 资产|TASK\.YAML/);
  assert.doesNotMatch(index, /Midscene|CUA/);
  assert.doesNotMatch(app, /本地自动化工作台|Local Automation Workspace/);
  assert.match(index, /<title>桌面任务中心<\/title>/);
  assert.match(app, /<details v-if="devMode" class="advanced wide"/);
  assert.match(app, /<code v-if="devMode">\{\{ view\?\.revision \}\}<\/code>/);
  assert.match(app, /setLocale\('zh-CN'\)/);
  assert.match(app, /setLocale\('en-US'\)/);
  assert.match(app, /<ConfirmDialog/);
  assert.match(recording, /<ConfirmDialog/);
  assert.match(confirmDialog, /role="alertdialog"/);
  assert.doesNotMatch(confirmDialog, /window\.confirm|globalThis\.confirm|\bconfirm\(/);
});
