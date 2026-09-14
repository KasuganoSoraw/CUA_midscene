import type { ExecutionDump } from '@midscene/core';

export interface ExecutionProgress {
  type: 'execution.progress';
  message: string;
  data: {
    source: 'midscene';
    taskIndex: number;
    action: string;
    status: 'running' | 'succeeded' | 'failed' | 'cancelled';
    executionId?: string;
  };
}

export type ExecutionProgressSink = (event: ExecutionProgress) => void;

function shortText(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/[\x00-\x1f\x7f]+/gu, ' ').trim();
  return text ? text.slice(0, limit) : undefined;
}

export function createMidsceneProgressListener(onProgress: ExecutionProgressSink) {
  const reported = new Set<string>();
  return (_dump: string, executionDump?: ExecutionDump): void => {
    if (!executionDump?.tasks) return;
    executionDump.tasks.forEach((task, taskIndex) => {
      if (task.status === 'pending') return;
      const status = task.status === 'finished' ? 'succeeded' : task.status;
      if (!['running', 'succeeded', 'failed', 'cancelled'].includes(status)) return;
      const executionId = shortText(executionDump.id, 120);
      const key = `${executionId ?? ''}:${task.taskId}:${status}`;
      if (reported.has(key)) return;
      reported.add(key);
      const action = shortText(task.subType, 80) ?? shortText(task.type, 80) ?? 'Action';
      const verb = {
        running: '正在执行', succeeded: '完成', failed: '执行失败', cancelled: '已取消',
      }[status];
      onProgress({
        type: 'execution.progress',
        message: `Midscene ${verb} ${action}`,
        data: {
          source: 'midscene', taskIndex, action, status,
          ...(executionId === undefined ? {} : { executionId }),
        },
      });
    });
  };
}
