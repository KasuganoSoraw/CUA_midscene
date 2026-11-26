import type { ExecutorResult } from '../cua/contracts/types.js';

export interface ReplayRecoveryOptions {
  goal: string;
  taskPrompt: {
    prompt: string;
    images: Array<{ name: string; url: string }>;
    convertHttpImage2Base64?: boolean;
  };
}

interface TaskStatus {
  name: string;
  status: string;
  error?: Error;
}

function stepId(task: TaskStatus): string {
  return /^step-\d{3,}/.exec(task.name)?.[0] ?? task.name;
}

const transportCodes = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN']);
const modelErrorNames = new Set([
  'APIError', 'APIConnectionError', 'APIConnectionTimeoutError', 'AI_APICallError',
]);

function isNonRecoverableFailure(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const detail = current as {
      status?: unknown; statusCode?: unknown; code?: unknown;
      name?: unknown; message?: unknown; cause?: unknown;
    };
    const status = detail.status ?? detail.statusCode;
    if (typeof status === 'number' && status >= 400 && status < 600) return true;
    if (typeof detail.code === 'string' && transportCodes.has(detail.code)) return true;
    if (typeof detail.name === 'string' && modelErrorNames.has(detail.name)) return true;
    if (typeof detail.message === 'string' && detail.message.startsWith('unknown flowItem in yaml:')) {
      return true;
    }
    current = detail.cause;
  }
  return false;
}

export function replayFailure(
  tasks: TaskStatus[],
): { fallback: NonNullable<ExecutorResult['fallback']>; reason: string } | undefined {
  const failedIndex = tasks.findIndex(task => task.status === 'error');
  if (failedIndex < 0) return undefined;
  const failed = tasks[failedIndex];
  if (isNonRecoverableFailure(failed.error)) return undefined;
  return {
    fallback: {
      triggered: true,
      from: 'replay',
      to: 'adaptive',
      completedSteps: tasks.filter(task => task.status === 'done').map(stepId),
      failedStep: stepId(failed),
      pendingSteps: tasks.slice(failedIndex + 1).filter(task => task.status === 'init')
        .map(stepId),
      uncertainSteps: [stepId(failed)],
      recoveryStatus: 'failed',
    },
    reason: failed.error?.message ?? '录制步骤执行失败',
  };
}

const serializationFailed = '[Serialization Failed]';

function stringifyReadingResult(value: unknown): string {
  const ancestors: object[] = [];
  return JSON.stringify(value, function (this: object, _key, current: unknown) {
    if (current === undefined) return '[Undefined]';
    if (typeof current === 'function') return '[Function]';
    if (typeof current === 'symbol') return `[Symbol: ${String(current)}]`;
    if (typeof current === 'bigint') return `${current.toString()}n`;
    if (current === null || typeof current !== 'object') return current;

    while (ancestors.length && ancestors.at(-1) !== this) ancestors.pop();
    if (ancestors.includes(current)) return '[Circular Reference]';
    ancestors.push(current);
    return current;
  }) ?? serializationFailed;
}

function stringifyReadingField(results: Record<string, unknown>, key: string): string {
  try {
    return stringifyReadingResult(results[key]);
  } catch {
    return JSON.stringify(serializationFailed);
  }
}

function safeStringify(results: Record<string, unknown>): string | undefined {
  try {
    const keys = Object.keys(results);
    if (!keys.length) return undefined;
    try {
      return stringifyReadingResult(results);
    } catch {
      // 单个读取结果无法序列化时，保留其他读取结果。
      const fields = keys.map(key => `${JSON.stringify(key)}:${stringifyReadingField(results, key)}`);
      return `{${fields.join(',')}}`;
    }
  } catch {
    return serializationFailed;
  }
}

export function recoveryPrompt(
  options: ReplayRecoveryOptions,
  fallback: NonNullable<ExecutorResult['fallback']>,
  reason: string,
  results: Record<string, unknown>,
): ReplayRecoveryOptions['taskPrompt'] {
  const completed = fallback.completedSteps.join('、') || '无';
  const pending = fallback.pendingSteps.join('、') || '无';
  const readingResults = safeStringify(results);
  return {
    ...options.taskPrompt,
    prompt: [
      `原始目标：${options.goal}`,
      '回放已停止。请先观察当前屏幕，从实际界面状态接续任务，不要从第一步重新执行。',
      `已完成步骤：${completed}`,
      `失败且结果待确认的步骤：${fallback.failedStep}`,
      `尚未执行步骤：${pending}`,
      `失败原因：${reason.slice(0, 500)}`,
      ...(readingResults === undefined ? [] : [`已获得的读取结果：${readingResults}`]),
      '先确认失败步骤是否已经产生效果；创建、提交、发送、删除或保存等操作在无法确认时不得重复。',
      '按当前画面完成剩余步骤，保留读取结果；无法确认时说明原因，不猜测，也不盲目操作。',
      '以下是完整步骤，仅供核对进度与定位剩余操作，已完成的步骤不可重复：',
      options.taskPrompt.prompt,
    ].join('\n'),
  };
}
