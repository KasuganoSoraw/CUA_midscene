import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseYamlScript } from '@midscene/core/yaml';
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

type YamlArtifacts = Pick<ExecutorResult, 'midsceneResult' | 'reportPath' | 'finalScreenshotPath'>;

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
  const observer = createMidsceneExecutionObserver(options.onProgress);
  try {
    process.env.MIDSCENE_RUN_DIR = path.join(path.resolve(options.runDirectory), 'midscene');
    // 缓存目录固定到 runsRoot 同级（dataRoot/midscene-cache），避免随每次
    // 运行的随机 run 目录漂移，保证跨运行 plan 缓存可命中。
    process.env.MIDSCENE_CACHE_DIR = path.join(
      path.resolve(options.runDirectory),
      '..',
      '..',
      'midscene-cache',
    );
    agent = await (options.agentFactory ?? createKeyboardEnabledComputerAgent)(yamlAgentOptions(script));
    if (agent.addDumpUpdateListener) {
      removeDumpListener = agent.addDumpUpdateListener(observer.listener);
    } else if (options.onProgress) {
      throw new Error('Midscene Agent 不支持过程事件');
    }
    const capturedOutput = prepareAiAct(agent, options.captureAiActOutput === true, options.abortSignal);
    if (options.abortSignal?.aborted) throw new Error('电脑操作已取消');
    const yamlResult = (await agent.runYaml(content)).result;
    const aiActOutput = capturedOutput();
    const questions = readQuestions(script, yamlResult);
    artifacts.midsceneResult = {
      ...yamlResult,
      ...(Object.keys(questions).length ? { readQuestions: questions } : {}),
      ...(aiActOutput === undefined ? {} : { aiActOutput }),
    };
    artifacts.finalScreenshotPath = await observer.persistFinalScreenshot(options.runDirectory);
  } finally {
    await cleanupYamlAgent(agent, removeDumpListener, previousRunDirectory, previousCacheDirectory, artifacts);
  }
}

export async function executeMidsceneYaml(
  options: MidsceneYamlExecutionOptions,
): Promise<ExecutorResult> {
  const yamlPath = path.resolve(options.yamlPath);
  const resultPath = path.resolve(options.resultPath);
  let taskCount: number | undefined;
  const artifacts: Pick<ExecutorResult, 'midsceneResult' | 'reportPath' | 'finalScreenshotPath'> = {};
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
