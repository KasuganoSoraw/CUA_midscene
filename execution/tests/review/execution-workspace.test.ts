import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { compileScript, parse } from 'vue/compiler-sfc';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { createRenderer, nextTick, type Component } from 'vue';
import type { ReviewTaskView, TaskExecutionStatus } from '../../review/shared/types.js';
import type { TaskCatalogReadyItem } from '../../cua/contracts/types.js';
import { executionInstruction, executionParameters } from '../../review/web/src/execution-presentation.js';
import { executionFeedback } from '../../review/web/src/execution-feedback.js';
import { useI18n } from '../../review/web/src/i18n.js';

function fixture(withInputs = true): ReviewTaskView {
  return {
    scene: 'orders', task: 'query', title: '订单查询', description: '查询订单', origin: 'user', writable: true, revision: 'revision',
    manifest: {
      schemaVersion: '0.2', scene: 'orders', task: 'query', title: '订单查询', description: '查询订单', goal: '查询订单',
      source: { tracePath: '', processedLogPath: '', conversionCommand: '' },
      inputs: withInputs ? { 'step-002-input': { type: 'string', label: '订单号', default: 'ORDER-1', description: '填写本次订单号' } } : {},
    },
    document: {},
    steps: [
      { id: 'step-001', name: 'step-001 | click', operation: 'click', flow: [{ aiTap: '查询菜单' }] },
      { id: 'step-002', name: 'step-002 | input', operation: 'input', flow: [{ KeyboardTypeText: { locate: '订单号标签右侧的输入框', value: '{{step-002-input}}', mode: 'replace' } }] },
    ],
  };
}

test('复制指令保留插件链接，随任务和运行方式变化，不包含运行输入', () => {
  assert.equal(executionInstruction('air-tickets-demo', 'act'), '[电脑操控](plugin://computer-use@buildin_extension) 运行录制任务 air-tickets-demo 自适应运行');
  assert.equal(executionInstruction('query', 'task'), '[电脑操控](plugin://computer-use@buildin_extension) 运行录制任务 query 按步骤运行');
  assert.equal(executionInstruction('', 'task'), '');
});

test('参数卡片从保存的任务获取步骤位置和目标描述，无参数不构造虚假输入', () => {
  const view = fixture();
  const original = structuredClone(view);
  assert.deepEqual(executionParameters(view), [{
    id: 'step-002-input', definition: view.manifest.inputs['step-002-input'], stepNumber: 2, target: '订单号标签右侧的输入框',
  }]);
  assert.deepEqual(view, original);
  assert.deepEqual(executionParameters(fixture(false)), []);
  view.manifest.inputs.extra = { type: 'string', label: '额外输入', default: '' };
  assert.equal(executionParameters(view)[1].stepNumber, undefined);
});

interface HostNode {
  tag: string;
  text: string;
  props: Record<string, any>;
  children: HostNode[];
  parent?: HostNode;
  focus(): void;
  select(): void;
}
function node(tag: string, text = ''): HostNode { return { tag, text, props: {}, children: [], focus() {}, select() {} }; }
function nodes(root: HostNode): HostNode[] { return [root, ...root.children.flatMap(nodes)]; }
function text(root: HostNode): string { return nodes(root).map(item => item.text).join(' '); }
async function settle(): Promise<void> { for (let i = 0; i < 12; i++) { await Promise.resolve(); await nextTick(); } }

async function mountWorkspace(options: { withInputs?: boolean; status?: TaskExecutionStatus; rejectCopy?: boolean; failTask?: boolean; failStatus?: boolean } = {}) {
  const view = fixture(options.withInputs);
  const task: TaskCatalogReadyItem = { ...view.manifest, status: 'ready', origin: 'user', writable: true, taskRoot: '', taskYamlPath: '', taskCount: 2, actionCount: 2 };
  let currentStatus: TaskExecutionStatus = options.status ?? { phase: 'idle' };
  const starts: any[] = [];
  const copies: string[] = [];
  const calls: string[] = [];
  const api = {
    tasks: async () => { calls.push('tasks'); return { tasks: [task] }; },
    task: async () => { calls.push('task'); if (options.failTask) throw new Error('task unavailable'); return structuredClone(view); },
    executionStatus: async () => { if (options.failStatus) throw new Error('connection lost'); return structuredClone(currentStatus); },
    startExecution: async (request: unknown) => { starts.push(request); currentStatus = { phase: 'preparing', scene: 'orders', task: 'query', mode: 'task', startsAt: new Date(Date.now() + 5000).toISOString() }; return currentStatus; },
    stopExecution: async () => { currentStatus = { phase: 'idle' }; return currentStatus; },
  };
  const file = new URL('../../review/web/src/components/ExecutionWorkspace.vue', import.meta.url);
  const { descriptor } = parse(await readFile(file, 'utf8'));
  const compiled = compileScript(descriptor, { id: 'execution-workspace-test', inlineTemplate: true });
  const { outputText } = transpileModule(compiled.content, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } });
  const exports: { default?: Component } = {};
  const realRequire = createRequire(file);
  const load = (id: string) => {
    if (id === 'vue') return { ...realRequire(id), vModelText: {} };
    if (id === '../api') return { api };
    if (id === '../i18n') return { useI18n };
    if (id === '../execution-feedback') return { executionFeedback };
    if (id === '../execution-presentation') return { executionInstruction, executionParameters };
    if (id.endsWith('.svg')) return { default: id };
    if (id.endsWith('TaskCatalog.vue')) return { default: 'task-catalog' };
    if (id.endsWith('ReviewSelect.vue')) return { default: 'review-select' };
    return realRequire(id);
  };
  const navigator = { clipboard: { writeText: async (value: string) => { if (options.rejectCopy) throw new Error('denied'); copies.push(value); } } };
  new Function('require', 'exports', 'navigator', outputText)(load, exports, navigator);
  const renderer = createRenderer<HostNode, HostNode>({
    createElement: tag => node(tag), createText: value => node('#text', value), createComment: value => node('#comment', value),
    setText: (item, value) => { item.text = value; }, setElementText: (item, value) => { item.text = value; item.children = []; },
    parentNode: item => item.parent ?? null,
    nextSibling: item => { const siblings = item.parent?.children ?? []; return siblings[siblings.indexOf(item) + 1] ?? null; },
    patchProp: (item, key, _old, value) => { item.props[key] = value; },
    insert(item, parent, anchor) {
      if (item.parent) item.parent.children.splice(item.parent.children.indexOf(item), 1);
      item.parent = parent;
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      if (index < 0) parent.children.push(item); else parent.children.splice(index, 0, item);
    },
    remove(item) { if (item.parent) item.parent.children.splice(item.parent.children.indexOf(item), 1); },
  });
  const root = node('root');
  const app = renderer.createApp(exports.default!, {
    scenes: [{ schemaVersion: '0.1', scene: 'orders', title: '订单管理', description: '', status: 'ready', origins: ['user'], writable: true, sceneRoots: [] }],
    initialScene: 'orders', initialTask: 'query',
  });
  app.mount(root);
  await settle();
  return { root, starts, copies, calls, view, unmount: () => app.unmount() };
}

test('实际页面展示参数、复制指令并仅将本次输入传给执行接口', async () => {
  const mounted = await mountWorkspace();
  try {
    assert.match(text(mounted.root), /步骤 2 · 输入文本.*订单号标签右侧的输入框/s);
    const input = nodes(mounted.root).find(item => item.props['aria-label'] === '订单号')!;
    input.props['onUpdate:modelValue']('ORDER-2');
    const select = nodes(mounted.root).find(item => item.tag === 'review-select')!;
    select.props['onUpdate:modelValue']('act');
    await settle();
    await nodes(mounted.root).find(item => item.props['aria-label'] === '复制运行指令')!.props.onClick();
    assert.equal(mounted.copies[0], executionInstruction('query', 'act'));
    assert.match(text(mounted.root), /指令已复制/);
    await nodes(mounted.root).find(item => String(item.props.class).includes('execution-start'))!.props.onClick();
    await settle();
    assert.deepEqual(mounted.starts[0], { scene: 'orders', task: 'query', mode: 'act', inputs: { 'step-002-input': 'ORDER-2' } });
    assert.equal(mounted.view.manifest.inputs['step-002-input'].default, 'ORDER-1');
    assert.match(text(mounted.root), /取消准备/);
    assert.equal(nodes(mounted.root).find(item => item.tag === 'task-catalog')!.props.busy, true);
    assert.equal(nodes(mounted.root).find(item => item.props['aria-label'] === '订单号')!.props.disabled, true);
  } finally { mounted.unmount(); }
});

test('无参数页面使用插画，允许直接准备，复制失败显示手动复制提示', async () => {
  const mounted = await mountWorkspace({ withInputs: false, rejectCopy: true });
  try {
    assert.match(text(mounted.root), /此任务没有运行参数，可以直接准备运行/);
    assert.ok(nodes(mounted.root).some(item => item.tag === 'img' && String(item.props.src).includes('execution-empty.svg')));
    assert.equal(nodes(mounted.root).find(item => String(item.props.class).includes('execution-start'))!.props.disabled, false);
    await nodes(mounted.root).find(item => item.props['aria-label'] === '复制运行指令')!.props.onClick();
    await settle();
    assert.match(text(mounted.root), /无法自动复制/);
    assert.equal(mounted.copies.length, 0);
    assert.equal(mounted.starts.length, 0);
  } finally { mounted.unmount(); }
});

test('失败结果使用真实提示和报告链接，不展示 Agent 思考或自动创建定时任务', async () => {
  const mounted = await mountWorkspace({ status: { phase: 'failed', scene: 'orders', task: 'query', mode: 'task', error: 'TimeoutError', result: { reportUrl: '/api/execution/runs/run-id/report' } } });
  try {
    assert.match(text(mounted.root), /运行等待超时/);
    assert.ok(nodes(mounted.root).some(item => item.tag === 'a' && item.props.href === '/api/execution/runs/run-id/report'));
    assert.ok(nodes(mounted.root).filter(item => item.tag === 'details').every(item => !item.props.open));
    assert.doesNotMatch(text(mounted.root), /思考完成|创建定时任务/);
    assert.equal(mounted.starts.length, 0);
  } finally { mounted.unmount(); }
});

test('运行中恢复任务身份和模式，不接受切换任务', async () => {
  const mounted = await mountWorkspace({ status: { phase: 'running', scene: 'orders', task: 'query', mode: 'act' } });
  try {
    assert.equal(nodes(mounted.root).find(item => item.tag === 'review-select')!.props.modelValue, 'act');
    const catalog = nodes(mounted.root).find(item => item.tag === 'task-catalog')!;
    const count = mounted.calls.length;
    await catalog.props.onSelect({ scene: 'other', task: 'other' });
    assert.equal(mounted.calls.length, count);
    assert.equal(catalog.props.busy, true);
    assert.match(text(mounted.root), /停止任务/);
  } finally { mounted.unmount(); }
});

test('任务详情不可读时仍能停止活动运行，状态连接异常时禁止新运行', async () => {
  const running = await mountWorkspace({ failTask: true, status: { phase: 'running', scene: 'orders', task: 'query', mode: 'task' } });
  try {
    const stop = nodes(running.root).find(item => String(item.props.class).includes('execution-stop'))!;
    assert.ok(stop);
    assert.equal(stop.props.disabled, false);
    await stop.props.onClick();
    await settle();
    assert.match(text(running.root), /等待运行/);
  } finally { running.unmount(); }
  const disconnected = await mountWorkspace({ failStatus: true });
  try {
    const start = nodes(disconnected.root).find(item => String(item.props.class).includes('execution-start'))!;
    assert.equal(start.props.disabled, true);
    await start.props.onClick();
    assert.equal(disconnected.starts.length, 0);
    assert.match(text(disconnected.root), /暂时无法获取运行状态/);
  } finally { disconnected.unmount(); }
});
