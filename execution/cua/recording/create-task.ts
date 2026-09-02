import {
  copyFile,
  mkdir,
  rm,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import type { Writable } from 'node:stream';
import { convertTrace } from '../conversion/showui-trace.js';
import type {
  ExecutorResult,
  ProcessedLogStep,
  TaskCatalogRoots,
} from '../contracts/types.js';
import {
  readProcessedLog,
  readShowuiTrace,
} from '../contracts/validation.js';
import { packageRoot } from '../package-root.js';
import { resolvePythonExecutable, runPythonWorker } from '../python-worker.js';
import { runTask } from '../task/execution.js';
import { requireIdentifier } from '../task/tasks.js';

export interface RecordProcessorRunRequest {
  pythonExecutable: string;
  recordingPath: string;
  progress: Writable;
}

export interface CreateTaskFromRecordingOptions {
  scene: string;
  task: string;
  recording: string;
  goal?: string;
  pythonExecutable?: string;
  catalog: TaskCatalogRoots;
  runsRoot: string;
  executionRoot?: string;
  creationCommand?: string;
  progress?: Writable;
}

export interface CreateTaskFromRecordingResult {
  created: true;
  valid: true;
  scene: string;
  task: string;
  goal: string;
  recordingPath: string;
  taskRoot: string;
  sourceRoot: string;
  taskYamlPath: string;
  taskManifestPath: string;
  runDir: string;
  resolvedTaskPath: string;
  executor: ExecutorResult;
}

export interface CreateTaskFromRecordingDependencies {
  runRecorder?: (request: RecordProcessorRunRequest) => Promise<void>;
  convert?: typeof convertTrace;
  validate?: typeof runTask;
}

async function pathKind(sourcePath: string): Promise<'file' | 'directory' | undefined> {
  try {
    const value = await stat(sourcePath);
    if (value.isFile()) return 'file';
    if (value.isDirectory()) return 'directory';
    return undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function runRecordingParser(
  request: RecordProcessorRunRequest,
  spawnProcess?: Parameters<typeof runPythonWorker>[1],
): Promise<void> {
  await runPythonWorker({
    pythonExecutable: request.pythonExecutable,
    module: 'cua_record',
    args: ['process', request.recordingPath],
    progress: request.progress,
  }, spawnProcess);
}

function normalizeScreenshotPath(rawValue: unknown, field: string, index: number): string | undefined {
  if (rawValue === undefined || rawValue === null) return undefined;
  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    throw new Error(`processed log step ${index + 1} 的 ${field} 必须是非空字符串`);
  }
  const raw = rawValue.trim();
  const portable = raw.replaceAll('\\', '/');
  if (path.win32.isAbsolute(raw) || path.posix.isAbsolute(portable)) {
    throw new Error(`processed log step ${index + 1} 的 ${field} 必须是相对路径：${raw}`);
  }
  const normalized = path.posix.normalize(portable);
  if (!normalized.startsWith('screenshots/') || normalized === 'screenshots') {
    throw new Error(`processed log step ${index + 1} 的 ${field} 必须位于 screenshots/：${raw}`);
  }
  return normalized;
}

async function generatedAssets(recordingPath: string): Promise<{
  tracePath: string;
  processedLogPath: string;
  processedLogScPath: string;
  screenshotPaths: string[];
}> {
  const name = path.basename(recordingPath);
  const tracePath = path.join(recordingPath, `${name}_trace.json`);
  const processedLogPath = path.join(recordingPath, `${name}_processed_log.json`);
  const processedLogScPath = path.join(recordingPath, `${name}_processed_log_sc.json`);
  await Promise.all([
    readShowuiTrace(tracePath),
    readProcessedLog(processedLogPath),
  ]);
  const processedSteps = await readProcessedLog(processedLogScPath);
  const screenshots = new Set<string>();
  processedSteps.forEach((step, index) => {
    for (const field of ['screenshot_full', 'screenshot_crop', 'screenshot_reference'] as const) {
      const relative = normalizeScreenshotPath((step as ProcessedLogStep)[field], field, index);
      if (relative) screenshots.add(relative);
    }
  });
  for (const relative of screenshots) {
    const source = path.resolve(recordingPath, ...relative.split('/'));
    const boundary = path.relative(recordingPath, source);
    if (boundary.startsWith('..') || path.isAbsolute(boundary) || (await pathKind(source)) !== 'file') {
      throw new Error(`录制截图不存在或越出录制目录：${relative}`);
    }
  }
  return {
    tracePath,
    processedLogPath,
    processedLogScPath,
    screenshotPaths: [...screenshots].sort(),
  };
}

async function copyGeneratedAssets(
  recordingPath: string,
  sourceRoot: string,
  assets: Awaited<ReturnType<typeof generatedAssets>>,
): Promise<void> {
  await mkdir(sourceRoot, { recursive: true });
  await Promise.all([
    copyFile(assets.tracePath, path.join(sourceRoot, 'showui-trace.json')),
    copyFile(assets.processedLogPath, path.join(sourceRoot, 'processed-log.json')),
    copyFile(assets.processedLogScPath, path.join(sourceRoot, 'processed-log-sc.json')),
  ]);
  for (const relative of assets.screenshotPaths) {
    const source = path.resolve(recordingPath, ...relative.split('/'));
    const target = path.resolve(sourceRoot, ...relative.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
  }
}

function quoteCommandValue(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`;
}

function traceGenerationCommand(recordingPath: string): string {
  return `python -m cua_record process ${quoteCommandValue(recordingPath)}`;
}

export async function createTaskFromRecording(
  options: CreateTaskFromRecordingOptions,
  dependencies: CreateTaskFromRecordingDependencies = {},
): Promise<CreateTaskFromRecordingResult> {
  if (!options.catalog.userProjectsRoot) throw new Error('从录制创建任务需要用户 projects 目录');
  const scene = requireIdentifier(options.scene, 'scene');
  const task = requireIdentifier(options.task, 'task');
  const goal = options.goal?.trim() ?? '';
  const recordingPath = path.resolve(options.recording);
  if ((await pathKind(recordingPath)) !== 'directory') throw new Error(`录制目录不存在：${recordingPath}`);
  if ((await pathKind(path.join(recordingPath, 'inputs'))) !== 'directory') {
    throw new Error(`录制目录缺少 inputs/：${recordingPath}`);
  }

  const executionRoot = path.resolve(options.executionRoot ?? packageRoot);
  const pythonExecutable = await resolvePythonExecutable(options.pythonExecutable, {
    executionRoot,
    devProjectRoot: path.resolve(executionRoot, '..', 'record'),
  });
  const userProjectsRoot = path.resolve(options.catalog.userProjectsRoot);
  const taskRoot = path.resolve(userProjectsRoot, scene, task);
  const sceneRoot = path.dirname(taskRoot);
  const sourceRoot = path.join(taskRoot, 'source');
  if (await pathKind(taskRoot)) throw new Error(`用户任务目录已存在，拒绝覆盖：${taskRoot}`);
  const builtinTaskRoot = path.resolve(options.catalog.builtinProjectsRoot, scene, task);
  if (await pathKind(path.join(builtinTaskRoot, 'task.json'))) {
    throw new Error(`内置任务不可覆盖：${builtinTaskRoot}`);
  }

  const sceneExisted = (await pathKind(sceneRoot)) === 'directory';
  await (dependencies.runRecorder ?? runRecordingParser)({
    pythonExecutable,
    recordingPath,
    progress: options.progress ?? process.stderr,
  });
  const assets = await generatedAssets(recordingPath);
  let taskCreated = false;
  try {
    taskCreated = true;
    await copyGeneratedAssets(recordingPath, sourceRoot, assets);
    const taskYamlPath = await (dependencies.convert ?? convertTrace)({
      scene,
      task,
      goal,
      catalog: options.catalog,
      conversionCommand: `npm run cua -- task init-from-trace --scene ${scene} --task ${task}${goal ? ` --goal ${quoteCommandValue(goal)}` : ''}`,
      recordingPreparationCommand: options.creationCommand ?? 'task create-from-recording',
      traceGenerationCommand: traceGenerationCommand(recordingPath),
    });
    const validation = await (dependencies.validate ?? runTask)({
      scene,
      task,
      catalog: options.catalog,
      runsRoot: options.runsRoot,
      dryRun: true,
    });
    return {
      created: true,
      valid: true,
      scene,
      task,
      goal,
      recordingPath,
      taskRoot,
      sourceRoot,
      taskYamlPath,
      taskManifestPath: path.join(taskRoot, 'task.json'),
      runDir: path.dirname(validation.resolvedTaskPath),
      resolvedTaskPath: validation.resolvedTaskPath,
      executor: validation.executorResult,
    };
  } catch (error) {
    if (taskCreated) {
      await rm(taskRoot, { recursive: true, force: true });
      if (!sceneExisted) await rm(sceneRoot, { recursive: true, force: true });
    }
    throw error;
  }
}
