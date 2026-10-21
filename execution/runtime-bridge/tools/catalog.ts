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

const CATALOG_ACTIONS = ['list-scenes', 'list-tasks', 'find-task', 'describe-task'] as const;

function normalizeCatalogAction(rawAction: unknown): string {
  let text: string;
  if (Array.isArray(rawAction) && rawAction.length > 0) {
    text = String(rawAction[0]);
  } else {
    text = String(rawAction);
  }
  const lowered = text.toLowerCase();
  for (const action of CATALOG_ACTIONS) {
    if (lowered.includes(action)) {
      return action;
    }
  }
  return text.trim();
}

export async function cuaCatalog(
  request: CuaCatalogRequest,
  dependencies: Partial<CuaCatalogDependencies> = {},
): Promise<CuaCatalogResult> {
  // 模型（如 GTSLLM-Pro-Moe）可能把 const 枚举值输出为数组、带引号、
  // 带噪声字符（如 list-scenes>），用子串匹配提取已知 action。
  const action = normalizeCatalogAction((request as { action?: unknown }).action);
  if (!CATALOG_ACTIONS.includes(action as typeof CATALOG_ACTIONS[number])) {
    throw new Error(`无法识别 cua_catalog action：${action}`);
  }
  const api = { ...defaultDependencies, ...dependencies };
  const layout = await api.resolveRuntimeLayout(request.dataRoot);
  if (action === 'list-scenes') {
    return { action: 'list-scenes', scenes: await api.listScenes(layout.catalog) };
  }
  if (action === 'find-task') {
    const task = requiredId((request as { task?: unknown }).task, 'task');
    return { action: 'find-task', task, matches: await api.findTask(task, layout.catalog) };
  }
  const scene = requiredId((request as { scene?: unknown }).scene, 'scene');
  if (action === 'list-tasks') {
    return { action: 'list-tasks', scene, tasks: await api.listTasks(scene, layout.catalog) };
  }
  if (action === 'describe-task') {
    const task = requiredId((request as { task?: unknown }).task, 'task');
    return {
      action: 'describe-task',
      scene,
      task,
      description: await api.describeTask(scene, task, layout.catalog),
    };
  }
  throw new Error(`无法识别 cua_catalog action：${action}`);
}

