import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import type { spawn } from 'node:child_process';
import {
  pythonExecutableEnv,
  resolvePythonExecutable,
  runPythonWorker,
  spawnPythonWorker,
} from '../cua/python-worker.js';

async function pythonFile(root: string, name: string): Promise<string> {
  const executable = path.join(root, name);
  await writeFile(executable, 'python');
  return executable;
}

test('Python executable 遵循显式、进程、env.local、env 和开发环境优先级', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-python-worker-'));
  const executionRoot = path.join(root, 'execution');
  const projectRoot = path.join(root, 'record');
  await mkdir(executionRoot);
  const devPython = process.platform === 'win32'
    ? path.join(projectRoot, '.venv', 'Scripts', 'python.exe')
    : path.join(projectRoot, '.venv', 'bin', 'python');
  await mkdir(path.dirname(devPython), { recursive: true });
  await writeFile(devPython, 'python');
  const explicit = await pythonFile(root, 'explicit-python');
  const processPython = await pythonFile(root, 'process-python');
  const localPython = await pythonFile(root, 'local-python');
  const envPython = await pythonFile(root, 'env-python');
  await writeFile(path.join(executionRoot, '.env'), `${pythonExecutableEnv}=${envPython}\n`);
  await writeFile(path.join(executionRoot, '.env.local'), `${pythonExecutableEnv}=${localPython}\n`);

  const previous = process.env[pythonExecutableEnv];
  try {
    process.env[pythonExecutableEnv] = processPython;
    assert.equal(await resolvePythonExecutable(explicit, { executionRoot, devProjectRoot: projectRoot }), explicit);
    assert.equal(await resolvePythonExecutable(undefined, { executionRoot, devProjectRoot: projectRoot }), processPython);
    delete process.env[pythonExecutableEnv];
    assert.equal(await resolvePythonExecutable(undefined, { executionRoot, devProjectRoot: projectRoot }), localPython);
    await writeFile(path.join(executionRoot, '.env.local'), '');
    assert.equal(await resolvePythonExecutable(undefined, { executionRoot, devProjectRoot: projectRoot }), envPython);
    await writeFile(path.join(executionRoot, '.env'), '');
    assert.equal(await resolvePythonExecutable(undefined, { executionRoot, devProjectRoot: projectRoot }), devPython);
  } finally {
    if (previous === undefined) delete process.env[pythonExecutableEnv];
    else process.env[pythonExecutableEnv] = previous;
  }
});

test('Python Worker 使用模块入口、无 shell 环境并转发诊断', async () => {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough };
  child.stdout = stdout;
  child.stderr = stderr;
  let invocation: { command: string; args: readonly string[]; options: Record<string, unknown> } | undefined;
  const fakeSpawn = ((command: string, args: readonly string[], options: Record<string, unknown>) => {
    invocation = { command, args, options };
    setImmediate(() => {
      stdout.write('progress\n');
      stderr.write('warning\n');
      child.emit('close', 0, null);
    });
    return child;
  }) as unknown as typeof spawn;
  const progress = new PassThrough();
  let forwarded = '';
  progress.on('data', (chunk) => { forwarded += chunk.toString(); });

  await runPythonWorker({
    pythonExecutable: 'E:\\runtime\\python.exe',
    module: 'cua_record',
    args: ['process', 'E:\\recording'],
    env: { COMPONENT_TEST: '1' },
    progress,
  }, fakeSpawn);

  assert.equal(invocation?.command, 'E:\\runtime\\python.exe');
  assert.deepEqual(invocation?.args, ['-m', 'cua_record', 'process', 'E:\\recording']);
  assert.equal(invocation?.options.shell, false);
  assert.equal((invocation?.options.env as NodeJS.ProcessEnv).COMPONENT_TEST, '1');
  assert.match(forwarded, /progress/);
  assert.match(forwarded, /warning/);
});

test('Python Worker 拒绝非法 module 并保留非零退出诊断', async () => {
  assert.throws(() => spawnPythonWorker({
    pythonExecutable: 'python',
    module: 'cua_record;exit',
  }), /module 名称无效/);

  const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const fakeSpawn = (() => {
    setImmediate(() => {
      child.stderr.write('module missing\n');
      child.emit('close', 3, null);
    });
    return child;
  }) as unknown as typeof spawn;

  await assert.rejects(runPythonWorker({
    pythonExecutable: 'E:\\runtime\\python.exe',
    module: 'cua_record',
  }, fakeSpawn), /exit=3[\s\S]*module missing/);
});
