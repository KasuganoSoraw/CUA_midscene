import assert from 'node:assert/strict';
import { cp, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CliUsageError, failedRunOutput, helpText, runCliCommand } from '../../cua/cli/main.js';
import { withRunDirectory } from '../../cua/run-directory.js';

test('CLI 失败输出保留结构化运行结果，原始异常保持不变', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-cli-failure-'));
  const failure = new Error('execution failed');
  let runDir = '';
  await assert.rejects(withRunDirectory(root, async directory => {
    runDir = directory;
    await writeFile(path.join(directory, 'execution-result.json'), JSON.stringify({
      schemaVersion: '0.2', status: 'failed', sourceYamlPath: path.join(directory, 'task.yaml'),
      dryRun: false, finishedAt: new Date().toISOString(), error: failure.message,
    }));
    throw failure;
  }), actual => actual === failure);
  const output = JSON.parse((await failedRunOutput(failure))!);
  assert.equal(output.runDir, runDir);
  assert.equal(output.executor.status, 'failed');
  assert.equal(output.executor.error, failure.message);
  assert.equal(await failedRunOutput(new Error('startup')), undefined);
});

async function taskDataRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-cli-data-'));
  await cp(new URL('../fixtures/recorded-projects/', import.meta.url), path.join(root, 'projects'), { recursive: true });
  return root;
}

test('scene/task 查询保持机器可读输出契约', async () => {
  const common = ['--data-root', await taskDataRoot()];
  const scenes = JSON.parse(await runCliCommand(['scene', 'list', ...common, '--json']));
  assert.equal(scenes.scenes[0].scene, 'browser-demo');
  const tasks = JSON.parse(await runCliCommand(['task', 'list', '--scene', 'browser-demo', ...common, '--json']));
  assert.equal(tasks.tasks[0].task, 'air-tickets-demo');
  assert.deepEqual(Object.keys(tasks.tasks[0].inputs), [
    'step-002-input',
    'step-008-input',
    'step-010-input',
  ]);
  assert.match(tasks.tasks[0].taskYamlPath, /task\.yaml$/);
  const described = JSON.parse(
    await runCliCommand(['task', 'describe', '--scene', 'browser-demo', '--task', 'air-tickets-demo', ...common, '--json']),
  );
  assert.equal(described.taskCount, 16);
});

test('task inspect 只覆盖本次明确输入', async () => {
  const common = ['--data-root', await taskDataRoot()];
  const inspected = JSON.parse(
    await runCliCommand([
      'task', 'inspect', '--scene', 'browser-demo', '--task', 'air-tickets-demo',
      '--input', 'step-002-input=GOOGLE', ...common, '--json',
    ]),
  );
  assert.equal(inspected.inputs['step-002-input'], 'GOOGLE');
  assert.equal(inspected.inputs['step-008-input'], 'SINGAPORE');
  assert.equal(inspected.yaml.tasks[1].flow[1].KeyboardTypeText.value, 'GOOGLE');
});

test('CLI 拒绝重复、旧命令和非法 aiAct 来源', async () => {
  const cases: Array<[string[], RegExp]> = [
    [['task', 'inspect', '--scene', 'first', '--scene', 'second', '--task', 'demo'], /不能重复提供/],
    [['flow', 'inspect'], /不支持的命令/],
    [['calibration', 'apply'], /不支持的命令/],
    [['task', 'create-from-recording', '--scene', 'demo', '--task', 'task'], /必须提供 --recording/],
    [['act', 'run'], /必须提供 --prompt/],
    [['act', 'run', '--scene', 'browser-demo'], /同时提供 --scene 和 --task/],
    [['act', 'run', '--prompt', '打开 Chrome', '--input', 'query=value'], /不能与任务参数混用/],
  ];
  for (const [argv, expected] of cases) {
    await assert.rejects(runCliCommand(argv), (error: Error) => {
      assert.ok(error instanceof CliUsageError);
      assert.match(error.message, expected);
      return true;
    });
  }
});

test('task validate、task run dry-run 与两种 aiAct dry-run 生成外部运行资产', async () => {
  const dataRoot = await taskDataRoot();
  const common = ['--data-root', dataRoot];
  const validated = JSON.parse(
    await runCliCommand(['task', 'validate', '--scene', 'browser-demo', '--task', 'air-tickets-demo', ...common]),
  );
  assert.equal(validated.valid, true);
  assert.equal(validated.executor.dryRun, true);
  const taskRun = JSON.parse(
    await runCliCommand(['task', 'run', '--scene', 'browser-demo', '--task', 'air-tickets-demo', '--dry-run', ...common]),
  );
  assert.equal(taskRun.executor.taskCount, 16);
  const recordedAct = JSON.parse(
    await runCliCommand(['act', 'run', '--scene', 'browser-demo', '--task', 'air-tickets-demo', '--dry-run', ...common]),
  );
  assert.equal(recordedAct.mode, 'recorded-task');
  assert.match(recordedAct.promptPath, /ai-act-prompt\.txt$/);
  const promptAct = JSON.parse(
    await runCliCommand(['act', 'run', '--prompt', '打开 Chrome 并搜索 GUI agent', '--dry-run', ...common]),
  );
  assert.equal(promptAct.mode, 'prompt');
  for (const result of [validated, taskRun, recordedAct, promptAct]) {
    assert.ok(path.resolve(result.runDir).startsWith(path.join(dataRoot, 'runs')));
  }
});

test('CLI 使用中文帮助', () => {
  assert.match(helpText, /CUA 场景、任务与 Midscene YAML 执行工具/);
  assert.match(helpText, /npm|cua/);
  assert.match(helpText, /task create-from-recording/);
  assert.match(helpText, /\[--goal <目标>\]/);
  assert.match(helpText, /task validate.+--inputs <file>.+--json/);
  assert.match(helpText, /task inspect.+--inputs <file>.+--json/);
  assert.match(helpText, /task run.+--data-root <path>.+--dry-run.+--json/);
  assert.match(helpText, /act run --scene.+--inputs <file>.+--data-root <path>.+--dry-run/);
});

test('task create-from-recording 接受可选 goal 并保持 stdout JSON 契约', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'cua-cli-create-'));
  let received: Record<string, unknown> | undefined;
  const output = await runCliCommand([
    'task',
    'create-from-recording',
    '--scene',
    'network',
    '--task',
    'query-alarm',
    '--recording',
    'E:\\recordings\\alarm',
    '--python-executable',
    'E:\\GDEClaw\\python.exe',
    '--data-root',
    dataRoot,
  ], {
    createFromRecording: async (options) => {
      received = options as unknown as Record<string, unknown>;
      return {
        created: true,
        valid: true,
        scene: options.scene,
        task: options.task,
        goal: '',
        recordingPath: options.recording,
        taskRoot: path.join(dataRoot, 'projects', options.scene, options.task),
        sourceRoot: path.join(dataRoot, 'projects', options.scene, options.task, 'source'),
        taskYamlPath: path.join(dataRoot, 'projects', options.scene, options.task, 'task.yaml'),
        taskManifestPath: path.join(dataRoot, 'projects', options.scene, options.task, 'task.json'),
        runDir: path.join(dataRoot, 'runs', 'test'),
        resolvedTaskPath: path.join(dataRoot, 'runs', 'test', 'resolved-task.yaml'),
        executor: {
          schemaVersion: '0.2',
          status: 'succeeded',
          sourceYamlPath: path.join(dataRoot, 'runs', 'test', 'resolved-task.yaml'),
          dryRun: true,
          taskCount: 1,
          finishedAt: new Date(0).toISOString(),
        },
      };
    },
  });

  const parsed = JSON.parse(output);
  assert.equal(parsed.created, true);
  assert.equal(parsed.goal, '');
  assert.equal(received?.goal, undefined);
  assert.equal(received?.pythonExecutable, 'E:\\GDEClaw\\python.exe');
  assert.match(String(received?.creationCommand), /task create-from-recording/);
  assert.doesNotMatch(output, /trace progress/);
});
