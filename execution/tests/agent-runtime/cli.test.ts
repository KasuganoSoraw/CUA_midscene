import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  AgentCliUsageError,
  agentHelpText,
  runAgentCliCommand,
} from '../../agent-runtime/cli.js';

test('Agent Runtime CLI 以单个 JSON 返回自然语言 dry-run 结果', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'cua-agent-cli-'));
  const output = await runAgentCliCommand([
    'act',
    'run',
    '--prompt',
    '打开 Chrome 并搜索 GUI agent',
    '--data-root',
    dataRoot,
    '--dry-run',
  ]);
  const result = JSON.parse(output);

  assert.equal(result.mode, 'prompt');
  assert.equal(result.executor.status, 'succeeded');
  assert.equal(result.executor.dryRun, true);
  assert.ok(path.resolve(result.runDir).startsWith(path.join(dataRoot, 'runs')));
  assert.equal(await readFile(result.promptPath, 'utf8'), '打开 Chrome 并搜索 GUI agent\n');
  assert.deepEqual(JSON.parse(await readFile(result.resultPath, 'utf8')), result.executor);
});

test('Agent Runtime CLI 只接受自然语言 act run 命令', async () => {
  const cases: Array<[string[], RegExp]> = [
    [[], /仅支持命令/],
    [['task', 'run'], /仅支持命令/],
    [['act', 'run'], /必须提供 --prompt/],
    [['act', 'run', '--prompt', 'test', '--prompt', 'again'], /不能重复提供/],
    [['act', 'run', '--prompt', 'test', '--unknown'], /无法识别参数/],
  ];

  for (const [argv, expected] of cases) {
    await assert.rejects(runAgentCliCommand(argv), (error: Error) => {
      assert.ok(error instanceof AgentCliUsageError);
      assert.match(error.message, expected);
      return true;
    });
  }
});

test('Agent Runtime CLI 在执行前拒绝相对数据根', async () => {
  await assert.rejects(
    runAgentCliCommand([
      'act',
      'run',
      '--prompt',
      '打开 Chrome',
      '--data-root',
      'relative-data',
      '--dry-run',
    ]),
    /必须配置绝对路径/,
  );
});

test('Agent Runtime 帮助只描述首期能力', () => {
  assert.match(agentHelpText, /cua act run --prompt/);
  assert.match(agentHelpText, /CUA_DATA_ROOT/);
  assert.match(agentHelpText, /--dry-run/);
  assert.doesNotMatch(agentHelpText, /task run|create-from-recording|review/);
});
