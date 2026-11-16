import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseYamlScript, ScriptPlayer } from '@midscene/core/yaml';
import type { Agent } from '@midscene/core';
import type { ExecutorResult } from '../cua/contracts/types.js';
import { createMidsceneExecutionObserver } from './midscene-final-screenshot.js';
import type { ExecutionProgressSink } from './midscene-progress.js';
import {
  createKeyboardEnabledComputerAgent,
  type ComputerAgent,
  type ComputerAgentOptions,
} from './computer-agent.js';
import { checkRequiredModelEnv, warnIfNodeVersionIsOld } from './env.js';
import {
  existingMidsceneHtmlReport,
  injectShrinkBannerIntoReport,
  midsceneReportFileName,
} from './midscene-report.js';
import { recoveryPrompt, replayFailure, type ReplayRecoveryOptions } from './midscene-replay-recovery.js';

interface AgentLike {
  runYaml(content: string): Promise<{ result: Record<string, unknown> }>;
  aiAct?: ComputerAgent['aiAct'];
  addDumpUpdateListener?: (
    listener: ReturnType<typeof createMidsceneExecutionObserver>['listener'],
  ) => () => void;
  reportFile?: string | null;
  destroy(): Promise<void>;
}

export interface MidsceneYamlExecutionOptions {
  yamlPath: string;
  resultPath: string;
  runDirectory: string;
  dryRun: boolean;
  captureAiActOutput?: boolean;
  replayFallback?: ReplayRecoveryOptions;
  abortSignal?: AbortSignal;
  onProgress?: ExecutionProgressSink;
  agentFactory?: (options: ComputerAgentOptions) => Promise<AgentLike>;
}

async function writeResult(resultPath: string, result: ExecutorResult): Promise<void> {
  await mkdir(path.dirname(resultPath), { recursive: true });
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

function prepareAiAct(agent: AgentLike, capture: boolean, abortSignal?: AbortSignal): () => string | undefined {
  if (!agent.aiAct) {
    if (capture) throw new Error('Midscene Agent 不支持捕获 aiAct 返回值');
    return () => undefined;
  }
  if (!capture && !abortSignal) return () => undefined;
  const executeAiAct = agent.aiAct.bind(agent);
  let captured: string | undefined;
  agent.aiAct = async (...args) => {
    if (abortSignal?.aborted) throw new Error('电脑操作已取消');
    const options = abortSignal ? { ...args[1], abortSignal } : args[1];
    const output = await executeAiAct(args[0], options);
    if (capture && typeof output === 'string' && output.trim()) captured = output;
    return output;
  };
  return () => captured;
}

function readQuestions(
  script: ReturnType<typeof parseYamlScript>, result: Record<string, unknown>,
): Record<string, string> {
  const questions: Record<string, string> = {};
  for (const task of script.tasks) {
    if (!String(task.name).endsWith(' | read')) continue;
    for (const flowItem of task.flow) {
      const action = flowItem as Record<string, unknown>;
      if (typeof action.name === 'string' && typeof action.aiAsk === 'string'
        && typeof result[action.name] === 'string') {
        questions[action.name] = action.aiAsk;
      }
    }
  }
  return questions;
}

type YamlArtifacts = Pick<ExecutorResult, 'midsceneResult' | 'reportPath' | 'finalScreenshotPath' | 'fallback'>;

function yamlAgentOptions(script: ReturnType<typeof parseYamlScript>): ComputerAgentOptions {
  return {
    ...(script.agent ?? {}),
    ...(script.computer?.displayId ? { displayId: script.computer.displayId } : {}),
    generateReport: script.agent?.generateReport ?? true,
    reportFileName: midsceneReportFileName,
    groupName: script.agent?.groupName ?? 'midscene-yaml-task',
    groupDescription: script.agent?.groupDescription ?? '执行 Midscene YAML 电脑操作任务',
  };
}

function restoreYamlEnvironment(runDirectory?: string, cacheDirectory?: string): void {
  if (runDirectory === undefined) delete process.env.MIDSCENE_RUN_DIR;
  else process.env.MIDSCENE_RUN_DIR = runDirectory;
  if (cacheDirectory === undefined) delete process.env.MIDSCENE_CACHE_DIR;
  else process.env.MIDSCENE_CACHE_DIR = cacheDirectory;
}

function setYamlEnvironment(runDirectory: string): void {
  process.env.MIDSCENE_RUN_DIR = path.join(path.resolve(runDirectory), 'midscene');
  process.env.MIDSCENE_CACHE_DIR = path.join(
    path.resolve(runDirectory), '..', '..', 'midscene-cache',
  );
}

function emitRecoveryProgress(
  options: MidsceneYamlExecutionOptions, taskIndex: number,
  status: 'running' | 'succeeded' | 'failed' | 'cancelled', message: string,
): void {
  options.onProgress?.({
    type: 'execution.progress', message,
    data: { source: 'midscene', taskIndex, taskId: 'adaptive-recovery',
      action: 'Adaptive', status, phase: 'adaptive' },
  });
}

function emitReplayFailureProgress(
  options: MidsceneYamlExecutionOptions, taskIndex: number, taskId: string,
): void {
  options.onProgress?.({
    type: 'execution.progress', message: '录制步骤未完成，准备接续电脑操作',
    data: { source: 'midscene', taskIndex, taskId,
      action: 'Replay', status: 'failed', phase: 'replay' },
  });
}

async function cleanupYamlAgent(
  agent: AgentLike | undefined, removeDumpListener: (() => void) | undefined,
  previousRunDirectory: string | undefined, previousCacheDirectory: string | undefined,
  artifacts: YamlArtifacts,
): Promise<void> {
  try {
    removeDumpListener?.();
  } finally {
    try {
      if (agent) {
        try { await agent.destroy(); }
        finally {
          artifacts.reportPath = await existingMidsceneHtmlReport(agent.reportFile);
          if (artifacts.reportPath) {
            const shrinkFactor = Number(process.env.MIDSCENE_SCREENSHOT_SHRINK_FACTOR || '1');
            await injectShrinkBannerIntoReport(
              artifacts.reportPath, Number.isFinite(shrinkFactor) ? shrinkFactor : 1,
            );
          }
        }
      }
    } finally {
      restoreYamlEnvironment(previousRunDirectory, previousCacheDirectory);
    }
  }
}

function replayRecoveryError(step: string, replayReason: string, error: unknown): Error {
  const recoveryReason = error instanceof Error ? error.message : String(error);
  return new Error(
    `Replay 步骤 ${step} 失败：${replayReason}\nAdaptive 接续失败：${recoveryReason}`,
    { cause: error },
  );
}

async function runReplayWithFallback(
  agent: AgentLike, script: ReturnType<typeof parseYamlScript>, options: MidsceneYamlExecutionOptions,
  artifacts: YamlArtifacts, onRecoveryStart: () => void,
): Promise<void> {
  const player = new ScriptPlayer(script, async () => ({ agent: agent as Agent, freeFn: [] }));
  await player.run();
  if (player.status === 'done') {
    const questions = readQuestions(script, player.result);
    artifacts.midsceneResult = {
      ...player.result,
      ...(Object.keys(questions).length ? { readQuestions: questions } : {}),
    };
    return;
  }
  const failure = replayFailure(player.taskStatusList);
  if (!failure || player.errorInSetup || options.abortSignal?.aborted || !agent.aiAct) {
    throw player.errorInSetup
      ?? player.taskStatusList.find(task => task.status === 'error')?.error
      ?? new Error('Replay 执行未完成');
  }
  artifacts.fallback = failure.fallback;
  const questions = readQuestions(script, player.result);
  artifacts.midsceneResult = {
    ...player.result,
    ...(Object.keys(questions).length ? { readQuestions: questions } : {}),
  };
  emitReplayFailureProgress(options, player.currentTaskIndex ?? 0, failure.fallback.failedStep);
  onRecoveryStart();
  emitRecoveryProgress(options, player.currentTaskIndex ?? 0, 'running', '正在接续电脑操作');
  const prompt = recoveryPrompt(options.replayFallback!, failure.fallback, failure.reason, player.result);
  let answer: unknown;
  try {
    answer = await agent.aiAct(prompt, { abortSignal: options.abortSignal });
    if (options.abortSignal?.aborted) throw new Error('电脑操作已取消');
  } catch (error) {
    emitRecoveryProgress(
      options, player.currentTaskIndex ?? 0,
      options.abortSignal?.aborted ? 'cancelled' : 'failed', '接续执行未完成',
    );
    if (options.abortSignal?.aborted) throw error;
    throw replayRecoveryError(failure.fallback.failedStep, failure.reason, error);
  }
  artifacts.fallback = { ...failure.fallback, recoveryStatus: 'succeeded' };
  artifacts.midsceneResult = {
    ...artifacts.midsceneResult,
    ...(typeof answer === 'string' && answer.trim() ? { aiActOutput: answer } : {}),
  };
  emitRecoveryProgress(options, player.currentTaskIndex ?? 0, 'succeeded', '接续执行完成');
}

async function runMidsceneScript(
  content: string, script: ReturnType<typeof parseYamlScript>, options: MidsceneYamlExecutionOptions,
  artifacts: YamlArtifacts,
): Promise<void> {
  warnIfNodeVersionIsOld();
  checkRequiredModelEnv();
  const previousRunDirectory = process.env.MIDSCENE_RUN_DIR;
  const previousCacheDirectory = process.env.MIDSCENE_CACHE_DIR;
  let agent: AgentLike | undefined;
  let removeDumpListener: (() => void) | undefined;
  let phase: 'replay' | 'adaptive' = 'replay';
  const progress = options.replayFallback && options.onProgress
    ? (event: Parameters<ExecutionProgressSink>[0]) => options.onProgress?.({
      ...event, data: { ...event.data, phase },
    }) : options.onProgress;
  const observer = createMidsceneExecutionObserver(progress);
  try {
    setYamlEnvironment(options.runDirectory);
    agent = await (options.agentFactory ?? createKeyboardEnabledComputerAgent)(yamlAgentOptions(script));
    if (agent.addDumpUpdateListener) {
      removeDumpListener = agent.addDumpUpdateListener(observer.listener);
    } else if (options.onProgress) {
      throw new Error('Midscene Agent 不支持过程事件');
    }
    const capturedOutput = prepareAiAct(agent, options.captureAiActOutput === true, options.abortSignal);
    if (options.abortSignal?.aborted) throw new Error('电脑操作已取消');
    if (options.replayFallback) {
      await runReplayWithFallback(agent, script, options, artifacts, () => { phase = 'adaptive'; });
    } else {
      const yamlResult = (await agent.runYaml(content)).result;
      const aiActOutput = capturedOutput();
      const questions = readQuestions(script, yamlResult);
      artifacts.midsceneResult = {
        ...yamlResult,
        ...(Object.keys(questions).length ? { readQuestions: questions } : {}),
        ...(aiActOutput === undefined ? {} : { aiActOutput }),
      };
    }
    artifacts.finalScreenshotPath = await observer.persistFinalScreenshot(options.runDirectory);
  } finally {
    if (artifacts.fallback && !artifacts.finalScreenshotPath) {
      try { artifacts.finalScreenshotPath = await observer.persistFinalScreenshot(options.runDirectory); }
      catch { /* 保留执行失败的原始原因 */ }
    }
    await cleanupYamlAgent(agent, removeDumpListener, previousRunDirectory, previousCacheDirectory, artifacts);
  }
}

export async function executeMidsceneYaml(
  options: MidsceneYamlExecutionOptions,
): Promise<ExecutorResult> {
  const yamlPath = path.resolve(options.yamlPath);
  const resultPath = path.resolve(options.resultPath);
  let taskCount: number | undefined;
  const artifacts: YamlArtifacts = {};
  try {
    let content: string;
    try {
      content = await readFile(yamlPath, 'utf8');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`读取 Midscene YAML 失败：${yamlPath}\n${message}`);
    }
    const script = parseYamlScript(content, yamlPath);
    if (!Array.isArray(script.tasks) || script.tasks.length === 0) {
      throw new Error('Midscene YAML tasks 必须是非空数组');
    }
    taskCount = script.tasks.length;
    if (!options.dryRun) {
      await runMidsceneScript(content, script, options, artifacts);
    }

    const result: ExecutorResult = {
      schemaVersion: '0.2',
      status: 'succeeded',
      sourceYamlPath: yamlPath,
      dryRun: options.dryRun,
      taskCount,
      ...artifacts,
      finishedAt: new Date().toISOString(),
    };
    await writeResult(resultPath, result);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeResult(resultPath, {
      schemaVersion: '0.2',
      status: 'failed',
      sourceYamlPath: yamlPath,
      dryRun: options.dryRun,
      ...(taskCount === undefined ? {} : { taskCount }),
      ...artifacts,
      finishedAt: new Date().toISOString(),
      error: message,
    });
    throw error;
  }
}
