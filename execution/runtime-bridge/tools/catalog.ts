import {
  describeTask,
  findTask,
  listScenes,
  listTasks,
  resolveRuntimeLayout,
} from '../../cua/index.js';
import type { CuaCatalogRequest, CuaCatalogResult } from '../contracts.js';

export interface CuaCatalogDependencies {
  resolveRuntimeLayout: typeof resolveRuntimeLayout;
  listScenes: typeof listScenes;
  listTasks: typeof listTasks;
  findTask: typeof findTask;
  describeTask: typeof describeTask;
}

const defaultDependencies: CuaCatalogDependencies = {
  resolveRuntimeLayout,
  listScenes,
  listTasks,
  findTask,
  describeTask,
};

function requiredId(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} 必须是非空字符串`);
  return value.trim();
}

export async function cuaCatalog(
  request: CuaCatalogRequest,
  dependencies: Partial<CuaCatalogDependencies> = {},
): Promise<CuaCatalogResult> {
  if (!['list-scenes', 'list-tasks', 'find-task', 'describe-task'].includes(request.action)) {
    throw new Error(`无法识别 cua_catalog action：${String((request as { action?: unknown }).action)}`);
  }
  const api = { ...defaultDependencies, ...dependencies };
  const layout = await api.resolveRuntimeLayout(request.dataRoot);
  if (request.action === 'list-scenes') {
    return { action: request.action, scenes: await api.listScenes(layout.catalog) };
  }
  if (request.action === 'find-task') {
    const task = requiredId(request.task, 'task');
    return { action: request.action, task, matches: await api.findTask(task, layout.catalog) };
  }
  const scene = requiredId(request.scene, 'scene');
  if (request.action === 'list-tasks') {
    return { action: request.action, scene, tasks: await api.listTasks(scene, layout.catalog) };
  }
  if (request.action === 'describe-task') {
    const task = requiredId(request.task, 'task');
    return {
      action: request.action,
      scene,
      task,
      description: await api.describeTask(scene, task, layout.catalog),
    };
  }
  throw new Error(`无法识别 cua_catalog action：${String((request as { action?: unknown }).action)}`);
}

