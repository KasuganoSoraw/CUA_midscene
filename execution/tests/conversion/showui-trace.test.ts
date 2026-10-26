import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  clampRecordedWaitMs,
  convertTrace,
  type ConvertOptions,
} from '../../cua/conversion/showui-trace.js';
import { readShowuiTrace, readTaskManifest } from '../../cua/contracts/validation.js';
import { buildRecordedTaskAiActPrompt } from '../../cua/task/execution.js';
import { resolveTask } from '../../cua/task/tasks.js';
import { readYamlDocument } from '../../cua/task/yaml-task.js';

const executionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const airTask = path.join(executionRoot, 'tests', 'fixtures', 'recorded-projects', 'browser-demo', 'air-tickets-demo');
const goal = '将 Qatar Airways 订票页面设置为 Singapore 到 Los Angeles 的单程航班搜索';

async function prepare(task: string): Promise<{ root: string; taskRoot: string; options: ConvertOptions }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-conversion-'));
  const user = path.join(root, 'user');
  const taskRoot = path.join(user, 'browser-demo', task);
  await cp(path.join(airTask, 'source'), path.join(taskRoot, 'source'), { recursive: true });
  return {
    root,
    taskRoot,
    options: {
      scene: 'browser-demo',
      task,
      goal,
      catalog: { userProjectsRoot: user },
      conversionCommand: `npm run cua -- task init-from-trace --scene browser-demo --task ${task}`,
    },
  };
}

test('录制等待按 200ms 到 30s 边界裁剪', () => {
  assert.equal(clampRecordedWaitMs(199), 0);
  assert.equal(clampRecordedWaitMs(200), 200);
  assert.equal(clampRecordedWaitMs(30_001), 30_000);
});

test('转换器生成与录制 operation 对应的 Midscene YAML 和输入契约', async () => {
  const fixture = await prepare('new-task');
  const output = await convertTrace(fixture.options);
  const document = await readYamlDocument(output);
  const golden = await readYamlDocument(path.join(airTask, 'task.yaml'));
  const trace = await readShowuiTrace(path.join(airTask, 'source', 'showui-trace.json'));
  const manifest = await readTaskManifest(path.join(fixture.taskRoot, 'task.json'));
  const tasks = document.tasks as Array<Record<string, any>>;

  assert.equal(tasks.length, 16);
  assert.deepEqual(document.tasks, golden.tasks);
  assert.deepEqual(tasks[0], {
    name: 'step-001 | click',
    flow: [{ aiTap: trace.trajectory[0].caption.operation.prompt }],
  });
  assert.equal(tasks[1].flow[0].sleep, 4101);
  assert.equal(tasks[1].flow[1].KeyboardTypeText.value, '{{step-002-input}}');
  assert.deepEqual(Object.keys(manifest.inputs), ['step-002-input', 'step-008-input', 'step-010-input']);
  assert.equal(manifest.inputs['step-002-input'].default, 'QATAR AIRWAYS');
  assert.equal(manifest.source.stepBindings?.['step-001'], 1);
  assert.equal(manifest.source.stepBindings?.['step-016'], 16);
  assert.equal(Object.keys(manifest.source.stepBindings ?? {}).length, 16);
  assert.match(await readFile(path.join(fixture.taskRoot, 'SKILL.md'), 'utf8'), /npm run cua -- task describe/);
});

test('双击 operation 映射为 aiDoubleClick', async () => {
  const fixture = await prepare('double-click-task');
  const tracePath = path.join(fixture.taskRoot, 'source', 'showui-trace.json');
  const trace = JSON.parse(await readFile(tracePath, 'utf8'));
  trace.trajectory[0].caption.operation = {
    type: 'doubleClick',
    prompt: '双击页面中部文件列表里的 report.xlsx 文件行以打开文件',
  };
  await writeFile(tracePath, JSON.stringify(trace), 'utf8');
  const document = await readYamlDocument(await convertTrace(fixture.options));
  assert.deepEqual((document.tasks as unknown[])[0], {
    name: 'step-001 | doubleClick',
    flow: [{ aiDoubleClick: '双击页面中部文件列表里的 report.xlsx 文件行以打开文件' }],
  });
});

test('右键 operation 映射为 aiRightClick', async () => {
  const fixture = await prepare('right-click-task');
  const tracePath = path.join(fixture.taskRoot, 'source', 'showui-trace.json');
  const trace = JSON.parse(await readFile(tracePath, 'utf8'));
  trace.trajectory[0].caption.operation = { type: 'rightClick', prompt: '右键点击目标文件' };
  await writeFile(tracePath, JSON.stringify(trace), 'utf8');
  const document = await readYamlDocument(await convertTrace(fixture.options));
  assert.deepEqual((document.tasks as Array<Record<string, any>>)[0], {
    name: 'step-001 | rightClick', flow: [{ aiRightClick: '右键点击目标文件' }],
  });
});

test('粘贴使用录制文本作为默认参数并追加输入', async () => {
  const fixture = await prepare('paste-task');
  const tracePath = path.join(fixture.taskRoot, 'source', 'showui-trace.json');
  const logPath = path.join(fixture.taskRoot, 'source', 'processed-log-sc.json');
  const trace = JSON.parse(await readFile(tracePath, 'utf8'));
  const processed = JSON.parse(await readFile(logPath, 'utf8'));
  trace.trajectory[1].caption.operation = {
    type: 'input', prompt: '向搜索框追加文本', locatePrompt: '搜索框', value: '模型返回的其他值',
  };
  processed[1].action = 'Paste text';
  processed[1].clipboard_text = ' 中文 text\n';
  await writeFile(tracePath, JSON.stringify(trace), 'utf8');
  await writeFile(logPath, JSON.stringify(processed), 'utf8');
  const document = await readYamlDocument(await convertTrace(fixture.options));
  const manifest = await readTaskManifest(path.join(fixture.taskRoot, 'task.json'));
  assert.deepEqual((document.tasks as Array<Record<string, any>>)[1].flow.slice(-2), [
    { KeyboardPress: { keyName: 'End', locate: { prompt: '搜索框' } } },
    { aiInput: null, value: '{{step-002-input}}', mode: 'typeOnly' },
  ]);
  assert.equal(manifest.inputs['step-002-input'].default, ' 中文 text\n');
});

test('滚动与后续输入合成单条 aiAct，固定文本不生成输入参数', async () => {
  const fixture = await prepare('scroll-input-task');
  const tracePath = path.join(fixture.taskRoot, 'source', 'showui-trace.json');
  const logPath = path.join(fixture.taskRoot, 'source', 'processed-log-sc.json');
  const trace = JSON.parse(await readFile(tracePath, 'utf8'));
  const processed = JSON.parse(await readFile(logPath, 'utf8'));
  trace.trajectory[0].caption.operation = { type: 'aiAct', prompt: '在页面主内容区域滚动' };
  processed[0].action = 'ScrollDown at';
  processed[0].scroll_count = 3;
  processed[1].action = 'Paste text';
  processed[1].clipboard_text = '已复制的内容';
  await writeFile(tracePath, JSON.stringify(trace), 'utf8');
  await writeFile(logPath, JSON.stringify(processed), 'utf8');

  const document = await readYamlDocument(await convertTrace(fixture.options));
  const manifest = await readTaskManifest(path.join(fixture.taskRoot, 'task.json'));
  const tasks = document.tasks as Array<Record<string, any>>;
  assert.equal(tasks.length, 15);
  assert.equal(tasks[0].name, 'step-001 | aiAct');
  assert.match(tasks[0].flow[0].ai, /向下滚动/);
  assert.match(tasks[0].flow[0].ai, /约 3 次滚轮/);
  assert.match(tasks[0].flow[0].ai, /将"已复制的内容"追加到现有内容末尾/);
  assert.equal(manifest.inputs['step-001-input'], undefined);
  assert.deepEqual(manifest.source.stepBindings?.['step-001'], [1, 2]);
  assert.equal(tasks[1].name, 'step-002 | keyboard');
});

test('滚动与后续参考图点击合成单条 aiAct 并保留参考图', async () => {
  const fixture = await prepare('scroll-reference-task');
  const tracePath = path.join(fixture.taskRoot, 'source', 'showui-trace.json');
  const logPath = path.join(fixture.taskRoot, 'source', 'processed-log-sc.json');
  const trace = JSON.parse(await readFile(tracePath, 'utf8'));
  const processed = JSON.parse(await readFile(logPath, 'utf8'));
  trace.trajectory[0].caption.operation = { type: 'aiAct', prompt: '在列表区域向下滚动' };
  processed[0].action = 'ScrollDown at';
  trace.trajectory[1].caption.operation = {
    type: 'click', prompt: '点击告警图标', useReferenceImage: true,
  };
  processed[1].action = 'LClick at';
  processed[1].screenshot_reference = 'screenshots/target.png';
  await writeFile(tracePath, JSON.stringify(trace), 'utf8');
  await writeFile(logPath, JSON.stringify(processed), 'utf8');
  await writeFile(path.join(fixture.taskRoot, 'source', 'screenshots', 'target.png'), 'reference', 'utf8');

  const document = await readYamlDocument(await convertTrace(fixture.options));
  const action = (document.tasks as Array<Record<string, any>>)[0].flow[0].ai;
  assert.match(action.prompt, /点击告警图标/);
  assert.deepEqual(action.images, [{ name: 'step-001-target', url: 'source/screenshots/target.png' }]);
  const guided = buildRecordedTaskAiActPrompt(document);
  assert.deepEqual(guided.images.find((image) => image.name === 'step-001-target'), action.images[0]);
  assert.match(guided.prompt, /向下滚动/);
  const resolved = await resolveTask({ scene: fixture.options.scene, task: fixture.options.task, catalog: fixture.options.catalog });
  const resolvedAi = ((resolved.document.tasks as Array<Record<string, any>>)[0].flow[0].ai as Record<string, any>);
  assert.equal(resolvedAi.images[0].url, path.join(fixture.taskRoot, 'source', 'screenshots', 'target.png'));
});

test('合并自然语言操作的参考图缺失时拒绝写出任务', async () => {
  const fixture = await prepare('scroll-missing-reference-task');
  const tracePath = path.join(fixture.taskRoot, 'source', 'showui-trace.json');
  const logPath = path.join(fixture.taskRoot, 'source', 'processed-log-sc.json');
  const trace = JSON.parse(await readFile(tracePath, 'utf8'));
  const processed = JSON.parse(await readFile(logPath, 'utf8'));
  trace.trajectory[0].caption.operation = { type: 'aiAct', prompt: '向下滚动' };
  processed[0].action = 'ScrollDown at';
  trace.trajectory[1].caption.operation = { type: 'click', prompt: '点击目标图标', useReferenceImage: true };
  processed[1].screenshot_reference = 'screenshots/not-found.png';
  await writeFile(tracePath, JSON.stringify(trace), 'utf8');
  await writeFile(logPath, JSON.stringify(processed), 'utf8');
  await assert.rejects(convertTrace(fixture.options), /参考图不存在/);
  await assert.rejects(readFile(path.join(fixture.taskRoot, 'task.yaml')), /ENOENT/);
});

test('末尾滚动生成独立 aiAct，不制造后续操作', async () => {
  const fixture = await prepare('terminal-scroll-task');
  const tracePath = path.join(fixture.taskRoot, 'source', 'showui-trace.json');
  const logPath = path.join(fixture.taskRoot, 'source', 'processed-log-sc.json');
  const trace = JSON.parse(await readFile(tracePath, 'utf8'));
  const processed = JSON.parse(await readFile(logPath, 'utf8'));
  trace.trajectory.at(-1).caption.operation = { type: 'aiAct', prompt: '在结果区域向下滚动' };
  processed.at(-1).action = 'ScrollDown at';
  await writeFile(tracePath, JSON.stringify(trace), 'utf8');
  await writeFile(logPath, JSON.stringify(processed), 'utf8');

  const document = await readYamlDocument(await convertTrace(fixture.options));
  const manifest = await readTaskManifest(path.join(fixture.taskRoot, 'task.json'));
  const last = (document.tasks as Array<Record<string, any>>).at(-1)!;
  assert.equal(last.name, 'step-016 | aiAct');
  assert.match(last.flow.at(-1).ai, /向下滚动/);
  assert.equal(manifest.source.stepBindings?.['step-016'], 16);
});

test('连续滚动只消费一次后续操作并保留全部录制来源', async () => {
  const fixture = await prepare('multi-scroll-task');
  const tracePath = path.join(fixture.taskRoot, 'source', 'showui-trace.json');
  const logPath = path.join(fixture.taskRoot, 'source', 'processed-log-sc.json');
  const trace = JSON.parse(await readFile(tracePath, 'utf8'));
  const processed = JSON.parse(await readFile(logPath, 'utf8'));
  for (let index = 0; index < 2; index += 1) {
    trace.trajectory[index].caption.operation = { type: 'aiAct', prompt: '滚动结果列表' };
    processed[index].action = index === 0 ? 'ScrollDown at' : 'ScrollUp at';
  }
  await writeFile(tracePath, JSON.stringify(trace), 'utf8');
  await writeFile(logPath, JSON.stringify(processed), 'utf8');

  const document = await readYamlDocument(await convertTrace(fixture.options));
  const manifest = await readTaskManifest(path.join(fixture.taskRoot, 'task.json'));
  const tasks = document.tasks as Array<Record<string, any>>;
  assert.equal(tasks.length, 14);
  assert.match(tasks[0].flow[0].ai, /向下滚动/);
  assert.match(tasks[0].flow[0].ai, /向上滚动/);
  assert.deepEqual(manifest.source.stepBindings?.['step-001'], [1, 2, 3]);
});

test('录制滚动不能回退为等待步骤', async () => {
  const fixture = await prepare('invalid-scroll-task');
  const tracePath = path.join(fixture.taskRoot, 'source', 'showui-trace.json');
  const logPath = path.join(fixture.taskRoot, 'source', 'processed-log-sc.json');
  const processed = JSON.parse(await readFile(logPath, 'utf8'));
  processed[0].action = 'ScrollDown at';
  await writeFile(logPath, JSON.stringify(processed), 'utf8');
  await assert.rejects(convertTrace(fixture.options), /滚动必须使用 aiAct operation/);
  await assert.rejects(readFile(path.join(fixture.taskRoot, 'task.yaml')), /ENOENT/);
});

test('视觉参考 click 和 doubleClick 生成原生 Midscene locate.images', async () => {
  for (const [taskName, operationType, actionName] of [
    ['reference-click', 'click', 'aiTap'],
    ['reference-double-click', 'doubleClick', 'aiDoubleClick'],
    ['reference-right-click', 'rightClick', 'aiRightClick'],
  ] as const) {
    const fixture = await prepare(taskName);
    const tracePath = path.join(fixture.taskRoot, 'source', 'showui-trace.json');
    const logPath = path.join(fixture.taskRoot, 'source', 'processed-log-sc.json');
    const trace = JSON.parse(await readFile(tracePath, 'utf8'));
    const processed = JSON.parse(await readFile(logPath, 'utf8'));
    trace.trajectory[0].caption.operation = {
      type: operationType,
      prompt: '点击页面右上角无文字告警图标以打开告警列表',
      useReferenceImage: true,
    };
    processed[0].screenshot_reference = 'screenshots/0.329s.reference.png';
    await writeFile(tracePath, JSON.stringify(trace), 'utf8');
    await writeFile(logPath, JSON.stringify(processed), 'utf8');
    await writeFile(
      path.join(fixture.taskRoot, 'source', 'screenshots', '0.329s.reference.png'),
      'reference-image',
      'utf8',
    );

    const document = await readYamlDocument(await convertTrace(fixture.options));
    const action = (document.tasks as Array<Record<string, any>>)[0].flow[0];
    assert.equal(action[actionName], null);
    assert.match(action.locate.prompt, /匹配参考图“step-001-target”正中央的主要图标/);
    assert.deepEqual(action.locate.images, [
      { name: 'step-001-target', url: 'source/screenshots/0.329s.reference.png' },
    ]);
  }
});

test('视觉参考证据缺失、绝对路径和越界路径均拒绝写出任务', async () => {
  for (const [taskName, referencePath, message] of [
    ['missing-reference', undefined, /缺少 screenshot_reference/],
    ['absolute-reference', 'E:/outside.png', /必须是 source 内相对路径/],
    ['escaped-reference', '../outside.png', /越出 source/],
  ] as const) {
    const fixture = await prepare(taskName);
    const tracePath = path.join(fixture.taskRoot, 'source', 'showui-trace.json');
    const logPath = path.join(fixture.taskRoot, 'source', 'processed-log-sc.json');
    const trace = JSON.parse(await readFile(tracePath, 'utf8'));
    const processed = JSON.parse(await readFile(logPath, 'utf8'));
    trace.trajectory[0].caption.operation.useReferenceImage = true;
    if (referencePath === undefined) delete processed[0].screenshot_reference;
    else processed[0].screenshot_reference = referencePath;
    await writeFile(tracePath, JSON.stringify(trace), 'utf8');
    await writeFile(logPath, JSON.stringify(processed), 'utf8');

    await assert.rejects(convertTrace(fixture.options), message);
    await assert.rejects(readFile(path.join(fixture.taskRoot, 'task.yaml')), /ENOENT/);
  }
});

test('转换器只消费 operation，不根据其他自然语言字段猜测动作', async () => {
  const fixture = await prepare('structured-only');
  const tracePath = path.join(fixture.taskRoot, 'source', 'showui-trace.json');
  const trace = JSON.parse(await readFile(tracePath, 'utf8'));
  trace.trajectory[0].caption.action = '按下 Enter 键';
  trace.trajectory[0].caption.think = '这是键盘动作';
  const originalOperation = trace.trajectory[0].caption.operation;
  await writeFile(tracePath, JSON.stringify(trace), 'utf8');
  const document = await readYamlDocument(await convertTrace(fixture.options));
  assert.equal((document.tasks as Array<Record<string, any>>)[0].flow[0].aiTap, originalOperation.prompt);
});

test('缺失 operation、定位提示和非法步骤不会写出半成品', async () => {
  for (const [task, mutate, message] of [
    ['missing-operation', (trace: any) => delete trace.trajectory[0].caption.operation, /operation/],
    ['missing-locate', (trace: any) => delete trace.trajectory[1].caption.operation.locatePrompt, /operation\.locatePrompt 不能为空/],
    ['duplicate-step', (trace: any) => (trace.trajectory[1].step_idx = 1), /唯一且按轨迹顺序严格递增/],
    ['missing-step', (trace: any) => (trace.trajectory[1].step_idx = 3), /从 1 开始连续编号/],
  ] as const) {
    const fixture = await prepare(task);
    const tracePath = path.join(fixture.taskRoot, 'source', 'showui-trace.json');
    const trace = JSON.parse(await readFile(tracePath, 'utf8'));
    mutate(trace);
    await writeFile(tracePath, JSON.stringify(trace), 'utf8');
    await assert.rejects(convertTrace(fixture.options), message);
    await assert.rejects(readFile(path.join(fixture.taskRoot, 'task.yaml')), /ENOENT/);
    await assert.rejects(readFile(path.join(fixture.taskRoot, 'task.json')), /ENOENT/);
  }
});

test('已有任务资产和内置任务均拒绝覆盖', async () => {
  const existing = await prepare('existing-task');
  await writeFile(path.join(existing.taskRoot, 'task.yaml'), 'preserve: true\n', 'utf8');
  await assert.rejects(convertTrace(existing.options), /任务资产已存在，拒绝覆盖/);
  assert.equal(await readFile(path.join(existing.taskRoot, 'task.yaml'), 'utf8'), 'preserve: true\n');

  const builtin = await prepare('builtin-task');
  builtin.options.catalog.builtinProjectsRoot = path.join(builtin.root, 'readonly');
  await cp(airTask, path.join(builtin.options.catalog.builtinProjectsRoot!, 'browser-demo', 'builtin-task'), {
    recursive: true,
  });
  await assert.rejects(convertTrace(builtin.options), /内置任务不可覆盖/);
});
