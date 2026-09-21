import type {
  CreateRecordingTaskRequest,
  CreateRecordingTaskResult,
  DeleteRecordingResult,
  DeleteTaskResult,
  RecorderDisplaysResult,
  RecorderStatus,
  ReviewServerIdentity,
  ReviewCatalogResponse,
  ReviewMutation,
  ReviewMutationResult,
  ReviewRecording,
  ReviewRecordingCatalog,
  ReviewTaskDraft,
  ReviewTaskListResponse,
  ReviewTaskView,
  SaveReviewTaskResult,
  StartRecorderRequest,
  StartTaskExecutionRequest,
  TaskExecutionStatus,
} from '../../shared/types.js';
import type {
  AgentEvent,
  AgentInvocationRequest,
  AgentInvocationResult,
  AgentStatus,
} from '../../shared/agent.js';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function streamAgentInvocation(
  body: AgentInvocationRequest,
  onEvent: (event: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<AgentInvocationResult> {
  const response = await fetch('/api/agent/invocations/stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const value = await response.json().catch(() => ({})) as { error?: string };
    throw new ApiError(value.error ?? `请求失败：${response.status}`, response.status);
  }
  if (!response.body) throw new Error('Agent 流缺少响应体');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let result: AgentInvocationResult | undefined;
  const acceptLine = (line: string) => {
    if (!line.trim()) return;
    const frame = JSON.parse(line) as {
      type: 'event' | 'result' | 'error';
      event?: AgentEvent;
      result?: AgentInvocationResult;
      error?: { message?: string };
    };
    if (frame.type === 'event' && frame.event) onEvent(frame.event);
    else if (frame.type === 'result' && frame.result) result = frame.result;
    else if (frame.type === 'error') throw new Error(frame.error?.message ?? 'Agent 调用失败');
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      let newline = pending.indexOf('\n');
      while (newline >= 0) {
        acceptLine(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        newline = pending.indexOf('\n');
      }
    }
    acceptLine(`${pending}${decoder.decode()}`);
  } finally {
    reader.releaseLock();
  }
  if (!result) throw new Error('Agent 流缺少最终结果');
  return result;
}

async function request<T>(pathname: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const response = await fetch(pathname, {
    ...init,
    headers,
  });
  const value = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new ApiError(value.error ?? `请求失败：${response.status}`, response.status);
  return value as T;
}

export const api = {
  reviewIdentity: () => request<ReviewServerIdentity>('/api/review/identity'),
  agentStatus: () => request<AgentStatus>('/api/agent/status'),
  invokeAgent: (body: AgentInvocationRequest) => request<AgentInvocationResult>(
    '/api/agent/invocations', { method: 'POST', body: JSON.stringify(body) },
  ),
  streamAgent: streamAgentInvocation,
  scenes: () => request<ReviewCatalogResponse>('/api/scenes'),
  recordings: () => request<ReviewRecordingCatalog>('/api/recordings'),
  recorderStatus: () => request<RecorderStatus>('/api/recorder/status'),
  refreshRecorderDisplays: () => request<RecorderDisplaysResult>(
    '/api/recorder/displays/refresh', { method: 'POST' },
  ),
  startRecorder: (body: StartRecorderRequest) => request<RecorderStatus>(
    '/api/recorder/start', { method: 'POST', body: JSON.stringify(body) },
  ),
  stopRecorder: () => request<RecorderStatus>('/api/recorder/stop', { method: 'POST' }),
  executionStatus: () => request<TaskExecutionStatus>('/api/execution/status'),
  startExecution: (body: StartTaskExecutionRequest) => request<TaskExecutionStatus>(
    '/api/execution/start', { method: 'POST', body: JSON.stringify(body) },
  ),
  stopExecution: () => request<TaskExecutionStatus>('/api/execution/stop', { method: 'POST' }),
  recording: (recording: string) =>
    request<ReviewRecording>(`/api/recordings/${encodeURIComponent(recording)}`),
  openRecordingFolder: (recording: string) =>
    request<{ opened: true; recording: string }>(
      `/api/recordings/${encodeURIComponent(recording)}/open-folder`,
      { method: 'POST' },
    ),
  createRecordingTask: (recording: string, body: CreateRecordingTaskRequest) =>
    request<CreateRecordingTaskResult>(
      `/api/recordings/${encodeURIComponent(recording)}/tasks`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  deleteRecording: (recording: string) => request<DeleteRecordingResult>(
    `/api/recordings/${encodeURIComponent(recording)}`,
    { method: 'DELETE' },
  ),
  tasks: (scene: string) => request<ReviewTaskListResponse>(`/api/scenes/${encodeURIComponent(scene)}/tasks`),
  task: (scene: string, task: string) => request<ReviewTaskView>(`/api/tasks/${encodeURIComponent(scene)}/${encodeURIComponent(task)}`),
  deleteTask: (scene: string, task: string) => request<DeleteTaskResult>(
    `/api/tasks/${encodeURIComponent(scene)}/${encodeURIComponent(task)}`,
    { method: 'DELETE' },
  ),
  mutate: (scene: string, task: string, draft: ReviewTaskDraft, mutation: ReviewMutation) =>
    request<ReviewMutationResult>(`/api/tasks/${encodeURIComponent(scene)}/${encodeURIComponent(task)}/mutate`, {
      method: 'POST', body: JSON.stringify({ draft, mutation }),
    }),
  validate: (scene: string, task: string, draft: ReviewTaskDraft) =>
    request<{ valid: boolean }>(`/api/tasks/${encodeURIComponent(scene)}/${encodeURIComponent(task)}/validate`, {
      method: 'POST', body: JSON.stringify(draft),
    }),
  save: (scene: string, task: string, revision: string, draft: ReviewTaskDraft) =>
    request<SaveReviewTaskResult>(`/api/tasks/${encodeURIComponent(scene)}/${encodeURIComponent(task)}`, {
      method: 'PUT', body: JSON.stringify({ expectedRevision: revision, ...draft }),
    }),
  evidenceUrl: (scene: string, task: string, evidencePath: string) => {
    const url = new URL(`/api/tasks/${encodeURIComponent(scene)}/${encodeURIComponent(task)}/evidence`, location.origin);
    url.searchParams.set('path', evidencePath);
    return url.toString();
  },
};
