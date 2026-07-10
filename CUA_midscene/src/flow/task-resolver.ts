import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { MidsceneFlow, MidsceneFlowRoute, MidsceneFlowStep } from './types.js';
import {
  FLOW_OVERRIDES_SCHEMA_VERSION,
  RESOLVED_FLOW_SCHEMA_VERSION,
  TASK_PROJECT_SCHEMA_VERSION,
  type FlowOverrides,
  type FlowStepPatch,
  type ResolvedFlowResult,
  type ResolvedFlowSnapshot,
  type TaskProjectConfig,
} from './task-types.js';

export interface ResolveProjectOptions {
  project: string;
  projectRoot?: string;
  flowPath?: string;
  inputs?: Record<string, string>;
}

export interface TaskProjectPaths {
  projectRoot: string;
  flowPath: string;
  projectConfigPath: string;
  overridesPath: string;
  proposalsDir: string;
  historyDir: string;
  reportsDir: string;
}

const ROUTE_KEYS: Record<MidsceneFlowRoute['strategy'], Set<string>> = {
  keyboard: new Set(['strategy', 'keyName']),
  input: new Set(['strategy', 'prompt', 'locatePrompt', 'value', 'mode', 'inputMethod']),
  tap: new Set(['strategy', 'prompt']),
  act: new Set(['strategy', 'prompt']),
  wait: new Set(['strategy', 'prompt', 'condition', 'timeoutMs']),
  'manual-review': new Set(['strategy', 'reason']),
};

export function taskProjectPaths(project: string, projectRoot?: string, flowPath?: string): TaskProjectPaths {
  const root = path.resolve(projectRoot ?? path.join('projects', project));
  return {
    projectRoot: root,
    flowPath: path.resolve(flowPath ?? path.join(root, 'ir', 'midscene-flow.json')),
    projectConfigPath: path.join(root, 'config', 'project.json'),
    overridesPath: path.join(root, 'config', 'flow-overrides.json'),
    proposalsDir: path.join(root, 'calibration', 'proposals'),
    historyDir: path.join(root, 'calibration', 'history'),
    reportsDir: path.join(root, 'reports'),
  };
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`读取 JSON 失败：${filePath}\n${message}`);
  }
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function fingerprintFlowContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export async function readFlowWithFingerprint(flowPath: string): Promise<{ flow: MidsceneFlow; fingerprint: string }> {
  let content: string;
  try {
    content = await readFile(flowPath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`读取 Midscene flow 失败：${flowPath}\n${message}`);
  }

  let flow: MidsceneFlow;
  try {
    flow = JSON.parse(content) as MidsceneFlow;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`解析 Midscene flow 失败：${flowPath}\n${message}`);
  }
  return { flow, fingerprint: fingerprintFlowContent(content) };
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} 必须是非空字符串`);
  }
}

function assertNonNegativeNumber(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${field} 必须是非负有限数值`);
  }
}

export function validateRoute(route: unknown, field = 'route', executable = true): asserts route is MidsceneFlowRoute {
  if (!route || typeof route !== 'object' || Array.isArray(route)) {
    throw new Error(`${field} 必须是对象`);
  }
  const candidate = route as Record<string, unknown>;
  const strategy = candidate.strategy;
  if (typeof strategy !== 'string' || !Object.hasOwn(ROUTE_KEYS, strategy)) {
    throw new Error(`${field}.strategy 不受支持：${String(strategy)}`);
  }
  const typedStrategy = strategy as MidsceneFlowRoute['strategy'];
  for (const key of Object.keys(candidate)) {
    if (!ROUTE_KEYS[typedStrategy].has(key)) {
      throw new Error(`${field} 包含 ${typedStrategy} 不允许的字段：${key}`);
    }
  }

  switch (typedStrategy) {
    case 'keyboard':
      assertNonEmptyString(candidate.keyName, `${field}.keyName`);
      break;
    case 'input':
      assertNonEmptyString(candidate.prompt, `${field}.prompt`);
      assertNonEmptyString(candidate.locatePrompt, `${field}.locatePrompt`);
      if (typeof candidate.value !== 'string') throw new Error(`${field}.value 必须是字符串`);
      if (candidate.mode !== undefined && !['replace', 'append', 'typeOnly'].includes(String(candidate.mode))) {
        throw new Error(`${field}.mode 不受支持：${String(candidate.mode)}`);
      }
      if (candidate.inputMethod !== undefined && candidate.inputMethod !== 'keyboard-action') {
        throw new Error(`${field}.inputMethod 必须是 keyboard-action`);
      }
      break;
    case 'tap':
    case 'act':
      assertNonEmptyString(candidate.prompt, `${field}.prompt`);
      break;
    case 'wait':
      assertNonEmptyString(candidate.condition, `${field}.condition`);
      if (candidate.prompt !== undefined) assertNonEmptyString(candidate.prompt, `${field}.prompt`);
      if (candidate.timeoutMs !== undefined) assertNonNegativeNumber(candidate.timeoutMs, `${field}.timeoutMs`);
      break;
    case 'manual-review':
      assertNonEmptyString(candidate.reason, `${field}.reason`);
      if (executable) throw new Error(`${field} 需要人工审查：${candidate.reason}`);
      break;
  }
}

export function validateFlow(flow: MidsceneFlow, executable = true): void {
  assertNonEmptyString(flow.schemaVersion, 'flow.schemaVersion');
  assertNonEmptyString(flow.project, 'flow.project');
  if (!Array.isArray(flow.steps)) throw new Error('flow.steps 必须是数组');

  const ids = new Set<string>();
  for (const step of flow.steps) {
    assertNonEmptyString(step.id, 'step.id');
    if (ids.has(step.id)) throw new Error(`flow 包含重复 step id：${step.id}`);
    ids.add(step.id);
    validateRoute(step.route, `${step.id}.route`, executable);
    if (step.timing?.waitBeforeMs !== undefined) {
      assertNonNegativeNumber(step.timing.waitBeforeMs, `${step.id}.timing.waitBeforeMs`);
    }
  }
}

export function validateProjectConfig(config: TaskProjectConfig, flow: MidsceneFlow): void {
  if (config.schemaVersion !== TASK_PROJECT_SCHEMA_VERSION) {
    throw new Error(`不支持的 project.json schemaVersion：${String(config.schemaVersion)}`);
  }
  if (config.project !== flow.project) {
    throw new Error(`project.json 项目 ${config.project} 与 flow 项目 ${flow.project} 不一致`);
  }
  assertNonEmptyString(config.title, 'project.title');
  if (typeof config.description !== 'string') throw new Error('project.description 必须是字符串');
  if (typeof config.goal !== 'string') throw new Error('project.goal 必须是字符串');
  if (!config.inputs || typeof config.inputs !== 'object' || Array.isArray(config.inputs)) {
    throw new Error('project.inputs 必须是对象');
  }

  const stepMap = new Map(flow.steps.map((step) => [step.id, step]));
  for (const [inputId, input] of Object.entries(config.inputs)) {
    assertNonEmptyString(inputId, 'input id');
    if (input.type !== 'string') throw new Error(`输入 ${inputId} 只支持 string 类型`);
    assertNonEmptyString(input.label, `输入 ${inputId}.label`);
    if (typeof input.default !== 'string') throw new Error(`输入 ${inputId}.default 必须是字符串`);
    if (input.binding?.field !== 'route.value') throw new Error(`输入 ${inputId} 只允许绑定 route.value`);
    const step = stepMap.get(input.binding.stepId);
    if (!step) throw new Error(`输入 ${inputId} 绑定了不存在的 step：${input.binding.stepId}`);
    if (step.route.strategy !== 'input') throw new Error(`输入 ${inputId} 只能绑定 input route：${step.id}`);
  }
}

function validatePatchKeys(patch: FlowStepPatch, stepId: string): void {
  const keys = Object.keys(patch as object);
  for (const key of keys) {
    if (key !== 'route' && key !== 'timing') throw new Error(`${stepId} 校准包含不允许的字段：${key}`);
  }
  if (!patch.route && !patch.timing) throw new Error(`${stepId} 校准必须包含 route 或 timing`);
  if (patch.timing) {
    for (const key of Object.keys(patch.timing)) {
      if (key !== 'waitBeforeMs') throw new Error(`${stepId}.timing 只允许修改 waitBeforeMs`);
    }
    if (patch.timing.waitBeforeMs !== undefined) {
      assertNonNegativeNumber(patch.timing.waitBeforeMs, `${stepId}.timing.waitBeforeMs`);
    }
  }
}

export function applyStepPatch(step: MidsceneFlowStep, patch: FlowStepPatch): MidsceneFlowStep {
  validatePatchKeys(patch, step.id);
  const result = structuredClone(step);

  if (patch.route) {
    const patchStrategy = patch.route.strategy;
    const strategyChanges = patchStrategy !== undefined && patchStrategy !== step.route.strategy;
    const candidate = strategyChanges
      ? patch.route
      : { ...step.route, ...patch.route, strategy: step.route.strategy };
    validateRoute(candidate, `${step.id}.route`);
    result.route = candidate;
  }

  if (patch.timing) {
    result.timing = {
      ...result.timing,
      ...patch.timing,
      waitReason: 'manual-calibration',
    };
  }
  return result;
}

export function validateOverrides(overrides: FlowOverrides, flow: MidsceneFlow): void {
  if (overrides.schemaVersion !== FLOW_OVERRIDES_SCHEMA_VERSION) {
    throw new Error(`不支持的 flow-overrides schemaVersion：${String(overrides.schemaVersion)}`);
  }
  if (overrides.project !== flow.project) {
    throw new Error(`flow-overrides 项目 ${overrides.project} 与 flow 项目 ${flow.project} 不一致`);
  }
  if (!overrides.steps || typeof overrides.steps !== 'object' || Array.isArray(overrides.steps)) {
    throw new Error('flow-overrides.steps 必须是对象');
  }
  const stepMap = new Map(flow.steps.map((step) => [step.id, step]));
  for (const [stepId, patch] of Object.entries(overrides.steps)) {
    const step = stepMap.get(stepId);
    if (!step) throw new Error(`flow-overrides 引用了不存在的 step：${stepId}`);
    applyStepPatch(step, patch);
  }
}

function applyOverrides(flow: MidsceneFlow, overrides: FlowOverrides): MidsceneFlow {
  const result = structuredClone(flow);
  result.steps = result.steps.map((step) => {
    const patch = overrides.steps[step.id];
    return patch ? applyStepPatch(step, patch) : step;
  });
  return result;
}

function applyInputs(
  flow: MidsceneFlow,
  config: TaskProjectConfig,
  providedInputs: Record<string, string>,
): { flow: MidsceneFlow; values: Record<string, string> } {
  for (const inputId of Object.keys(providedInputs)) {
    if (!Object.hasOwn(config.inputs, inputId)) throw new Error(`未知输入参数：${inputId}`);
  }

  const result = structuredClone(flow);
  const stepMap = new Map(result.steps.map((step) => [step.id, step]));
  const values: Record<string, string> = {};
  for (const [inputId, definition] of Object.entries(config.inputs)) {
    const value = Object.hasOwn(providedInputs, inputId) ? providedInputs[inputId] : definition.default;
    values[inputId] = value;
    const step = stepMap.get(definition.binding.stepId);
    if (!step || step.route.strategy !== 'input') {
      throw new Error(`输入 ${inputId} 的绑定已失效：${definition.binding.stepId}`);
    }
    step.route.value = value;
  }
  return { flow: result, values };
}

export async function resolveProjectFlow(options: ResolveProjectOptions): Promise<ResolvedFlowResult> {
  const paths = taskProjectPaths(options.project, options.projectRoot, options.flowPath);
  const [{ flow: baseFlow, fingerprint }, config, overrides] = await Promise.all([
    readFlowWithFingerprint(paths.flowPath),
    readJsonFile<TaskProjectConfig>(paths.projectConfigPath),
    readJsonFile<FlowOverrides>(paths.overridesPath),
  ]);

  validateFlow(baseFlow);
  if (baseFlow.project !== options.project) {
    throw new Error(`请求项目 ${options.project} 与 flow 项目 ${baseFlow.project} 不一致`);
  }
  validateProjectConfig(config, baseFlow);
  validateOverrides(overrides, baseFlow);

  const calibratedFlow = applyOverrides(baseFlow, overrides);
  const resolved = applyInputs(calibratedFlow, config, options.inputs ?? {});
  validateFlow(resolved.flow);

  return {
    flow: resolved.flow,
    sources: {
      baseFlowPath: paths.flowPath,
      projectConfigPath: paths.projectConfigPath,
      overridesPath: paths.overridesPath,
      baseFlowFingerprint: fingerprint,
      appliedOverrideSteps: Object.keys(overrides.steps),
    },
    inputs: resolved.values,
  };
}

export function createResolvedFlowSnapshot(result: ResolvedFlowResult): ResolvedFlowSnapshot {
  return {
    schemaVersion: RESOLVED_FLOW_SCHEMA_VERSION,
    resolvedAt: new Date().toISOString(),
    ...result,
  };
}

export async function writeResolvedFlowSnapshot(
  result: ResolvedFlowResult,
  reportsDir: string,
): Promise<string> {
  const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const runDir = path.join(reportsDir, runId);
  const snapshotPath = path.join(runDir, 'resolved-flow.json');
  await mkdir(runDir, { recursive: true });
  await writeFile(snapshotPath, `${JSON.stringify(createResolvedFlowSnapshot(result), null, 2)}\n`, 'utf8');
  return snapshotPath;
}

export function createInitialProjectConfig(flow: MidsceneFlow): TaskProjectConfig {
  const inputs: TaskProjectConfig['inputs'] = {};
  for (const step of flow.steps) {
    if (step.route.strategy !== 'input') continue;
    const inputId = `${step.id}-value`;
    inputs[inputId] = {
      type: 'string',
      label: `${step.route.locatePrompt}输入值`,
      description: step.route.prompt,
      default: step.route.value,
      binding: { stepId: step.id, field: 'route.value' },
    };
  }
  return {
    schemaVersion: TASK_PROJECT_SCHEMA_VERSION,
    project: flow.project,
    title: flow.project,
    description: flow.goal,
    goal: flow.goal,
    inputs,
  };
}

export function createEmptyOverrides(project: string): FlowOverrides {
  return { schemaVersion: FLOW_OVERRIDES_SCHEMA_VERSION, project, steps: {} };
}
