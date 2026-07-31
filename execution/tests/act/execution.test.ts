import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  runNaturalLanguageAiAct,
  type NativeAiActExecutorResult,
} from '../../cua/index.js';
import type { MidsceneAiActExecutionOptions } from '../../executors/midscene-ai-act.js';

test('独立 aiAct API 保存 prompt 并调用原生执行器', async () => {
  const runsRoot = await mkdtemp(path.join(os.tmpdir(), 'cua-native-ai-act-api-'));
  let received: MidsceneAiActExecutionOptions | undefined;
  const run = await runNaturalLanguageAiAct({
    prompt: '  打开 Chrome 并搜索 GUI agent  ',
    runsRoot,
    dryRun: true,
    executor: async (options) => {
      received = options;
      const result: NativeAiActExecutorResult = {
        schemaVersion: '0.1',
        status: 'succeeded',
        sourcePromptPath: options.sourcePromptPath,
        dryRun: options.dryRun,
        finishedAt: new Date().toISOString(),
      };
      return result;
    },
  });

  assert.equal(await readFile(run.promptPath, 'utf8'), '打开 Chrome 并搜索 GUI agent\n');
  assert.equal(received?.prompt, '打开 Chrome 并搜索 GUI agent');
  assert.equal(received?.runDirectory, run.runDirectory);
  assert.equal(received?.resultPath, run.resultPath);
  assert.equal(run.executorResult.status, 'succeeded');
});

test('独立 aiAct API 在创建运行目录前拒绝空 prompt', async () => {
  const runsRoot = await mkdtemp(path.join(os.tmpdir(), 'cua-native-ai-act-empty-'));
  await assert.rejects(
    runNaturalLanguageAiAct({ prompt: '   ', runsRoot, dryRun: true }),
    /prompt 不能为空/,
  );
});
