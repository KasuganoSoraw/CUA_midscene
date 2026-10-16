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
import type { TaskExecutionResultSummary } from '../../review/shared/types.js';

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
  phase: 'running' | 'succeeded' | 'failed' | 'stopped',
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
    await waitFor(running, 'stopped');
    assert.match(running.status().error ?? '', /用户停止/);
  } finally {
    await running.close();
  }
});

test('成功和失败结果均提供实际存在的本地报告入口，并脱敏技术错误', async () => {
  const { root, catalog } = await fixture();
  const runDir = path.join(root, 'runs', 'test-run');
  const reportPath = path.join(runDir, 'report.html');
  await mkdir(runDir, { recursive: true });
  await writeFile(reportPath, '<html>report</html>');
  for (const status of ['succeeded', 'failed']) {
    const executor = { schemaVersion: '0.2', status, dryRun: false, sourceYamlPath: path.join(runDir, 'task.yaml'), finishedAt: new Date().toISOString(), reportPath, ...(status === 'failed' ? { error: 'runner failed 测试输入' } : {}) };
    await writeFile(path.join(runDir, 'execution-result.json'), JSON.stringify(executor));
    const payload = JSON.stringify({ runDir, executor });
    const manager = new TaskExecutionManager({
      catalog, dataRoot: root, executionRoot: root, countdownMs: 0,
      resolveLaunch: async () => ({ command: process.execPath, prefixArgs: ['-e', `process.stdout.write(${JSON.stringify(payload)});process.exit(${status === 'failed' ? 1 : 0})`, '--'] }),
    });
    try {
      await manager.start(request);
      await waitFor(manager, status as 'succeeded' | 'failed');
      assert.equal(manager.status().result?.reportUrl, '/api/execution/runs/test-run/report');
      if (status === 'failed') assert.equal(manager.status().error, 'runner failed [运行时输入]');
    } finally { await manager.close(); }
  }
});

test('技术详情不公开模型访问凭据', async () => {
  const { root, catalog } = await fixture();
  const previous = process.env.MIDSCENE_MODEL_API_KEY;
  process.env.MIDSCENE_MODEL_API_KEY = 'secret-key-for-test';
  const manager = new TaskExecutionManager({
    catalog, dataRoot: root, executionRoot: root, countdownMs: 0,
    resolveLaunch: async () => ({ command: process.execPath, prefixArgs: ['-e', 'process.stderr.write("401 Unauthorized secret-key-for-test");process.exit(1)', '--'] }),
  });
  try {
    await manager.start(request);
    await waitFor(manager, 'failed');
    assert.equal(manager.status().error, '401 Unauthorized [访问凭据]');
  } finally {
    await manager.close();
    if (previous === undefined) delete process.env.MIDSCENE_MODEL_API_KEY;
    else process.env.MIDSCENE_MODEL_API_KEY = previous;
  }
});

test('执行完成时保留输出边界、结果摘要和错误优先级', async () => {
  const { root, catalog } = await fixture();
  const missingRun = path.join(root, 'runs', 'missing-report');
  const cases: Array<{
    name: string; stdout: string; code: number; diagnostics: string;
    phase: 'succeeded' | 'failed'; result?: TaskExecutionResultSummary; error?: string;
  }> = [
    {
      name: '成功但报告尚未生成',
      stdout: JSON.stringify({ runDir: missingRun, resolvedTaskPath: 'snapshot.yaml', executor: { status: 'succeeded', dryRun: false, inputs: request.inputs, sourceYamlPath: 'private.yaml' } }),
      code: 0, diagnostics: '', phase: 'succeeded',
      result: { runDir: missingRun, resolvedTaskPath: 'snapshot.yaml', executor: { status: 'succeeded', dryRun: false } },
    },
    {
      name: '非法路径字段不进入摘要',
      stdout: JSON.stringify({ runDir: 123, resolvedTaskPath: [], executor: { status: 'succeeded' } }),
      code: 0, diagnostics: '', phase: 'succeeded', result: { executor: { status: 'succeeded' } },
    },
    {
      name: '非零退出码不能被成功载荷覆盖',
      stdout: JSON.stringify({ executor: { status: 'succeeded' } }),
      code: 2, diagnostics: '', phase: 'failed', result: { executor: { status: 'succeeded' } },
      error: '任务执行失败：exit=2 signal=-',
    },
    {
      name: '执行器错误优先于stderr并脱敏',
      stdout: JSON.stringify({ executor: { status: 'failed', error: '失败 测试输入' } }),
      code: 1, diagnostics: '其他诊断', phase: 'failed',
      result: { executor: { status: 'failed', error: '失败 [运行时输入]' } }, error: '失败 [运行时输入]',
    },
    {
      name: '执行器失败不能被零退出码覆盖',
      stdout: JSON.stringify({ executor: { status: 'failed', error: '' } }),
      code: 0, diagnostics: '  诊断 测试输入  ', phase: 'failed',
      result: { executor: { status: 'failed', error: '' } }, error: '诊断 [运行时输入]',
    },
    {
      name: '空对象保留空摘要', stdout: '{}', code: 1, diagnostics: '',
      phase: 'failed', result: {}, error: '任务执行失败：exit=1 signal=-',
    },
    ...['invalid-json', 'null', '[]', '42'].map(stdout => ({
      name: `非对象输出 ${stdout}`, stdout, code: 1, diagnostics: '诊断 测试输入',
      phase: 'failed' as const, error: '诊断 [运行时输入]',
    })),
  ];
  for (const item of cases) {
    const manager = new TaskExecutionManager({
      catalog, dataRoot: root, executionRoot: root, countdownMs: 0,
      resolveLaunch: async () => ({ command: process.execPath, prefixArgs: ['-e',
        `process.stdout.write(${JSON.stringify(item.stdout)});process.stderr.write(${JSON.stringify(item.diagnostics)});process.exit(${item.code})`, '--'],
      }),
    });
    try {
      await manager.start(request);
      await waitFor(manager, item.phase);
      const status = manager.status();
      assert.deepEqual(status.result, item.result, item.name);
      assert.equal(Object.hasOwn(status, 'result'), item.result !== undefined, item.name);
      assert.equal(status.error, item.error, item.name);
    } finally { await manager.close(); }
  }
});
