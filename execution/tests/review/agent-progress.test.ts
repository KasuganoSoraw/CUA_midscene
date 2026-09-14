import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentEvent } from '../../review/shared/agent.js';
import { appendVisibleAgentEvent } from '../../review/web/src/agent-progress.js';

function event(type: AgentEvent['type'], data?: AgentEvent['data']): AgentEvent {
  return {
    schemaVersion: '1.0', invocationId: 'inv-1', type,
    timestamp: '2026-09-14T00:00:00.000Z', data,
  };
}

test('同一 Midscene 任务的状态与描述更新替换展示项', () => {
  const visible: AgentEvent[] = [];
  const started = event('execution.started');
  const running = event('execution.progress', {
    callId: 'call-1', executionId: 'exec-1', taskId: 'task-1',
    source: 'midscene', taskIndex: 0, action: 'Locate',
    description: '用户名输入框', status: 'running',
  });
  const updated = event('execution.progress', {
    ...running.data, description: '登录页用户名输入框', status: 'succeeded',
  });
  const completed = event('tool.completed');
  for (const item of [started, running, updated, completed]) {
    appendVisibleAgentEvent(visible, item);
  }
  assert.deepEqual(visible, [started, updated, completed]);
});

test('不同执行和 Tool call 的任务保持独立，缺少任务 ID 的事件仍追加', () => {
  const visible: AgentEvent[] = [];
  const first = event('execution.progress', { callId: 'call-1', executionId: 'exec-1', taskId: 'task-1' });
  const otherExecution = event('execution.progress', { callId: 'call-1', executionId: 'exec-2', taskId: 'task-1' });
  const otherCall = event('execution.progress', { callId: 'call-2', executionId: 'exec-1', taskId: 'task-1' });
  const legacy = event('execution.progress', { callId: 'call-1', action: 'Tap' });
  for (const item of [first, otherExecution, otherCall, legacy]) {
    appendVisibleAgentEvent(visible, item);
  }
  assert.deepEqual(visible, [first, otherExecution, otherCall, legacy]);
});
