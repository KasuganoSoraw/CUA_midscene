import type { AgentEvent } from '../../shared/agent.js';

function progressIdentity(event: AgentEvent): string | undefined {
  if (event.type !== 'execution.progress') return undefined;
  const taskId = event.data?.taskId;
  if (typeof taskId !== 'string' || !taskId) return undefined;
  const callId = typeof event.data?.callId === 'string' ? event.data.callId : '';
  const executionId = typeof event.data?.executionId === 'string' ? event.data.executionId : '';
  return JSON.stringify([event.invocationId, callId, executionId, taskId]);
}

export function appendVisibleAgentEvent(events: AgentEvent[], event: AgentEvent): void {
  const identity = progressIdentity(event);
  if (identity === undefined) {
    events.push(event);
    return;
  }
  const index = events.findIndex((item) => progressIdentity(item) === identity);
  if (index < 0) events.push(event);
  else events.splice(index, 1, event);
}
