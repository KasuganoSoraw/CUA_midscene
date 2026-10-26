import path from 'node:path';
import { requireSkillsRoot } from '../../cua/data-paths.js';
import { requireSkillName } from '../../cua/skills/paths.js';
import type { ExecutionOptions } from '../../cua/task/execution.js';
import {
  requireDataPaths,
  resolveRuntimeLayout,
  runNaturalLanguageAiAct,
  runRecordedTaskAiAct,
  runTask,
} from '../../cua/index.js';
import type { CuaExecuteRequest, CuaExecuteResult } from '../contracts.js';
import type { ExecutionProgressSink } from '../../executors/midscene-progress.js';

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

function optionalStringRecord(value: unknown, name: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} 必须是 JSON object`);
  }
  const entries = Object.entries(value);
  const invalid = entries.find(([, item]) => typeof item !== 'string');
  if (invalid) throw new Error(`${name}.${invalid[0]} 必须是字符串`);
  return Object.fromEntries(entries) as Record<string, string>;
}

export async function cuaExecute(
  request: CuaExecuteRequest,
  dependencies: Partial<CuaExecuteDependencies> = {},
  onProgress?: ExecutionProgressSink,
): Promise<CuaExecuteResult> {
  if ('skillName' in request) return executeSkillRequest(request, dependencies, onProgress);
  if (!['replay', 'guided', 'freeform'].includes(request.strategy)) {
    throw new Error(`无法识别 cua_execute strategy：${String((request as { strategy?: unknown }).strategy)}`);
  }
  const rawInputs = (request as { inputs?: unknown }).inputs;
  if (request.strategy === 'freeform' && rawInputs !== undefined) {
    throw new Error('freeform cua_execute 不接受 inputs');
  }
  const inputs = optionalStringRecord(rawInputs, 'inputs');
  const api = { ...defaultDependencies, ...dependencies };
  const layout = await api.resolveRuntimeLayout(request.dataRoot);
  const data = await api.requireDataPaths(layout);

  if (request.strategy === 'freeform') {
    const run = await api.runNaturalLanguageAiAct({
      prompt: requiredString(request.goal, 'goal'),
      runsRoot: data.runsRoot,
      dryRun: request.dryRun,
      ...(request.displayId === undefined ? {} : { displayId: request.displayId }),
      ...(onProgress === undefined ? {} : { onProgress }),
    });
    return {
      strategy: request.strategy,
      status: run.executorResult.status,
      runDir: run.runDirectory,
      promptPath: run.promptPath,
      resultPath: run.resultPath,
      ...(run.executorResult.reportPath == null ? {} : { reportPath: run.executorResult.reportPath }),
      ...(run.executorResult.finalScreenshotPath == null
        ? {}
        : { finalScreenshotPath: run.executorResult.finalScreenshotPath }),
      executor: run.executorResult,
    };
  }

  const options = {
    scene: requiredString(request.scene, 'scene'),
    task: requiredString(request.task, 'task'),
    catalog: layout.catalog,
    runsRoot: data.runsRoot,
    ...(inputs === undefined ? {} : { inputs }),
    dryRun: request.dryRun,
    ...(onProgress === undefined ? {} : { onProgress }),
  };
  if (request.strategy === 'replay') {
    const run = await api.runTask(options);
    return {
      strategy: request.strategy,
      status: run.executorResult.status,
      runDir: path.dirname(run.resolvedTaskPath),
      resolvedTaskPath: run.resolvedTaskPath,
      ...(run.executorResult.reportPath == null ? {} : { reportPath: run.executorResult.reportPath }),
      ...(run.executorResult.finalScreenshotPath == null
        ? {}
        : { finalScreenshotPath: run.executorResult.finalScreenshotPath }),
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
      ...(run.executorResult.reportPath == null ? {} : { reportPath: run.executorResult.reportPath }),
      ...(run.executorResult.finalScreenshotPath == null
        ? {}
        : { finalScreenshotPath: run.executorResult.finalScreenshotPath }),
      executor: run.executorResult,
    };
  }
  throw new Error(`无法识别 cua_execute strategy：${String((request as { strategy?: unknown }).strategy)}`);
}

async function executeSkillRequest(
  request: Extract<CuaExecuteRequest, { skillName: string }>,
  dependencies: Partial<CuaExecuteDependencies>, onProgress?: ExecutionProgressSink,
): Promise<CuaExecuteResult> {
  const allowed = new Set(['skillName', 'strategy', 'inputs', 'dryRun', 'dataRoot']);
  if (Object.keys(request).some(key => !allowed.has(key))) throw new Error('Skill 执行包含不支持的字段或任意路径');
  const strategy = request.strategy ?? 'guided';
  if (strategy !== 'guided' && strategy !== 'replay') throw new Error('Skill 仅支持 guided 或 replay');
  const skillName = requireSkillName(request.skillName);
  const api = { ...defaultDependencies, ...dependencies };
  const layout = await api.resolveRuntimeLayout(request.dataRoot);
  const data = await api.requireDataPaths(layout);
  const options: ExecutionOptions = {
    skillName, skillsRoot: requireSkillsRoot(layout), runsRoot: data.runsRoot,
    inputs: optionalStringRecord(request.inputs, 'inputs'), dryRun: request.dryRun, onProgress,
  };
  const run = strategy === 'guided' ? await api.runRecordedTaskAiAct(options) : await api.runTask(options);
  return {
    strategy, status: run.executorResult.status, runDir: path.dirname(run.resolvedTaskPath),
    resolvedTaskPath: run.resolvedTaskPath,
    ...('promptPath' in run ? { promptPath: String(run.promptPath) } : {}),
    ...(run.executorResult.reportPath ? { reportPath: run.executorResult.reportPath } : {}),
    ...(run.executorResult.finalScreenshotPath ? { finalScreenshotPath: run.executorResult.finalScreenshotPath } : {}),
    executor: run.executorResult,
  };
}

