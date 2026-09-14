import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExecutionDump } from '@midscene/core';
import {
  createMidsceneProgressListener,
  type ExecutionProgress,
} from '../../executors/midscene-progress.js';

test('Midscene 累计快照生成动作描述并按任务身份去重', () => {
  const events: ExecutionProgress[] = [];
  const listener = createMidsceneProgressListener((event) => events.push(event));
  const task = {
    taskId: 'task-1', type: 'Action Space', subType: 'Tap', status: 'running',
    param: { locate: { prompt: '用户名输入框' } },
    uiContext: { screenshot: 'private-image' },
  };
  const dump = { id: 'execution-1', tasks: [task] } as unknown as ExecutionDump;
  listener('private-raw-dump', dump);
  listener('private-raw-dump', dump);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    type: 'execution.progress',
    message: 'Tap - 用户名输入框',
    data: {
      source: 'midscene', executionId: 'execution-1', taskIndex: 0,
      taskId: 'task-1', action: 'Tap', description: '用户名输入框', status: 'running',
    },
  });

  const finished = {
    id: 'execution-1', tasks: [{ ...task, status: 'finished' }],
  } as unknown as ExecutionDump;
  listener('private-raw-dump', finished);
  listener('private-raw-dump', finished);
  assert.equal(events.length, 2);
  assert.equal(events[1]?.data.status, 'succeeded');
  assert.equal(events[1]?.message, 'Tap - 用户名输入框');
  assert.doesNotMatch(JSON.stringify(events), /private-image|private-raw-dump/u);
});

test('同一状态的描述变化更新任务且输入值按 Midscene 文本展示', () => {
  const events: ExecutionProgress[] = [];
  const listener = createMidsceneProgressListener((event) => events.push(event));
  const input = { taskId: 'input-1', type: 'Action Space', subType: 'Input', status: 'running', param: { value: 'admin' } };
  listener('', { id: 'execution-1', tasks: [input] } as unknown as ExecutionDump);
  listener('', { id: 'execution-1', tasks: [{ ...input, param: { value: 'Changeme_123' } }] } as unknown as ExecutionDump);
  listener('', { id: 'execution-1', tasks: [{ ...input, param: { value: 'Changeme_123' } }] } as unknown as ExecutionDump);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((event) => event.message), ['Input - admin', 'Input - Changeme_123']);
  assert.equal(events[0]?.data.taskId, events[1]?.data.taskId);

  listener('', { id: 'execution-1', tasks: [{
    taskId: 'plan-1', type: 'Planning', subType: 'Plan', status: 'finished',
    output: { log: '输入用户名 admin' },
  }] } as unknown as ExecutionDump);
  assert.equal(events[2]?.message, 'Plan - 输入用户名 admin');
});

test('Midscene 失败进度不携带原始错误并跳过 pending 状态', () => {
  const events: ExecutionProgress[] = [];
  const listener = createMidsceneProgressListener((event) => events.push(event));
  listener('', { tasks: [{ taskId: 'pending', type: 'Log', status: 'pending' }] } as unknown as ExecutionDump);
  listener('', {
    tasks: [{
      taskId: 'failed', type: 'Action Space', subType: 'Input', status: 'failed',
      errorMessage: '输入 private-password 失败',
    }],
  } as unknown as ExecutionDump);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.data.action, 'Input');
  assert.equal(events[0]?.data.taskId, 'failed');
  assert.equal(events[0]?.data.status, 'failed');
  assert.doesNotMatch(JSON.stringify(events), /private-password/u);
});
