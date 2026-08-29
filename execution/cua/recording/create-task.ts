import { spawn } from 'node:child_process';
import {
  copyFile,
  mkdir,
  readFile,
  rm,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import type { Writable } from 'node:stream';
import dotenv from 'dotenv';
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
import { runTask } from '../task/execution.js';
import { requireIdentifier } from '../task/tasks.js';

export const recordRootEnv = 'CUA_RECORD_ROOT';

export interface RecorderRunRequest {
  recordRoot: string;
  recordingPath: string;
  progress: Writable;
}

export interface CreateTaskFromRecordingOptions {
  scene: string;
  task: string;
  recording: string;
  goal?: string;
  recordRoot?: string;
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
  recordRoot: string;
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
  runRecorder?: (request: RecorderRunRequest) => Promise<void>;
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

async function configuredRecordRoot(
  explicit: string | undefined,
  executionRoot: string,
): Promise<{ value?: string; source?: string }> {
  if (explicit !== undefined) return { value: explicit, source: '--record-root' };
  const processValue = process.env[recordRootEnv]?.trim();
  if (processValue) return { value: processValue, source: recordRootEnv };

  for (const filename of ['.env.local', '.env']) {
    const envPath = path.join(executionRoot, filename);
    try {
      const parsed = dotenv.parse(await readFile(envPath));
      const value = parsed[recordRootEnv]?.trim();
      if (value) return { value, source: envPath };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return {};
}

async function validateRecordRoot(root: string, source: string): Promise<string> {
  if (!path.isAbsolute(root)) throw new Error(`${source} 必须配置绝对路径：${root}`);
  const resolved = path.resolve(root);
  const missing: string[] = [];
  for (const relative of ['pyproject.toml', path.join('Aloha_Learn', 'parser.py')]) {
    if ((await pathKind(path.join(resolved, relative))) !== 'file') missing.push(relative);
  }
  if (missing.length) throw new Error(`录制后处理器根目录无效：${resolved}\n缺少：${missing.join(', ')}`);
  return resolved;
}

export async function resolveRecordRoot(
  explicit?: string,
  options: { executionRoot?: string } = {},
): Promise<string> {
  const executionRoot = path.resolve(options.executionRoot ?? packageRoot);
  const configured = await configuredRecordRoot(explicit, executionRoot);
  if (configured.value !== undefined) {
    return validateRecordRoot(configured.value, configured.source ?? recordRootEnv);
  }
  const sibling = path.resolve(executionRoot, '..', 'record');
  try {
    return await validateRecordRoot(sibling, '源码仓相邻 record 目录');
  } catch {
    throw new Error(
      `无法定位录制后处理器根目录；请提供 --record-root 或在 execution/.env.local 配置 ${recordRootEnv}\n已检查：${sibling}`,
    );
  }
}

export async function runRecordingParser(
  request: RecorderRunRequest,
  spawnProcess: typeof spawn = spawn,
): Promise<void> {
  const args = [
    'run',
    'python',
    path.join('Aloha_Learn', 'parser.py'),
    request.recordingPath,
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawnProcess('uv', args, {
      cwd: request.recordRoot,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const forward = (chunk: Buffer) => {
      request.progress.write(chunk);
      output = `${output}${chunk.toString('utf8')}`.slice(-16_384);
    };
    child.stdout.on('data', forward);
    child.stderr.on('data', forward);
    child.once('error', (error) => {
      reject(new Error(`无法启动录制后处理器 uv 进程：${error.message}`));
    });
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = output.trim() ? `\n${output.trim()}` : '';
      reject(new Error(`录制后处理器执行失败：exit=${String(code)} signal=${signal ?? '-'}${detail}`));
    });
  });
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

function traceGenerationCommand(recordRoot: string, recordingPath: string): string {
  const parts = [
    `cd ${quoteCommandValue(recordRoot)}`,
    `uv run python Aloha_Learn/parser.py ${quoteCommandValue(recordingPath)}`,
  ];
  return parts.join('; ');
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

  const recordRoot = await resolveRecordRoot(options.recordRoot, {
    executionRoot: options.executionRoot,
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
    recordRoot,
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
      traceGenerationCommand: traceGenerationCommand(recordRoot, recordingPath),
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
      recordRoot,
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
