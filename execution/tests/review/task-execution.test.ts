import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  resolveTaskCliLaunch,
  TaskExecutionManager,
} from '../../review/service/task-execution.js';
import { createTaskFixture } from '../helpers/task-fixture.js';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-task-execution-'));
  const projectsRoot = path.join(root, 'projects');
  await createTaskFixture(projectsRoot);
  await mkdir(path.join(root, 'runs'), { recursive: true });
  return {
    root,
    catalog: { builtinProjectsRoot: projectsRoot },
  };
}

async function waitFor(
  manager: TaskExecutionManager,
  phase: 'running' | 'succeeded' | 'failed',
): Promise<void> {
  const deadline = Date.now() + 4_000;
  while (manager.status().phase !== phase && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(manager.status().phase, phase);
}

const request = {
  scene: 'browser-demo', task: 'search-demo', mode: 'task' as const,
  inputs: { 'step-001-input': '测试输入' },
};

test('CLI 启动路径在开发环境优先源码，在交付环境回退构建产物', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-cli-launch-'));
  const sourceCli = path.join(root, 'cli', 'main.ts');
  const tsxCli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const builtCli = path.join(root, 'dist', 'cli', 'main.js');
  await Promise.all([
    mkdir(path.dirname(sourceCli), { recursive: true }),
    mkdir(path.dirname(tsxCli), { recursive: true }),
    mkdir(path.dirname(builtCli), { recursive: true }),
  ]);
  await Promise.all([sourceCli, tsxCli, builtCli].map((file) => writeFile(file, '', 'utf8')));
  assert.deepEqual((await resolveTaskCliLaunch(root)).prefixArgs, [tsxCli, sourceCli]);

  const packagedRoot = await mkdtemp(path.join(os.tmpdir(), 'cua-cli-package-'));
  const packagedCli = path.join(packagedRoot, 'dist', 'cli', 'main.js');
  await mkdir(path.dirname(packagedCli), { recursive: true });
  await writeFile(packagedCli, '', 'utf8');
  assert.deepEqual((await resolveTaskCliLaunch(packagedRoot)).prefixArgs, [packagedCli]);
});

test('任务执行管理器倒计时后启动 CLI 并仅公开安全结果摘要', async () => {
  const { root, catalog } = await fixture();
  const script = `process.stdout.write(JSON.stringify({inputs:{secret:'hidden'},runDir:'C:/runs/1',resolvedTaskPath:'C:/runs/1/task.yaml',executor:{status:'succeeded'}}))`;
  const manager = new TaskExecutionManager({
    catalog, dataRoot: root, executionRoot: root, countdownMs: 10,
    resolveLaunch: async () => ({ command: process.execPath, prefixArgs: ['-e', script, '--'] }),
  });
  try {
    const preparing = await manager.start(request);
    assert.equal(preparing.phase, 'preparing');
    await assert.rejects(manager.start(request), /已有任务/);
    await waitFor(manager, 'succeeded');
    const completed = manager.status();
    assert.equal(completed.result?.runDir, 'C:/runs/1');
    assert.equal(Object.hasOwn(completed.result ?? {}, 'inputs'), false);
  } finally {
    await manager.close();
  }
});

test('任务执行管理器可在准备期取消且不启动子进程', async () => {
  const { root, catalog } = await fixture();
  let spawned = false;
  const manager = new TaskExecutionManager({
    catalog, dataRoot: root, executionRoot: root, countdownMs: 1_000,
    resolveLaunch: async () => ({ command: process.execPath, prefixArgs: ['-e', 'process.exit(0)', '--'] }),
    spawnProcess: (() => {
      spawned = true;
      throw new Error('不应启动进程');
    }) as typeof spawn,
  });
  try {
    await manager.start(request);
    assert.equal((await manager.stop()).phase, 'idle');
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(spawned, false);
  } finally {
    await manager.close();
  }
});

test('任务执行管理器报告 CLI 失败并可停止运行中进程', async () => {
  const { root, catalog } = await fixture();
  const failed = new TaskExecutionManager({
    catalog, dataRoot: root, executionRoot: root, countdownMs: 0,
    resolveLaunch: async () => ({
      command: process.execPath,
      prefixArgs: ['-e', `process.stderr.write('runner failed');process.exit(2)`, '--'],
    }),
  });
  try {
    await failed.start(request);
    await waitFor(failed, 'failed');
    assert.match(failed.status().error ?? '', /runner failed/);
  } finally {
    await failed.close();
  }

  const running = new TaskExecutionManager({
    catalog, dataRoot: root, executionRoot: root, countdownMs: 0,
    resolveLaunch: async () => ({
      command: process.execPath,
      prefixArgs: ['-e', `setInterval(() => {}, 1000)`, '--'],
    }),
  });
  try {
    await running.start(request);
    await waitFor(running, 'running');
    assert.equal((await running.stop()).phase, 'stopping');
    await waitFor(running, 'failed');
    assert.match(running.status().error ?? '', /用户停止/);
  } finally {
    await running.close();
  }
});
