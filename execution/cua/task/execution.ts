import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ExecutorResult, JsonObject, ResolvedTaskResult, TaskCatalogRoots } from '../contracts/types.js';
import {
  executeMidsceneHybrid,
  type MidsceneHybridExecutionOptions,
} from '../../executors/midscene-hybrid.js';
import { executeMidsceneYaml, type MidsceneYamlExecutionOptions } from '../../executors/midscene-yaml.js';
import type { ExecutionProgressSink } from '../../executors/midscene-progress.js';
import { keyboardInputAiActContext } from '../../executors/computer-agent.js';
import { createRunDirectory } from '../run-directory.js';
import { resolveTask } from './tasks.js';
import { writeYamlDocument } from './yaml-task.js';
import {
  buildRecordedTaskAiActPrompt,
  type RecordedTaskAiActPrompt,
} from './recorded-task-prompt.js';

export { buildRecordedTaskAiActPrompt };
export type { RecordedTaskAiActPrompt };

export const aiActContext = keyboardInputAiActContext;

export interface ExecutionOptions {
  scene: string;
  task: string;
  catalog: TaskCatalogRoots;
  runsRoot: string;
  inputs?: Record<string, string>;
  dryRun?: boolean;
  onProgress?: ExecutionProgressSink;
  executor?: typeof executeMidsceneYaml;
}

export interface TaskRun {
  resolved: ResolvedTaskResult;
  resolvedTaskPath: string;
  executorResult: ExecutorResult;
}

export interface HybridExecutionOptions extends Omit<ExecutionOptions, 'executor'> {
  executor?: typeof executeMidsceneHybrid;
  maxRecoveries?: number;
}

export interface RecordedTaskAiActRun extends TaskRun {
  promptPath: string;
  aiActYamlPath: string;
}

export function aiActYamlDocument(
  prompt: string | RecordedTaskAiActPrompt,
  groupName: string,
  groupDescription: string,
  taskName: string,
): JsonObject {
  return {
    computer: {},
    agent: { groupName, groupDescription, generateReport: true, aiActContext },
    tasks: [{ name: taskName, flow: [{ ai: prompt }] }],
  };
}

async function execute(
  yamlPath: string,
  runDirectory: string,
  dryRun: boolean,
  executor: typeof executeMidsceneYaml,
  onProgress?: ExecutionProgressSink,
): Promise<ExecutorResult> {
  const options: MidsceneYamlExecutionOptions = {
    yamlPath,
    resultPath: path.join(runDirectory, 'execution-result.json'),
    runDirectory,
    dryRun,
    ...(onProgress === undefined ? {} : { onProgress }),
  };
  return executor(options);
}

async function executeHybrid(
  yamlPath: string,
  runDirectory: string,
  goal: string,
  dryRun: boolean,
  executor: typeof executeMidsceneHybrid,
  onProgress?: ExecutionProgressSink,
  maxRecoveries?: number,
): Promise<ExecutorResult> {
  const options: MidsceneHybridExecutionOptions = {
    yamlPath,
    resultPath: path.join(runDirectory, 'execution-result.json'),
    runDirectory,
    goal,
    dryRun,
    ...(onProgress === undefined ? {} : { onProgress }),
    ...(maxRecoveries === undefined ? {} : { maxRecoveries }),
  };
  return executor(options);
}

export async function runTask(options: ExecutionOptions): Promise<TaskRun> {
  const resolved = await resolveTask(options);
  const runDirectory = await createRunDirectory(options.runsRoot);
  const resolvedTaskPath = path.join(runDirectory, 'resolved-task.yaml');
  await writeYamlDocument(resolvedTaskPath, resolved.document);
  const executorResult = await execute(
    resolvedTaskPath,
    runDirectory,
    options.dryRun ?? false,
    options.executor ?? executeMidsceneYaml,
    options.onProgress,
  );
  return { resolved, resolvedTaskPath, executorResult };
}

export async function runHybridTask(options: HybridExecutionOptions): Promise<TaskRun> {
  const resolved = await resolveTask(options);
  const runDirectory = await createRunDirectory(options.runsRoot);
  const resolvedTaskPath = path.join(runDirectory, 'resolved-task.yaml');
  await writeYamlDocument(resolvedTaskPath, resolved.document);
  const executorResult = await executeHybrid(
    resolvedTaskPath,
    runDirectory,
    resolved.manifest.goal,
    options.dryRun ?? false,
    options.executor ?? executeMidsceneHybrid,
    options.onProgress,
    options.maxRecoveries,
  );
  return { resolved, resolvedTaskPath, executorResult };
}

export async function runRecordedTaskAiAct(options: ExecutionOptions): Promise<RecordedTaskAiActRun> {
  const resolved = await resolveTask(options);
  const taskPrompt = buildRecordedTaskAiActPrompt(resolved.document);
  const runDirectory = await createRunDirectory(options.runsRoot);
  const resolvedTaskPath = path.join(runDirectory, 'resolved-task.yaml');
  const promptPath = path.join(runDirectory, 'ai-act-prompt.txt');
  const aiActYamlPath = path.join(runDirectory, 'ai-act-task.yaml');
  await writeYamlDocument(resolvedTaskPath, resolved.document);
  await writeFile(promptPath, taskPrompt.prompt, 'utf8');
  await writeYamlDocument(
    aiActYamlPath,
    aiActYamlDocument(
      taskPrompt.images.length ? taskPrompt : taskPrompt.prompt,
      `${options.task}-ai-act`,
      resolved.manifest.goal,
      '录制任务整体 aiAct',
    ),
  );
  const executorResult = await execute(
    aiActYamlPath,
    runDirectory,
    options.dryRun ?? false,
    options.executor ?? executeMidsceneYaml,
    options.onProgress,
  );
  return { resolved, resolvedTaskPath, promptPath, aiActYamlPath, executorResult };
}

export async function runPrompt(options: {
  prompt: string;
  runsRoot: string;
  dryRun?: boolean;
  executor?: typeof executeMidsceneYaml;
}): Promise<{ yamlPath: string; executorResult: ExecutorResult }> {
  const prompt = options.prompt.trim();
  if (!prompt) throw new Error('自然语言 prompt 不能为空');
  const runDirectory = await createRunDirectory(options.runsRoot);
  const yamlPath = path.join(runDirectory, 'resolved-task.yaml');
  await writeYamlDocument(
    yamlPath,
    aiActYamlDocument(prompt, 'natural-language-ai-act', '执行无录制自然语言电脑操作', '自然语言电脑操作'),
  );
  const executorResult = await execute(
    yamlPath,
    runDirectory,
    options.dryRun ?? false,
    options.executor ?? executeMidsceneYaml,
  );
  return { yamlPath, executorResult };
}
