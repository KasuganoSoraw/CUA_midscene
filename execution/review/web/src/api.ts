import type {
  CreateRecordingTaskRequest,
  CreateRecordingTaskResult,
  ReviewCatalogResponse,
  ReviewMutation,
  ReviewMutationResult,
  ReviewRecording,
  ReviewRecordingCatalog,
  ReviewTaskDraft,
  ReviewTaskListResponse,
  ReviewTaskView,
  SaveReviewTaskResult,
} from '../../shared/types.js';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
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
  scenes: () => request<ReviewCatalogResponse>('/api/scenes'),
  recordings: () => request<ReviewRecordingCatalog>('/api/recordings'),
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
  tasks: (scene: string) => request<ReviewTaskListResponse>(`/api/scenes/${encodeURIComponent(scene)}/tasks`),
  task: (scene: string, task: string) => request<ReviewTaskView>(`/api/tasks/${encodeURIComponent(scene)}/${encodeURIComponent(task)}`),
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
