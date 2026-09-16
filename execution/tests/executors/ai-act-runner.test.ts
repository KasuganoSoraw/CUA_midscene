import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ExecutionDump } from '@midscene/core';
import { executeMidsceneAiAct } from '../../executors/midscene-ai-act.js';

async function executionFixture() {
  const runDirectory = await mkdtemp(path.join(os.tmpdir(), 'cua-ai-act-runner-'));
  return {
    runDirectory,
    sourcePromptPath: path.join(runDirectory, 'ai-act-prompt.txt'),
    resultPath: path.join(runDirectory, 'ai-act-result.json'),
  };
}

test('原生 aiAct dry-run 校验 prompt 且不创建 Agent', async () => {
  const fixture = await executionFixture();
  let factoryCalled = false;
  const result = await executeMidsceneAiAct({
    ...fixture,
    prompt: '打开 Chrome 并搜索 GUI agent',
    dryRun: true,
    agentFactory: async () => {
      factoryCalled = true;
      throw new Error('dry-run 不应创建 Agent');
    },
  });

  assert.equal(factoryCalled, false);
  assert.equal(result.status, 'succeeded');
  assert.equal(result.sourcePromptPath, fixture.sourcePromptPath);
  assert.deepEqual(JSON.parse(await readFile(fixture.resultPath, 'utf8')), result);
});

test('原生 aiAct 直接调用 Agent 并在成功后销毁和恢复环境', async () => {
  const fixture = await executionFixture();
  const reportPath = path.join(fixture.runDirectory, 'midscene', 'report', 'execution-report.html');
  const required = [
    'MIDSCENE_MODEL_BASE_URL',
    'MIDSCENE_MODEL_NAME',
    'MIDSCENE_MODEL_API_KEY',
    'MIDSCENE_MODEL_FAMILY',
  ];
  const previous = Object.fromEntries(required.map((key) => [key, process.env[key]]));
  const previousRunDirectory = process.env.MIDSCENE_RUN_DIR;
  for (const key of required) process.env[key] = 'test';
  process.env.MIDSCENE_RUN_DIR = 'previous-directory';
  let destroyed = false;
  let listenerRemoved = false;
  const progress: string[] = [];

  try {
    const result = await executeMidsceneAiAct({
      ...fixture,
      prompt: '打开 Chrome',
      dryRun: false,
      displayId: '1',
      onProgress: (event) => { progress.push(event.data.status); },
      agentFactory: async (options) => {
        assert.equal(options.displayId, '1');
        assert.equal(options.generateReport, true);
        assert.equal(options.reportFileName, 'execution-report');
        const context = String(options.aiActContext);
        assert.match(context, /ASCII.*必须使用 KeyboardTypeText/);
        assert.match(context, /包含中文.*使用默认 Input/);
        assert.match(context, /默认 Input 仅用于待输入字符本身不受 KeyboardTypeText 支持/);
        assert.match(context, /不得因为定位失败、输入失败或一般执行失败.*切换为默认 Input/);
        assert.equal(process.env.MIDSCENE_RUN_DIR, path.join(fixture.runDirectory, 'midscene'));
        let listener: ((dump: string, executionDump?: ExecutionDump) => void) | undefined;
        return {
          reportFile: reportPath,
          addDumpUpdateListener: (callback: typeof listener) => {
            listener = callback;
            return () => { listenerRemoved = true; };
          },
          aiAct: async (prompt) => {
            assert.equal(prompt, '打开 Chrome');
            listener?.('', { id: 'exec', tasks: [{
              taskId: 'task-1', status: 'running', type: 'Planning', subType: 'Act',
            }] } as unknown as ExecutionDump);
            assert.deepEqual(progress, ['running']);
            return '操作完成';
          },
          destroy: async () => {
            destroyed = true;
            await mkdir(path.dirname(reportPath), { recursive: true });
            await writeFile(reportPath, '<html></html>', 'utf8');
          },
        };
      },
    });

    assert.equal(result.status, 'succeeded');
    assert.equal(result.midsceneResult, '操作完成');
    assert.equal(result.reportPath, reportPath);
    assert.equal(JSON.parse(await readFile(fixture.resultPath, 'utf8')).reportPath, reportPath);
    assert.equal(destroyed, true);
    assert.equal(listenerRemoved, true);
    assert.equal(process.env.MIDSCENE_RUN_DIR, 'previous-directory');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (previousRunDirectory === undefined) delete process.env.MIDSCENE_RUN_DIR;
    else process.env.MIDSCENE_RUN_DIR = previousRunDirectory;
  }
});

test('原生 aiAct 未生成报告文件时保持成功且不返回 reportPath', async () => {
  const fixture = await executionFixture();
  const required = [
    'MIDSCENE_MODEL_BASE_URL',
    'MIDSCENE_MODEL_NAME',
    'MIDSCENE_MODEL_API_KEY',
    'MIDSCENE_MODEL_FAMILY',
  ];
  const previous = Object.fromEntries(required.map((key) => [key, process.env[key]]));
  for (const key of required) process.env[key] = 'test';
  try {
    const result = await executeMidsceneAiAct({
      ...fixture,
      prompt: '打开 Chrome',
      dryRun: false,
      agentFactory: async () => ({
        reportFile: path.join(fixture.runDirectory, 'midscene', 'report', 'missing.html'),
        aiAct: async () => '操作完成',
        destroy: async () => undefined,
      }),
    });
    assert.equal(result.status, 'succeeded');
    assert.equal(result.reportPath, undefined);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('原生 aiAct 失败时保留错误并销毁 Agent', async () => {
  const fixture = await executionFixture();
  const required = [
    'MIDSCENE_MODEL_BASE_URL',
    'MIDSCENE_MODEL_NAME',
    'MIDSCENE_MODEL_API_KEY',
    'MIDSCENE_MODEL_FAMILY',
  ];
  const previous = Object.fromEntries(required.map((key) => [key, process.env[key]]));
  let destroyed = false;
  for (const key of required) process.env[key] = 'test';

  try {
    await assert.rejects(
      executeMidsceneAiAct({
        ...fixture,
        prompt: '打开 Chrome',
        dryRun: false,
        agentFactory: async () => ({
          aiAct: async () => {
            throw new Error('规划失败');
          },
          destroy: async () => {
            destroyed = true;
          },
        }),
      }),
      /规划失败/,
    );
    assert.equal(destroyed, true);
    const result = JSON.parse(await readFile(fixture.resultPath, 'utf8'));
    assert.equal(result.status, 'failed');
    assert.match(result.error, /规划失败/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('原生 aiAct 拒绝空 prompt 并写入失败结果', async () => {
  const fixture = await executionFixture();
  await assert.rejects(
    executeMidsceneAiAct({ ...fixture, prompt: '   ', dryRun: true }),
    /prompt 不能为空/,
  );
  const result = JSON.parse(await readFile(fixture.resultPath, 'utf8'));
  assert.equal(result.status, 'failed');
  assert.match(result.error, /prompt 不能为空/);
});
