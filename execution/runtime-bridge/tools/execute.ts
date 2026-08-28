import path from 'node:path';
import {
  requireDataPaths,
  resolveRuntimeLayout,
  runNaturalLanguageAiAct,
  runRecordedTaskAiAct,
  runTask,
} from '../../cua/index.js';
import type { CuaExecuteRequest, CuaExecuteResult } from '../contracts.js';

export interface CuaExecuteDependencies {
  resolveRuntimeLayout: typeof resolveRuntimeLayout;
  requireDataPaths: typeof requireDataPaths;
  runTask: typeof runTask;
  runRecordedTaskAiAct: typeof runRecordedTaskAiAct;
  runNaturalLanguageAiAct: typeof runNaturalLanguageAiAct;
}

const defaultDependencies: CuaExecuteDependencies = {
  resolveRuntimeLayout,
  requireDataPaths,
  runTask,
  runRecordedTaskAiAct,
  runNaturalLanguageAiAct,
};

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} 必须是非空字符串`);
  return value.trim();
}

export async function cuaExecute(
  request: CuaExecuteRequest,
  dependencies: Partial<CuaExecuteDependencies> = {},
): Promise<CuaExecuteResult> {
  if (!['replay', 'guided', 'freeform'].includes(request.strategy)) {
    throw new Error(`无法识别 cua_execute strategy：${String((request as { strategy?: unknown }).strategy)}`);
  }
  const api = { ...defaultDependencies, ...dependencies };
  const layout = await api.resolveRuntimeLayout(request.dataRoot);
  const data = await api.requireDataPaths(layout);

  if (request.strategy === 'freeform') {
    const run = await api.runNaturalLanguageAiAct({
      prompt: requiredString(request.goal, 'goal'),
      runsRoot: data.runsRoot,
      dryRun: request.dryRun,
      ...(request.displayId === undefined ? {} : { displayId: request.displayId }),
    });
    return {
      strategy: request.strategy,
      status: run.executorResult.status,
      runDir: run.runDirectory,
      promptPath: run.promptPath,
      resultPath: run.resultPath,
      executor: run.executorResult,
    };
  }

  const options = {
    scene: requiredString(request.scene, 'scene'),
    task: requiredString(request.task, 'task'),
    catalog: layout.catalog,
    runsRoot: data.runsRoot,
    ...(request.inputs === undefined ? {} : { inputs: request.inputs }),
    dryRun: request.dryRun,
  };
  if (request.strategy === 'replay') {
    const run = await api.runTask(options);
    return {
      strategy: request.strategy,
      status: run.executorResult.status,
      runDir: path.dirname(run.resolvedTaskPath),
      resolvedTaskPath: run.resolvedTaskPath,
      executor: run.executorResult,
    };
  }
  if (request.strategy === 'guided') {
    const run = await api.runRecordedTaskAiAct(options);
    return {
      strategy: request.strategy,
      status: run.executorResult.status,
      runDir: path.dirname(run.resolvedTaskPath),
      resolvedTaskPath: run.resolvedTaskPath,
      promptPath: run.promptPath,
      executor: run.executorResult,
    };
  }
  throw new Error(`无法识别 cua_execute strategy：${String((request as { strategy?: unknown }).strategy)}`);
}

