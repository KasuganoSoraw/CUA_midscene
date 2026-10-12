import assert from 'node:assert/strict';
import test from 'node:test';
import { RecordingGenerationManager } from '../../review/service/recording-generation.js';

test('录制生成立即返回并独立于状态读取持续运行', async () => {
  const manager = new RecordingGenerationManager();
  let finish: () => void = () => {};
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  const request = { scene: 'browser-demo', task: 'new-task', goal: '演示' };
  const accepted = manager.start('Recording_1', request, async () => {
    await pending;
    return { created: true, valid: true, ...request };
  });
  assert.equal(accepted.phase, 'running');
  assert.deepEqual(manager.status().request, request);
  accepted.request!.task = 'changed-in-browser';
  assert.equal(manager.status().request?.task, 'new-task');
  assert.throws(() => manager.start('Recording_2', request, async () => {
    throw new Error('should not run');
  }), { statusCode: 409 });
  finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.status().phase, 'succeeded');
  assert.equal(manager.status().result?.task, 'new-task');
});

test('后台生成失败可重新读取错误并发起下一次生成', async () => {
  const manager = new RecordingGenerationManager();
  const request = { scene: 'demo', task: 'task', goal: '' };
  manager.start('Recording_1', request, async () => { throw new Error('生成失败'); });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.status().phase, 'failed');
  assert.equal(manager.status().error, '生成失败');
  assert.equal(manager.start('Recording_2', request, async () => ({ created: true, valid: true, ...request })).phase, 'running');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.status().phase, 'succeeded');
  assert.equal(manager.status().error, undefined);
});
