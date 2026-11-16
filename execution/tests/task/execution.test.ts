import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import type { ExecutorResult } from '../../cua/contracts/types.js';
import {
  buildRecordedTaskAiActPrompt,
  runPrompt,
  runRecordedTaskAiAct,
  runTask,
} from '../../cua/task/execution.js';
import { readYamlDocument, writeYamlDocument } from '../../cua/task/yaml-task.js';
import type { MidsceneYamlExecutionOptions } from '../../executors/midscene-yaml.js';
import { createTaskFixture } from '../helpers/task-fixture.js';

const executionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const catalog = { userProjectsRoot: path.join(executionRoot, 'tests', 'fixtures', 'recorded-projects') };

async function fakeExecutor(options: MidsceneYamlExecutionOptions): Promise<ExecutorResult> {
  const document = await readYamlDocument(options.yamlPath);
  return {
    schemaVersion: '0.2',
    status: 'succeeded',
    sourceYamlPath: path.resolve(options.yamlPath),
    dryRun: options.dryRun,
    taskCount: (document.tasks as unknown[]).length,
    finishedAt: new Date().toISOString(),
  };
}

test('整体 aiAct prompt 保留步骤和动作且不呈现短间隔', () => {
  const document = {
    tasks: [
      { name: 'step-001 | click', flow: [{ sleep: 500 }, { aiTap: '点击 Chrome 顶部地址栏' }] },
      { name: 'step-002 | input', flow: [{ KeyboardTypeText: { locate: 'Chrome 顶部地址栏', value: 'GUI agent', mode: 'replace' } }] },
      { name: 'step-003 | keyboard', flow: [{ KeyboardPress: { keyName: 'Enter' } }] },
      { name: 'step-004 | wait', flow: [{ aiWaitFor: '等待搜索结果页出现', timeout: 15_000 }] },
      { name: 'step-005 | doubleClick', flow: [{ aiDoubleClick: 'report.xlsx 文件行' }] },
      { name: 'step-006 | rightClick', flow: [{ aiRightClick: 'report.xlsx 文件行' }] },
      { name: 'step-007 | input', flow: [
        { KeyboardPress: { keyName: 'End', locate: { prompt: '搜索框' } } },
        { aiInput: null, value: '中文 text', mode: 'typeOnly' },
      ] },
    ],
  };
  const result = buildRecordedTaskAiActPrompt(document);
  assert.match(result.prompt, /^请严格按以下步骤顺序完成电脑操作：/);
  assert.ok(result.prompt.indexOf('step-001') < result.prompt.indexOf('step-002'));
  assert.match(result.prompt, /使用 KeyboardTypeText 在 "Chrome 顶部地址栏" 中替换输入 "GUI agent"/);
  assert.match(result.prompt, /按下 "Enter" 键/);
  assert.match(result.prompt, /双击以下描述对应的目标："report.xlsx 文件行"/);
  assert.match(result.prompt, /右键点击以下描述对应的目标："report.xlsx 文件行"/);
  assert.match(result.prompt, /在 "搜索框" 中按下 "End" 键/);
  assert.match(result.prompt, /在 "当前焦点输入框" 中追加输入 "中文 text"/);
  assert.doesNotMatch(result.prompt, /500|timeout/);
  assert.deepEqual(result.images, []);
});

test('Guided 仅将超过两秒的步骤间隔作为画面就绪参考', () => {
  const result = buildRecordedTaskAiActPrompt({ tasks: [
    { name: 'step-001 | click', flow: [{ aiTap: '打开列表' }] },
    { name: 'step-002 | click', flow: [{ sleep: 1999 }, { aiTap: '选择条目' }] },
    { name: 'step-003 | click', flow: [{ sleep: 2000 }, { aiTap: '打开页签' }] },
    { name: 'step-004 | click', flow: [{ sleep: 2001 }, { aiTap: '选择选项' }] },
    { name: 'step-005 | click', flow: [{ sleep: 3500 }, { aiTap: '确认内容' }] },
  ] });
  assert.match(result.prompt, /根据当前画面决定是否等待，不必机械复现时长/);
  assert.doesNotMatch(result.prompt, /step-002[^\n]*录制时距上一步/);
  assert.doesNotMatch(result.prompt, /step-003[^\n]*录制时距上一步/);
  assert.match(result.prompt, /step-004[^\n]*录制时距上一步约/);
  assert.match(result.prompt, /step-005[^\n]*录制时距上一步约 3\.5 秒/);
  assert.doesNotMatch(result.prompt, /1999|2000|2001|3500|sleep/);
});

test('Guided 无较长录制间隔时不添加等待建议', () => {
  const result = buildRecordedTaskAiActPrompt({ tasks: [
    { name: 'step-001 | click', flow: [{ sleep: 4000 }, { aiTap: '打开列表' }] },
    { name: 'step-002 | click', flow: [{ sleep: 2000 }, { aiTap: '选择条目' }] },
  ] });
  assert.doesNotMatch(result.prompt, /录制间隔|录制时距上一步|机械复现/);
});

test('Guided 按原步骤位置读取信息并在最终回答中保留各次结果', () => {
  const result = buildRecordedTaskAiActPrompt({ tasks: [
    { name: 'step-001 | click', flow: [{ aiTap: '打开列表' }] },
    { name: 'step-002 | read', flow: [{ aiAsk: '读取列表中的名称', name: 'read-step-002' }] },
    { name: 'step-003 | click', flow: [{ aiTap: '打开详情' }] },
    { name: 'step-004 | read', flow: [{ aiAsk: '读取详情中的数值和单位', name: 'read-step-004' }] },
  ] });
  const prompt = result.prompt;
  assert.ok(prompt.indexOf('step-001') < prompt.indexOf('step-002'));
  assert.ok(prompt.indexOf('step-002') < prompt.indexOf('step-003'));
  assert.ok(prompt.indexOf('step-003') < prompt.indexOf('step-004'));
  assert.match(prompt, /获取信息：读取列表中的名称/);
  assert.match(prompt, /获取信息：读取详情中的数值和单位/);
  assert.match(prompt, /最终回答中分别返回/);
  assert.match(prompt, /仅观察当前界面/);
});

test('逐 task 执行与 inspect 使用相同 resolved YAML', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-run-task-'));
  let recoveryGoal: string | undefined;
  let recoveryPrompt: string | undefined;
  const run = await runTask({
    scene: 'browser-demo',
    task: 'air-tickets-demo',
    catalog,
    runsRoot: root,
    inputs: { 'step-002-input': 'GOOGLE' },
    dryRun: true,
    executor: async options => {
      recoveryGoal = options.replayFallback?.goal;
      recoveryPrompt = options.replayFallback?.taskPrompt.prompt;
      return fakeExecutor(options);
    },
  });
  const document = await readYamlDocument(run.resolvedTaskPath);
  assert.deepEqual(document, run.resolved.document);
  assert.equal(((document.tasks as Array<Record<string, any>>)[1].flow[1].KeyboardTypeText as any).value, 'GOOGLE');
  assert.equal(run.executorResult.taskCount, 16);
  assert.equal(recoveryGoal, run.resolved.manifest.goal);
  assert.match(recoveryPrompt ?? '', /GOOGLE/);
});

test('录制任务整体 aiAct 复用 resolved 输入并保存临时投影', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-run-act-'));
  let captureAiActOutput = false;
  const run = await runRecordedTaskAiAct({
    scene: 'browser-demo',
    task: 'air-tickets-demo',
    catalog,
    runsRoot: root,
    inputs: { 'step-002-input': 'GOOGLE' },
    dryRun: true,
    executor: async (options) => {
      captureAiActOutput = options.captureAiActOutput === true;
      return fakeExecutor(options);
    },
  });
  const prompt = await readFile(run.promptPath, 'utf8');
  const aiAct = await readYamlDocument(run.aiActYamlPath);
  assert.equal(prompt.match(/^step-\d{3} \|/gm)?.length, 16);
  assert.match(prompt, /替换输入 "GOOGLE"/);
  assert.doesNotMatch(prompt, /sleep/);
  const actionPrompt = (aiAct.tasks as Array<Record<string, any>>)[0].flow[0].ai;
  assert.equal(typeof actionPrompt === 'string' ? actionPrompt : actionPrompt.prompt, prompt);
  assert.equal(run.executorResult.taskCount, 1);
  assert.equal(captureAiActOutput, true);
});

test('录制任务整体 aiAct 保留 resolved 参考图片 prompt', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-run-image-act-'));
  const builtin = path.join(root, 'builtin');
  const user = path.join(root, 'user');
  const runsRoot = path.join(root, 'runs');
  await mkdir(builtin, { recursive: true });
  const taskRoot = await createTaskFixture(user);
  const imagePath = path.join(taskRoot, 'source', 'screenshots', 'target.png');
  await mkdir(path.dirname(imagePath), { recursive: true });
  await writeFile(imagePath, 'image');
  const yamlPath = path.join(taskRoot, 'task.yaml');
  const document = await readYamlDocument(yamlPath);
  (document.tasks as Array<Record<string, any>>)[1].flow = [
    {
      aiTap: null,
      locate: {
        prompt: '点击与参考图“step-002-target”匹配的图标',
        images: [{ name: 'step-002-target', url: 'source/screenshots/target.png' }],
      },
    },
  ];
  await writeYamlDocument(yamlPath, document);

  const run = await runRecordedTaskAiAct({
    scene: 'browser-demo',
    task: 'search-demo',
    catalog: { builtinProjectsRoot: builtin, userProjectsRoot: user },
    runsRoot,
    dryRun: true,
    executor: fakeExecutor,
  });
  const aiAct = await readYamlDocument(run.aiActYamlPath);
  const aiPrompt = (aiAct.tasks as Array<Record<string, any>>)[0].flow[0].ai;
  assert.match(aiPrompt.prompt, /step-002-target/);
  assert.deepEqual(aiPrompt.images, [
    { name: 'step-002-target', url: path.resolve(imagePath) },
  ]);
  assert.match(await readFile(run.promptPath, 'utf8'), /step-002-target/);
});

test('整体 aiAct 拒绝同名参考图指向不同 URL', () => {
  assert.throws(
    () => buildRecordedTaskAiActPrompt({
      tasks: [
        {
          name: 'step-001 | click',
          flow: [{ aiTap: null, locate: { prompt: '目标一', images: [{ name: 'target', url: 'a.png' }] } }],
        },
        {
          name: 'step-002 | click',
          flow: [{ aiTap: null, locate: { prompt: '目标二', images: [{ name: 'target', url: 'b.png' }] } }],
        },
      ],
    }),
    /参考图名称冲突/,
  );
});

test('自然语言 prompt 生成单 ai action 且拒绝空文本', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-run-prompt-'));
  const run = await runPrompt({ prompt: '打开 Chrome 并搜索 GUI agent', runsRoot: root, dryRun: true, executor: fakeExecutor });
  const document = await readYamlDocument(run.yamlPath);
  assert.deepEqual((document.tasks as Array<Record<string, unknown>>)[0].flow, [{ ai: '打开 Chrome 并搜索 GUI agent' }]);
  assert.match(String((document.agent as Record<string, unknown>).aiActContext), /KeyboardTypeText/);
  await assert.rejects(runPrompt({ prompt: '   ', runsRoot: root, executor: fakeExecutor }), /prompt 不能为空/);
});

test('未知 aiAct action 在创建 run directory 前失败', async () => {
  assert.throws(
    () => buildRecordedTaskAiActPrompt({ tasks: [{ name: 'step-001 | click', flow: [{ aiHover: '目标' }] }] }),
    /必须且只能包含一个受支持动作/,
  );
});
