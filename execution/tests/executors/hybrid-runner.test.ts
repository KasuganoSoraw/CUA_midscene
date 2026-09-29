import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ExecutionDump, TUserPrompt } from '@midscene/core';
import { parse } from 'yaml';
import { executeMidsceneHybrid } from '../../executors/midscene-hybrid.js';

async function fixture() {
  const runDirectory = await mkdtemp(path.join(os.tmpdir(), 'cua-hybrid-runner-'));
  const yamlPath = path.join(runDirectory, 'resolved-task.yaml');
  const resultPath = path.join(runDirectory, 'execution-result.json');
  await writeFile(yamlPath, `
computer: {}
agent:
  groupName: hybrid-test
  groupDescription: 完成三步测试任务
  generateReport: true
tasks:
  - name: step-001 | click
    flow:
      - aiTap: 第一个按钮
  - name: step-002 | click
    flow:
      - aiTap: 第二个按钮
  - name: step-003 | click
    flow:
      - aiTap: 第三个按钮
`, 'utf8');
  return { runDirectory, yamlPath, resultPath };
}

function withModelEnv<T>(run: () => Promise<T>): Promise<T> {
  const keys = [
    'MIDSCENE_MODEL_BASE_URL',
    'MIDSCENE_MODEL_NAME',
    'MIDSCENE_MODEL_API_KEY',
    'MIDSCENE_MODEL_FAMILY',
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) process.env[key] = 'test';
  return run().finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test('hybrid 复用一个 Agent，并只对失败步骤进行局部恢复', async () => withModelEnv(async () => {
  const source = await fixture();
  const runSteps: string[] = [];
  const recoveryPrompts: TUserPrompt[] = [];
  const progress: Array<{ taskIndex: number; taskId: string; phase?: string; status: string }> = [];
  const reportPath = path.join(source.runDirectory, 'midscene', 'report', 'execution-report.html');
  let destroyed = 0;
  let listener: ((dump: string, executionDump?: ExecutionDump) => void) | undefined;

  const result = await executeMidsceneHybrid({
    ...source,
    goal: '完成三步测试任务',
    dryRun: false,
    onProgress: (event) => progress.push(event.data),
    agentFactory: async () => ({
      reportFile: reportPath,
      addDumpUpdateListener: (callback) => {
        listener = callback;
        return () => { listener = undefined; };
      },
      runYaml: async (content) => {
        const document = parse(content) as { tasks: Array<{ name: string }> };
        assert.equal(document.tasks.length, 1);
        const name = document.tasks[0].name;
        runSteps.push(name);
        if (name.startsWith('step-002')) throw new Error('目标位置发生变化');
        listener?.('', {
          id: `execution-${runSteps.length}`,
          tasks: [{
            taskId: 'local-task',
            status: 'finished',
            type: 'Action Space',
            subType: 'Tap',
            recorder: name.startsWith('step-003') ? [{
              type: 'screenshot',
              ts: 1,
              timing: 'after-calling',
              screenshot: { format: 'png', rawBase64: Buffer.from('hybrid final').toString('base64') },
            }] : [],
          }],
        } as unknown as ExecutionDump);
        return { result: { name } };
      },
      aiAct: async (prompt) => {
        recoveryPrompts.push(prompt);
        return '第二个按钮已点击';
      },
      destroy: async () => {
        destroyed += 1;
        await mkdir(path.dirname(reportPath), { recursive: true });
        await writeFile(reportPath, '<html></html>', 'utf8');
      },
    }),
  });

  assert.deepEqual(runSteps, [
    'step-001 | click',
    'step-002 | click',
    'step-003 | click',
  ]);
  assert.equal(recoveryPrompts.length, 1);
  const promptText = typeof recoveryPrompts[0] === 'string'
    ? recoveryPrompts[0]
    : recoveryPrompts[0].prompt;
  assert.match(promptText, /只恢复并完成当前步骤/);
  assert.match(promptText, /不要执行后续步骤/);
  assert.equal(destroyed, 1);
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(result.hybrid, {
    steps: [
      { stepIndex: 0, stepId: 'step-001', name: 'step-001 | click', status: 'replayed' },
      {
        stepIndex: 1,
        stepId: 'step-002',
        name: 'step-002 | click',
        status: 'recovered',
        replayError: '目标位置发生变化',
        recoveryResult: '第二个按钮已点击',
      },
      { stepIndex: 2, stepId: 'step-003', name: 'step-003 | click', status: 'replayed' },
    ],
    recovery: { attempted: 1, succeeded: 1, limit: 3, steps: ['step-002'] },
  });
  assert.equal(result.reportPath, reportPath);
  assert.equal(await readFile(result.finalScreenshotPath!, 'utf8'), 'hybrid final');
  assert.ok(progress.some((event) => event.taskId === 'step-001' && event.taskIndex === 0 && event.phase === 'replay'));
  assert.ok(progress.some((event) => event.taskId === 'step-002' && event.taskIndex === 1 && event.phase === 'recovery' && event.status === 'succeeded'));
  assert.ok(progress.some((event) => event.taskId === 'step-003' && event.taskIndex === 2 && event.phase === 'replay'));
  assert.deepEqual(JSON.parse(await readFile(source.resultPath, 'utf8')), result);
}));

test('hybrid 恢复失败时停止后续步骤并持久化恢复摘要', async () => withModelEnv(async () => {
  const source = await fixture();
  const runSteps: string[] = [];
  await assert.rejects(
    executeMidsceneHybrid({
      ...source,
      goal: '完成三步测试任务',
      dryRun: false,
      agentFactory: async () => ({
        runYaml: async (content) => {
          const document = parse(content) as { tasks: Array<{ name: string }> };
          runSteps.push(document.tasks[0].name);
          throw new Error('回放失败');
        },
        aiAct: async () => { throw new Error('恢复失败'); },
        destroy: async () => undefined,
      }),
    }),
    /恢复失败/,
  );
  assert.deepEqual(runSteps, ['step-001 | click']);
  const persisted = JSON.parse(await readFile(source.resultPath, 'utf8'));
  assert.equal(persisted.status, 'failed');
  assert.deepEqual(persisted.hybrid.recovery, {
    attempted: 1,
    succeeded: 0,
    limit: 3,
    steps: ['step-001'],
  });
  assert.equal(persisted.hybrid.steps[0].status, 'failed');
}));
