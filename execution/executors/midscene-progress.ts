import type { ExecutionDump } from '@midscene/core';
import { paramStr, typeStr } from '@midscene/core/agent';

export interface ExecutionProgress {
  type: 'execution.progress';
  message: string;
  data: {
    source: 'midscene';
    taskIndex: number;
    taskId: string;
    action: string;
    description?: string;
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
  const reported = new Map<string, string>();
  return (_dump: string, executionDump?: ExecutionDump): void => {
    if (!executionDump?.tasks) return;
    executionDump.tasks.forEach((task, taskIndex) => {
      if (task.status === 'pending') return;
      const status = task.status === 'finished' ? 'succeeded' : task.status;
      if (!['running', 'succeeded', 'failed', 'cancelled'].includes(status)) return;
      const executionId = shortText(executionDump.id, 120);
      const taskId = shortText(task.taskId, 120);
      if (!taskId) return;
      const action = shortText(typeStr(task), 80) ?? 'Action';
      let description: string | undefined;
      try {
        description = shortText(paramStr(task), 300);
      } catch {
        description = undefined;
      }
      const identity = JSON.stringify([executionId ?? '', taskId]);
      const signature = JSON.stringify([status, action, description ?? '']);
      if (reported.get(identity) === signature) return;
      reported.set(identity, signature);
      onProgress({
        type: 'execution.progress',
        message: description ? `${action} - ${description}` : action,
        data: {
          source: 'midscene', taskIndex, taskId, action, status,
          ...(description === undefined ? {} : { description }),
          ...(executionId === undefined ? {} : { executionId }),
        },
      });
    });
  };
}
