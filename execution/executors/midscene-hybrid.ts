import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  type AiActOptions,
  type TUserPrompt,
} from '@midscene/core';
import { parseYamlScript } from '@midscene/core/yaml';
import type {
  ExecutorResult,
  HybridExecutionSummary,
  HybridStepResult,
  JsonObject,
} from '../cua/contracts/types.js';
import { buildRecordedTaskAiActPrompt } from '../cua/task/recorded-task-prompt.js';
import { dumpYamlDocument, readYamlDocument } from '../cua/task/yaml-task.js';
import { createMidsceneExecutionObserver } from './midscene-final-screenshot.js';
import type {
  ExecutionProgress,
  ExecutionProgressSink,
} from './midscene-progress.js';
import { createMidsceneProgressListener } from './midscene-progress.js';
import {
  createKeyboardEnabledComputerAgent,
  keyboardInputAiActContext,
  type ComputerAgentOptions,
} from './computer-agent.js';
import { checkRequiredModelEnv, warnIfNodeVersionIsOld } from './env.js';
import { existingMidsceneHtmlReport, midsceneReportFileName } from './midscene-report.js';

const defaultRecoveryLimit = 3;

interface AgentLike {
  runYaml(content: string): Promise<{ result: Record<string, unknown> }>;
  aiAct(prompt: TUserPrompt, options?: AiActOptions): Promise<string | undefined>;
  addDumpUpdateListener?: (
    listener: ReturnType<typeof createMidsceneExecutionObserver>['listener'],
  ) => () => void;
  reportFile?: string | null;
  destroy(): Promise<void>;
}

export interface MidsceneHybridExecutionOptions {
  yamlPath: string;
  resultPath: string;
  runDirectory: string;
  dryRun: boolean;
  goal: string;
  maxRecoveries?: number;
  abortSignal?: AbortSignal;
  onProgress?: ExecutionProgressSink;
  agentFactory?: (options: ComputerAgentOptions) => Promise<AgentLike>;
}

interface ProgressContext {
  stepIndex: number;
  stepId: string;
  phase: 'replay' | 'recovery';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readStepIdentity(task: JsonObject, stepIndex: number): { stepId: string; name: string } {
  const name = typeof task.name === 'string' ? task.name.trim() : '';
  const match = /^(step-\d{3,})\b/u.exec(name);
  if (!match) throw new Error(`混合回放 tasks[${stepIndex + 1}].name 缺少合法 step ID`);
  return { stepId: match[1], name };
}

function withSingleTask(document: JsonObject, task: JsonObject): JsonObject {
  return { ...document, tasks: [task] };
}

function recoveryPrompt(
  document: JsonObject,
  task: JsonObject,
  goal: string,
  replayError: string,
): TUserPrompt {
  const intendedStep = buildRecordedTaskAiActPrompt(withSingleTask(document, task));
  const prompt = [
    '严格回放当前录制步骤时遇到界面变化。请只恢复并完成当前步骤。',
    `完整任务目标：${goal}`,
    `当前步骤：${String(task.name)}`,
    `当前步骤意图：\n${intendedStep.prompt.trim()}`,
    `回放错误：${replayError}`,
    '处理当前界面的轻微偏移、弹窗或确认，并用最少操作完成当前步骤。',
    '如果当前步骤的目标动作实际上已经完成，不要重复产生相同副作用。',
    '不要执行后续步骤，不要重复已经完成的前序步骤，也不要扩大任务范围。',
  ].join('\n');
  if (!intendedStep.images.length) return prompt;
  return {
    prompt,
    images: intendedStep.images,
    ...(intendedStep.convertHttpImage2Base64 === true
      ? { convertHttpImage2Base64: true }
      : {}),
  };
}

function mapProgress(
  onProgress: ExecutionProgressSink | undefined,
  context: () => ProgressContext | undefined,
): ExecutionProgressSink | undefined {
  if (!onProgress) return undefined;
  return (event) => {
    const current = context();
    if (!current) return;
    onProgress({
      ...event,
      data: {
        ...event.data,
        taskIndex: current.stepIndex,
        taskId: current.stepId,
        phase: current.phase,
      },
    });
  };
}

function emitRecoveryProgress(
  onProgress: ExecutionProgressSink | undefined,
  context: ProgressContext,
  status: ExecutionProgress['data']['status'],
  description: string,
): void {
  onProgress?.({
    type: 'execution.progress',
    message: `Recovery - ${description}`,
    data: {
      source: 'midscene',
      taskIndex: context.stepIndex,
      taskId: context.stepId,
      action: 'Recovery',
      description,
      status,
      phase: 'recovery',
    },
  });
}

async function writeResult(resultPath: string, result: ExecutorResult): Promise<void> {
  await mkdir(path.dirname(resultPath), { recursive: true });
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

export async function executeMidsceneHybrid(
  options: MidsceneHybridExecutionOptions,
): Promise<ExecutorResult> {
  const yamlPath = path.resolve(options.yamlPath);
  const resultPath = path.resolve(options.resultPath);
  const maxRecoveries = options.maxRecoveries ?? defaultRecoveryLimit;
  if (!Number.isInteger(maxRecoveries) || maxRecoveries < 0) {
    throw new Error('混合回放 maxRecoveries 必须是非负整数');
  }

  let taskCount: number | undefined;
  let reportPath: string | undefined;
  let finalScreenshotPath: string | undefined;
  const stepResults: HybridStepResult[] = [];
  const recoverySteps: string[] = [];
  let recoveryAttempts = 0;
  let recoverySucceeded = 0;
  const summary = (): HybridExecutionSummary => ({
    steps: [...stepResults],
    recovery: {
      attempted: recoveryAttempts,
      succeeded: recoverySucceeded,
      limit: maxRecoveries,
      steps: [...recoverySteps],
    },
  });

  try {
    const document = await readYamlDocument(yamlPath);
    const content = dumpYamlDocument(document);
    const script = parseYamlScript(content, yamlPath);
    const tasks = document.tasks as JsonObject[];
    taskCount = tasks.length;
    const rawResults: Record<string, unknown>[] = [];

    if (!options.dryRun) {
      warnIfNodeVersionIsOld();
      checkRequiredModelEnv();
      const previousRunDirectory = process.env.MIDSCENE_RUN_DIR;
      let agent: AgentLike | undefined;
      let removeDumpListener: (() => void) | undefined;
      let currentProgress: ProgressContext | undefined;
      let progressListener: ReturnType<typeof createMidsceneProgressListener> | undefined;
      const observer = createMidsceneExecutionObserver();
      const dumpListener: ReturnType<typeof createMidsceneExecutionObserver>['listener'] = (dump, executionDump) => {
        observer.listener(dump, executionDump);
        progressListener?.(dump, executionDump);
      };
      const setProgressContext = (context: ProgressContext): void => {
        currentProgress = context;
        const sink = mapProgress(options.onProgress, () => currentProgress);
        progressListener = sink ? createMidsceneProgressListener(sink) : undefined;
      };
      try {
        process.env.MIDSCENE_RUN_DIR = path.join(path.resolve(options.runDirectory), 'midscene');
        const agentOptions: ComputerAgentOptions = {
          ...(script.agent ?? {}),
          ...(script.computer?.displayId ? { displayId: script.computer.displayId } : {}),
          generateReport: script.agent?.generateReport ?? true,
          reportFileName: midsceneReportFileName,
          groupName: script.agent?.groupName ?? 'midscene-hybrid-task',
          groupDescription: script.agent?.groupDescription ?? options.goal,
          aiActContext: keyboardInputAiActContext,
        };
        agent = await (options.agentFactory ?? createKeyboardEnabledComputerAgent)(agentOptions);
        if (agent.addDumpUpdateListener) {
          removeDumpListener = agent.addDumpUpdateListener(dumpListener);
        } else if (options.onProgress) {
          throw new Error('Midscene Agent 不支持过程事件');
        }

        for (const [stepIndex, task] of tasks.entries()) {
          const { stepId, name } = readStepIdentity(task, stepIndex);
          setProgressContext({ stepIndex, stepId, phase: 'replay' });
          try {
            const replay = await agent.runYaml(dumpYamlDocument(withSingleTask(document, task)));
            rawResults.push(replay.result);
            stepResults.push({ stepIndex, stepId, name, status: 'replayed' });
            continue;
          } catch (error) {
            const replayError = errorMessage(error);
            if (recoveryAttempts >= maxRecoveries) {
              const message = `混合回放恢复次数已达到上限 ${maxRecoveries}，无法恢复 ${stepId}`;
              stepResults.push({ stepIndex, stepId, name, status: 'failed', replayError, recoveryError: message });
              throw new Error(message, { cause: error });
            }

            recoveryAttempts += 1;
            recoverySteps.push(stepId);
            setProgressContext({ stepIndex, stepId, phase: 'recovery' });
            if (!currentProgress) throw new Error('混合回放进度上下文初始化失败');
            emitRecoveryProgress(options.onProgress, currentProgress, 'running', `正在恢复 ${name}`);
            try {
              const recovered = await agent.aiAct(
                recoveryPrompt(document, task, options.goal, replayError),
                options.abortSignal ? { abortSignal: options.abortSignal } : undefined,
              );
              recoverySucceeded += 1;
              stepResults.push({
                stepIndex,
                stepId,
                name,
                status: 'recovered',
                replayError,
                ...(recovered === undefined ? {} : { recoveryResult: recovered }),
              });
              emitRecoveryProgress(options.onProgress, currentProgress, 'succeeded', `已恢复 ${name}`);
            } catch (recoveryError) {
              const message = errorMessage(recoveryError);
              stepResults.push({
                stepIndex,
                stepId,
                name,
                status: 'failed',
                replayError,
                recoveryError: message,
              });
              emitRecoveryProgress(options.onProgress, currentProgress, 'failed', `${name} 恢复失败`);
              throw recoveryError;
            }
          }
        }
      } finally {
        try {
          finalScreenshotPath = await observer.persistFinalScreenshot(options.runDirectory);
        } finally {
          try {
            removeDumpListener?.();
          } finally {
            try {
              if (agent) {
                await agent.destroy();
                reportPath = await existingMidsceneHtmlReport(agent.reportFile);
              }
            } finally {
              if (previousRunDirectory === undefined) delete process.env.MIDSCENE_RUN_DIR;
              else process.env.MIDSCENE_RUN_DIR = previousRunDirectory;
            }
          }
        }
      }
    }

    const result: ExecutorResult = {
      schemaVersion: '0.2',
      status: 'succeeded',
      sourceYamlPath: yamlPath,
      dryRun: options.dryRun,
      taskCount,
      ...(rawResults.length ? { midsceneResult: { steps: rawResults } } : {}),
      ...(reportPath === undefined ? {} : { reportPath }),
      ...(finalScreenshotPath === undefined ? {} : { finalScreenshotPath }),
      hybrid: summary(),
      finishedAt: new Date().toISOString(),
    };
    await writeResult(resultPath, result);
    return result;
  } catch (error) {
    const result: ExecutorResult = {
      schemaVersion: '0.2',
      status: 'failed',
      sourceYamlPath: yamlPath,
      dryRun: options.dryRun,
      ...(taskCount === undefined ? {} : { taskCount }),
      ...(reportPath === undefined ? {} : { reportPath }),
      ...(finalScreenshotPath === undefined ? {} : { finalScreenshotPath }),
      hybrid: summary(),
      finishedAt: new Date().toISOString(),
      error: errorMessage(error),
    };
    await writeResult(resultPath, result);
    throw error;
  }
}
