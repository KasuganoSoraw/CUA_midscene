import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parseYamlScript } from '@midscene/core/yaml';
import {
  clampRecordedWaitMs,
  convertTrace,
  buildRecordedSteps,
  type ConvertOptions,
} from '../../cua/conversion/showui-trace.js';
import { readShowuiTrace, readTaskManifest, validateContract } from '../../cua/contracts/validation.js';
import { dumpYamlDocument, readYamlDocument, validateRecordedTaskDocument } from '../../cua/task/yaml-task.js';
import { buildRecordedTaskAiActPrompt } from '../../cua/task/execution.js';

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

function recordedActions(
  items: Array<{ action: string; type: string; prompt: string; timestamp?: number; scrollEnd?: number; app?: string; reference?: string; path?: unknown[] }>,
) {
  return {
    trace: { trajectory: items.map((item, index) => ({
      step_idx: index + 1, caption: { operation: { type: item.type, prompt: item.prompt,
        ...(item.reference ? { useReferenceImage: true } : {}) } },
    })) } as any,
    processed: items.map((item, index) => ({
      timestamp: item.timestamp ?? index + 1, action: item.action, current_software: item.app ?? 'Browser',
      ...(item.scrollEnd === undefined ? {} : { scroll_end_timestamp: item.scrollEnd }),
      ...(item.reference ? { screenshot_reference: item.reference } : {}),
      ...(item.path ? { path: item.path } : {}),
      scroll_count: 7,
    })),
  };
}

test('连续滚动与点击合并为目标驱动 aiAct，滚轮次数不进入 Replay 或 Guided', async () => {
  const { trace, processed } = recordedActions([
    { action: 'ScrollDown at', type: 'aiAct', prompt: '在列表顶部向下滚动' },
    { action: 'ScrollDown at', type: 'aiAct', prompt: '在列表内容区域向下滚动。' },
    { action: 'LClick at', type: 'click', prompt: '单击名称为项目甲的条目', reference: 'screenshots/target.png' },
  ]);
  const built = buildRecordedSteps(trace, processed);
  assert.equal(built.tasks.length, 1);
  assert.deepEqual(built.stepBindings['step-001'], [1, 2, 3]);
  const ai = (built.tasks[0].flow as any[])[0].ai;
  assert.match(ai.prompt, /项目甲/);
  assert.match(ai.prompt, /若目标不可见，在列表内容区域向下滚动；单击/);
  assert.doesNotMatch(ai.prompt, /录制方向|滚动区域及作用对象|按当前画面|7\s*次|scroll_count/);
  assert.equal((ai.prompt.match(/向下滚动/g) ?? []).length, 1);
  assert.deepEqual(ai.images, [{ name: 'step-001-target', url: 'source/screenshots/target.png' }]);
  const document = { computer: {}, agent: { groupName: 'demo', groupDescription: '查找网元' }, tasks: built.tasks };
  assert.doesNotThrow(() => parseYamlScript(dumpYamlDocument(document)));
  const guided = buildRecordedTaskAiActPrompt(document);
  assert.match(guided.prompt, /项目甲/);
  assert.doesNotMatch(guided.prompt, /7\s*次/);
  assert.deepEqual(guided.images, ai.images);
  const manifest = { schemaVersion: '0.3', skillName: 'demo', title: 'demo', description: 'demo', goal: '查找网元',
    source: { tracePath: 'source/showui-trace.json', processedLogPath: 'source/processed-log-sc.json', conversionCommand: '', stepBindings: built.stepBindings },
    inputs: built.inputs } as any;
  await validateContract(manifest, 'skill-task.schema.json', 'test');
  validateRecordedTaskDocument(document, manifest, 'test');
});

test('英文录制步骤保持英文复合操作和参考图定位说明', () => {
  const { trace, processed } = recordedActions([
    { action: 'ScrollDown at', type: 'aiAct', prompt: 'Scroll down 4 times in the results list' },
    { action: 'LClick at', type: 'click', prompt: 'Click the matching result', reference: 'screenshots/target.png' },
  ]);
  const built = buildRecordedSteps(trace, processed, 'en-US');
  const ai = (built.tasks[0].flow as any[])[0].ai;
  assert.match(ai.prompt, /If the target is not visible, scroll down in the results list; then Click the matching result/);
  assert.match(ai.prompt, /Match the target to the primary icon centered in reference image/);
  assert.doesNotMatch(ai.prompt, /4 times|[\u3400-\u9fff]/u);
});

test('不同方向和目标操作组合仅保留一次滚动与目标动作语义', () => {
  for (const [scrollAction, scrollText, targetAction, targetType, targetText] of [
    ['ScrollDown at', '在侧栏目录向下滚动', 'LClick at', 'click', '点击目录中的目标项'],
    ['ScrollUp at', '在表格内容区向上滚动', 'LDoubleClick at', 'doubleClick', '双击目标文件行'],
    ['ScrollDown at', '在画布列表向下滚动', 'RClick at', 'rightClick', '右键点击目标图层'],
  ] as const) {
    const { trace, processed } = recordedActions([
      { action: scrollAction, type: 'aiAct', prompt: scrollText },
      { action: targetAction, type: targetType, prompt: targetText },
    ]);
    const built = buildRecordedSteps(trace, processed);
    const prompt = String((built.tasks[0].flow as any[])[0].ai);
    assert.equal(built.tasks.length, 1);
    assert.equal((prompt.split(scrollText).length - 1), 1);
    assert.equal((prompt.split(targetText).length - 1), 1);
    assert.match(prompt, /若目标不可见/);
    assert.doesNotMatch(prompt, /录制方向|滚动区域及作用对象|找到后|不要重复操作/);
  }
});

test('滚动提示中的次数不进入复合操作', () => {
  const { trace, processed } = recordedActions([
    { action: 'ScrollUp at', type: 'aiAct', prompt: '在内容列表向上滚动约 4 次' },
    { action: 'LClick at', type: 'click', prompt: '点击列表顶部的目标项' },
  ]);
  const prompt = String((buildRecordedSteps(trace, processed).tasks[0].flow as any[])[0].ai);
  assert.match(prompt, /内容列表向上滚动/);
  assert.match(prompt, /点击列表顶部的目标项/);
  assert.doesNotMatch(prompt, /4\s*次|录制方向/);
});

test('滚动与点击的合并间隔从最后一次滚动结束时计算', async () => {
  const actions = [
    { action: 'ScrollDown at', type: 'aiAct', prompt: '在列表中向下滚动', timestamp: 1, scrollEnd: 9 },
    { action: 'LClick at', type: 'click', prompt: '点击目标行', timestamp: 10 },
  ];
  const { trace, processed } = recordedActions(actions);
  await validateContract(processed, 'processed-log.schema.json', 'test');
  assert.equal(buildRecordedSteps(trace, processed).tasks.length, 1);
  delete (processed[0] as { scroll_end_timestamp?: number }).scroll_end_timestamp;
  assert.equal(buildRecordedSteps(trace, processed).tasks.length, 2);
  processed[0].scroll_end_timestamp = 4;
  assert.equal(buildRecordedSteps(trace, processed).tasks.length, 2);
  processed[0].scroll_end_timestamp = 11;
  assert.equal(buildRecordedSteps(trace, processed).tasks.length, 2);
});

test('滚动可合并双击和右键，但不吞并输入、按键、等待或拖拽', () => {
  for (const [action, type] of [['LDoubleClick at', 'doubleClick'], ['RClick at', 'rightClick']] as const) {
    const { trace, processed } = recordedActions([
      { action: 'ScrollUp at', type: 'aiAct', prompt: '文件列表向上滚动' },
      { action, type, prompt: type === 'doubleClick' ? '双击目标文件行' : '右键点击目标文件行' },
    ]);
    const built = buildRecordedSteps(trace, processed);
    assert.equal(built.tasks.length, 1);
    assert.match(String((built.tasks[0].flow as any[])[0].ai), type === 'doubleClick' ? /双击目标/ : /右键点击目标/);
  }
  for (const [action, type, prompt, pathValue] of [
    ['Type: abc', 'input', '在搜索框输入 abc'],
    ['Press ENTER', 'keyboard', '按 Enter'],
    ['Wait', 'wait', '等待完成'],
    ['DragStart at', 'aiAct', '按住对象拖到目标位置并释放', [{ x: 1, y: 2 }, { x: 9, y: 8 }]],
  ] as const) {
    const { trace, processed } = recordedActions([
      { action: 'ScrollDown at', type: 'aiAct', prompt: '在列表区域向下滚动' },
      { action, type, prompt, path: pathValue as unknown[] | undefined },
    ]);
    if (type === 'input') Object.assign(trace.trajectory[1].caption.operation, { locatePrompt: '搜索框', value: 'abc' });
    if (type === 'keyboard') Object.assign(trace.trajectory[1].caption.operation, { key: 'Enter' });
    if (type === 'wait') Object.assign(trace.trajectory[1].caption.operation, { condition: '完成' });
    const built = buildRecordedSteps(trace, processed);
    assert.equal(built.tasks.length, 2);
    assert.equal(built.tasks[1].name, `step-002 | ${type}`);
    if (type === 'input') assert.equal(built.inputs['step-002-input'].default, 'abc');
  }
});

test('独立滚动和完整拖拽分别生成 aiAct；跨应用与长时间间隔不合并', () => {
  const { trace, processed } = recordedActions([
    { action: 'ScrollDown at', type: 'aiAct', prompt: '在列表中向下滚动', app: 'Browser' },
    { action: 'LClick at', type: 'click', prompt: '点击另一个应用的按钮', app: 'Editor' },
    { action: 'DragStart at', type: 'aiAct', prompt: '按住矩形拖动至右侧区域并释放', path: [{ x: 1, y: 1 }, { x: 8, y: 2 }] },
    { action: 'LClick at', type: 'click', prompt: '点击保存按钮', timestamp: 20 },
  ]);
  const built = buildRecordedSteps(trace, processed);
  assert.equal(built.tasks.length, 4);
  assert.equal(built.tasks[0].name, 'step-001 | aiAct');
  assert.deepEqual((built.tasks[0].flow as any[])[0], { ai: '在列表中向下滚动' });
  assert.equal(built.tasks[2].name, 'step-003 | aiAct');
  assert.deepEqual((built.tasks[2].flow as any[]).at(-1), { ai: '按住矩形拖动至右侧区域并释放' });
  assert.equal(built.tasks[3].name, 'step-004 | click');
  assert.deepEqual(Object.values(built.stepBindings), [1, 2, 3, 4]);
  processed[2].path = [{ x: 1, y: 1 }];
  assert.throws(() => buildRecordedSteps(trace, processed), /缺少完整拖拽路径/);
});
