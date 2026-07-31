import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { NativeAiActExecutorResult } from '../contracts/types.js';
import { createRunDirectory } from '../run-directory.js';
import {
  executeMidsceneAiAct,
  type MidsceneAiActExecutionOptions,
} from '../../executors/midscene-ai-act.js';

export interface NaturalLanguageAiActOptions {
  prompt: string;
  runsRoot: string;
  dryRun?: boolean;
  displayId?: string;
  abortSignal?: AbortSignal;
  executor?: typeof executeMidsceneAiAct;
}

export interface NaturalLanguageAiActRun {
  runDirectory: string;
  promptPath: string;
  resultPath: string;
  executorResult: NativeAiActExecutorResult;
}

export async function runNaturalLanguageAiAct(
  options: NaturalLanguageAiActOptions,
): Promise<NaturalLanguageAiActRun> {
  const prompt = options.prompt.trim();
  if (!prompt) throw new Error('自然语言 prompt 不能为空');

  const runDirectory = await createRunDirectory(options.runsRoot);
  const promptPath = path.join(runDirectory, 'ai-act-prompt.txt');
  const resultPath = path.join(runDirectory, 'ai-act-result.json');
  await writeFile(promptPath, `${prompt}\n`, 'utf8');

  const executionOptions: MidsceneAiActExecutionOptions = {
    prompt,
    sourcePromptPath: promptPath,
    resultPath,
    runDirectory,
    dryRun: options.dryRun ?? false,
    ...(options.displayId === undefined ? {} : { displayId: options.displayId }),
    ...(options.abortSignal === undefined ? {} : { abortSignal: options.abortSignal }),
  };
  const executorResult = await (options.executor ?? executeMidsceneAiAct)(executionOptions);
  return { runDirectory, promptPath, resultPath, executorResult };
}
