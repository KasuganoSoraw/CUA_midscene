import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ExecutionDump } from '@midscene/core';
import { executeMidsceneYaml } from '../../executors/midscene-yaml.js';
import { replayFailure, recoveryPrompt } from '../../executors/midscene-replay-recovery.js';

const taskPrompt = { prompt: 'step-001: 打开列表\nstep-002: 选择条目\nstep-003: 完成操作', images: [] };

async function fixture() {
  const runDirectory = await mkdtemp(path.join(os.tmpdir(), 'cua-replay-fallback-'));
  const yamlPath = path.join(runDirectory, 'task.yaml');
  const resultPath = path.join(runDirectory, 'execution-result.json');
  await writeFile(yamlPath, `computer: {}
tasks:
  - name: step-001 | click
    flow:
      - ai: 打开列表
  - name: step-002 | click
    flow:
      - ai: 选择条目
  - name: step-003 | click
    flow:
      - ai: 完成操作
`, 'utf8');
  return { runDirectory, yamlPath, resultPath };
}

function modelEnvironment(): () => void {
  const keys = ['MIDSCENE_MODEL_BASE_URL', 'MIDSCENE_MODEL_NAME', 'MIDSCENE_MODEL_FAMILY', 'MIDSCENE_MODEL_API_KEY'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) process.env[key] = 'test';
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

test('Replay 中途失败后由同一 Agent 接续并保留单份结果', async () => {
  const paths = await fixture();
  const restore = modelEnvironment();
  let created = 0;
  let destroyed = 0;
  const prompts: unknown[] = [];
  const events: Array<{ data: { phase?: string; taskId?: string; status: string } }> = [];
  try {
    const result = await executeMidsceneYaml({
      ...paths, dryRun: false,
      replayFallback: { goal: '完成列表操作', taskPrompt },
      onProgress: event => { events.push(event); },
      agentFactory: async () => {
        created += 1;
        return {
          getActionSpace: async () => [],
          aiAct: async (prompt: unknown) => {
            prompts.push(prompt);
            if (prompts.length === 2) throw new Error('目标未找到');
            return prompts.length === 3 ? '已完成' : '已打开';
          },
          runYaml: async () => { throw new Error('Replay 应使用同 Agent 的播放器'); },
          addDumpUpdateListener: () => () => undefined,
          destroy: async () => { destroyed += 1; },
        } as any;
      },
    });
    assert.equal(result.status, 'succeeded');
    assert.equal(created, 1);
    assert.equal(destroyed, 1);
    assert.equal(prompts.length, 3);
    assert.match(JSON.stringify(prompts[2]), /先观察当前屏幕/);
    assert.match(JSON.stringify(prompts[2]), /已完成步骤：step-001/);
    assert.equal(result.fallback?.failedStep, 'step-002');
    assert.deepEqual(result.fallback?.pendingSteps, ['step-003']);
    assert.equal(result.fallback?.recoveryStatus, 'succeeded');
    assert.equal(result.midsceneResult?.aiActOutput, '已完成');
    assert.deepEqual(events.map(event => [event.data.phase, event.data.taskId, event.data.status]), [
      ['replay', 'step-002', 'failed'],
      ['adaptive', 'adaptive-recovery', 'running'],
      ['adaptive', 'adaptive-recovery', 'succeeded'],
    ]);
    assert.deepEqual(JSON.parse(await readFile(paths.resultPath, 'utf8')), JSON.parse(JSON.stringify(result)));
  } finally {
    restore();
  }
});

test('Replay 首步失败由 Adaptive 从当前画面接续', async () => {
  const paths = await fixture();
  const restore = modelEnvironment();
  let calls = 0;
  try {
    const result = await executeMidsceneYaml({
      ...paths, dryRun: false, replayFallback: { goal: '完成任务', taskPrompt },
      agentFactory: async () => ({
        getActionSpace: async () => [],
        aiAct: async () => {
          calls += 1;
          if (calls === 1) throw new Error('首步定位失败');
          return '已接续完成';
        },
        runYaml: async () => { throw new Error('不应重新运行完整 YAML'); },
        destroy: async () => undefined,
      } as any),
    });
    assert.equal(result.status, 'succeeded');
    assert.equal(result.fallback?.failedStep, 'step-001');
    assert.deepEqual(result.fallback?.completedSteps, []);
    assert.equal(result.midsceneResult?.aiActOutput, '已接续完成');
    assert.equal(calls, 2);
  } finally { restore(); }
});

test('Replay 成功时不触发 Adaptive', async () => {
  const paths = await fixture();
  const restore = modelEnvironment();
  let calls = 0;
  try {
    const result = await executeMidsceneYaml({
      ...paths, dryRun: false, replayFallback: { goal: '完成任务', taskPrompt },
      agentFactory: async () => ({
        getActionSpace: async () => [],
        aiAct: async () => { calls += 1; return '已完成'; },
        runYaml: async () => { throw new Error('不应重新运行完整 YAML'); },
        destroy: async () => undefined,
      } as any),
    });
    assert.equal(result.status, 'succeeded');
    assert.equal(result.fallback, undefined);
    assert.equal(calls, 3);
  } finally { restore(); }
});

test('回退完成后保留同一 Agent 的报告与最终截图', async () => {
  const paths = await fixture();
  const restore = modelEnvironment();
  const reportFile = path.join(paths.runDirectory, 'midscene', 'report', 'execution-report.html');
  const screenshot = Buffer.from('adaptive screenshot');
  let listener: ((dump: string, executionDump?: ExecutionDump) => void) | undefined;
  let calls = 0;
  try {
    const result = await executeMidsceneYaml({
      ...paths, dryRun: false, replayFallback: { goal: '完成任务', taskPrompt },
      agentFactory: async () => ({
        reportFile,
        getActionSpace: async () => [],
        addDumpUpdateListener: (callback: typeof listener) => {
          listener = callback;
          return () => { listener = undefined; };
        },
        aiAct: async () => {
          calls += 1;
          if (calls === 1) throw new Error('定位失败');
          listener?.('', { id: 'adaptive', tasks: [{
            taskId: 'adaptive-step', status: 'finished', type: 'Action Space', subType: 'Tap',
            recorder: [{ type: 'screenshot', ts: 1, timing: 'after-calling',
              screenshot: { format: 'png', rawBase64: screenshot.toString('base64') } }],
          }] } as unknown as ExecutionDump);
          return '已完成';
        },
        runYaml: async () => { throw new Error('不应重新运行完整 YAML'); },
        destroy: async () => {
          await mkdir(path.dirname(reportFile), { recursive: true });
          await writeFile(reportFile, '<html><body>report</body></html>');
        },
      } as any),
    });
    assert.equal(result.reportPath, reportFile);
    assert.equal(result.finalScreenshotPath, path.join(paths.runDirectory, 'final-screenshot.png'));
    assert.deepEqual(await readFile(result.finalScreenshotPath), screenshot);
    assert.equal(result.fallback?.recoveryStatus, 'succeeded');
  } finally { restore(); }
});

test('Adaptive 失败不会再次回退且保留失败结果', async () => {
  const paths = await fixture();
  const restore = modelEnvironment();
  let calls = 0;
  let destroyed = 0;
  try {
    await assert.rejects(executeMidsceneYaml({
      ...paths, dryRun: false, replayFallback: { goal: '完成任务', taskPrompt },
      agentFactory: async () => ({
        getActionSpace: async () => [],
        aiAct: async () => { calls += 1; throw new Error(`阶段 ${calls} 失败`); },
        runYaml: async () => { throw new Error('不应重新运行完整 YAML'); },
        destroy: async () => { destroyed += 1; },
      } as any),
    }), /Replay 步骤 step-001 失败：阶段 1 失败\nAdaptive 接续失败：阶段 2 失败/);
    const result = JSON.parse(await readFile(paths.resultPath, 'utf8'));
    assert.equal(result.status, 'failed');
    assert.equal(result.fallback.recoveryStatus, 'failed');
    assert.equal(result.fallback.failedStep, 'step-001');
    assert.equal(calls, 2);
    assert.equal(destroyed, 1);
  } finally { restore(); }
});

test('Replay 取消时不启动 Adaptive', async () => {
  const paths = await fixture();
  const restore = modelEnvironment();
  const controller = new AbortController();
  let calls = 0;
  try {
    await assert.rejects(executeMidsceneYaml({
      ...paths, dryRun: false, replayFallback: { goal: '完成任务', taskPrompt },
      abortSignal: controller.signal,
      agentFactory: async () => ({
        getActionSpace: async () => [],
        aiAct: async () => {
          calls += 1;
          controller.abort();
          throw new Error('电脑操作已取消');
        },
        runYaml: async () => { throw new Error('不应重新运行完整 YAML'); },
        destroy: async () => undefined,
      } as any),
    }), /电脑操作已取消/);
    const result = JSON.parse(await readFile(paths.resultPath, 'utf8'));
    assert.equal(result.status, 'failed');
    assert.equal(result.fallback, undefined);
    assert.equal(calls, 1);
  } finally { restore(); }
});

test('Adaptive 接收取消信号并停止本次回退', async () => {
  const paths = await fixture();
  const restore = modelEnvironment();
  const controller = new AbortController();
  let calls = 0;
  try {
    await assert.rejects(executeMidsceneYaml({
      ...paths, dryRun: false, replayFallback: { goal: '完成任务', taskPrompt },
      abortSignal: controller.signal,
      agentFactory: async () => ({
        getActionSpace: async () => [],
        aiAct: async (_prompt: unknown, options?: { abortSignal?: AbortSignal }) => {
          calls += 1;
          assert.equal(options?.abortSignal, controller.signal);
          if (calls === 1) throw new Error('定位失败');
          controller.abort();
          throw new Error('电脑操作已取消');
        },
        runYaml: async () => { throw new Error('不应重新运行完整 YAML'); },
        destroy: async () => undefined,
      } as any),
    }), /电脑操作已取消/);
    const result = JSON.parse(await readFile(paths.resultPath, 'utf8'));
    assert.equal(result.status, 'failed');
    assert.equal(result.fallback.recoveryStatus, 'failed');
    assert.equal(calls, 2);
  } finally { restore(); }
});

test('失败步骤保持不确定且恢复提示不要求重复已完成操作', () => {
  const failure = replayFailure([
    { name: 'step-001', status: 'done' },
    { name: 'step-002', status: 'error', error: new Error('目标未找到') },
    { name: 'step-003', status: 'init' },
  ]);
  assert.ok(failure);
  assert.deepEqual(failure.fallback.completedSteps, ['step-001']);
  assert.deepEqual(failure.fallback.uncertainSteps, ['step-002']);
  const images = [{ name: 'target', url: 'C:/reference.png' }];
  const prompt = recoveryPrompt(
    { goal: '完成任务', taskPrompt: { ...taskPrompt, images } },
    failure.fallback, failure.reason, {},
  );
  assert.match(prompt.prompt, /已完成的步骤不可重复/);
  assert.match(prompt.prompt, /不得重复/);
  assert.deepEqual(prompt.images, images);
});

function readingResultsInPrompt(results: Record<string, unknown>): string | undefined {
  const failure = replayFailure([{ name: 'step-001', status: 'error' }]);
  assert.ok(failure);
  const { prompt } = recoveryPrompt({ goal: '查询', taskPrompt }, failure.fallback, failure.reason, results);
  const prefix = '已获得的读取结果：';
  return prompt.split('\n').find(line => line.startsWith(prefix))?.slice(prefix.length);
}

test('回退提示保持正常读取结果的 JSON 格式，空对象不添加读取结果', () => {
  const results = { text: '列表\n内容', rows: [{ enabled: true, count: 2 }, null] };
  assert.equal(readingResultsInPrompt(results), JSON.stringify(results));
  assert.equal(readingResultsInPrompt({}), undefined);
});

test('回退提示保留正常字段和共享对象并替换异常值', () => {
  const shared = { value: '可用' };
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const results = {
    rows: [shared, circular, shared],
    count: 9007199254740993n,
    handler: () => 'unused',
    token: Symbol('标记'),
    missing: undefined,
  };
  assert.deepEqual(JSON.parse(readingResultsInPrompt(results)!), {
    rows: [shared, { self: '[Circular Reference]' }, shared],
    count: '9007199254740993n',
    handler: '[Function]',
    token: '[Symbol: Symbol(标记)]',
    missing: '[Undefined]',
  });
});

test('单个读取字段抛出序列化异常时保留其他字段', () => {
  const results = {
    normal: '已读取',
    broken: { toJSON() { throw new Error('不可序列化'); } },
    get inaccessible() { throw new Error('无法读取'); },
  };
  assert.deepEqual(JSON.parse(readingResultsInPrompt(results)!), {
    normal: '已读取',
    broken: '[Serialization Failed]',
    inaccessible: '[Serialization Failed]',
  });
});

test('无法枚举读取结果时回退提示使用兜底文本', () => {
  const results = new Proxy({}, { ownKeys() { throw new Error('无法枚举'); } });
  assert.equal(readingResultsInPrompt(results), '[Serialization Failed]');
});

test('模型服务与连接错误不触发 Adaptive', () => {
  const httpError = Object.assign(new Error('请求受限'), { status: 413 });
  const connectionError = Object.assign(new Error('连接失败'), { code: 'ECONNREFUSED' });
  assert.equal(replayFailure([{ name: 'step-001', status: 'error', error: httpError }]), undefined);
  assert.equal(replayFailure([{ name: 'step-001', status: 'error', error: connectionError }]), undefined);
});

test('YAML 包含未支持的动作时不触发 Adaptive', () => {
  const error = new Error('unknown flowItem in yaml: {"unsupported":true}');
  assert.equal(replayFailure([{ name: 'step-001', status: 'error', error }]), undefined);
});
