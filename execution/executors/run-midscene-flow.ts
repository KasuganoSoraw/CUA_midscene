import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createKeyboardEnabledComputerAgent, type ComputerAgent } from './computer-agent.js';
import { checkRequiredModelEnv, warnIfNodeVersionIsOld } from './env.js';
import {
  readResolvedFlow,
  type MidsceneFlowStep,
  type ResolvedFlowSnapshot,
} from './resolved-flow-contract.js';

interface RunOptions {
  resolvedFlowPath: string;
  resultPath: string;
  dryRun: boolean;
}

interface ExecutorResult {
  schemaVersion: '0.1';
  status: 'succeeded' | 'failed';
  scene?: string;
  task?: string;
  resolvedFlowPath: string;
  dryRun: boolean;
  stepCount?: number;
  completedStepIds: string[];
  finishedAt: string;
  error?: string;
}

function parseArgs(argv: string[]): RunOptions {
  const values = new Map<string, string>();
  let dryRun = false;
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === '--dry-run') {
      if (dryRun) throw new Error('参数 --dry-run 不能重复提供');
      dryRun = true;
      continue;
    }
    if (current !== '--resolved-flow' && current !== '--result') {
      throw new Error(`无法识别参数：${current}`);
    }
    if (values.has(current)) throw new Error(`参数 ${current} 不能重复提供`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`参数 ${current} 缺少值`);
    values.set(current, value);
    index += 1;
  }
  const resolvedFlow = values.get('--resolved-flow');
  const result = values.get('--result');
  if (!resolvedFlow) throw new Error('必须提供 --resolved-flow <path>');
  if (!result) throw new Error('必须提供 --result <path>');
  return {
    resolvedFlowPath: path.resolve(resolvedFlow),
    resultPath: path.resolve(result),
    dryRun,
  };
}

function describeRoute(step: MidsceneFlowStep): string {
  const route = step.route;
  switch (route.strategy) {
    case 'keyboard':
      return `${describeStepTiming(step)}${step.id} keyboard ${route.keyName}`;
    case 'input':
      return `${describeStepTiming(step)}${step.id} input KeyboardTypeText locate "${route.locatePrompt}" -> ${renderPrompt(route.prompt, route.value)} = ${route.value}`;
    case 'tap':
      return `${describeStepTiming(step)}${step.id} tap ${route.prompt}`;
    case 'act':
      return `${describeStepTiming(step)}${step.id} act ${route.prompt}`;
    case 'wait':
      return `${describeStepTiming(step)}${step.id} wait ${route.condition}`;
    case 'manual-review':
      return `${describeStepTiming(step)}${step.id} manual-review ${route.reason}`;
  }
}

function renderPrompt(prompt: string, value: string): string {
  return prompt.replaceAll('{{value}}', value);
}

function describeStepTiming(step: MidsceneFlowStep): string {
  const waitBeforeMs = step.timing?.waitBeforeMs ?? 0;
  return waitBeforeMs > 0 ? `[wait ${waitBeforeMs}ms] ` : '';
}

async function delay(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitBeforeStep(step: MidsceneFlowStep): Promise<void> {
  const waitBeforeMs = step.timing?.waitBeforeMs ?? 0;
  if (waitBeforeMs <= 0) return;
  console.error(`等待 ${waitBeforeMs}ms 后执行 ${step.id}（来源：${step.timing?.waitReason ?? 'resolved flow'}）`);
  await delay(waitBeforeMs);
}

async function executeStep(agent: ComputerAgent, step: MidsceneFlowStep): Promise<void> {
  const route = step.route;
  switch (route.strategy) {
    case 'keyboard':
      await agent.callActionInActionSpace('KeyboardPress', { keyName: route.keyName });
      return;
    case 'input':
      await agent.callActionInActionSpace('KeyboardTypeText', {
        locate: { prompt: route.locatePrompt },
        value: route.value,
        mode: route.mode ?? 'replace',
      });
      return;
    case 'tap':
      await agent.aiTap(route.prompt);
      return;
    case 'act':
      await agent.aiAct(route.prompt);
      return;
    case 'wait':
      await agent.aiWaitFor(route.prompt ?? route.condition, { timeoutMs: route.timeoutMs ?? 15000 });
      return;
    case 'manual-review':
      throw new Error(`step ${step.id} 需要人工审查：${route.reason}`);
  }
}

async function writeResult(resultPath: string, result: ExecutorResult): Promise<void> {
  await mkdir(path.dirname(resultPath), { recursive: true });
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

async function executeFlow(flow: ResolvedFlowSnapshot, dryRun: boolean): Promise<string[]> {
  if (dryRun) {
    console.error(`Midscene executor dry-run 通过：${flow.flow.scene}/${flow.flow.task}`);
    for (const step of flow.flow.steps) console.error(describeRoute(step));
    return [];
  }

  warnIfNodeVersionIsOld();
  checkRequiredModelEnv();
  const agent = await createKeyboardEnabledComputerAgent({
    generateReport: true,
    groupName: `midscene-flow-${flow.flow.scene}-${flow.flow.task}`,
    groupDescription: flow.flow.goal || `执行 Midscene flow：${flow.flow.scene}/${flow.flow.task}`,
  });

  const completedStepIds: string[] = [];
  try {
    for (const step of flow.flow.steps) {
      await waitBeforeStep(step);
      console.error(`执行 ${describeRoute(step)}`);
      await executeStep(agent, step);
      completedStepIds.push(step.id);
    }
    return completedStepIds;
  } finally {
    await agent.destroy();
  }
}

async function run(options: RunOptions): Promise<void> {
  let flow: ResolvedFlowSnapshot | undefined;
  let completedStepIds: string[] = [];
  try {
    flow = await readResolvedFlow(options.resolvedFlowPath);
    completedStepIds = await executeFlow(flow, options.dryRun);
    await writeResult(options.resultPath, {
      schemaVersion: '0.1',
      status: 'succeeded',
      scene: flow.flow.scene,
      task: flow.flow.task,
      resolvedFlowPath: options.resolvedFlowPath,
      dryRun: options.dryRun,
      stepCount: flow.flow.steps.length,
      completedStepIds,
      finishedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeResult(options.resultPath, {
      schemaVersion: '0.1',
      status: 'failed',
      scene: flow?.flow.scene,
      task: flow?.flow.task,
      resolvedFlowPath: options.resolvedFlowPath,
      dryRun: options.dryRun,
      stepCount: flow?.flow.steps.length,
      completedStepIds,
      finishedAt: new Date().toISOString(),
      error: message,
    });
    throw error;
  }
}

run(parseArgs(process.argv.slice(2))).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
