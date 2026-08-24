import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import type { JsonObject, TaskCatalogRoots } from '../../cua/contracts/types.js';
import { resolveTask } from '../../cua/task/tasks.js';
import type {
  StartTaskExecutionRequest,
  TaskExecutionStatus,
} from '../shared/types.js';

export interface TaskExecutionControl {
  status(): TaskExecutionStatus;
  start(request: StartTaskExecutionRequest): Promise<TaskExecutionStatus>;
  stop(): Promise<TaskExecutionStatus>;
  close(): Promise<void>;
}

interface CliLaunch {
  command: string;
  prefixArgs: string[];
}

interface TaskExecutionManagerOptions {
  catalog: TaskCatalogRoots;
  dataRoot: string;
  executionRoot: string;
  countdownMs?: number;
  resolveLaunch?: () => Promise<CliLaunch>;
  spawnProcess?: typeof spawn;
}

const activePhases = new Set<TaskExecutionStatus['phase']>([
  'preparing', 'running', 'stopping',
]);
const maxStdoutBytes = 2 * 1024 * 1024;
const maxDiagnosticsBytes = 16 * 1024;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function limitedAppend(current: string, chunk: Buffer | string, limit: number): string {
  return `${current}${chunk.toString()}`.slice(-limit);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function redactInputs(message: string, inputs: Record<string, string>): string {
  return Object.values(inputs)
    .filter((value) => value.length > 0)
    .sort((left, right) => right.length - left.length)
    .reduce((result, value) => result.replaceAll(value, '[运行时输入]'), message);
}

function objectValue(value: unknown): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined;
}

function safeExecutorSummary(
  executor: JsonObject | undefined,
  inputs: Record<string, string>,
): JsonObject | undefined {
  if (!executor) return undefined;
  return Object.fromEntries([
    'schemaVersion', 'status', 'dryRun', 'taskCount', 'finishedAt',
  ].filter((key) => executor[key] !== undefined).map((key) => [key, executor[key]]).concat(
    typeof executor.error === 'string'
      ? [['error', redactInputs(executor.error, inputs)]]
      : [],
  ));
}

export async function resolveTaskCliLaunch(executionRoot: string): Promise<CliLaunch> {
  const root = path.resolve(executionRoot);
  const builtCli = path.join(root, 'dist', 'cli', 'main.js');
  const tsxCli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const sourceCli = path.join(root, 'cli', 'main.ts');
  try {
    await Promise.all([access(tsxCli), access(sourceCli)]);
    return { command: process.execPath, prefixArgs: [tsxCli, sourceCli] };
  } catch {
    // Packaged deployments do not include the development-only tsx runtime.
  }
  try {
    await access(builtCli);
    return { command: process.execPath, prefixArgs: [builtCli] };
  } catch {
    throw new Error(`找不到可运行的 CUA CLI：已检查 ${sourceCli} 和 ${builtCli}`);
  }
}

export class TaskExecutionManager implements TaskExecutionControl {
  private current: TaskExecutionStatus = { phase: 'idle' };
  private timer?: NodeJS.Timeout;
  private child?: ChildProcessWithoutNullStreams;
  private generation = 0;
  private stopRequested = false;

  constructor(private readonly options: TaskExecutionManagerOptions) {}

  status(): TaskExecutionStatus {
    return clone(this.current);
  }

  async start(request: StartTaskExecutionRequest): Promise<TaskExecutionStatus> {
    if (activePhases.has(this.current.phase)) {
      throw Object.assign(new Error('已有任务正在准备或执行，请先等待其完成或停止'), { statusCode: 409 });
    }

    await resolveTask({
      scene: request.scene,
      task: request.task,
      catalog: this.options.catalog,
      inputs: request.inputs,
    });
    const launch = await (this.options.resolveLaunch ?? (() => resolveTaskCliLaunch(this.options.executionRoot)))();
    const countdownMs = this.options.countdownMs ?? 5_000;
    const preparedAt = new Date();
    const generation = ++this.generation;
    this.stopRequested = false;
    this.current = {
      phase: 'preparing',
      scene: request.scene,
      task: request.task,
      mode: request.mode,
      preparedAt: preparedAt.toISOString(),
      startsAt: new Date(preparedAt.getTime() + countdownMs).toISOString(),
    };
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.launch(generation, request, launch);
    }, countdownMs);
    return this.status();
  }

  async stop(): Promise<TaskExecutionStatus> {
    if (this.current.phase === 'preparing') {
      if (this.timer) clearTimeout(this.timer);
      this.timer = undefined;
      this.generation += 1;
      this.current = { phase: 'idle' };
      return this.status();
    }
    if (this.current.phase === 'running' && this.child) {
      this.stopRequested = true;
      this.current = { ...this.current, phase: 'stopping' };
      this.child.kill();
    }
    return this.status();
  }

  async close(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.generation += 1;
    this.child?.kill();
    this.child = undefined;
  }

  private async launch(
    generation: number,
    request: StartTaskExecutionRequest,
    launch: CliLaunch,
  ): Promise<void> {
    if (generation !== this.generation || this.current.phase !== 'preparing') return;
    const command = request.mode === 'task' ? ['task', 'run'] : ['act', 'run'];
    const args = [
      ...launch.prefixArgs,
      ...command,
      '--scene', request.scene,
      '--task', request.task,
      '--data-root', this.options.dataRoot,
      ...(request.mode === 'task' ? ['--json'] : []),
      ...Object.entries(request.inputs).flatMap(([key, value]) => ['--input', `${key}=${value}`]),
    ];
    let child: ChildProcessWithoutNullStreams;
    try {
      child = (this.options.spawnProcess ?? spawn)(launch.command, args, {
        cwd: path.resolve(this.options.executionRoot),
        env: process.env,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      child.stdin.end();
    } catch (error) {
      this.fail(generation, `无法启动任务执行进程：${errorMessage(error)}`);
      return;
    }
    this.child = child;
    this.current = { ...this.current, phase: 'running', startedAt: new Date().toISOString() };
    let stdout = '';
    let diagnostics = '';
    child.stdout.on('data', (chunk) => { stdout = limitedAppend(stdout, chunk, maxStdoutBytes); });
    child.stderr.on('data', (chunk) => { diagnostics = limitedAppend(diagnostics, chunk, maxDiagnosticsBytes); });
    child.once('error', (error) => {
      this.fail(generation, `任务执行进程错误：${error.message}`);
    });
    child.once('close', (code, signal) => {
      if (generation !== this.generation) return;
      this.child = undefined;
      const finishedAt = new Date().toISOString();
      if (this.stopRequested) {
        this.current = {
          ...this.current,
          phase: 'failed',
          finishedAt,
          error: `任务已由用户停止${signal ? `（signal=${signal}）` : ''}`,
        };
        return;
      }
      let payload: JsonObject | undefined;
      try {
        payload = objectValue(JSON.parse(stdout.trim()));
      } catch {
        // The diagnostic below includes the process result without echoing runtime inputs.
      }
      const executor = objectValue(payload?.executor);
      const executorSummary = safeExecutorSummary(executor, request.inputs);
      if (code === 0 && executor?.status === 'succeeded') {
        this.current = {
          ...this.current,
          phase: 'succeeded',
          finishedAt,
          result: {
            ...(typeof payload?.runDir === 'string' ? { runDir: payload.runDir } : {}),
            ...(typeof payload?.resolvedTaskPath === 'string' ? { resolvedTaskPath: payload.resolvedTaskPath } : {}),
            ...(executorSummary ? { executor: executorSummary } : {}),
          },
        };
        return;
      }
      const executorError = typeof executor?.error === 'string'
        ? redactInputs(executor.error, request.inputs)
        : undefined;
      const detail = redactInputs(diagnostics.trim(), request.inputs);
      this.current = {
        ...this.current,
        phase: 'failed',
        finishedAt,
        error: executorError || detail || `任务执行失败：exit=${String(code)} signal=${signal ?? '-'}`,
        ...(payload ? {
          result: {
            ...(typeof payload.runDir === 'string' ? { runDir: payload.runDir } : {}),
            ...(typeof payload.resolvedTaskPath === 'string' ? { resolvedTaskPath: payload.resolvedTaskPath } : {}),
            ...(executorSummary ? { executor: executorSummary } : {}),
          },
        } : {}),
      };
    });
  }

  private fail(generation: number, message: string): void {
    if (generation !== this.generation) return;
    this.child = undefined;
    this.current = {
      ...this.current,
      phase: 'failed',
      finishedAt: new Date().toISOString(),
      error: message,
    };
  }
}
