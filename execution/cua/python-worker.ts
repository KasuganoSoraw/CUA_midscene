import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Writable } from 'node:stream';
import dotenv from 'dotenv';

export const pythonExecutableEnv = 'CUA_PYTHON_EXECUTABLE';

export interface PythonWorkerLaunch {
  pythonExecutable: string;
  module: string;
  args?: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: SpawnOptions['stdio'];
}

export interface ResolvePythonExecutableOptions {
  executionRoot: string;
  devProjectRoot?: string;
}

function defaultProjectPython(projectRoot: string): string {
  return process.platform === 'win32'
    ? path.join(projectRoot, '.venv', 'Scripts', 'python.exe')
    : path.join(projectRoot, '.venv', 'bin', 'python');
}

async function configuredPython(
  explicit: string | undefined,
  executionRoot: string,
): Promise<{ value?: string; source?: string }> {
  if (explicit !== undefined) return { value: explicit, source: '--python-executable' };
  const processValue = process.env[pythonExecutableEnv]?.trim();
  if (processValue) return { value: processValue, source: pythonExecutableEnv };

  for (const filename of ['.env.local', '.env']) {
    const envPath = path.join(executionRoot, filename);
    try {
      const parsed = dotenv.parse(await readFile(envPath));
      const value = parsed[pythonExecutableEnv]?.trim();
      if (value) return { value, source: envPath };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return {};
}

export async function resolvePythonExecutable(
  explicit: string | undefined,
  options: ResolvePythonExecutableOptions,
): Promise<string> {
  const executionRoot = path.resolve(options.executionRoot);
  const configured = await configuredPython(explicit, executionRoot);
  const source = configured.source ?? '开发环境 Python';
  const candidate = configured.value
    ?? (options.devProjectRoot ? defaultProjectPython(path.resolve(options.devProjectRoot)) : undefined);
  if (!candidate?.trim()) {
    throw new Error(`未配置 ${pythonExecutableEnv}，且没有可用的开发环境 Python`);
  }
  if (!path.isAbsolute(candidate)) throw new Error(`${source} 必须配置绝对路径：${candidate}`);
  const resolved = path.resolve(candidate);
  const details = await stat(resolved).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Python executable 不存在或不可访问：${resolved}（${message}）`);
  });
  if (!details.isFile()) throw new Error(`Python executable 不是文件：${resolved}`);
  return resolved;
}

function requireModuleName(module: string): string {
  const normalized = module.trim();
  if (!/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/u.test(normalized)) {
    throw new Error(`Python module 名称无效：${module}`);
  }
  return normalized;
}

export function spawnPythonWorker(
  launch: PythonWorkerLaunch,
  spawnProcess: typeof spawn = spawn,
): ChildProcess {
  const module = requireModuleName(launch.module);
  return spawnProcess(
    launch.pythonExecutable,
    ['-m', module, ...(launch.args ?? [])],
    {
      ...(launch.cwd ? { cwd: launch.cwd } : {}),
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        ...launch.env,
      },
      shell: false,
      windowsHide: true,
      stdio: launch.stdio ?? ['pipe', 'pipe', 'pipe'],
    },
  );
}

export async function runPythonWorker(
  launch: Omit<PythonWorkerLaunch, 'stdio'> & { progress?: Writable },
  spawnProcess: typeof spawn = spawn,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawnPythonWorker(
      { ...launch, stdio: ['ignore', 'pipe', 'pipe'] },
      spawnProcess,
    );
    let output = '';
    const forward = (chunk: Buffer) => {
      launch.progress?.write(chunk);
      output = `${output}${chunk.toString('utf8')}`.slice(-16_384);
    };
    child.stdout?.on('data', forward);
    child.stderr?.on('data', forward);
    child.once('error', (error) => {
      reject(new Error(`无法启动 Python Worker：${error.message}`));
    });
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = output.trim() ? `\n${output.trim()}` : '';
      reject(new Error(`Python Worker 执行失败：exit=${String(code)} signal=${signal ?? '-'}${detail}`));
    });
  });
}
