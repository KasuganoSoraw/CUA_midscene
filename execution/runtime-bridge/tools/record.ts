import { resolveRuntimeLayout, requireDataPaths } from '../../cua/task/data-paths.js';
import { defaultReviewPort, reviewDataRootKey, reviewProtocolVersion, reviewServiceName } from '../../review/server/main.js';
import type { RecordingProgress, RecordingResult } from '../../review/shared/recording.js';
import { validatePreparedAssets } from '../../review/service/prepare-recording.js';
import { randomUUID } from 'node:crypto';

export interface CuaRecordRequest { goal: string; dataRoot?: string }

export function recordingServiceUrl(): URL {
  const url = new URL(process.env.CUA_REVIEW_URL ?? `http://127.0.0.1:${defaultReviewPort}/`);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('CUA_REVIEW_URL 必须为本机 loopback HTTP 服务根地址');
  }
  return url;
}

async function verifyService(url: URL, dataRoot: string): Promise<void> {
  let response;
  try {
    response = await fetch(new URL('/api/review/identity', url), {
      signal: AbortSignal.timeout(2000), redirect: 'error',
    });
  } catch {
    throw new Error('录制服务未启动，请由宿主 Keeper 启动本地 Workbench Service');
  }
  const identity = await response.json() as Record<string, unknown>;
  if (!response.ok || identity.service !== reviewServiceName
    || identity.protocolVersion !== reviewProtocolVersion
    || identity.dataRootKey !== reviewDataRootKey(dataRoot)) {
    throw new Error('录制服务版本或数据目录不匹配，请更新并重启宿主 Keeper');
  }
}

async function readRecordingResult(
  response: Response, onProgress?: (event: RecordingProgress) => void,
): Promise<RecordingResult> {
  if (!response.ok || !response.body) throw new Error(`录制服务请求失败：HTTP ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: RecordingResult | undefined;
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      if (buffer.length > 1_048_576) throw new Error('录制服务帧超过限制');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines.filter(Boolean)) {
        const frame = JSON.parse(line) as { type: string; event?: RecordingProgress; result?: RecordingResult };
        if (frame.type === 'heartbeat') continue;
        if (frame.type === 'event' && frame.event?.type === 'recording.progress') onProgress?.(frame.event);
        else if (frame.type === 'result' && frame.result) {
          if (result) throw new Error('录制服务重复返回终态');
          result = frame.result;
        } else throw new Error('录制服务帧无效');
      }
      if (chunk.done) break;
    }
    if (buffer.trim() || !result || !['completed', 'cancelled', 'failed'].includes(result.status)) {
      throw new Error('录制服务没有返回完整终态');
    }
    return result;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export async function cuaRecord(
  request: CuaRecordRequest, onProgress?: (event: RecordingProgress) => void, signal?: AbortSignal,
): Promise<RecordingResult> {
  if (Object.keys(request).some((key) => !['goal', 'dataRoot'].includes(key))) {
    throw new Error('录制仅接受 goal 和内部 dataRoot');
  }
  if (typeof request.goal !== 'string' || !request.goal.trim()) throw new Error('录制目标不能为空');
  const layout = await resolveRuntimeLayout(request.dataRoot);
  const data = await requireDataPaths(layout);
  const url = recordingServiceUrl();
  await verifyService(url, data.root);
  signal?.throwIfAborted();
  const sessionId = randomUUID();
  try {
    const response = await fetch(new URL('/api/recorder/record', url), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goal: request.goal, sessionId }), signal, redirect: 'error',
    });
    const result = await readRecordingResult(response, onProgress);
    if (result.status === 'completed') {
      result.assets = await validatePreparedAssets(result.assets, result.assets.recordingRoot);
    }
    return result;
  } finally {
    if (signal?.aborted) {
      const response = await fetch(new URL('/api/recorder/abort', url), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId }), signal: AbortSignal.timeout(25_000), redirect: 'error',
      });
      if (!response.ok) throw new Error(`录制取消未确认：HTTP ${response.status}`);
      await response.arrayBuffer();
    }
  }
}
