import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  TUserPromptSchema,
  type AiActOptions,
  type TUserPrompt,
} from '@midscene/core';
import type { NativeAiActExecutorResult } from '../cua/contracts/types.js';
import { createMidsceneExecutionObserver } from './midscene-final-screenshot.js';
import type { ExecutionProgressSink } from './midscene-progress.js';
import {
  createKeyboardEnabledComputerAgent,
  keyboardInputAiActContext,
  type ComputerAgentOptions,
} from './computer-agent.js';
import { checkRequiredModelEnv, warnIfNodeVersionIsOld } from './env.js';
import { existingMidsceneHtmlReport, midsceneReportFileName } from './midscene-report.js';

interface AgentLike {
  aiAct(prompt: TUserPrompt, options?: AiActOptions): Promise<string | undefined>;
  addDumpUpdateListener?: (
    listener: ReturnType<typeof createMidsceneExecutionObserver>['listener'],
  ) => () => void;
  reportFile?: string | null;
  destroy(): Promise<void>;
}

export interface MidsceneAiActExecutionOptions {
  prompt: TUserPrompt;
  sourcePromptPath: string;
  resultPath: string;
  runDirectory: string;
  dryRun: boolean;
  displayId?: string;
  abortSignal?: AbortSignal;
  onProgress?: ExecutionProgressSink;
  agentFactory?: (options: ComputerAgentOptions) => Promise<AgentLike>;
}

async function writeResult(
  resultPath: string,
  result: NativeAiActExecutorResult,
): Promise<void> {
  await mkdir(path.dirname(resultPath), { recursive: true });
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

export async function executeMidsceneAiAct(
  options: MidsceneAiActExecutionOptions,
): Promise<NativeAiActExecutorResult> {
  const sourcePromptPath = path.resolve(options.sourcePromptPath);
  const resultPath = path.resolve(options.resultPath);
  let reportPath: string | undefined;

  try {
    const prompt = TUserPromptSchema.parse(options.prompt);
    const promptText = typeof prompt === 'string' ? prompt : prompt.prompt;
    if (!promptText.trim()) throw new Error('Midscene aiAct prompt 不能为空');
    let midsceneResult: string | undefined;
    let finalScreenshotPath: string | undefined;

    if (!options.dryRun) {
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
        agent = await (options.agentFactory ?? createKeyboardEnabledComputerAgent)({
          ...(options.displayId === undefined ? {} : { displayId: options.displayId }),
          generateReport: true,
          reportFileName: midsceneReportFileName,
          groupName: 'native-ai-act',
          groupDescription: '执行原生 Midscene aiAct 电脑操作',
          aiActContext: keyboardInputAiActContext,
        });
        if (agent.addDumpUpdateListener) {
          removeDumpListener = agent.addDumpUpdateListener(observer.listener);
        } else if (options.onProgress) {
          throw new Error('Midscene Agent 不支持过程事件');
        }
        midsceneResult = await agent.aiAct(
          prompt,
          options.abortSignal ? { abortSignal: options.abortSignal } : undefined,
        );
        finalScreenshotPath = await observer.persistFinalScreenshot(options.runDirectory);
      } finally {
        try {
          removeDumpListener?.();
        } finally {
          try {
            if (agent) {
              try { await agent.destroy(); }
              finally { reportPath = await existingMidsceneHtmlReport(agent.reportFile); }
            }
          } finally {
            if (previousRunDirectory === undefined) delete process.env.MIDSCENE_RUN_DIR;
            else process.env.MIDSCENE_RUN_DIR = previousRunDirectory;
            if (previousCacheDirectory === undefined) delete process.env.MIDSCENE_CACHE_DIR;
            else process.env.MIDSCENE_CACHE_DIR = previousCacheDirectory;
          }
        }
      }
    }

    const result: NativeAiActExecutorResult = {
      schemaVersion: '0.1',
      status: 'succeeded',
      sourcePromptPath,
      dryRun: options.dryRun,
      ...(midsceneResult === undefined ? {} : { midsceneResult }),
      ...(reportPath === undefined ? {} : { reportPath }),
      ...(finalScreenshotPath === undefined ? {} : { finalScreenshotPath }),
      finishedAt: new Date().toISOString(),
    };
    await writeResult(resultPath, result);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeResult(resultPath, {
      schemaVersion: '0.1',
      status: 'failed',
      sourcePromptPath,
      dryRun: options.dryRun,
      finishedAt: new Date().toISOString(),
      error: message,
      ...(reportPath === undefined ? {} : { reportPath }),
    });
    throw error;
  }
}
