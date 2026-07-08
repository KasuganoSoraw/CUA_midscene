import { agentForComputer } from '@midscene/computer';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { checkRequiredModelEnv, warnIfNodeVersionIsOld } from '../env.js';
import { createKeyboardTypeTextAction } from './keyboard-type-action.js';
import type { MidsceneFlow, MidsceneFlowRoute, MidsceneFlowStep } from './types.js';

type ComputerAgent = Awaited<ReturnType<typeof agentForComputer>>;

interface RunOptions {
  project: string;
  flowPath: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): RunOptions {
  const options = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === '--dry-run') {
      options.set('dry-run', true);
      continue;
    }

    if (!current.startsWith('--')) continue;
    const key = current.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`参数 --${key} 缺少值`);
    }
    options.set(key, value);
    i += 1;
  }

  const project = options.get('project');
  if (typeof project !== 'string') {
    throw new Error('必须提供 --project <project-name>');
  }

  const defaultFlowPath = path.join('projects', project, 'ir', 'midscene-flow.json');
  const flowPath = options.get('flow');

  return {
    project,
    flowPath: typeof flowPath === 'string' ? flowPath : defaultFlowPath,
    dryRun: options.get('dry-run') === true,
  };
}

async function readFlow(flowPath: string): Promise<MidsceneFlow> {
  try {
    return JSON.parse(await readFile(flowPath, 'utf8')) as MidsceneFlow;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`读取 Midscene flow 失败：${flowPath}\n${message}`);
  }
}

function assertSupportedRoute(step: MidsceneFlowStep): void {
  switch (step.route.strategy) {
    case 'keyboard':
    case 'input':
    case 'tap':
    case 'act':
    case 'wait':
      return;
    case 'manual-review':
      throw new Error(`step ${step.id} 需要人工审查：${step.route.reason}`);
    default: {
      const unknown = step.route as MidsceneFlowRoute;
      throw new Error(`step ${step.id} 使用了不受支持的策略：${String(unknown.strategy)}`);
    }
  }
}

function validateFlow(flow: MidsceneFlow): void {
  if (!flow.schemaVersion || !flow.project || !Array.isArray(flow.steps)) {
    throw new Error('无效 Midscene flow：缺少 schemaVersion、project 或 steps');
  }

  for (const step of flow.steps) {
    assertSupportedRoute(step);
  }
}

function describeRoute(step: MidsceneFlowStep): string {
  const route = step.route;
  switch (route.strategy) {
    case 'keyboard':
      return `${step.id} keyboard ${route.keyName}`;
    case 'input':
      return `${step.id} input KeyboardTypeText locate "${route.locatePrompt}" -> ${renderPrompt(route.prompt, route.value)} = ${route.value}`;
    case 'tap':
      return `${step.id} tap ${route.prompt}`;
    case 'act':
      return `${step.id} act ${route.prompt}`;
    case 'wait':
      return `${step.id} wait ${route.condition}`;
    case 'manual-review':
      return `${step.id} manual-review ${route.reason}`;
  }
}

function renderPrompt(prompt: string, value: string): string {
  return prompt.replaceAll('{{value}}', value);
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

async function run(options: RunOptions): Promise<void> {
  const flow = await readFlow(options.flowPath);
  validateFlow(flow);

  if (options.dryRun) {
    console.log(`Midscene flow dry-run 通过：${options.flowPath}`);
    for (const step of flow.steps) {
      console.log(describeRoute(step));
    }
    return;
  }

  warnIfNodeVersionIsOld();
  checkRequiredModelEnv();

  const keyboardTypeText = createKeyboardTypeTextAction();
  const agent = await agentForComputer({
    generateReport: true,
    groupName: `midscene-flow-${flow.project}`,
    groupDescription: flow.goal || `执行 Midscene flow：${flow.project}`,
    customActions: [keyboardTypeText.action],
  });
  const keyboard = agent.interface.inputPrimitives?.keyboard;
  if (!keyboard?.keyboardPress) {
    throw new Error('当前 Midscene computer interface 不支持底层 keyboardPress 输入');
  }
  keyboardTypeText.setPressKey(async (keyName, target) => {
    await keyboard.keyboardPress(keyName, { target });
  });

  try {
    for (const step of flow.steps) {
      console.log(`执行 ${describeRoute(step)}`);
      await executeStep(agent, step);
    }
  } finally {
    await agent.destroy();
  }
}

run(parseArgs(process.argv.slice(2))).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
