import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ExecutionDump } from '@midscene/core';
import type { Agent } from '@midscene/core';
import { ScriptPlayer, parseYamlScript } from '@midscene/core/yaml';
import { executeMidsceneYaml } from '../../executors/midscene-yaml.js';

async function yamlFixture(content: string) {
  const runDirectory = await mkdtemp(path.join(os.tmpdir(), 'cua-yaml-runner-'));
  const yamlPath = path.join(runDirectory, 'task.yaml');
  const resultPath = path.join(runDirectory, 'execution-result.json');
  await writeFile(yamlPath, content, 'utf8');
  return { runDirectory, yamlPath, resultPath };
}

test('dry-run 解析 YAML 且不创建 Agent', async () => {
  const fixture = await yamlFixture(`
computer: {}
tasks:
  - name: 键盘输入示例
    flow:
      - KeyboardTypeText:
          locate: Chrome 地址栏
          value: QATAR AIRWAYS
          mode: replace
      - KeyboardPress:
          keyName: Enter
`);
  let factoryCalled = false;
  const result = await executeMidsceneYaml({
    ...fixture,
    dryRun: true,
    agentFactory: async () => {
      factoryCalled = true;
      throw new Error('dry-run 不应创建 Agent');
    },
  });
  assert.equal(factoryCalled, false);
  assert.equal(result.status, 'succeeded');
  assert.equal(result.taskCount, 1);
  assert.deepEqual(JSON.parse(await readFile(fixture.resultPath, 'utf8')), result);
});

test('非法 YAML 写入失败结果并保留原始错误', async () => {
  const fixture = await yamlFixture('computer: {}\ntasks: []\n');
  await assert.rejects(executeMidsceneYaml({ ...fixture, dryRun: true }), /tasks 必须是非空数组/);
  const result = JSON.parse(await readFile(fixture.resultPath, 'utf8'));
  assert.equal(result.status, 'failed');
  assert.match(result.error, /tasks 必须是非空数组/);
});

test('实际执行设置本次报告目录并在成功后销毁 Agent 和恢复环境', async () => {
  const fixture = await yamlFixture('tasks:\n  - name: test\n    flow:\n      - sleep: 1\n');
  const reportPath = path.join(fixture.runDirectory, 'midscene', 'report', 'execution-report.html');
  const previousRequired = Object.fromEntries(
    ['MIDSCENE_MODEL_BASE_URL', 'MIDSCENE_MODEL_NAME', 'MIDSCENE_MODEL_API_KEY', 'MIDSCENE_MODEL_FAMILY'].map(
      (key) => [key, process.env[key]],
    ),
  );
  const previousRunDirectory = process.env.MIDSCENE_RUN_DIR;
  for (const key of Object.keys(previousRequired)) process.env[key] = 'test';
  process.env.MIDSCENE_RUN_DIR = 'previous-directory';
  let destroyed = false;
  let listenerRemoved = false;
  const progress: string[] = [];
  const screenshotContent = Buffer.from('yaml final screenshot');
  try {
    const result = await executeMidsceneYaml({
      ...fixture,
      dryRun: false,
      onProgress: (event) => { progress.push(event.data.status); },
      agentFactory: async (options) => {
        assert.equal(process.env.MIDSCENE_RUN_DIR, path.join(fixture.runDirectory, 'midscene'));
        assert.equal(options.reportFileName, 'execution-report');
        let listener: ((dump: string, executionDump?: ExecutionDump) => void) | undefined;
        return {
          reportFile: reportPath,
          addDumpUpdateListener: (callback: typeof listener) => {
            listener = callback;
            return () => { listenerRemoved = true; };
          },
          runYaml: async () => {
            listener?.('', { id: 'exec', tasks: [{
              taskId: 'task-1', status: 'finished', type: 'Action Space', subType: 'Tap',
              recorder: [{
                type: 'screenshot',
                ts: 1,
                timing: 'after-calling',
                screenshot: {
                  format: 'png',
                  rawBase64: screenshotContent.toString('base64'),
                },
              }],
            }] } as unknown as ExecutionDump);
            assert.deepEqual(progress, ['succeeded']);
            return { result: { ok: true } };
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
    assert.deepEqual(result.midsceneResult, { ok: true });
    assert.equal(result.reportPath, reportPath);
    assert.equal(result.finalScreenshotPath, path.join(fixture.runDirectory, 'final-screenshot.png'));
    assert.deepEqual(await readFile(result.finalScreenshotPath), screenshotContent);
    const persisted = JSON.parse(await readFile(fixture.resultPath, 'utf8'));
    assert.equal(persisted.reportPath, reportPath);
    assert.equal(persisted.finalScreenshotPath, result.finalScreenshotPath);
    assert.equal(destroyed, true);
    assert.equal(listenerRemoved, true);
    assert.equal(process.env.MIDSCENE_RUN_DIR, 'previous-directory');
  } finally {
    for (const [key, value] of Object.entries(previousRequired)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (previousRunDirectory === undefined) delete process.env.MIDSCENE_RUN_DIR;
    else process.env.MIDSCENE_RUN_DIR = previousRunDirectory;
  }
});

test('guided 保留 YAML 执行并采集 aiAct 回答', async () => {
  const fixture = await yamlFixture(`
computer: {}
agent:
  aiActContext: 读取界面信息时返回结果
tasks:
  - name: guided
    flow:
      - ai:
          prompt: 读取选项后继续操作
          images:
            - name: reference
              url: C:/reference.png
`);
  const required = ['MIDSCENE_MODEL_BASE_URL', 'MIDSCENE_MODEL_NAME', 'MIDSCENE_MODEL_FAMILY'];
  const previous = Object.fromEntries(required.map((key) => [key, process.env[key]]));
  for (const key of required) process.env[key] = 'test';
  const events: string[] = [];
  const screenshotContent = Buffer.from('guided screenshot');
  const reportPath = path.join(fixture.runDirectory, 'midscene', 'report', 'execution-report.html');
  let destroyed = false;
  try {
    const result = await executeMidsceneYaml({
      ...fixture,
      dryRun: false,
      captureAiActOutput: true,
      onProgress: (event) => { events.push(event.data.status); },
      agentFactory: async (options) => {
        assert.equal(options.aiActContext, '读取界面信息时返回结果');
        let listener: ((dump: string, executionDump?: ExecutionDump) => void) | undefined;
        const agent = {
          reportFile: reportPath,
          addDumpUpdateListener: (callback: typeof listener) => {
            listener = callback;
            return () => undefined;
          },
          aiAct: async (prompt: unknown) => {
            assert.deepEqual(prompt, {
              prompt: '读取选项后继续操作',
              images: [{ name: 'reference', url: 'C:/reference.png' }],
            });
            listener?.('', { id: 'exec', tasks: [{
              taskId: 'task-1', status: 'finished', type: 'Action Space', subType: 'Tap',
              recorder: [{
                type: 'screenshot', ts: 1, timing: 'after-calling',
                screenshot: { format: 'png', rawBase64: screenshotContent.toString('base64') },
              }],
            }] } as unknown as ExecutionDump);
            return '选项 A；选项 B';
          },
          runYaml: async () => {
            await agent.aiAct({
              prompt: '读取选项后继续操作',
              images: [{ name: 'reference', url: 'C:/reference.png' }],
            });
            return { result: { existing: true } };
          },
          destroy: async () => {
            destroyed = true;
            await mkdir(path.dirname(reportPath), { recursive: true });
            await writeFile(reportPath, '<html></html>', 'utf8');
          },
        };
        return agent;
      },
    });
    assert.deepEqual(result.midsceneResult, { existing: true, aiActOutput: '选项 A；选项 B' });
    assert.deepEqual(events, ['succeeded']);
    assert.equal(result.reportPath, reportPath);
    assert.equal(result.finalScreenshotPath, path.join(fixture.runDirectory, 'final-screenshot.png'));
    assert.deepEqual(await readFile(result.finalScreenshotPath), screenshotContent);
    assert.equal(destroyed, true);
    assert.deepEqual(JSON.parse(await readFile(fixture.resultPath, 'utf8')).midsceneResult, result.midsceneResult);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('guided 的空 aiAct 回答不生成 aiActOutput', async () => {
  const fixture = await yamlFixture('tasks:\n  - name: guided\n    flow:\n      - ai: 执行操作\n');
  const required = ['MIDSCENE_MODEL_BASE_URL', 'MIDSCENE_MODEL_NAME', 'MIDSCENE_MODEL_FAMILY'];
  const previous = Object.fromEntries(required.map((key) => [key, process.env[key]]));
  for (const key of required) process.env[key] = 'test';
  try {
    const result = await executeMidsceneYaml({
      ...fixture,
      dryRun: false,
      captureAiActOutput: true,
      agentFactory: async () => {
        const agent = {
          aiAct: async () => undefined,
          runYaml: async () => {
            await agent.aiAct();
            return { result: {} };
          },
          destroy: async () => undefined,
        };
        return agent;
      },
    });
    assert.deepEqual(result.midsceneResult, {});
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Replay 通过 Midscene YAML Player 按执行位置保存多个 aiAsk 结果', async () => {
  const fixture = await yamlFixture(`
computer: {}
tasks:
  - name: step-001 | click
    flow:
      - aiTap: 打开列表
  - name: step-002 | read
    flow:
      - aiAsk: 读取列表选项
        name: read-step-002
  - name: step-003 | click
    flow:
      - aiTap: 打开详情
  - name: step-004 | read
    flow:
      - aiAsk: 读取详情数值
        name: read-step-004
`);
  const required = ['MIDSCENE_MODEL_BASE_URL', 'MIDSCENE_MODEL_NAME', 'MIDSCENE_MODEL_FAMILY'];
  const previous = Object.fromEntries(required.map(key => [key, process.env[key]]));
  for (const key of required) process.env[key] = 'test';
  const order: string[] = [];
  let screen = '';
  try {
    const result = await executeMidsceneYaml({
      ...fixture,
      dryRun: false,
      agentFactory: async () => {
        const agent = {
          getActionSpace: async () => [],
          aiTap: async (prompt: string) => {
            order.push(`tap:${prompt}`);
            screen = prompt === '打开列表' ? '列表' : '详情';
          },
          aiAsk: async (prompt: string) => {
            order.push(`ask:${prompt}`);
            return screen === '列表' ? '选项 A、选项 B' : '带宽 100 Mbit/s';
          },
          runYaml: async (content: string) => {
            const player = new ScriptPlayer(parseYamlScript(content), async () => ({
              agent: agent as unknown as Agent, freeFn: [],
            }));
            await player.run();
            assert.equal(player.status, 'done');
            return { result: player.result };
          },
          destroy: async () => undefined,
        };
        return agent;
      },
    });
    assert.deepEqual(order, [
      'tap:打开列表', 'ask:读取列表选项', 'tap:打开详情', 'ask:读取详情数值',
    ]);
    assert.deepEqual(result.midsceneResult, {
      'read-step-002': '选项 A、选项 B',
      'read-step-004': '带宽 100 Mbit/s',
      readQuestions: {
        'read-step-002': '读取列表选项',
        'read-step-004': '读取详情数值',
      },
    });
    assert.deepEqual(JSON.parse(await readFile(fixture.resultPath, 'utf8')).midsceneResult,
      result.midsceneResult);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('实际执行未生成报告文件时保持成功且不返回 reportPath', async () => {
  const fixture = await yamlFixture('tasks:\n  - name: test\n    flow:\n      - sleep: 1\n');
  const required = ['MIDSCENE_MODEL_BASE_URL', 'MIDSCENE_MODEL_NAME', 'MIDSCENE_MODEL_API_KEY', 'MIDSCENE_MODEL_FAMILY'];
  const previous = Object.fromEntries(required.map((key) => [key, process.env[key]]));
  for (const key of required) process.env[key] = 'test';
  try {
    const result = await executeMidsceneYaml({
      ...fixture,
      dryRun: false,
      agentFactory: async () => ({
        reportFile: path.join(fixture.runDirectory, 'midscene', 'report', 'missing.html'),
        runYaml: async () => ({ result: { ok: true } }),
        destroy: async () => undefined,
      }),
    });
    assert.equal(result.status, 'succeeded');
    assert.equal(result.reportPath, undefined);
    assert.equal(result.finalScreenshotPath, undefined);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Agent 执行失败仍会销毁并恢复环境', async () => {
  const fixture = await yamlFixture('tasks:\n  - name: test\n    flow:\n      - sleep: 1\n');
  const required = ['MIDSCENE_MODEL_BASE_URL', 'MIDSCENE_MODEL_NAME', 'MIDSCENE_MODEL_API_KEY', 'MIDSCENE_MODEL_FAMILY'];
  const previous = Object.fromEntries(required.map((key) => [key, process.env[key]]));
  const previousRunDirectory = process.env.MIDSCENE_RUN_DIR;
  for (const key of required) process.env[key] = 'test';
  let destroyed = false;
  const reportPath = path.join(fixture.runDirectory, 'midscene', 'report', 'failed.html');
  try {
    await assert.rejects(
      executeMidsceneYaml({
        ...fixture,
        dryRun: false,
        agentFactory: async () => ({
          reportFile: reportPath,
          runYaml: async () => {
            throw new Error('KeyboardTypeText 不支持字符');
          },
          destroy: async () => {
            destroyed = true;
            await mkdir(path.dirname(reportPath), { recursive: true });
            await writeFile(reportPath, '<html>failed run</html>', 'utf8');
          },
        }),
      }),
      /KeyboardTypeText 不支持字符/,
    );
    assert.equal(destroyed, true);
    const persisted = JSON.parse(await readFile(fixture.resultPath, 'utf8'));
    assert.equal(persisted.status, 'failed');
    assert.equal(persisted.reportPath, reportPath);
    assert.equal(process.env.MIDSCENE_RUN_DIR, previousRunDirectory);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (previousRunDirectory === undefined) delete process.env.MIDSCENE_RUN_DIR;
    else process.env.MIDSCENE_RUN_DIR = previousRunDirectory;
  }
});
