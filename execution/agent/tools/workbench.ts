import { startReviewServer } from '../../review/server/main.js';
import type { CuaWorkbenchRequest, CuaWorkbenchResult } from '../contracts.js';

export interface CuaWorkbenchDependencies {
  startReviewServer: typeof startReviewServer;
}

function targetUrl(baseUrl: string, request: CuaWorkbenchRequest): string {
  const url = new URL(baseUrl);
  url.searchParams.set('mode', request.mode);
  if (request.mode !== 'recording') {
    if (request.scene !== undefined) url.searchParams.set('scene', request.scene);
    if (request.task !== undefined) url.searchParams.set('task', request.task);
  }
  return url.toString();
}

function optionalId(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} 必须是非空字符串`);
  return value.trim();
}

export async function cuaWorkbench(
  request: CuaWorkbenchRequest,
  dependencies: Partial<CuaWorkbenchDependencies> = {},
): Promise<CuaWorkbenchResult> {
  if (!['recording', 'review', 'execution'].includes(request.mode)) {
    throw new Error(`无法识别 cua_workbench mode：${String((request as { mode?: unknown }).mode)}`);
  }
  const rawTarget = request as CuaWorkbenchRequest & { scene?: unknown; task?: unknown };
  const scene = optionalId(rawTarget.scene, 'scene');
  const task = optionalId(rawTarget.task, 'task');
  if (request.mode !== 'recording' && task !== undefined && scene === undefined) {
    throw new Error('提供 task 时必须同时提供 scene');
  }
  const normalizedRequest = { ...request, ...(scene === undefined ? {} : { scene }), ...(task === undefined ? {} : { task }) };
  const server = await (dependencies.startReviewServer ?? startReviewServer)({
    ...(request.dataRoot === undefined ? {} : { dataRoot: request.dataRoot }),
  });
  return {
    mode: request.mode,
    baseUrl: server.url,
    url: targetUrl(server.url, normalizedRequest),
    reused: server.reused,
  };
}
