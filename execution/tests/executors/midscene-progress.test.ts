import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExecutionDump } from '@midscene/core';
import {
  createMidsceneProgressListener,
  type ExecutionProgress,
} from '../../executors/midscene-progress.js';

test('Midscene 累计快照只产生受控状态变化且不泄露参数和截图', () => {
  const events: ExecutionProgress[] = [];
  const listener = createMidsceneProgressListener((event) => events.push(event));
  const task = {
    taskId: 'task-1', type: 'Action Space', subType: 'Tap', status: 'running',
    param: { value: 'private-password' },
    uiContext: { screenshot: 'private-image' },
  };
  const dump = { id: 'execution-1', tasks: [task] } as unknown as ExecutionDump;
  listener('private-raw-dump', dump);
  listener('private-raw-dump', dump);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    type: 'execution.progress',
    message: 'Midscene 正在执行 Tap',
    data: {
      source: 'midscene', executionId: 'execution-1', taskIndex: 0,
      action: 'Tap', status: 'running',
    },
  });

  const finished = {
    id: 'execution-1', tasks: [{ ...task, status: 'finished' }],
  } as unknown as ExecutionDump;
  listener('private-raw-dump', finished);
  listener('private-raw-dump', finished);
  assert.equal(events.length, 2);
  assert.equal(events[1]?.data.status, 'succeeded');
  assert.doesNotMatch(JSON.stringify(events), /private-password|private-image|private-raw-dump/u);
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
  assert.equal(events[0]?.data.status, 'failed');
  assert.doesNotMatch(JSON.stringify(events), /private-password/u);
});
