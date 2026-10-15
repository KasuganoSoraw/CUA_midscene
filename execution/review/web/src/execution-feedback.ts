import type { TaskExecutionStatus } from '../../shared/types.js';
import type { MessageKey } from './i18n.js';

export interface ExecutionFeedback {
  titleKey: MessageKey;
  descriptionKey: MessageKey;
}

export function executionFeedback(status: TaskExecutionStatus): ExecutionFeedback | undefined {
  if (status.phase === 'succeeded') return { titleKey: 'execution.succeeded', descriptionKey: 'execution.success' };
  if (status.phase === 'stopped') return { titleKey: 'execution.stopped', descriptionKey: 'execution.stoppedHelp' };
  if (status.phase !== 'failed') return undefined;
  const message = status.error ?? '';
  if (status.failureKind === 'launch') return { titleKey: 'execution.failure.launch', descriptionKey: 'execution.failure.launchHelp' };
  if (/Missing required env vars:/.test(message)) return { titleKey: 'execution.failure.configuration', descriptionKey: 'execution.failure.configurationHelp' };
  if (/\b(?:ECONNREFUSED|ENOTFOUND|EAI_AGAIN)\b/.test(message)) return { titleKey: 'execution.failure.connection', descriptionKey: 'execution.failure.connectionHelp' };
  if (/\b(?:TimeoutError|ETIMEDOUT)\b/.test(message)) return { titleKey: 'execution.failure.timeout', descriptionKey: 'execution.failure.timeoutHelp' };
  if (/\b(?:401 Unauthorized|403 Forbidden)\b/i.test(message)) return { titleKey: 'execution.failure.authorization', descriptionKey: 'execution.failure.authorizationHelp' };
  if (/\b429 Too Many Requests\b/i.test(message)) return { titleKey: 'execution.failure.rateLimit', descriptionKey: 'execution.failure.rateLimitHelp' };
  return { titleKey: 'execution.failed', descriptionKey: 'execution.failure.unknownHelp' };
}
