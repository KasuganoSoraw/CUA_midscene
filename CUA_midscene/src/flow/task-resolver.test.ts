import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createEmptyOverrides,
  fingerprintFlowContent,
  resolveProjectFlow,
  validateOverrides,
} from './task-resolver.js';
import {
  FLOW_OVERRIDES_SCHEMA_VERSION,
  TASK_PROJECT_SCHEMA_VERSION,
  type FlowOverrides,
  type TaskProjectConfig,
} from './task-types.js';
import { MIDSCENE_FLOW_SCHEMA_VERSION, type MidsceneFlow } from './types.js';

const project = 'resolver-test';
const flow: MidsceneFlow = {
  schemaVersion: MIDSCENE_FLOW_SCHEMA_VERSION,
  project,
  goal: '测试任务解析',
  source: { tracePath: 'source/showui-trace.json' },
  steps: [
    {
      id: 'step-001',
      sourceTrace: { stepIndex: 1 },
      intent: '输入关键词',
      evidence: { observation: '', action: '输入默认关键词' },
      route: {
        strategy: 'input',
        prompt: '在搜索框输入 {{value}}',
        locatePrompt: '页面顶部的搜索输入框',
        value: '默认关键词',
        mode: 'replace',
        inputMethod: 'keyboard-action',
      },
      fallback: { strategy: 'vision', instruction: '在搜索框输入 {{value}}' },
    },
    {
      id: 'step-002',
      sourceTrace: { stepIndex: 2 },
      intent: '点击搜索',
      evidence: { observation: '', action: '点击搜索按钮' },
      route: { strategy: 'tap', prompt: '页面右侧的蓝色搜索按钮' },
      fallback: { strategy: 'vision', instruction: '点击搜索按钮' },
    },
  ],
};

const config: TaskProjectConfig = {
  schemaVersion: TASK_PROJECT_SCHEMA_VERSION,
  project,
  title: '解析测试',
  description: '验证任务参数和校准',
  goal: flow.goal,
  inputs: {
    'step-001-value': {
      type: 'string',
      label: '搜索关键词',
      default: '默认关键词',
      binding: { stepId: 'step-001', field: 'route.value' },
    },
  },
};

const root = await mkdtemp(path.join(os.tmpdir(), 'cua-task-resolver-'));
try {
  await mkdir(path.join(root, 'ir'), { recursive: true });
  await mkdir(path.join(root, 'config'), { recursive: true });
  const flowContent = `${JSON.stringify(flow, null, 2)}\n`;
  await writeFile(path.join(root, 'ir', 'midscene-flow.json'), flowContent, 'utf8');
  await writeFile(path.join(root, 'config', 'project.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  const overrides: FlowOverrides = {
    schemaVersion: FLOW_OVERRIDES_SCHEMA_VERSION,
    project,
    steps: {
      'step-002': { route: { prompt: '页面顶部工具栏右侧的蓝色搜索按钮' } },
    },
  };
  await writeFile(path.join(root, 'config', 'flow-overrides.json'), `${JSON.stringify(overrides, null, 2)}\n`, 'utf8');

  const defaults = await resolveProjectFlow({ project, projectRoot: root });
  assert.equal(defaults.flow.steps[0].route.strategy, 'input');
  assert.equal(defaults.flow.steps[0].route.strategy === 'input' && defaults.flow.steps[0].route.value, '默认关键词');
  assert.equal(defaults.flow.steps[1].route.strategy === 'tap' && defaults.flow.steps[1].route.prompt, '页面顶部工具栏右侧的蓝色搜索按钮');
  assert.equal(defaults.sources.baseFlowFingerprint, fingerprintFlowContent(flowContent));

  const sparse = await resolveProjectFlow({
    project,
    projectRoot: root,
    inputs: { 'step-001-value': '47405' },
  });
  assert.equal(sparse.flow.steps[0].route.strategy === 'input' && sparse.flow.steps[0].route.value, '47405');
  assert.equal(sparse.flow.steps[1].route.strategy === 'tap' && sparse.flow.steps[1].route.prompt, '页面顶部工具栏右侧的蓝色搜索按钮');

  await assert.rejects(
    resolveProjectFlow({ project, projectRoot: root, inputs: { unknown: 'value' } }),
    /未知输入参数：unknown/,
  );

  const invalidStepOverrides = createEmptyOverrides(project);
  invalidStepOverrides.steps['step-999'] = { route: { prompt: '不存在的目标' } };
  assert.throws(() => validateOverrides(invalidStepOverrides, flow), /不存在的 step：step-999/);

  const invalidRouteOverrides = createEmptyOverrides(project);
  invalidRouteOverrides.steps['step-002'] = { route: { strategy: 'input', value: '缺少定位字段' } };
  assert.throws(() => validateOverrides(invalidRouteOverrides, flow), /prompt 必须是非空字符串/);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log('任务 resolver 测试通过');
