import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  TUserPromptSchema,
  type AiActOptions,
  type TUserPrompt,
} from '@midscene/core';
import type { NativeAiActExecutorResult } from '../cua/contracts/types.js';
import {
  createKeyboardEnabledComputerAgent,
  keyboardInputAiActContext,
  type ComputerAgentOptions,
} from './computer-agent.js';
import { checkRequiredModelEnv, warnIfNodeVersionIsOld } from './env.js';

interface AgentLike {
  aiAct(prompt: TUserPrompt, options?: AiActOptions): Promise<string | undefined>;
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

  try {
    const prompt = TUserPromptSchema.parse(options.prompt);
    const promptText = typeof prompt === 'string' ? prompt : prompt.prompt;
    if (!promptText.trim()) throw new Error('Midscene aiAct prompt 不能为空');
    let midsceneResult: string | undefined;

    if (!options.dryRun) {
      warnIfNodeVersionIsOld();
      checkRequiredModelEnv();
      const previousRunDirectory = process.env.MIDSCENE_RUN_DIR;
      let agent: AgentLike | undefined;
      try {
        process.env.MIDSCENE_RUN_DIR = path.join(path.resolve(options.runDirectory), 'midscene');
        agent = await (options.agentFactory ?? createKeyboardEnabledComputerAgent)({
          ...(options.displayId === undefined ? {} : { displayId: options.displayId }),
          generateReport: true,
          groupName: 'native-ai-act',
          groupDescription: '执行原生 Midscene aiAct 电脑操作',
          aiActContext: keyboardInputAiActContext,
        });
        midsceneResult = await agent.aiAct(
          prompt,
          options.abortSignal ? { abortSignal: options.abortSignal } : undefined,
        );
      } finally {
        try {
          if (agent) await agent.destroy();
        } finally {
          if (previousRunDirectory === undefined) delete process.env.MIDSCENE_RUN_DIR;
          else process.env.MIDSCENE_RUN_DIR = previousRunDirectory;
        }
      }
    }

    const result: NativeAiActExecutorResult = {
      schemaVersion: '0.1',
      status: 'succeeded',
      sourcePromptPath,
      dryRun: options.dryRun,
      ...(midsceneResult === undefined ? {} : { midsceneResult }),
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
    });
    throw error;
  }
}
